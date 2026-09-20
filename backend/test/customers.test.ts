import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function adminJwt(app: Awaited<ReturnType<typeof buildTestApp>>['app'], accountId: string) {
  const device = await insertDevice(app.deps.pool, accountId, { role: 'ADMIN' });
  return signDeviceToken({ deviceId: device.id, accountId, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
}

describe('Customers', () => {
  it('creates and lists customers for the caller account', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminJwt(app, account.id);

    const create = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'Maria Perez', phone: '0414-1234567' },
    });
    expect(create.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/customers', headers: { authorization: `Bearer ${jwt}` } });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].name).toBe('Maria Perez');
  });
});
