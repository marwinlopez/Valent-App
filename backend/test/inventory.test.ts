import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function jwtFor(app: any, accountId: string, role = 'INVENTARIO') {
  const device = await insertDevice(app.deps.pool, accountId, { role });
  return signDeviceToken({ deviceId: device.id, accountId, role }, app.deps.env.JWT_SECRET);
}

describe('GET /products', () => {
  it('finds a product by barcode', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10', '2026-09-19', 'dev-1'],
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/products?barcode=123',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      barcode: '123',
      name: 'Leche',
      brand: 'Marca X',
      department: 'Lacteos',
      unit: 'unidad',
      costUsd: 2.5,
      stock: 10,
    });
  });

  it('reports an empty cost cell as null rather than inventing a zero', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '', '10', '', ''],
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/products?barcode=123',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    // NaN over the wire is null, which the client reads as "missing cost".
    expect(res.json().costUsd).toBeNull();
  });

  it('reports the missing cells of a short row as null (Sheets omits trailing empties)', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([['123', 'Leche', 'Marca X', 'Lacteos', 'unidad']]);

    const res = await app.inject({
      method: 'GET',
      url: '/products?barcode=123',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ costUsd: null, stock: null });
  });

  it('returns 404 when the barcode is not found', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/products?barcode=999',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /products', () => {
  it('appends a new product row through the sheets queue', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        barcode: '456',
        name: 'Arroz',
        brand: 'Marca Y',
        department: 'Granos',
        unit: 'kg',
        costUsd: 1.2,
        stock: 50,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    const [spreadsheetId, range, row] = sheets.appendRow.mock.calls[0];
    expect(spreadsheetId).toBe(account.spreadsheetId);
    expect(range).toBe('Productos!A:I');
    expect(row[0]).toBe('456');
  });

  it('rejects a duplicate barcode', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([['456', 'Arroz', 'Marca Y', 'Granos', 'kg', '1.2', '50', '', '']]);

    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { barcode: '456', name: 'Arroz', brand: 'Y', department: 'Granos', unit: 'kg', costUsd: 1.2, stock: 50 },
    });
    expect(res.statusCode).toBe(409);
  });

  it('serializes the duplicate check with the write so two concurrent creates for the same barcode cannot both succeed', async () => {
    // This test uses a stateful mock (rather than a canned return value) to exercise the
    // actual race: getValues reflects whatever appendRow has "written" so far. With the
    // duplicate check running outside sheetsQueue.enqueue, both concurrent requests would
    // read "not found" before either one's write landed, and both appendRow calls would go
    // through. With the check moved inside the same enqueue callback as the write, the
    // second request's check only runs after the first request's write has completed
    // (PQueue concurrency: 1 per account), so it correctly observes the row and gets 409.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);

    let appended = false;
    sheets.getValues.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return appended ? [['999', 'Existing', 'Brand', 'Dept', 'unidad', '1', '1', '', '']] : [];
    });
    sheets.appendRow.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      appended = true;
    });

    const payload = {
      barcode: '999',
      name: 'Nuevo',
      brand: 'Brand',
      department: 'Dept',
      unit: 'unidad',
      costUsd: 1,
      stock: 1,
    };

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/products', headers: { authorization: `Bearer ${jwt}` }, payload }),
      app.inject({ method: 'POST', url: '/products', headers: { authorization: `Bearer ${jwt}` }, payload }),
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /products/:barcode/stock', () => {
  it('reads the current row, applies the delta, and updates it', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['789', 'Pan', 'Marca Z', 'Panaderia', 'unidad', '0.8', '20', '', ''],
    ]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/products/789/stock',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { delta: -5, requestId: 'req-00000001' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stock).toBe(15);
    expect(sheets.updateRow).toHaveBeenCalledTimes(1);
    const [, range, row] = sheets.updateRow.mock.calls[0];
    expect(range).toBe('Productos!A2:I2');
    expect(row[6]).toBe(15);
  });

  it('rejects an adjustment against a non-numeric stock cell instead of writing NaN', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['789', 'Pan', 'Marca Z', 'Panaderia', 'unidad', '0.8', '10 unidades', '', ''],
    ]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/products/789/stock',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { delta: 5, requestId: 'req-00000002' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_STOCK_VALUE');
    expect(sheets.updateRow).not.toHaveBeenCalled();
  });

  it('rejects a stock adjustment rather than erasing a cost cell it only carries through', async () => {
    // Stock itself is fine; the cost cell holds a Spanish-locale `2,5`, which
    // parses to NaN. The stock route doesn't own cost, but writeStock still
    // carries it through the row it writes.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['789', 'Pan', 'Marca Z', 'Panaderia', 'unidad', '2,5', '10', '', ''],
    ]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/products/789/stock',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { delta: 5, requestId: 'req-00000003' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_SHEET_VALUE');
    expect(sheets.updateRow).not.toHaveBeenCalled();
  });
});

