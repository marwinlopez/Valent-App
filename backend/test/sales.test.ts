import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function jwtFor(app: any, accountId: string, role = 'POST_VENTA') {
  const device = await insertDevice(app.deps.pool, accountId, { role });
  return { jwt: signDeviceToken({ deviceId: device.id, accountId, role }, app.deps.env.JWT_SECRET), deviceId: device.id };
}

describe('POST /sales', () => {
  it('records a cash sale and appends it to the Sheets Ventas tab', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 2.5 }],
        totalUsd: 5,
        totalVes: 210,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 42,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    const [, range] = sheets.appendRow.mock.calls[0];
    expect(range).toBe('Ventas!A:I');
  });

  it('re-validates credit server-side and rejects a credit sale over the limit', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Plata', 100, 15]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 90]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 50 }],
        totalUsd: 50,
        totalVes: 2100,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 42,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(sheets.appendRow).not.toHaveBeenCalled();
  });

  it('accepts a credit sale within the limit and increases the customer balance', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 0]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 50 }],
        totalUsd: 50,
        totalVes: 2100,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 42,
      },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
      customerRows[0].id,
    ]);
    expect(Number(rows[0].current_debt_balance)).toBe(50);
  });
});
