import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';

const PRODUCTS_RANGE = 'Productos!A2:I';
const PRODUCTS_APPEND_RANGE = 'Productos!A:I';

interface ProductRow {
  rowIndex: number; // 1-based data row, i.e. sheet row = rowIndex + 1
  barcode: string;
  name: string;
  brand: string;
  department: string;
  unit: string;
  costUsd: number;
  stock: number;
}

function parseRow(raw: string[], rowIndex: number): ProductRow {
  return {
    rowIndex,
    barcode: raw[0] ?? '',
    name: raw[1] ?? '',
    brand: raw[2] ?? '',
    department: raw[3] ?? '',
    unit: raw[4] ?? '',
    costUsd: Number(raw[5] ?? 0),
    stock: Number(raw[6] ?? 0),
  };
}

async function findProductRow(
  app: FastifyInstance,
  spreadsheetId: string,
  barcode: string
): Promise<ProductRow | null> {
  const rows = await app.deps.sheets.getValues(spreadsheetId, PRODUCTS_RANGE);
  const index = rows.findIndex((r) => r[0] === barcode);
  if (index === -1) return null;
  return parseRow(rows[index], index + 1);
}

const createProductSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  department: z.string().min(1),
  unit: z.string().min(1),
  costUsd: z.number().nonnegative(),
  stock: z.number().nonnegative(),
});

const stockAdjustSchema = z.object({
  delta: z.number(),
});

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products', { preHandler: app.requireAuth }, async (req) => {
    const { barcode } = req.query as { barcode?: string };
    if (!barcode) {
      throw new ApiError(422, 'MISSING_BARCODE', 'barcode query parameter is required');
    }
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    const product = await findProductRow(app, spreadsheetId, barcode);
    if (!product) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
    }
    const { rowIndex, ...rest } = product;
    return rest;
  });

  app.post('/products', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO']) }, async (req) => {
    const body = createProductSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    const existing = await findProductRow(app, spreadsheetId, body.barcode);
    if (existing) {
      throw new ApiError(409, 'DUPLICATE_BARCODE', `A product with barcode ${body.barcode} already exists`);
    }

    await app.deps.sheetsQueue.enqueue(req.auth!.accountId, () =>
      app.deps.sheets.appendRow(spreadsheetId, PRODUCTS_APPEND_RANGE, [
        body.barcode,
        body.name,
        body.brand,
        body.department,
        body.unit,
        body.costUsd,
        body.stock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ])
    );

    return body;
  });

  app.patch('/products/:barcode/stock', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO', 'POST_VENTA']) }, async (req) => {
    const { barcode } = req.params as { barcode: string };
    const { delta } = stockAdjustSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    const updated = await app.deps.sheetsQueue.enqueue(req.auth!.accountId, async () => {
      const product = await findProductRow(app, spreadsheetId, barcode);
      if (!product) {
        throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
      }
      const newStock = product.stock + delta;
      if (newStock < 0) {
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Stock adjustment would go below zero');
      }
      const sheetRow = product.rowIndex + 1;
      await app.deps.sheets.updateRow(spreadsheetId, `Productos!A${sheetRow}:I${sheetRow}`, [
        product.barcode,
        product.name,
        product.brand,
        product.department,
        product.unit,
        product.costUsd,
        newStock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ]);
      return { ...product, stock: newStock };
    });

    const { rowIndex, ...rest } = updated;
    return rest;
  });
}
