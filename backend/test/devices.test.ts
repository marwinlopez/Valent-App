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
});
