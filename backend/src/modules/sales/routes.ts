import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';
import { evaluateCreditCheck } from '../customers/credit.js';
import { findProductRows, writeProductRow, type ProductRow } from '../inventory/products.js';

const SALES_APPEND_RANGE = 'Ventas!A:I';

interface AuditableItem {
  barcode: string;
  quantity: number;
}

/**
 * Compares the client's total against what the backend would expect, and warns
 * when they diverge.
 *
 * Deliberately ordinary float arithmetic, and deliberately NOT the app's
 * `calculatePriceVes`: the client stays authoritative (what the customer was
 * shown is what gets charged), so this only has to catch a meaningful
 * divergence, not agree to the last unit. Reimplementing the app's integer
 * pricing here would create a second source of truth that can drift silently.
 *
 * The tolerance scales with line count so accumulated per-line rounding
 * doesn't raise false alarms.
 */
async function auditTotal(
  app: FastifyInstance,
  accountId: string,
  saleId: string,
  items: AuditableItem[],
  products: Map<string, ProductRow>,
  clientTotalVes: number
): Promise<void> {
  // Bound as a parameter, not `rate_date = CURRENT_DATE`, matching
  // `bcv/routes.ts`: that route writes (and serves) today's rate using this
  // same `new Date().toISOString().slice(0, 10)` expression evaluated on the
  // API server's clock. Using `CURRENT_DATE` here would compare against the
  // *database server's* timezone instead, which is not necessarily the row
  // `GET /bcv-rate` served the mobile app -- the exact thing this audit is
  // supposed to check against.
  const today = new Date().toISOString().slice(0, 10);
  const { rows: rateRows } = await app.deps.pool.query(
    'SELECT rate FROM bcv_rates WHERE account_id = $1 AND rate_date = $2',
    [accountId, today]
  );
  // No rate configured: the backend can't form an expectation. Warning on every
  // sale in an unconfigured account is noise that trains people to ignore the
  // real ones.
  if (rateRows.length === 0) return;
  const rate = Number(rateRows[0].rate);

  const { rows: marginRows } = await app.deps.pool.query(
    "SELECT level_name, percentage FROM margin_rules WHERE account_id = $1 AND level = 'DEPARTAMENTO'",
    [accountId]
  );
  const marginByDepartment = new Map<string, number>(
    marginRows.map((r) => [r.level_name as string, Number(r.percentage)])
  );

  let expected = 0;
  for (const item of items) {
    const product = products.get(item.barcode);
    const margin = product ? marginByDepartment.get(product.department) : undefined;
    if (!product || margin === undefined || !Number.isFinite(product.costUsd)) return;
    expected += product.costUsd * (1 + margin / 100) * rate * item.quantity;
  }

  const tolerance = 0.01 * items.length;
  if (Math.abs(expected - clientTotalVes) > tolerance) {
    app.log.warn(
      { saleId, clientTotalVes, expectedTotalVes: expected, tolerance },
      'Sale total differs from the server-side estimate'
    );
  }
}

const saleItemSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceUsd: z.number().nonnegative(),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  items: z.array(saleItemSchema).min(1),
  totalUsd: z.number().nonnegative(),
  totalVes: z.number().nonnegative(),
  paymentMethod: z.enum(['EFECTIVO_USD', 'EFECTIVO_VES', 'PAGO_MOVIL', 'PUNTO_DE_VENTA', 'CREDITO']),
  bcvRateUsed: z.number().positive(),
});

