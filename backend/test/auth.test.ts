import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';

describe('POST /auth/link-device', () => {
  it('links a new device and returns a JWT', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: {
        inviteToken: account.id,
        hardwareId: 'hw-123',
        deviceName: 'Pixel 8',
        role: 'INVENTARIO',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe('INVENTARIO');
    expect(body.accountId).toBe(account.id);
    expect(typeof body.jwt).toBe('string');
  });

  it('rejects an unknown invite token', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: 'nonexistent', hardwareId: 'hw-1', deviceName: 'X', role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects re-linking a revoked device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { status: 'REVOKED', hardwareId: 'hw-revoked' });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: {
        inviteToken: account.id,
        hardwareId: 'hw-revoked',
        deviceName: 'Pixel 8',
        role: 'INVENTARIO',
      },
    });

    expect(res.statusCode).toBe(403);
    const check = await app.deps.pool.query('SELECT status FROM devices WHERE id = $1', [device.id]);
    expect(check.rows[0].status).toBe('REVOKED');
  });
});

describe('GET /auth/me', () => {
  it('returns the current device role for a valid token', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: account.id, hardwareId: 'hw-1', deviceName: 'X', role: 'ADMIN' },
    });
    const { jwt } = link.json();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('ADMIN');
    expect(res.json().status).toBe('ACTIVE');
  });

  it('rejects a request with no token', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('reports REVOKED status for a revoked device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { status: 'REVOKED' });
    const { signDeviceToken } = await import('../src/modules/auth/jwt.js');
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REVOKED');
  });

  it('returns a fresh, valid JWT with matching claims on success', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: account.id, hardwareId: 'hw-refresh', deviceName: 'X', role: 'ADMIN' },
    });
    const { jwt: originalJwt } = link.json();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${originalJwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.jwt).toBe('string');

    const { verifyDeviceToken } = await import('../src/modules/auth/jwt.js');
    const claims = verifyDeviceToken(body.jwt, app.deps.env.JWT_SECRET);
    expect(claims.accountId).toBe(account.id);
    expect(claims.role).toBe('ADMIN');
    expect(typeof claims.deviceId).toBe('string');
  });
});
