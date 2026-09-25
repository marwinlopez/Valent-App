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

/**
 * A sheet cell as a number, or NaN when it isn't one.
 *
 * Never `?? 0`: Sheets omits trailing empty cells, so a row whose cost was
 * never filled arrives as a short array, and a substituted 0 reaches the app
 * as "Precio: 0 Bs" stated as fact. A Spanish-locale sheet can also hold
 * `2,5` or `10 unidades`. NaN serializes to null over JSON, which is exactly
 * what the client's "report a missing input, never invent a price" check
 * already knows how to read.
 */
function num(raw: string | undefined): number {
  const n = Number(raw);
  return raw === undefined || raw === '' || !Number.isFinite(n) ? NaN : n;
}

function parseRow(raw: string[], rowIndex: number): ProductRow {
  return {
    rowIndex,
    barcode: raw[0] ?? '',
    name: raw[1] ?? '',
    brand: raw[2] ?? '',
    department: raw[3] ?? '',
    unit: raw[4] ?? '',
    costUsd: num(raw[5]),
    stock: num(raw[6]),
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

/* No `barcode`: it's the key used to find the row, so changing it would be a
   delete-and-create. No `stock`: PATCH /products/:barcode/stock owns that, and
   accepting it here would let a stale edit form silently overwrite a stock
   level another device just adjusted. */
const updateProductSchema = z.object({
  name: z.string().min(1),
  brand: z.string().min(1),
  department: z.string().min(1),
  unit: z.string().min(1),
  costUsd: z.number().nonnegative(),
});

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  /* Not `requireAuth`: the list branch turned this route from "one row if you
     already know the code" into "the whole catalog, costUsd included".
     CLIENTE_PEDIDOS is a role held by a customer's own device (sub-project 6),
     which has no business reading cost prices. A customer-facing catalog needs
     its own route returning derived prices without costs. */
  app.get('/products', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO', 'POST_VENTA']) }, async (req) => {
    const { barcode } = req.query as { barcode?: string };
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    // No barcode means "the whole catalog". A read needs no queue — the queue
    // serializes writes; concurrent reads can't corrupt anything.
    if (!barcode) {
      const raw = await app.deps.sheets.getValues(spreadsheetId, PRODUCTS_RANGE);
      return raw.map((row, index) => {
        const { rowIndex, ...rest } = parseRow(row, index + 1);
        return rest;
      });
    }

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

    // The duplicate-barcode check MUST run inside the same enqueue callback as the
    // appendRow write. If the check ran outside the queue (as a plain await before
    // enqueue), two concurrent POSTs for the same barcode could both observe "not
    // found" before either one's write lands, since the queue only serializes the
    // writes themselves, not a check-then-write sequence spanning two separate calls.
    // Wrapping both steps in one callback makes the whole check-then-write atomic
    // with respect to other queued tasks for this account, mirroring the pattern the
    // PATCH /products/:barcode/stock route already uses for its read-modify-write.
    await app.deps.sheetsQueue.enqueue(req.auth!.accountId, async () => {
      const existing = await findProductRow(app, spreadsheetId, body.barcode);
      if (existing) {
        throw new ApiError(409, 'DUPLICATE_BARCODE', `A product with barcode ${body.barcode} already exists`);
      }

      await app.deps.sheets.appendRow(spreadsheetId, PRODUCTS_APPEND_RANGE, [
        body.barcode,
        body.name,
        body.brand,
        body.department,
        body.unit,
        body.costUsd,
        body.stock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ]);
    });

    return body;
  });

  app.put('/products/:barcode', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO']) }, async (req) => {
    const { barcode } = req.params as { barcode: string };
    const body = updateProductSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    // Find-then-write must be one queued task: between a lookup outside the
    // queue and the write inside it, another task could move the row and this
    // update would land on the wrong product.
    const updated = await app.deps.sheetsQueue.enqueue(req.auth!.accountId, async () => {
      const product = await findProductRow(app, spreadsheetId, barcode);
      if (!product) {
        throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
      }
      const sheetRow = product.rowIndex + 1;
      await app.deps.sheets.updateRow(spreadsheetId, `Productos!A${sheetRow}:I${sheetRow}`, [
        product.barcode,
        body.name,
        body.brand,
        body.department,
        body.unit,
        body.costUsd,
        product.stock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ]);
      return { ...product, ...body };
    });

    const { rowIndex, ...rest } = updated;
    return rest;
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
      // A cell holding `2,5` or `10 unidades` parses to NaN. Without this,
      // NaN + delta is NaN, `NaN < 0` is false so the floor check passes, and
      // the NaN is written back as null — erasing the stock cell and
      // answering 200.
      if (!Number.isFinite(product.stock)) {
        throw new ApiError(
          409,
          'INVALID_STOCK_VALUE',
          `The stock cell for barcode ${barcode} is not a number; fix it in the sheet before adjusting`
        );
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
