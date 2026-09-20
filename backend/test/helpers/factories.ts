import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

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
