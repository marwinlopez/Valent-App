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

  it('accepts a loyalty level belonging to the caller account', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminJwt(app, account.id);
    const { rows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 500, 30]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'Con Nivel', loyaltyLevelId: rows[0].id },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().loyalty_level_id).toBe(rows[0].id);
  });

  it("rejects a loyalty level belonging to another account", async () => {
    const { app } = await buildTestApp();
    const accountA = await insertAccount(app.deps.pool);
    const accountB = await insertAccount(app.deps.pool);
    const jwt = await adminJwt(app, accountA.id);
    const { rows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [accountB.id, 'Oro Ajeno', 99999, 90]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'Infiltrado', loyaltyLevelId: rows[0].id },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INVALID_LOYALTY_LEVEL');
    const created = await app.deps.pool.query('SELECT id FROM customers WHERE account_id = $1', [accountA.id]);
    expect(created.rows).toHaveLength(0);
  });
});
