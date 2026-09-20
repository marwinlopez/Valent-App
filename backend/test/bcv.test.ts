import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

describe('BCV rate', () => {
  it('sets and retrieves the rate for a given date', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const put = await app.inject({
      method: 'PUT',
      url: '/bcv-rate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rateDate: '2026-09-19', rate: 42.5 },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: '/bcv-rate?date=2026-09-19',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(Number(get.json().rate)).toBe(42.5);
  });

  it('returns 404 when no rate exists for the date', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({
      method: 'GET',
      url: '/bcv-rate?date=2020-01-01',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
