import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice, adminToken, issueInviteToken } from './helpers/factories';

describe('POST /auth/link-device', () => {
  it('links a new device and returns a JWT', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, jwt, 'INVENTARIO');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-123', deviceName: 'Pixel 8' },
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
      payload: { inviteToken: randomUUID(), hardwareId: 'hw-1', deviceName: 'X' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_INVITE_TOKEN');
  });

  it('rejects re-linking a revoked device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { status: 'REVOKED', hardwareId: 'hw-revoked' });
    const jwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, jwt, 'INVENTARIO');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-revoked', deviceName: 'Pixel 8' },
    });

    expect(res.statusCode).toBe(403);
    const check = await app.deps.pool.query('SELECT status FROM devices WHERE id = $1', [device.id]);
    expect(check.rows[0].status).toBe('REVOKED');

    // The transaction rolled back, so the invite was not burned by the failed attempt.
    const invite = await app.deps.pool.query('SELECT used_at FROM invite_tokens WHERE id = $1', [inviteToken]);
    expect(invite.rows[0].used_at).toBeNull();
  });

  it('takes the role from the invite token and ignores any role in the request body', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, jwt, 'CLIENTE_PEDIDOS');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-role', deviceName: 'Pixel 8', role: 'ADMIN' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('CLIENTE_PEDIDOS');

    const { verifyDeviceToken } = await import('../src/modules/auth/jwt.js');
    expect(verifyDeviceToken(res.json().jwt, app.deps.env.JWT_SECRET).role).toBe('CLIENTE_PEDIDOS');

    const { rows } = await app.deps.pool.query('SELECT role FROM devices WHERE account_id = $1 AND hardware_id = $2', [
      account.id,
      'hw-role',
    ]);
    expect(rows[0].role).toBe('CLIENTE_PEDIDOS');
  });

  it('does not let a linked device self-escalate by replaying its own accountId as an invite token', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, jwt, 'CLIENTE_PEDIDOS');

    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-cliente', deviceName: 'Tablet' },
    });
    expect(link.statusCode).toBe(200);
    expect(link.json().role).toBe('CLIENTE_PEDIDOS');

    // The accountId is in plaintext inside the device's own JWT, so this is
    // exactly what a low-privilege device could try on its own.
    const escalate = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: {
        inviteToken: link.json().accountId,
        hardwareId: 'hw-cliente-2',
        deviceName: 'Tablet',
        role: 'ADMIN',
      },
    });

    expect(escalate.statusCode).toBe(422);
    expect(escalate.json().error.code).toBe('INVALID_INVITE_TOKEN');
    expect(escalate.json().jwt).toBeUndefined();
  });

  it('rejects an expired invite token', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { rows } = await app.deps.pool.query(
      `INSERT INTO invite_tokens (account_id, role, expires_at)
       VALUES ($1, $2, now() - interval '1 hour') RETURNING id`,
      [account.id, 'ADMIN']
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: rows[0].id, hardwareId: 'hw-expired', deviceName: 'X' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_INVITE_TOKEN');
    const devices = await app.deps.pool.query('SELECT id FROM devices WHERE account_id = $1', [account.id]);
    expect(devices.rows).toHaveLength(0);
  });

  it('rejects an invite token that has already been used', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, jwt, 'INVENTARIO');

    const first = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-first', deviceName: 'First' },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-second', deviceName: 'Second' },
    });
    expect(second.statusCode).toBe(422);
    expect(second.json().error.code).toBe('INVALID_INVITE_TOKEN');

    const devices = await app.deps.pool.query('SELECT id FROM devices WHERE account_id = $1 AND hardware_id = $2', [
      account.id,
      'hw-second',
    ]);
    expect(devices.rows).toHaveLength(0);
  });

  it("rejects a new device once the account's device_limit is reached", async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool, { deviceLimit: 2 });
    const jwt = await adminToken(app, account.id); // device 1 of 2
    const firstInvite = await issueInviteToken(app, jwt, 'INVENTARIO');
    const secondInvite = await issueInviteToken(app, jwt, 'INVENTARIO');

    const first = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: firstInvite, hardwareId: 'hw-a', deviceName: 'A' },
    });
    expect(first.statusCode).toBe(200); // device 2 of 2

    const second = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: secondInvite, hardwareId: 'hw-b', deviceName: 'B' },
    });
    expect(second.statusCode).toBe(403);
    expect(second.json().error.code).toBe('DEVICE_LIMIT_REACHED');
  });

  it('lets an existing device re-link at the device_limit (re-linking takes no new slot)', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool, { deviceLimit: 2 });
    const jwt = await adminToken(app, account.id);
    const firstInvite = await issueInviteToken(app, jwt, 'INVENTARIO');
    const secondInvite = await issueInviteToken(app, jwt, 'INVENTARIO');

    await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: firstInvite, hardwareId: 'hw-a', deviceName: 'A' },
    });

    const relink = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: secondInvite, hardwareId: 'hw-a', deviceName: 'A renamed' },
    });
    expect(relink.statusCode).toBe(200);
  });

  it('counts revoked devices against nothing (a revoked slot is reusable)', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool, { deviceLimit: 2 });
    const jwt = await adminToken(app, account.id);
    await insertDevice(app.deps.pool, account.id, { status: 'REVOKED', hardwareId: 'hw-old' });
    const inviteToken = await issueInviteToken(app, jwt, 'INVENTARIO');

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-new', deviceName: 'New' },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET /auth/me', () => {
  it('returns the current device role for a valid token', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const adminJwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, adminJwt, 'ADMIN');
    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-1', deviceName: 'X' },
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
    const body = res.json();
    expect(body.status).toBe('REVOKED');
    expect(body.jwt).toBeUndefined();
    expect('jwt' in body).toBe(false);
  });

  it('returns a fresh, valid JWT with matching claims on success', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const adminJwt = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, adminJwt, 'ADMIN');
    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-refresh', deviceName: 'X' },
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

  it('rejects a token whose device row no longer exists', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { signDeviceToken } = await import('../src/modules/auth/jwt.js');
    const jwt = signDeviceToken({ deviceId: randomUUID(), accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(401);
  });
});

