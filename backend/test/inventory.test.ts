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
