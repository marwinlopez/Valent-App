import { describe, it, expect } from 'vitest';
import { evaluateCreditCheck } from '../src/modules/customers/credit';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

describe('evaluateCreditCheck (pure)', () => {
  it('approves when requested amount fits within available credit', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 50, creditLimit: 200, requestedAmount: 100 });
    expect(result).toEqual({ approved: true, availableCredit: 150, reason: null });
  });

  it('rejects when requested amount exceeds available credit', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 180, creditLimit: 200, requestedAmount: 50 });
    expect(result.approved).toBe(false);
    expect(result.availableCredit).toBe(20);
    expect(result.reason).toMatch(/exceeds/i);
  });

  it('rejects a non-positive requested amount', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 0, creditLimit: 200, requestedAmount: 0 });
    expect(result.approved).toBe(false);
  });

  it('rejects a non-finite requested amount', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 0, creditLimit: 200, requestedAmount: NaN });
    expect(result.approved).toBe(false);
  });
});

describe('GET /customers/:id/credit-check', () => {
  it('evaluates credit for a customer with a loyalty level', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'POST_VENTA' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'POST_VENTA' }, app.deps.env.JWT_SECRET);

    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Juan', levelRows[0].id, 100]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/customers/${customerRows[0].id}/credit-check?amount=150`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ approved: true, availableCredit: 200, reason: null });
  });

  it('rejects when the customer has no loyalty level (no credit limit)', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'POST_VENTA' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'POST_VENTA' }, app.deps.env.JWT_SECRET);
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, current_debt_balance) VALUES ($1, $2, $3) RETURNING id',
      [account.id, 'Sin Nivel', 0]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/customers/${customerRows[0].id}/credit-check?amount=10`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.json().approved).toBe(false);
  });

  it('rejects a non-numeric amount query param instead of approving', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'POST_VENTA' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'POST_VENTA' }, app.deps.env.JWT_SECRET);

    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Juan', levelRows[0].id, 100]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/customers/${customerRows[0].id}/credit-check?amount=abc`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.json().approved).toBe(false);
  });
});
