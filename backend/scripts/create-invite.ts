import type { Pool } from 'pg';
import { DEVICE_ROLES, type DeviceRole } from '../src/modules/auth/jwt.js';

export interface CreatedInvite {
  inviteToken: string;
  expiresAt: string;
}

/**
 * Creates an invite token from outside the API.
 *
 * This exists for one case the endpoint cannot serve: the FIRST device of an
 * account. `POST /devices/invite` requires an ADMIN device, and a brand-new
 * account has none — so without this, bootstrapping means hand-written SQL
 * against production. Deliberately a script and not an endpoint: an
 * unauthenticated invite route would hand anyone an ADMIN device.
 */
export async function createInvite(
  pool: Pool,
  accountId: string,
  role: DeviceRole
): Promise<CreatedInvite> {
  if (!DEVICE_ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}". Expected one of: ${DEVICE_ROLES.join(', ')}`);
  }

  const { rows: accountRows } = await pool.query('SELECT id FROM accounts WHERE id = $1', [accountId]);
  if (accountRows.length === 0) {
    throw new Error(`No account with id ${accountId}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO invite_tokens (account_id, role, expires_at)
     VALUES ($1, $2, now() + interval '24 hours')
     RETURNING id, expires_at`,
    [accountId, role]
  );

  return {
    inviteToken: rows[0].id as string,
    expiresAt: new Date(rows[0].expires_at).toISOString(),
  };
}

/* CLI: npm run create-invite -- --account <uuid> --role ADMIN */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  const accountId = valueOf('--account');
  const role = valueOf('--role') as DeviceRole | undefined;

  if (!accountId || !role) {
    console.error('Usage: npm run create-invite -- --account <uuid> --role <ADMIN|INVENTARIO|POST_VENTA|CLIENTE_PEDIDOS>');
    process.exit(1);
  }

  const { loadEnv } = await import('../src/config/env.js');
  const { createPool } = await import('../src/db/client.js');
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  try {
    const invite = await createInvite(pool, accountId, role);
    console.log(`Invite token: ${invite.inviteToken}`);
    console.log(`Role:         ${role}`);
    console.log(`Expires:      ${invite.expiresAt}`);
  } finally {
    await pool.end();
  }
}
