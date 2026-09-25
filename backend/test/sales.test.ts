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
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', '']]);

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

  it("does not honour a credit limit from another account's loyalty level", async () => {
    const { app, sheets } = await buildTestApp();
    const accountA = await insertAccount(app.deps.pool);
    const accountB = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, accountA.id);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [accountB.id, 'Oro Ajeno', 99999, 90]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [accountA.id, 'Infiltrado', levelRows[0].id, 0]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 500 }],
        totalUsd: 500,
        totalVes: 21000,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 42,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CREDIT_DENIED');
    expect(sheets.appendRow).not.toHaveBeenCalled();
  });

  it('accepts a credit sale within the limit and increases the customer balance', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', '']]);
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

  it('locks the customer row with BEGIN / SELECT ... FOR UPDATE / COMMIT on an approved credit sale, and only appends to Sheets after the commit', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', '']]);
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
    // Recorded into the same list so the Sheets append can be ordered against
    // the SQL, not just counted.
    sheets.appendRow.mockImplementation(async () => {
      queries.push('SHEETS_APPEND');
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
    expect(queries).not.toContain('ROLLBACK');

    // The balance is committed before the sale is appended: a Sheets failure
    // can then be compensated, whereas the reverse order can leave a sale in
    // the ledger with no matching debt.
    expect(queries.indexOf('COMMIT')).toBeGreaterThan(queries.indexOf('UPDATE customers SET current_debt_balance = current_debt_balance + $1 WHERE id = $2'));
    expect(queries.indexOf('SHEETS_APPEND')).toBeGreaterThan(queries.indexOf('COMMIT'));
    expect(queries[queries.length - 1]).toBe('SHEETS_APPEND');
  });

  it('reverses the credit balance when the Sheets append fails after the commit', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', '']]);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 20]
    );

    // Reading the balance from *inside* the append proves the increase was
    // already committed when the append ran -- so the reversal below is real
    // compensation, not just a transaction rollback.
    let balanceDuringAppend: number | null = null;
    sheets.appendRow.mockImplementation(async () => {
      const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
        customerRows[0].id,
      ]);
      balanceDuringAppend = Number(rows[0].current_debt_balance);
      throw new Error('Sheets is unavailable');
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

    // The caller gets a real error rather than a silent partial success...
    expect(res.statusCode).toBe(500);
    expect(balanceDuringAppend).toBe(70);

    // ...and the customer is not left carrying debt for a sale that never
    // reached the ledger.
    const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
      customerRows[0].id,
    ]);
    expect(Number(rows[0].current_debt_balance)).toBe(20);
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

describe('POST /sales stock decrement', () => {
  it('decrements every line and appends the sale in one queue pass', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
      ['456', 'Arroz', 'Y', 'Granos', 'kg', '1.2', '50', '', ''],
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [
          { barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 3 },
          { barcode: '456', name: 'Arroz', quantity: 1, unitPriceUsd: 1.5 },
        ],
        totalUsd: 7.5,
        totalVes: 300,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    expect(sheets.updateRow).toHaveBeenCalledTimes(2);

    const written = sheets.updateRow.mock.calls.map(([, range, row]) => [range, row[0], row[6]]);
    expect(written).toEqual(
      expect.arrayContaining([
        ['Productos!A2:I2', '123', 8],
        ['Productos!A3:I3', '456', 49],
      ])
    );
  });

  it('rejects the whole sale when one line is short, writing nothing', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
      ['456', 'Arroz', 'Y', 'Granos', 'kg', '1.2', '1', '', ''],
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [
          { barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 3 },
          { barcode: '456', name: 'Arroz', quantity: 5, unitPriceUsd: 1.5 },
        ],
        totalUsd: 13.5,
        totalVes: 540,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(res.json().error.message).toContain('456');
    expect(sheets.appendRow).not.toHaveBeenCalled();
    expect(sheets.updateRow).not.toHaveBeenCalled();
  });

  it('rejects a sale whose stock cell is not a number, writing nothing', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10 unidades', '', ''],
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 3 }],
        totalUsd: 3,
        totalVes: 120,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STOCK_VALUE');
    expect(sheets.appendRow).not.toHaveBeenCalled();
    expect(sheets.updateRow).not.toHaveBeenCalled();
  });

  it('rejects a sale whose cost cell is not a number, before the sale row is written', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    // A blank cost cell: parseRow's `num()` yields NaN for it, exactly like a
    // Spanish-locale "2,5". writeProductRow would reject this too, but only
    // after the sale row already landed -- this guard must fire before that.
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '', '10', '', ''],
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 3 }],
        totalUsd: 3,
        totalVes: 120,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_SHEET_VALUE');
    expect(sheets.appendRow).not.toHaveBeenCalled();
    expect(sheets.updateRow).not.toHaveBeenCalled();
  });

  it('rejects a sale naming a product that is not in the catalog', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '999', name: 'Fantasma', quantity: 1, unitPriceUsd: 1 }],
        totalUsd: 1,
        totalVes: 40,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PRODUCT_NOT_FOUND');
    expect(sheets.appendRow).not.toHaveBeenCalled();
  });

  it('keeps a credit sale and its debt when a stock write fails afterwards', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Plata', 100, 15]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 0]
    );
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
    ]);
    sheets.updateRow.mockRejectedValue(new Error('sheets is down'));

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 3 }],
        totalUsd: 3,
        totalVes: 120,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 40,
      },
    });

    // The sale row landed, so the sale stands and the debt must not be
    // compensated away — that would be under-billing a recorded sale.
    expect(res.statusCode).toBe(200);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    // Non-vacuous: without this, a missing decrement (updateRow never even
    // called) would pass this test exactly as well as the intended "decrement
    // was attempted but rejected" case, since mockRejectedValue only matters
    // if something invokes it.
    expect(sheets.updateRow).toHaveBeenCalledTimes(1);
    const { rows } = await app.deps.pool.query(
      'SELECT current_debt_balance FROM customers WHERE id = $1',
      [customerRows[0].id]
    );
    expect(Number(rows[0].current_debt_balance)).toBe(3);
  });

  it('rejects the same barcode appearing twice in one sale', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [
          { barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 3 },
          { barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 3 },
        ],
        totalUsd: 9,
        totalVes: 360,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('DUPLICATE_LINE');
  });
});