describe('PATCH /products/:barcode/stock idempotency', () => {
  /* A sheet that actually holds a value, so a double-applied delta shows up as
     a wrong number rather than having to be inferred from call counts. */
  function statefulSheet(sheets: any, initialStock: number) {
    const state = { stock: initialStock };
    sheets.getValues.mockImplementation(async () => [
      ['789', 'Pan', 'Marca Z', 'Panaderia', 'unidad', '0.8', String(state.stock), '', ''],
    ]);
    sheets.updateRow.mockImplementation(async (_id: string, _range: string, row: unknown[]) => {
      state.stock = row[6] as number;
    });
    return state;
  }

  function rateLimited(): Error {
    const err = new Error('rate limited') as Error & { code: number };
    err.code = 429;
    return err;
  }

  async function patch(app: any, jwt: string, body: unknown) {
    return app.inject({
      method: 'PATCH',
      url: '/products/789/stock',
      headers: { authorization: `Bearer ${jwt}` },
      payload: body,
    });
  }

  it('does not double-apply when a queue retry follows a write that landed', async () => {
    // The exact bug: SheetsQueue.withRetry re-runs the whole callback on a
    // 429/5xx. If the write landed and only the response failed, the retry
    // re-reads the already-updated stock, so re-deriving `stock + delta` would
    // subtract a second time and still answer 200.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    const state = statefulSheet(sheets, 20);

    let attempts = 0;
    sheets.updateRow.mockImplementation(async (_id: string, _range: string, row: unknown[]) => {
      attempts += 1;
      state.stock = row[6] as number; // the write itself lands
      if (attempts === 1) throw rateLimited(); // ...but the response does not
    });

    const res = await patch(app, jwt, { delta: -5, requestId: 'req-retry-landed' });

    expect(res.statusCode).toBe(200);
    expect(state.stock).toBe(15);
    expect(res.json().stock).toBe(15);
  });

  it('still applies the adjustment when the retried write never landed', async () => {
    // The other half of the same ambiguity, and the reason the ledger row is
    // written before the sheet rather than after: a 429 that rejected the
    // write outright must not be mistaken for "already applied".
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    const state = statefulSheet(sheets, 20);

    let attempts = 0;
    sheets.updateRow.mockImplementation(async (_id: string, _range: string, row: unknown[]) => {
      attempts += 1;
      if (attempts === 1) throw rateLimited(); // rejected, nothing written
      state.stock = row[6] as number;
    });

    const res = await patch(app, jwt, { delta: -5, requestId: 'req-retry-rejected' });

    expect(res.statusCode).toBe(200);
    expect(state.stock).toBe(15);
    expect(res.json().stock).toBe(15);
  });

  it('ignores a replayed requestId sent as a second request', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    const state = statefulSheet(sheets, 20);

    const first = await patch(app, jwt, { delta: -5, requestId: 'req-replayed' });
    const second = await patch(app, jwt, { delta: -5, requestId: 'req-replayed' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(state.stock).toBe(15);
    expect(second.json().stock).toBe(15);
  });

  it('applies two adjustments that carry different requestIds', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    const state = statefulSheet(sheets, 20);

    await patch(app, jwt, { delta: -5, requestId: 'req-first-one' });
    const second = await patch(app, jwt, { delta: -5, requestId: 'req-second-one' });

    expect(second.statusCode).toBe(200);
    expect(state.stock).toBe(10);
    expect(second.json().stock).toBe(10);
  });

  it('rejects a requestId replayed against a different barcode', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    statefulSheet(sheets, 20);

    await patch(app, jwt, { delta: -5, requestId: 'req-crossed-over' });
    sheets.getValues.mockResolvedValue([
      ['999', 'Otro', 'Marca', 'Dept', 'unidad', '1', '20', '', ''],
    ]);
    const res = await app.inject({
      method: 'PATCH',
      url: '/products/999/stock',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { delta: -5, requestId: 'req-crossed-over' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REQUEST_ID_REUSED');
  });

  it('requires a requestId', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    statefulSheet(sheets, 20);

    const res = await patch(app, jwt, { delta: -5 });

    expect(res.statusCode).toBe(422);
  });
});

describe('GET /products (list)', () => {
  it('returns every product when no barcode is given', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
      ['456', 'Arroz', 'Marca Y', 'Granos', 'kg', '1.2', '50', '', ''],
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      barcode: '123',
      name: 'Leche',
      brand: 'Marca X',
      department: 'Lacteos',
      unit: 'unidad',
      costUsd: 2.5,
      stock: 10,
    });
    expect(body[0]).not.toHaveProperty('rowIndex');
  });

  it('returns an empty array for an empty catalog', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('rejects a CLIENTE_PEDIDOS device: the catalog carries cost prices', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'CLIENTE_PEDIDOS');

    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PUT /products/:barcode', () => {
  it('updates the editable fields and preserves stock', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'INVENTARIO');
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
    ]);

    const res = await app.inject({
      method: 'PUT',
      url: '/products/123',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        name: 'Leche entera',
        brand: 'Marca Z',
        department: 'Lacteos',
        unit: 'litro',
        costUsd: 3,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ barcode: '123', name: 'Leche entera', costUsd: 3, stock: 10 });

    const [, range, row] = sheets.updateRow.mock.calls[0];
    expect(range).toBe('Productos!A2:I2');
    expect(row[1]).toBe('Leche entera');
    // stock comes from the sheet, never from the request body — PATCH stock owns it
    expect(row[6]).toBe(10);
  });

  it('returns 404 for a barcode that does not exist', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'INVENTARIO');
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'PUT',
      url: '/products/999',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'X', brand: 'Y', department: 'Z', unit: 'u', costUsd: 1 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects an edit rather than erasing a stock cell it only carries through', async () => {
    // The stock cell holds `10 unidades`, which parses to NaN. PUT doesn't
    // own stock, but it still round-trips it through the write — without the
    // shared guard, NaN serializes to null and the edit would erase it.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'INVENTARIO');
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10 unidades', '', ''],
    ]);

    const res = await app.inject({
      method: 'PUT',
      url: '/products/123',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'Leche entera', brand: 'Marca X', department: 'Lacteos', unit: 'litro', costUsd: 3 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_SHEET_VALUE');
    expect(sheets.updateRow).not.toHaveBeenCalled();
  });

  it('serializes its read-modify-write with the queue, so a concurrent stock adjustment is not clobbered', async () => {
    // The PUT equivalent of the POST duplicate-check test above, and for the
    // same reason: the row is read, modified and written back whole. If the
    // read ran outside sheetsQueue.enqueue, a stock adjustment landing in
    // between would be overwritten by the stale `product.stock` this route
    // carries forward — a silent lost update, with both requests answering
    // 200. Inside one callback, whichever task runs second reads the first
    // one's result.
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'INVENTARIO');

    const state = { name: 'Leche', stock: 10 };
    sheets.getValues.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [['123', state.name, 'Marca X', 'Lacteos', 'unidad', '2.5', String(state.stock), '', '']];
    });
    sheets.updateRow.mockImplementation(async (_id: string, _range: string, row: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.name = row[1] as string;
      state.stock = Number(row[6]);
    });

    const [put, patch] = await Promise.all([
      app.inject({
        method: 'PUT',
        url: '/products/123',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { name: 'Leche entera', brand: 'Marca X', department: 'Lacteos', unit: 'litro', costUsd: 2.5 },
      }),
      app.inject({
        method: 'PATCH',
        url: '/products/123/stock',
        headers: { authorization: `Bearer ${jwt}` },
        payload: { delta: -5, requestId: 'req-concurrent' },
      }),
    ]);

    expect([put.statusCode, patch.statusCode]).toEqual([200, 200]);
    expect(state).toEqual({ name: 'Leche entera', stock: 5 });
  });

  it('rejects a POST_VENTA device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'POST_VENTA');

    const res = await app.inject({
      method: 'PUT',
      url: '/products/123',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'X', brand: 'Y', department: 'Z', unit: 'u', costUsd: 1 },
    });

    expect(res.statusCode).toBe(403);
  });
});
