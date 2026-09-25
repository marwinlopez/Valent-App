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

// Matches the column order every write below builds, so a rejected write can
// name the offending column instead of just an index.
const ROW_COLUMNS = ['barcode', 'name', 'brand', 'department', 'unit', 'costUsd', 'stock', 'updatedAt', 'updatedBy'] as const;

/**
 * The single choke point every write to the Productos sheet goes through.
 *
 * PUT and PATCH .../stock both reconstruct the whole 9-column row, carrying
 * forward columns they don't own (PUT carries `stock`, the stock route
 * carries `costUsd`). Those carried-through values came from `parseRow`,
 * which yields NaN for a cell Sheets can't parse — write that straight
 * through and `JSON.stringify` turns it into `null`, erasing whatever was in
 * that cell while the route still answers 200. One guard here, instead of a
 * field-level check duplicated in every route that assembles a row.
 */
async function writeProductRow(
  app: FastifyInstance,
  spreadsheetId: string,
  sheetRow: number,
  barcode: string,
  row: (string | number)[]
): Promise<void> {
  const badIndex = row.findIndex((v) => typeof v === 'number' && !Number.isFinite(v));
  if (badIndex !== -1) {
    throw new ApiError(
      409,
      'INVALID_SHEET_VALUE',
      `Cannot write barcode ${barcode}: column "${ROW_COLUMNS[badIndex]}" is not a valid number in the sheet`
    );
  }
  await app.deps.sheets.updateRow(spreadsheetId, `Productos!A${sheetRow}:I${sheetRow}`, row);
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
  /* Idempotency key, one per logical adjustment (see stock_adjustments).
     Required, not optional: an optional key would be silently absent exactly
     on the client paths that forgot to send it, which are the ones that
     retry. */
  requestId: z.string().min(8).max(64),
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
      await writeProductRow(app, spreadsheetId, sheetRow, barcode, [
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
    const { delta, requestId } = stockAdjustSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;
    const accountId = req.auth!.accountId;

    /* Everything below — the ledger lookup, the read, the decision and the
       write — lives inside one enqueue callback. A lookup outside it and a
       write inside would be the same split read-decide-write this codebase has
       already been bitten by three times. */
    const updated = await app.deps.sheetsQueue.enqueue(accountId, async () => {
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
      const sheetRow = product.rowIndex + 1;
      const writeStock = (stock: number) =>
        writeProductRow(app, spreadsheetId, sheetRow, barcode, [
          product.barcode,
          product.name,
          product.brand,
          product.department,
          product.unit,
          product.costUsd,
          stock,
          new Date().toISOString(),
          req.auth!.deviceId,
        ]);

      const { rows: prior } = await app.deps.pool.query(
        'SELECT barcode, prev_stock, new_stock FROM stock_adjustments WHERE account_id = $1 AND request_id = $2',
        [accountId, requestId]
      );
      if (prior.length > 0) {
        if (prior[0].barcode !== barcode) {
          throw new ApiError(
            409,
            'REQUEST_ID_REUSED',
            `requestId ${requestId} was already used for barcode ${prior[0].barcode}`
          );
        }
        // NUMERIC comes back as a string from pg, as a number from pg-mem.
        const prevStock = Number(prior[0].prev_stock);
        const recordedStock = Number(prior[0].new_stock);
        // The record is written before the sheet, so "recorded" does not mean
        // "landed". If the sheet still holds the pre-adjustment value the write
        // never went through (a 429 rejects the request outright) and is
        // re-issued — as an absolute value, so repeating it is harmless.
        // Anything else means the delta is already in, possibly with later
        // adjustments stacked on top, so nothing is written and the row is
        // returned as it currently reads.
        if (product.stock === prevStock && prevStock !== recordedStock) {
          await writeStock(recordedStock);
          return { ...product, stock: recordedStock };
        }
        if (product.stock !== recordedStock) {
          // Neither branch of the assumption above held: the sheet's current
          // stock matches neither prev_stock nor new_stock. That means a
          // human edited the cell or another instance adjusted it since this
          // ledger row was written — not proof the delta already landed.
          // Dropping it is still the safe direction (never double-apply), but
          // silently is wrong; log it so a dropped delta is findable.
          app.log.warn(
            {
              barcode,
              requestId,
              prevStock,
              recordedStock,
              observedStock: product.stock,
            },
            'Stock adjustment replay: sheet stock matches neither prev_stock nor new_stock; dropping the delta without writing'
          );
        }
        return product;
      }

      const newStock = product.stock + delta;
      if (newStock < 0) {
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Stock adjustment would go below zero');
      }

      // Recorded before the write, not after. The failure being guarded is a
      // retry of a write that landed but whose response never came back: a
      // record written afterwards would be missing in exactly that case, and
      // the retry would add the delta a second time.
      await app.deps.pool.query(
        `INSERT INTO stock_adjustments (account_id, request_id, barcode, prev_stock, new_stock, device_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [accountId, requestId, barcode, product.stock, newStock, req.auth!.deviceId]
      );
      await writeStock(newStock);
      return { ...product, stock: newStock };
    });

    const { rowIndex, ...rest } = updated;
    return rest;
  });
}
