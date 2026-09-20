import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';
import { evaluateCreditCheck } from '../customers/credit.js';

const SALES_APPEND_RANGE = 'Ventas!A:I';

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

    const appendSale = () =>
      app.deps.sheetsQueue.enqueue(req.auth!.accountId, () =>
        app.deps.sheets.appendRow(spreadsheetId, SALES_APPEND_RANGE, [
          saleId,
          new Date().toISOString(),
          req.auth!.deviceId,
          body.customerId ?? '',
          JSON.stringify(body.items),
          body.totalUsd,
          body.totalVes,
          body.paymentMethod,
          body.bcvRateUsed,
        ])
      );

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
        // own lock -- only the customer row's balance is contended.
        const { rows: levelRows } = await client.query('SELECT credit_limit FROM loyalty_levels WHERE id = $1', [
          rows[0].loyalty_level_id,
        ]);
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

        // The Sheets append is a separate system, not part of the Postgres
        // transaction -- but if it throws, the catch below still rolls back the
        // Postgres side so we don't leave a stale row lock or an update without
        // a corresponding sale record.
        await appendSale();

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

      return { saleId };
    }

    await appendSale();
    return { saleId };
  });
}