export async function registerSalesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sales', { preHandler: app.requireRole(['ADMIN', 'POST_VENTA']) }, async (req) => {
    const body = createSaleSchema.parse(req.body);

    const { rows: accountRows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = accountRows[0].spreadsheet_id as string;
    const saleId = randomUUID();

    const barcodes = body.items.map((item) => item.barcode);
    if (new Set(barcodes).size !== barcodes.length) {
      // `items` is a trust boundary. Decrementing one row twice in a single
      // callback would compute the second write from stock the first already
      // superseded, silently under-decrementing.
      throw new ApiError(422, 'DUPLICATE_LINE', 'The same barcode appears more than once in this sale');
    }

    const recordSale = () =>
      app.deps.sheetsQueue.enqueue(req.auth!.accountId, async () => {
        // One read for the whole sale, inside the queue: a read outside it
        // could be superseded by another task's write before these writes land.
        const products = await findProductRows(app, spreadsheetId, barcodes);

        // Validate every line before writing anything, so a short line at the
        // end can't leave the earlier lines already decremented.
        for (const item of body.items) {
          const product = products.get(item.barcode);
          if (!product) {
            throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${item.barcode}`);
          }
          if (!Number.isFinite(product.stock)) {
            throw new ApiError(
              409,
              'INVALID_STOCK_VALUE',
              `Cannot sell barcode ${item.barcode}: its stock cell is not a number`
            );
          }
          // writeProductRow rejects a non-finite costUsd too (it carries the
          // whole row forward, costUsd included). Checked here, before the
          // append, for the same reason as stock above: that guard must not
          // be the thing that fires after the sale row has already landed,
          // where the catch below can only log it.
          if (!Number.isFinite(product.costUsd)) {
            throw new ApiError(
              409,
              'INVALID_SHEET_VALUE',
              `Cannot sell barcode ${item.barcode}: its cost cell is not a number`
            );
          }
          if (product.stock < item.quantity) {
            throw new ApiError(
              409,
              'INSUFFICIENT_STOCK',
              `Not enough stock for barcode ${item.barcode}: ${product.stock} available, ${item.quantity} requested`
            );
          }
        }

        await auditTotal(app, req.auth!.accountId, saleId, body.items, products, body.totalVes).catch(() => undefined);

        // The sale row goes first on purpose. If a write fails partway, this
        // order leaves a recorded sale with stock not fully decremented —
        // inventory reads high, which a physical count surfaces, and the money
        // is on the books. The reverse would lose the revenue record and shrink
        // inventory, which nothing surfaces.
        await app.deps.sheets.appendRow(spreadsheetId, SALES_APPEND_RANGE, [
          saleId,
          new Date().toISOString(),
          req.auth!.deviceId,
          body.customerId ?? '',
          JSON.stringify(body.items),
          body.totalUsd,
          body.totalVes,
          body.paymentMethod,
          body.bcvRateUsed,
        ]);

        try {
          for (const item of body.items) {
            const product = products.get(item.barcode)!;
            const sheetRow = product.rowIndex + 1;
            await writeProductRow(app, spreadsheetId, sheetRow, product.barcode, [
              product.barcode,
              product.name,
              product.brand,
              product.department,
              product.unit,
              product.costUsd,
              product.stock - item.quantity,
              new Date().toISOString(),
              req.auth!.deviceId,
            ]);
          }
        } catch (err) {
          // The sale row already landed. Throwing here would tell the operator
          // the sale failed and invite a second charge — and `POST /sales` is
          // not idempotent, so that is the worse outcome. It would also reach
          // the credit path's compensation below, reversing the debt for a sale
          // that IS on the books: exactly the silent under-billing that the
          // existing ordering comment says to avoid. Stock reads high until
          // someone counts, which is the discoverable side.
          app.log.error({ err, saleId }, 'Sale recorded but stock was not fully decremented');
        }
      });

    if (body.paymentMethod === 'CREDITO') {
      if (!body.customerId) {
        throw new ApiError(422, 'CUSTOMER_REQUIRED', 'customerId is required for credit sales');
      }
      const customerId = body.customerId;

      // Reserve a single client for the whole transaction (same pattern as
      // db/migrate.ts): separate pool.query() calls can each be serviced by a
      // different physical connection, so BEGIN/COMMIT would not be atomic, and
      // the row lock below would not be held across the check and the update.
      //
      // `SELECT ... FOR UPDATE` locks the customer row for the duration of the
      // transaction, so a concurrent credit sale for the same customer blocks
      // until this transaction commits or rolls back. This closes the TOCTOU
      // race where two concurrent sales could each read the same pre-sale
      // balance, both independently pass evaluateCreditCheck, and both be
      // approved even though their combined total exceeds the credit limit
      // (the same class of bug Task 13 fixed for the duplicate-barcode check).
      const client = await app.deps.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'SELECT current_debt_balance, loyalty_level_id FROM customers WHERE id = $1 AND account_id = $2 FOR UPDATE',
          [customerId, req.auth!.accountId]
        );
        if (rows.length === 0) {
          throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
        }

        // loyalty_levels isn't mutated by this endpoint, so it doesn't need its
        // own lock -- only the customer row's balance is contended. The
        // account_id filter keeps another tenant's credit limit from ever
        // authorizing a sale on this account.
        const { rows: levelRows } = await client.query(
          'SELECT credit_limit FROM loyalty_levels WHERE id = $1 AND account_id = $2',
          [rows[0].loyalty_level_id, req.auth!.accountId]
        );
        const creditLimit =
          levelRows.length === 0 || levelRows[0].credit_limit === null ? 0 : Number(levelRows[0].credit_limit);
        const check = evaluateCreditCheck({
          currentDebtBalance: Number(rows[0].current_debt_balance),
          creditLimit,
          requestedAmount: body.totalUsd,
        });
        if (!check.approved) {
          throw new ApiError(409, 'CREDIT_DENIED', check.reason ?? 'Credit not approved');
        }

        await client.query('UPDATE customers SET current_debt_balance = current_debt_balance + $1 WHERE id = $2', [
          body.totalUsd,
          customerId,
        ]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // The Sheets append deliberately happens AFTER the commit, outside the
      // transaction and the customer row lock.
      //
      // Appending first would fail in the dangerous direction: if the append
      // succeeded and the UPDATE/COMMIT then failed, Postgres would roll back
      // and leave a sale in the Sheets ledger with no matching debt on the
      // customer -- silent under-billing that nothing surfaces. This way round,
      // the worst case is a debt increase with no ledger row, which the
      // compensation below undoes and which is in any case visible and
      // correctable. It also means the pooled pg client is released before we
      // wait on the network and on the account's whole SheetsQueue backlog,
      // instead of holding a connection (and a row lock) for that long.
      try {
        await recordSale();
      } catch (err) {
        // Compensate: a single UPDATE is its own transaction, so this either
        // fully reverses the optimistic increase or does nothing.
        try {
          await app.deps.pool.query(
            'UPDATE customers SET current_debt_balance = current_debt_balance - $1 WHERE id = $2',
            [body.totalUsd, customerId]
          );
        } catch (compensationErr) {
          // The sale is now billed but not recorded. Surfacing the original
          // error still beats swallowing it, but this needs a human.
          app.log.error(
            { err: compensationErr, saleId, customerId, amountUsd: body.totalUsd },
            'Failed to reverse the credit balance after a failed Sheets append'
          );
        }
        throw err;
      }

      return { saleId };
    }

    await recordSale();
    return { saleId };
  });
}
