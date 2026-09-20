import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';
import { verifyQrToken } from '../src/modules/customers/qrToken';

describe('POST /customers/:id/qr-link', () => {
  it('issues a short-lived QR token for the customer', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
    const { rows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, current_debt_balance) VALUES ($1, $2, 0) RETURNING id',
      [account.id, 'Cliente QR']
    );
    const customerId = rows[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${customerId}/qr-link`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const { qrToken } = res.json();

    const decoded = verifyQrToken(qrToken, app.deps.env.JWT_SECRET);
    expect(decoded).toEqual({ customerId, accountId: account.id });
  });
});
