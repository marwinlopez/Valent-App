import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { signDeviceToken, type DeviceRole } from '../../src/modules/auth/jwt.js';

export async function insertAccount(
  pool: Pool,
  overrides: Partial<{ name: string; plan: string; deviceLimit: number; spreadsheetId: string }> = {}
): Promise<{ id: string; spreadsheetId: string }> {
  const id = randomUUID();
  const spreadsheetId = overrides.spreadsheetId ?? `sheet-${id}`;
  await pool.query(
    'INSERT INTO accounts (id, name, plan, device_limit, spreadsheet_id) VALUES ($1, $2, $3, $4, $5)',
    [id, overrides.name ?? 'Test Account', overrides.plan ?? 'basic', overrides.deviceLimit ?? 3, spreadsheetId]
  );
  return { id, spreadsheetId };
}

export async function insertDevice(
  pool: Pool,
  accountId: string,
  overrides: Partial<{ hardwareId: string; role: string; name: string; status: string }> = {}
): Promise<{ id: string }> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO devices (id, account_id, hardware_id, role, name, status) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      id,
      accountId,
      overrides.hardwareId ?? `hw-${id}`,
      overrides.role ?? 'ADMIN',
      overrides.name ?? 'Test Device',
      overrides.status ?? 'ACTIVE',
    ]
  );
  return { id };
}

/* Links an ADMIN device straight into the DB and returns a token for it -- the
   shortcut used by tests that need an authenticated admin but aren't testing
   the linking flow itself. */
export async function adminToken(app: FastifyInstance, accountId: string): Promise<string> {
  const device = await insertDevice(app.deps.pool, accountId, { role: 'ADMIN' });
  return signDeviceToken({ deviceId: device.id, accountId, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
}

/* Goes through the real ADMIN-only endpoint rather than inserting a row, so
   tests exercise the same path a real admin would. */
export async function issueInviteToken(app: FastifyInstance, jwt: string, role: DeviceRole): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/devices/invite',
    headers: { authorization: `Bearer ${jwt}` },
    payload: { role },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Failed to issue invite token: ${res.statusCode} ${res.body}`);
  }
  return res.json().inviteToken as string;
}
