import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const isVercel = Boolean(process.env.VERCEL);
const defaultUploadDir = isVercel ? '/tmp/khorak-uploads' : './uploads';

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isVercel,
  port: Number(process.env.PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/khorak?schema=public',
  jwtSecret:
    process.env.JWT_SECRET ||
    'khorak-dev-access-secret-panchmahal-2026-change-in-prod',
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET ||
    'khorak-dev-refresh-secret-panchmahal-2026-change-in-prod',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || defaultUploadDir),
  maxUploadSizeMb: Number(process.env.MAX_UPLOAD_SIZE_MB || 5),
  expiryWarningDays: Number(process.env.EXPIRY_WARNING_DAYS || 30),
  reorderWarningDays: Number(process.env.REORDER_WARNING_DAYS || 7),
  reorderCriticalDays: Number(process.env.REORDER_CRITICAL_DAYS || 3),
  defaultEstimatedDailyConsumption: Number(
    process.env.DEFAULT_ESTIMATED_DAILY_CONSUMPTION || 8
  ),
};

