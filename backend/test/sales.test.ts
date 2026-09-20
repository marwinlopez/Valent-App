import { describe, it, expect, vi } from 'vitest';
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

  // NOTE on the two tests below: see task-14-report.md ("Fix round 1" section) for the
  // full writeup. Short version: pg-mem (v2.9.1, used by createTestPool()) parses
  // `SELECT ... FOR UPDATE` without error but does not implement any row-locking
  // semantics for it -- it is effectively a no-op. Verified empirically: two
  // concurrent BEGIN/SELECT-FOR-UPDATE/UPDATE/COMMIT transactions against the same
  // pg-mem row both read the pre-write value and a `git grep -i lock` over
  // node_modules/pg-mem/dist turns up nothing. So a true concurrency test (below,
  // skipped) cannot demonstrate real serialization against this harness -- it would
  // pass against real Postgres, which does implement FOR UPDATE blocking, but
  // reliably fails against pg-mem for reasons that have nothing to do with whether
  // the route code is correct. The active test right after it verifies the actual
  // thing this test file *can* prove under pg-mem: that the route issues the correct
  // BEGIN / SELECT ... FOR UPDATE / COMMIT / ROLLBACK sequence against a single
  // reserved client, which is what makes the fix correct once it runs against a
  // database that honors row locks.
  it.skip('[requires real Postgres row-locking; pg-mem does not implement FOR UPDATE -- see comment above] serializes the credit check with the balance update so two concurrent credit sales for the same customer cannot both be approved when only one fits the limit', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 100, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 0]
    );

    // Each sale is 80 against a credit_limit of 100: individually within the
    // limit, but the combined 160 is not. If the credit check and the balance
    // update aren't atomic with respect to each other, both requests can read
    // the same pre-sale balance (0) and both get approved.
    sheets.appendRow.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const payload = {
      customerId: customerRows[0].id,
      items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 80 }],
      totalUsd: 80,
      totalVes: 3360,
      paymentMethod: 'CREDITO',
      bcvRateUsed: 42,
    };

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/sales', headers: { authorization: `Bearer ${jwt}` }, payload }),
      app.inject({ method: 'POST', url: '/sales', headers: { authorization: `Bearer ${jwt}` }, payload }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);

    const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
      customerRows[0].id,
    ]);
    expect(Number(rows[0].current_debt_balance)).toBe(80);
  });

  it('locks the customer row with BEGIN / SELECT ... FOR UPDATE / COMMIT on an approved credit sale', async () => {
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

    // Spy on pool.connect() so we can record every query issued on the single
    // reserved client used for the credit-sale transaction, without changing its
    // behavior (each call still delegates to the real pg-mem client).
    const queries: string[] = [];
    const originalConnect = app.deps.pool.connect.bind(app.deps.pool);
    vi.spyOn(app.deps.pool, 'connect').mockImplementation(async (...args: unknown[]) => {
      const client = await (originalConnect as (...a: unknown[]) => Promise<any>)(...args);
      const originalQuery = client.query.bind(client);
      client.query = (...qargs: unknown[]) => {
        if (typeof qargs[0] === 'string') queries.push(qargs[0]);
        return originalQuery(...qargs);
      };
      return client;
    });

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
    expect(queries[0]).toBe('BEGIN');
    expect(queries.some((q) => /FOR UPDATE/i.test(q) && /customers/i.test(q))).toBe(true);
    expect(queries.some((q) => /UPDATE customers/i.test(q))).toBe(true);
    expect(queries[queries.length - 1]).toBe('COMMIT');
    expect(queries).not.toContain('ROLLBACK');
  });

  it('rolls back the transaction instead of committing when a credit sale is denied', async () => {
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

    const queries: string[] = [];
    const originalConnect = app.deps.pool.connect.bind(app.deps.pool);
    vi.spyOn(app.deps.pool, 'connect').mockImplementation(async (...args: unknown[]) => {
      const client = await (originalConnect as (...a: unknown[]) => Promise<any>)(...args);
      const originalQuery = client.query.bind(client);
      client.query = (...qargs: unknown[]) => {
        if (typeof qargs[0] === 'string') queries.push(qargs[0]);
        return originalQuery(...qargs);
      };
      return client;
    });

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
    expect(queries[0]).toBe('BEGIN');
    expect(queries[queries.length - 1]).toBe('ROLLBACK');
    expect(queries).not.toContain('COMMIT');

    // The row lock was released by the ROLLBACK, so the balance is unchanged and a
    // later request against the same customer is not blocked.
    const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
      customerRows[0].id,
    ]);
    expect(Number(rows[0].current_debt_balance)).toBe(90);
  });
});
