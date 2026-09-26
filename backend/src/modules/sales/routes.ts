import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';
import { isRetryableSheetsError } from '../../sheets/queue.js';
import { evaluateCreditCheck } from '../customers/credit.js';
import { findProductRows, writeProductRow, type ProductRow } from '../inventory/products.js';

const SALES_APPEND_RANGE = 'Ventas!A:I';

// Stock writes are idempotent (writeProductRow always writes an absolute
// stock value, never a delta), so retrying one on a transient Sheets error is
// safe -- unlike the sale-row append below, which is not idempotent and must
// NOT be retried. Small and local to this loop; MAX_STOCK_WRITE_ATTEMPTS
// mirrors SheetsQueue's own MAX_ATTEMPTS.
const MAX_STOCK_WRITE_ATTEMPTS = 3;

async function withStockWriteRetries(write: () => Promise<void>): Promise<void> {
  for (let attempt = 1; attempt <= MAX_STOCK_WRITE_ATTEMPTS; attempt++) {
    try {
      await write();
      return;
    } catch (err) {
      if (attempt === MAX_STOCK_WRITE_ATTEMPTS || !isRetryableSheetsError(err)) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 50));
    }
  }
}

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
 * The tolerance scales with total quantity, not line count: the client rounds
 * a UNIT price to the nearest USD CENT (not Bs céntimo -- `priceCart` prices
 * everything in USD and only converts the finished total, see cart.ts) and
 * then multiplies by quantity, so the error accumulates once per unit sold,
 * not once per line. That per-unit rounding error is up to 0.005 USD, which
 * is worth up to `0.005 * rate` bolívars once converted -- the budget has to
 * be denominated in the currency being compared (Bs), so the per-unit term
 * is scaled by the day's rate. 0.01 * rate per unit is double that per-unit
 * bound; 0.02 per line adds a little extra slack for the line-level rounding
 * step and float summation noise. A budget that didn't scale with the rate
 * (as this one used to) warns on the large majority of ordinary correct
 * sales, because most of a bodega's catalog is sub-dollar and a USD cent is
 * tens of bolívars wide.
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

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const tolerance = 0.01 * rate * totalQuantity + 0.02 * items.length;
  if (Math.abs(expected - clientTotalVes) > tolerance) {
    app.log.warn(
      { saleId, clientTotalVes, expectedTotalVes: expected, tolerance },
      'Sale total_ves differs from the server-side price estimate (possible stale rate/margin on the client)'
    );
  }
}

/**
 * Internal-consistency checks on the numbers the client sent, using no
 * catalog/rate/margin data at all -- so, unlike `auditTotal`, these still run
 * when there's no bcv_rates row or no margin rule for a department.
 *
 * `totalUsd` is what `evaluateCreditCheck` compares against the credit limit
 * and what gets added to `customers.current_debt_balance`. A client that sent
 * `items` worth real money but a tiny `totalUsd` would sail through
 * `auditTotal` (which never looks at totalUsd) and incur a fraction of the
 * actual debt. This pins two arithmetic relationships that must hold no
 * matter what the "true" price should have been:
 *   - totalUsd must equal the sum of the client's own per-line usd prices
 *   - totalVes must equal totalUsd converted at the client's own bcvRateUsed
 *
 * Deliberately `bcvRateUsed` from the request, not the day's rate from
 * Postgres: this checks the client's numbers are mutually consistent, not
 * that they match today's price (auditTotal already does the latter).
 */
function auditInternalConsistency(
  app: FastifyInstance,
  saleId: string,
  items: { quantity: number; unitPriceUsd: number }[],
  totalUsd: number,
  totalVes: number,
  bcvRateUsed: number
): void {
  // Mobile's `priceCart` (cart.ts) sums per-line USD prices with a single
  // round2 at the end, so this only needs to absorb float summation noise.
  const itemsSumUsd = items.reduce((sum, item) => sum + item.unitPriceUsd * item.quantity, 0);
  if (Math.abs(itemsSumUsd - totalUsd) > 0.01) {
    app.log.warn(
      { saleId, itemsSumUsd, totalUsd },
      'Sale total_usd is internally inconsistent with its own line items -- possible broken or hostile client'
    );
  }

  // After the mobile fix that makes bolivars derive from USD, totalVes =
  // round2(totalUsd * bcvRate) holds by construction on the client, so this
  // tolerance only needs to cover a single round2 step (0.005) plus noise.
  const expectedTotalVes = Math.round(totalUsd * bcvRateUsed * 100) / 100;
  if (Math.abs(expectedTotalVes - totalVes) > 0.01) {
    app.log.warn(
      { saleId, totalUsd, bcvRateUsed, expectedTotalVes, totalVes },
      'Sale total_ves is internally inconsistent with total_usd and bcvRateUsed -- possible broken or hostile client'
    );
  }
}

const saleItemSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(1),
  // .int() matches the client's own guard (useCart.ts's `Number.isInteger`
  // check) and, since Number.isInteger(Infinity/NaN) is false, already rejects
  // non-finite quantities too -- no separate .finite() needed here.
  quantity: z.number().int().positive(),
  unitPriceUsd: z.number().nonnegative().finite(),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  items: z.array(saleItemSchema).min(1),
  // .finite() on every numeric field below closes the same hole
  // writeProductRow's runtime guard exists for on the products sheet:
  // `JSON.parse('{"a":1e999}')` yields Infinity, and a plain z.number() lets
  // it through. Tightening the schema covers every field here cleanly, so no
  // separate runtime guard (à la writeProductRow) is needed for this route.
  totalUsd: z.number().nonnegative().finite(),
  totalVes: z.number().nonnegative().finite(),
  paymentMethod: z.enum(['EFECTIVO_USD', 'EFECTIVO_VES', 'PAGO_MOVIL', 'PUNTO_DE_VENTA', 'CREDITO']),
  bcvRateUsed: z.number().positive().finite(),
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

        await auditTotal(app, req.auth!.accountId, saleId, body.items, products, body.totalVes).catch((err) => {
          // Must never reject (the sale still has to go through), but a real
          // Postgres error in here is indistinguishable from "no rate
          // configured" unless it's logged -- the two look identical to the
          // caller (both just mean "no warning fired").
          app.log.warn({ err, saleId }, 'auditTotal failed and was skipped for this sale');
        });
        try {
          auditInternalConsistency(app, saleId, body.items, body.totalUsd, body.totalVes, body.bcvRateUsed);
        } catch (err) {
          // Cannot throw today (no I/O, no external call), but the "must never
          // reject a sale" guarantee this function exists to provide shouldn't
          // rest on that staying true forever -- same reasoning as auditTotal's
          // .catch just above.
          app.log.warn({ err, saleId }, 'auditInternalConsistency failed and was skipped for this sale');
        }

        // The sale row goes first on purpose. If a write fails partway, this
        // order leaves a recorded sale with stock not fully decremented —
        // inventory reads high, which a physical count surfaces, and the money
        // is on the books. The reverse would lose the revenue record and shrink
        // inventory, which nothing surfaces.
        try {
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
        } catch (err) {
          // This append may have already committed on Google's side before the
          // failure reached us (a 503, a dropped connection) -- routine under
          // load. SheetsQueue.withRetry replays this ENTIRE task on a
          // retryable error (see queue.ts's isRetryable), which would re-append
          // this same saleId a second time: duplicated revenue, one stock
          // decrement, one debt increment. We cannot tell "committed then
          // failed" from "never sent", so this append must never be retried.
          // ApiError is inherently non-retryable to withRetry (its `code` is a
          // string, not a numeric status), so wrapping any error from this one
          // call in an ApiError guarantees it surfaces to the operator instead
          // of being silently replayed. The full fix is a saleId ledger
          // mirroring stock_adjustments (tracked as a backend follow-up).
          //
          // Logged before throwing: errorHandler.ts returns ApiError responses
          // without logging them, so without this line there would be no
          // server-side record at all of a possibly-orphaned Ventas row --
          // nothing for anyone to reconcile against.
          app.log.error({ err, saleId }, 'Sale append to Sheets failed; sale may or may not be recorded');
          throw new ApiError(
            502,
            'SALE_APPEND_FAILED',
            'Could not confirm the sale was recorded in Sheets; verify before charging again'
          );
        }

        const failedBarcodes: string[] = [];
        for (const item of body.items) {
          try {
            // Non-null: the validation loop above already 404s on any barcode
            // missing from `products`. Moved inside the try (not guarded only
            // by that non-null assertion) because an escaping error here is
            // the same "reverses a real debt for a recorded sale" scenario the
            // per-line try below exists to prevent.
            const product = products.get(item.barcode)!;
            const sheetRow = product.rowIndex + 1;
            // Retried on its own (not via sheetsQueue -- calling enqueue again
            // from inside an already-running task would just queue behind
            // itself, breaking the one-atomic-block rule). Safe to retry
            // because writeProductRow writes an absolute stock value, not a
            // delta: replaying it is a no-op if it already landed.
            await withStockWriteRetries(() =>
              writeProductRow(app, spreadsheetId, sheetRow, product.barcode, [
                product.barcode,
                product.name,
                product.brand,
                product.department,
                product.unit,
                product.costUsd,
                product.stock - item.quantity,
                new Date().toISOString(),
                req.auth!.deviceId,
              ])
            );
          } catch (err) {
            // The sale row already landed. Throwing here would tell the
            // operator the sale failed and invite a second charge — and
            // `POST /sales` is not idempotent, so that is the worse outcome.
            // It would also reach the credit path's compensation below,
            // reversing the debt for a sale that IS on the books: exactly the
            // silent under-billing the ordering comment above warns against.
            // Scoped per line (not one try around the whole loop) so one
            // barcode failing after retries doesn't abandon every line after
            // it. Stock reads high until someone counts, which is the
            // discoverable side.
            failedBarcodes.push(item.barcode);
            app.log.error(
              { err, saleId, barcode: item.barcode, failedBarcodes },
              'Sale recorded but stock was not decremented for this barcode'
            );
          }
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
