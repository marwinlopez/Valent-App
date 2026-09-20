import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { SheetsClient } from './sheets/client.js';
import { SheetsQueue } from './sheets/queue.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
await runMigrations(pool, migrationsDir);

const sheets = new SheetsClient({
  clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: env.GOOGLE_PRIVATE_KEY,
});
const sheetsQueue = new SheetsQueue();

const app = buildApp({ pool, sheets, sheetsQueue, env });

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
