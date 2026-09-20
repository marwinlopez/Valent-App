import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function adminToken(app: Awaited<ReturnType<typeof buildTestApp>>['app'], accountId: string) {
  const device = await insertDevice(app.deps.pool, accountId, { role: 'ADMIN' });
  return signDeviceToken({ deviceId: device.id, accountId, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
}

describe('GET /devices', () => {
  it('lists devices for the caller account only', async () => {
    const { app } = await buildTestApp();
    const accountA = await insertAccount(app.deps.pool);
    const accountB = await insertAccount(app.deps.pool);
    await insertDevice(app.deps.pool, accountA.id, { name: 'Device A' });
    await insertDevice(app.deps.pool, accountB.id, { name: 'Device B' });
    const jwt = await adminToken(app, accountA.id);

    const res = await app.inject({ method: 'GET', url: '/devices', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((d: { name: string }) => d.name);
    expect(names).toContain('Device A');
    expect(names).not.toContain('Device B');
  });

  it('rejects non-ADMIN roles', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'INVENTARIO' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'INVENTARIO' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({ method: 'GET', url: '/devices', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /devices/invite', () => {
  it('lets an ADMIN create an invite token', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);

    const res = await app.inject({
      method: 'POST',
      url: '/devices/invite',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { role: 'POST_VENTA' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe('POST_VENTA');
    expect(body.inviteToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const { rows } = await app.deps.pool.query(
      'SELECT account_id, role, used_at FROM invite_tokens WHERE id = $1',
      [body.inviteToken]
    );
    expect(rows[0].account_id).toBe(account.id);
    expect(rows[0].role).toBe('POST_VENTA');
    expect(rows[0].used_at).toBeNull();
  });

  it('rejects a non-ADMIN caller', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'CLIENTE_PEDIDOS' });
    const jwt = signDeviceToken(
      { deviceId: device.id, accountId: account.id, role: 'CLIENTE_PEDIDOS' },
      app.deps.env.JWT_SECRET
    );

    const res = await app.inject({
      method: 'POST',
      url: '/devices/invite',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unauthenticated caller', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/devices/invite', payload: { role: 'ADMIN' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown role', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);

    const res = await app.inject({
      method: 'POST',
      url: '/devices/invite',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { role: 'SUPER_ADMIN' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('PATCH /devices/:id', () => {
  it('revokes a device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const target = await insertDevice(app.deps.pool, account.id);
    const jwt = await adminToken(app, account.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/devices/${target.id}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { status: 'REVOKED' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REVOKED');
  });

  it('returns 404 when device does not exist', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);
    const nonExistentId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

    const res = await app.inject({
      method: 'PATCH',
      url: `/devices/${nonExistentId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { status: 'REVOKED' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when device belongs to another account', async () => {
    const { app } = await buildTestApp();
    const accountA = await insertAccount(app.deps.pool);
    const accountB = await insertAccount(app.deps.pool);
    const targetDevice = await insertDevice(app.deps.pool, accountB.id);
    const jwt = await adminToken(app, accountA.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/devices/${targetDevice.id}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { status: 'REVOKED' },
    });
    expect(res.statusCode).toBe(404);
  });
});
