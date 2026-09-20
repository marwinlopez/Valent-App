import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createTestPool } from './testDb.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SheetsQueue } from '../../src/sheets/queue.js';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

export async function buildTestApp(): Promise<{ app: FastifyInstance; env: Env }> {
  const pool = createTestPool();
  await runMigrations(pool, migrationsDir);

  const env: Env = {
    DATABASE_URL: 'test',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
    GOOGLE_PRIVATE_KEY: 'fake',
    JWT_SECRET: 'a'.repeat(20),
    PORT: 3000,
  };

  const sheets = {
    getValues: vi.fn().mockResolvedValue([]),
    appendRow: vi.fn().mockResolvedValue(undefined),
    updateRow: vi.fn().mockResolvedValue(undefined),
  };

  const app = buildApp({ pool, sheets: sheets as any, sheetsQueue: new SheetsQueue(), env });
  return { app, env };
}
