import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { refreshAllActiveCentreAlerts } from './services/alert.service';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`KHORAK API server listening on http://localhost:${env.port}`);

  // Run initial alert evaluation and schedule periodic checks every 5 minutes
  refreshAllActiveCentreAlerts().catch((err) =>
    console.error('Initial alert refresh failed:', err)
  );
  setInterval(() => {
    refreshAllActiveCentreAlerts().catch((err) =>
      console.error('Scheduled alert refresh failed:', err)
    );
  }, 5 * 60 * 1000).unref();
});

async function shutdown() {
  console.log('Shutting down KHORAK API server...');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

