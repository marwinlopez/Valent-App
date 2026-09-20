import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

describe('Margin rules', () => {
  it('creates, lists, and updates a margin rule', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const create = await app.inject({
      method: 'POST',
      url: '/margins',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { level: 'DEPARTAMENTO', levelName: 'Lacteos', percentage: 25 },
    });
    expect(create.statusCode).toBe(200);
    const id = create.json().id;

    const list = await app.inject({ method: 'GET', url: '/margins', headers: { authorization: `Bearer ${jwt}` } });
    expect(list.json()).toHaveLength(1);

    const update = await app.inject({
      method: 'PUT',
      url: `/margins/${id}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { percentage: 30 },
    });
    expect(Number(update.json().percentage)).toBe(30);
  });

  it('returns percentage as a JS number from every handler', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    // percentage is NUMERIC(6,2): node-postgres returns "25.00" for it against
    // real Postgres, so these assert the type, not just the value. pg-mem is
    // lenient here and would pass either way, which is exactly why the check
    // has to be explicit.
    const create = await app.inject({
      method: 'POST',
      url: '/margins',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { level: 'CATEGORIA', levelName: 'Bebidas', percentage: 25 },
    });
    expect(typeof create.json().percentage).toBe('number');
    expect(create.json().percentage).toBe(25);

    const list = await app.inject({ method: 'GET', url: '/margins', headers: { authorization: `Bearer ${jwt}` } });
    expect(typeof list.json()[0].percentage).toBe('number');

    const update = await app.inject({
      method: 'PUT',
      url: `/margins/${create.json().id}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { percentage: 12.5 },
    });
    expect(typeof update.json().percentage).toBe('number');
    expect(update.json().percentage).toBe(12.5);
  });

  it('returns 404 when updating non-existent margin rule', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const fakeId = randomUUID();
    const res = await app.inject({
      method: 'PUT',
      url: `/margins/${fakeId}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { percentage: 30 },
    });
    expect(res.statusCode).toBe(404);
  });
});
