import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../plugins/errorHandler.js';

export const PRODUCTS_RANGE = 'Productos!A2:I';

export interface ProductRow {
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
export function num(raw: string | undefined): number {
  const n = Number(raw);
  return raw === undefined || raw === '' || !Number.isFinite(n) ? NaN : n;
}

export function parseRow(raw: string[], rowIndex: number): ProductRow {
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

export async function findProductRow(
  app: FastifyInstance,
  spreadsheetId: string,
  barcode: string
): Promise<ProductRow | null> {
  const rows = await app.deps.sheets.getValues(spreadsheetId, PRODUCTS_RANGE);
  const index = rows.findIndex((r) => r[0] === barcode);
  if (index === -1) return null;
  return parseRow(rows[index], index + 1);
}

/**
 * Every requested barcode's row, from ONE read of the sheet.
 *
 * `findProductRow` re-reads the whole sheet per barcode, which is fine for a
 * single lookup and wasteful for a sale: a ten-line sale would pull the
 * catalog ten times and, worse, could see it change between reads.
 */
export async function findProductRows(
  app: FastifyInstance,
  spreadsheetId: string,
  barcodes: string[]
): Promise<Map<string, ProductRow>> {
  const rows = await app.deps.sheets.getValues(spreadsheetId, PRODUCTS_RANGE);
  const wanted = new Set(barcodes);
  const found = new Map<string, ProductRow>();
  rows.forEach((raw, index) => {
    const barcode = raw[0] ?? '';
    if (wanted.has(barcode) && !found.has(barcode)) {
      found.set(barcode, parseRow(raw, index + 1));
    }
  });
  return found;
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
export async function writeProductRow(
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
