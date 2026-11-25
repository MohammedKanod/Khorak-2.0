import EmbeddedPostgres from 'embedded-postgres';
import path from 'path';
import fs from 'fs';
import net from 'net';

function isPortOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function main() {
  const alreadyRunning = await isPortOpen(5432);
  if (alreadyRunning) {
    console.log('PostgreSQL is already listening on port 5432.');
    return;
  }

  const databaseDir = path.resolve(process.cwd(), '.pg-data');
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port: 5432,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: (msg: string) => {
      if (process.env.DEBUG_PG) console.log('[pg]', msg);
    },
    onError: (err: unknown) => {
      console.error('[pg-err]', err);
    },
  });

  if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    await pg.initialise();
  }
  await pg.start();

  try {
    await pg.createDatabase('khorak');
    console.log('Created UTF-8 database "khorak".');
  } catch {
    console.log('Database "khorak" already exists.');
  }

  console.log('Embedded PostgreSQL (UTF-8) running on postgresql://postgres:postgres@localhost:5432/khorak');

  const shutdown = async () => {
    console.log('\nStopping Embedded PostgreSQL...');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start PostgreSQL:', err);
  process.exit(1);
});
