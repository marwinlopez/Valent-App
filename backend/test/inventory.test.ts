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
      payload: { delta: -5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stock).toBe(15);
    expect(sheets.updateRow).toHaveBeenCalledTimes(1);
    const [, range, row] = sheets.updateRow.mock.calls[0];
    expect(range).toBe('Productos!A2:I2');
    expect(row[6]).toBe(15);
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
