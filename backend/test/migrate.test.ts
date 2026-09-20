import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestPool } from './helpers/testDb';
import { runMigrations } from '../src/db/migrate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

describe('runMigrations', () => {
  it('creates all expected tables', async () => {
    const pool = createTestPool();
    await runMigrations(pool, migrationsDir);

    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tableNames = rows.map((r) => r.table_name).sort();
    expect(tableNames).toEqual(
      [
        '_migrations',
        'accounts',
        'bcv_rates',
        'customer_qr_links',
        'customers',
        'devices',
        'invite_tokens',
        'loyalty_levels',
        'margin_rules',
      ].sort()
    );
  });

  it('is idempotent — running twice does not error', async () => {
    const pool = createTestPool();
    await runMigrations(pool, migrationsDir);
    await expect(runMigrations(pool, migrationsDir)).resolves.not.toThrow();
  });
});
