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
    // 502 SALE_APPEND_FAILED, not a generic 500: see the A1 fix in routes.ts
    // -- any appendRow failure is wrapped so SheetsQueue's retry can never
    // replay this non-idempotent write.
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('SALE_APPEND_FAILED');
    expect(balanceDuringAppend).toBe(70);

    // ...and the customer is not left carrying debt for a sale that never
    // reached the ledger.
    const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
      customerRows[0].id,
    ]);
    expect(Number(rows[0].current_debt_balance)).toBe(20);
  });

  it('reverses the credit balance when a credit sale is rejected for insufficient stock, not just for an infra failure', async () => {
    // Before A5's stock-write fix, only an infrastructure failure (a rejected
    // appendRow) could enter this compensation branch. Now an ordinary
    // cashier mistake -- a line that outsells the stock on hand -- throws
    // from inside the same recordSale() and must be compensated too.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 20]
    );
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '1', '', ''], // only 1 unit in stock
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 5, unitPriceUsd: 3 }],
        totalUsd: 15,
        totalVes: 600,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 40,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(sheets.appendRow).not.toHaveBeenCalled();

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

  it('does not replay the sale append when it fails with a 503-shaped (retryable) error', async () => {
    // Pins the A1 fix: a 503 from appendRow is exactly the kind of error
    // SheetsQueue.withRetry would otherwise replay up to 3 times, which for
    // this non-idempotent write means duplicating the sale row. It must be
    // called exactly once, and the caller must see an error, never a 200.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2.5', '10', '', '']]);
    const err = new Error('service unavailable') as Error & { response: { status: number } };
    err.response = { status: 503 };
    sheets.appendRow.mockRejectedValue(err);

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

    expect(res.statusCode).not.toBe(200);
    expect(res.json().error.code).toBe('SALE_APPEND_FAILED');
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    // No stock write either: appendRow throwing must skip the decrement loop.
    expect(sheets.updateRow).not.toHaveBeenCalled();
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

describe('POST /sales total audit', () => {
  // Captures every SQL statement issued through app.deps.pool.query during
  // the request, so a "no warning" assertion can be pinned to "the audit ran
  // and concluded no warning" instead of passing just as well if auditTotal's
  // call (or a specific early-return) were deleted entirely.
  function spyOnQueries(app: any): string[] {
    const queries: string[] = [];
    const originalQuery = app.deps.pool.query.bind(app.deps.pool);
    vi.spyOn(app.deps.pool, 'query').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string') queries.push(args[0]);
      return (originalQuery as (...a: unknown[]) => Promise<unknown>)(...(args as [string, ...unknown[]]));
    });
    return queries;
  }

  async function saleWith(totalVes: number, quantity = 2) {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    const warn = vi.spyOn(app.log, 'warn');

    // Bound as a literal, not the SQL `CURRENT_DATE` keyword: matches the
    // production query in routes.ts, which compares against
    // `new Date().toISOString().slice(0, 10)` (see the comment on `auditTotal`
    // for why). This also sidesteps a pg-mem limitation -- its `CURRENT_DATE`
    // is neither truncated to midnight nor memoized across statements, so a
    // row inserted with it never matches a later `WHERE ... = CURRENT_DATE`.
    const today = new Date().toISOString().slice(0, 10);
    await app.deps.pool.query(
      'INSERT INTO bcv_rates (account_id, rate_date, rate) VALUES ($1, $2, $3)',
      [account.id, today, 40]
    );
    await app.deps.pool.query(
      "INSERT INTO margin_rules (account_id, level, level_name, percentage) VALUES ($1, 'DEPARTAMENTO', $2, $3)",
      [account.id, 'Lacteos', 50]
    );
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2', '10', '', ''],
    ]);

    // Spied AFTER the setup inserts above, so only the queries the request
    // itself issues are captured.
    const queries = spyOnQueries(app);

    // unitPriceUsd/totalUsd chase totalVes at bcvRateUsed=40 so A3's
    // internal-consistency checks (which run unconditionally, regardless of
    // whether a rate/margin is configured) stay quiet and only auditTotal --
    // which compares against the *product's real* cost and margin -- is
    // exercised. quantity default 2 keeps the pre-existing "matches"/"differs"
    // cases' numbers (240 Bs) intact.
    const totalUsd = totalVes / 40;
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity, unitPriceUsd: totalUsd / quantity }],
        totalUsd,
        totalVes,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });
    return { res, warn, queries };
  }

  // 2 USD cost + 50% margin = 3 USD, x2 units, x40 = 240 Bs
  it('stays quiet when the client total matches the server estimate', async () => {
    const { res, warn, queries } = await saleWith(240);
    expect(res.statusCode).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    // Non-vacuous: proves auditTotal's SELECTs actually ran, so "no warning"
    // reflects a real comparison rather than the whole function (or its call
    // site) having been deleted.
    expect(queries.some((q) => q.includes('FROM bcv_rates'))).toBe(true);
    expect(queries.some((q) => q.includes('FROM margin_rules'))).toBe(true);
  });

  it('warns when the client total differs beyond the tolerance', async () => {
    const { res, warn } = await saleWith(200);
    expect(res.statusCode).toBe(200); // the client stays authoritative
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ clientTotalVes: 200, expectedTotalVes: 240 }),
      expect.stringContaining('differs')
    );
  });

  // Brackets the A2 tolerance boundary (0.01 * totalQuantity + 0.02 * lines)
  // from both sides: 1 line, qty 1 -> tolerance 0.03. The old per-line-only
  // formula (0.01 * items.length = 0.01) would warn on BOTH of these, since
  // even the "inside" case's 0.02 Bs diff exceeds it -- which is exactly the
  // false-alarm-on-an-ordinary-sale bug A2 fixes.
  it('stays quiet just inside the tolerance boundary', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    const warn = vi.spyOn(app.log, 'warn');
    const today = new Date().toISOString().slice(0, 10);
    await app.deps.pool.query('INSERT INTO bcv_rates (account_id, rate_date, rate) VALUES ($1, $2, $3)', [
      account.id,
      today,
      40,
    ]);
    await app.deps.pool.query(
      "INSERT INTO margin_rules (account_id, level, level_name, percentage) VALUES ($1, 'DEPARTAMENTO', $2, $3)",
      [account.id, 'Lacteos', 50]
    );
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2', '10', '', '']]);
    const queries = spyOnQueries(app);

    // True server estimate: 2 * 1.5 * 40 = 120. Client total is 119.98, a
    // 0.02 Bs diff, inside the 0.03 tolerance. totalUsd/unitPriceUsd are
    // totalVes/40 so A3's checks stay quiet too.
    const totalVes = 119.98;
    const totalUsd = totalVes / 40;
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: totalUsd }],
        totalUsd,
        totalVes,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    // Non-vacuous: proves the comparison actually ran at this specific
    // boundary value, rather than auditTotal (or its call) being deleted.
    expect(queries.some((q) => q.includes('FROM bcv_rates'))).toBe(true);
    expect(queries.some((q) => q.includes('FROM margin_rules'))).toBe(true);
  });

  it('warns just outside the tolerance boundary', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    const warn = vi.spyOn(app.log, 'warn');
    const today = new Date().toISOString().slice(0, 10);
    await app.deps.pool.query('INSERT INTO bcv_rates (account_id, rate_date, rate) VALUES ($1, $2, $3)', [
      account.id,
      today,
      40,
    ]);
    await app.deps.pool.query(
      "INSERT INTO margin_rules (account_id, level, level_name, percentage) VALUES ($1, 'DEPARTAMENTO', $2, $3)",
      [account.id, 'Lacteos', 50]
    );
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'X', 'Lacteos', 'unidad', '2', '10', '', '']]);

    // Same setup, but a 0.04 Bs diff -- just outside the 0.03 tolerance.
    const totalVes = 119.96;
    const totalUsd = totalVes / 40;
    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: totalUsd }],
        totalUsd,
        totalVes,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 40,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(warn).toHaveBeenCalled();
  });

  it('skips the audit when no rate is configured, rather than warning on every sale', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id, 'POST_VENTA');
    const warn = vi.spyOn(app.log, 'warn');
    // A margin rule DOES exist this time. Without it, the item loop's
    // "margin === undefined" check would return early regardless of whether
    // the "no rate configured" early-return works -- masking exactly the
    // branch this test is supposed to pin. It has to be the rate, and only
    // the rate, that's missing.
    await app.deps.pool.query(
      "INSERT INTO margin_rules (account_id, level, level_name, percentage) VALUES ($1, 'DEPARTAMENTO', $2, $3)",
      [account.id, 'Lacteos', 50]
    );
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'X', 'Lacteos', 'unidad', '2', '10', '', ''],
    ]);

    const queries = spyOnQueries(app);

    // totalVes = totalUsd * bcvRateUsed exactly, so A3's unconditional
    // internal-consistency checks stay quiet -- this test is only about
    // whether auditTotal itself skips.
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

    expect(res.statusCode).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    // Non-vacuous: the rate lookup ran (the audit wasn't skipped/deleted
    // entirely)...
    expect(queries.some((q) => q.includes('FROM bcv_rates'))).toBe(true);
    // ...and the margin lookup did NOT (proving it was the "no rate
    // configured" early return that stopped it, not some other reason).
    expect(queries.some((q) => q.includes('FROM margin_rules'))).toBe(false);
  });
});
