import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import { errorHandler } from './lib/errors';
import { authRouter } from './routes/auth.routes';
import { inventoryRouter } from './routes/inventory.routes';
import { dispatchRouter } from './routes/dispatch.routes';
import { approvalRouter, discrepancyRouter } from './routes/discrepancy.routes';
import { beneficiaryRouter, distributionRouter } from './routes/distribution.routes';
import { analyticsRouter } from './routes/analytics.routes';
import { syncRouter } from './routes/sync.routes';
import { appealsRouter } from './routes/appeals.routes';
import { stockRequestsRouter } from './routes/stockRequests.routes';
import { entitlementsRouter } from './routes/entitlements.routes';
import { prisma } from './lib/prisma';
import { ensureProductionSchema } from './lib/ensureSchema';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  const allowedOrigins = Array.from(
    new Set([
      ...env.frontendUrl
        .split(',')
        .map((s) => s.trim().replace(/\/+$/, ''))
        .filter(Boolean),
      'https://localhost',
      'http://localhost',
      'capacitor://localhost',
    ])
  );

  app.use(
    cors({
      origin:
        env.nodeEnv === 'development' || allowedOrigins.includes('*')
          ? true
          : allowedOrigins,
      credentials: true,
      // Cache CORS preflight (OPTIONS) results so the browser doesn't pay an
      // extra round trip before every JSON/Authorization request.
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/uploads', express.static(path.resolve(env.uploadDir)));

  app.get(['/health', '/api/health'], async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        success: true,
        status: 'healthy',
        service: 'khorak-api',
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const anyErr = err as { code?: string; name?: string; message?: string };
      const sanitizedMessage = (anyErr?.message || '')
        .replace(/postgres(ql)?:\/\/[^\s'"]+/gi, 'postgresql://[REDACTED]')
        .slice(0, 400);
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        service: 'khorak-api',
        databaseUrlSet: Boolean(process.env.DATABASE_URL),
        errorName: anyErr?.name || 'UnknownError',
        errorCode: anyErr?.code || null,
        errorMessage: sanitizedMessage || null,
      });
    }
  });

  app.use('/api', async (_req, _res, next) => {
    try {
      await ensureProductionSchema();
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/auth', authRouter);
  app.use('/api/inventory', inventoryRouter);
  app.use('/api/dispatches', dispatchRouter);
  app.use('/api/discrepancies', discrepancyRouter);
  app.use('/api/approvals', approvalRouter);
  app.use('/api/distributions', distributionRouter);
  app.use('/api/beneficiaries', beneficiaryRouter);
  app.use('/api/entitlements', entitlementsRouter);
  app.use('/api/appeals', appealsRouter);
  app.use('/api/stock-requests', stockRequestsRouter);
  app.use('/api/sync', syncRouter);
  app.use('/api', analyticsRouter);

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'API endpoint not found',
      },
    });
  });

  app.use(errorHandler);
  return app;
}

