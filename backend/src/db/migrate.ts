import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  // Note: deliberately checked-then-created rather than a single
  // `CREATE TABLE IF NOT EXISTS`. pg-mem (used by the test pool) fails an
  // internal AST-coverage check when that statement runs a second time
  // against a table that already exists with these constraint types. This
  // form is standard SQL and behaves identically against real Postgres.
  const { rows: existing } = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '_migrations'"
  );
  if (existing.length === 0) {
    await pool.query(`
      CREATE TABLE _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    // Reserve a single client for the whole transaction: separate
    // pool.query() calls can each be serviced by a different physical
    // connection, so BEGIN/COMMIT would not be guaranteed atomic.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

/* Allows `npm run migrate` against the real DATABASE_URL. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadEnv } = await import('../config/env.js');
  const { createPool } = await import('./client.js');
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  await runMigrations(pool, dir);
  await pool.end();
  console.log('Migrations applied.');
}
