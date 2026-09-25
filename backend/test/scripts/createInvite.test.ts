import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createTestPool } from '../helpers/testDb';
import { runMigrations } from '../../src/db/migrate';
import { insertAccount } from '../helpers/factories';
import { createInvite } from '../../scripts/create-invite';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

describe('createInvite', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await runMigrations(pool, migrationsDir);
  });

  it('inserts a single-use invite token for the account and role', async () => {
    const account = await insertAccount(pool);

    const result = await createInvite(pool, account.id, 'ADMIN');

    const { rows } = await pool.query(
      'SELECT account_id, role, used_at, expires_at FROM invite_tokens WHERE id = $1',
      [result.inviteToken]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(account.id);
    expect(rows[0].role).toBe('ADMIN');
    expect(rows[0].used_at).toBeNull();
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an account id that does not exist', async () => {
    await expect(
      createInvite(pool, '00000000-0000-0000-0000-000000000000', 'ADMIN')
    ).rejects.toThrow(/account/i);
  });

  it('rejects an unknown role', async () => {
    const account = await insertAccount(pool);
    await expect(createInvite(pool, account.id, 'SUPERUSER' as never)).rejects.toThrow(/role/i);
  });
});