describe('device revocation is enforced server-side', () => {
  it('rejects an authenticated call from a revoked device that still holds a valid JWT', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const admin = await adminToken(app, account.id);
    const inviteToken = await issueInviteToken(app, admin, 'POST_VENTA');
    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken, hardwareId: 'hw-victim', deviceName: 'Victim' },
    });
    const { jwt } = link.json();

    // The JWT works before revocation...
    const before = await app.inject({ method: 'GET', url: '/customers', headers: { authorization: `Bearer ${jwt}` } });
    expect(before.statusCode).toBe(200);

    const { rows } = await app.deps.pool.query('SELECT id FROM devices WHERE account_id = $1 AND hardware_id = $2', [
      account.id,
      'hw-victim',
    ]);
    const revoke = await app.inject({
      method: 'PATCH',
      url: `/devices/${rows[0].id}`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { status: 'REVOKED' },
    });
    expect(revoke.statusCode).toBe(200);

    // ...and stops working immediately after, even though the JWT itself is
    // still signed, unexpired and unchanged.
    const after = await app.inject({ method: 'GET', url: '/customers', headers: { authorization: `Bearer ${jwt}` } });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe('DEVICE_REVOKED');

    // /auth/me stays reachable so the client can find out why.
    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${jwt}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().status).toBe('REVOKED');
  });

  it('rejects a role-guarded call from a revoked ADMIN device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN', status: 'REVOKED' });
    const { signDeviceToken } = await import('../src/modules/auth/jwt.js');
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({ method: 'GET', url: '/devices', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('DEVICE_REVOKED');
  });
});
