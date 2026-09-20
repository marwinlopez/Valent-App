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

    if (body.paymentMethod === 'CREDITO') {
      if (!body.customerId) {
        throw new ApiError(422, 'CUSTOMER_REQUIRED', 'customerId is required for credit sales');
      }
      const { rows } = await app.deps.pool.query(
        `SELECT c.current_debt_balance, l.credit_limit
         FROM customers c
         LEFT JOIN loyalty_levels l ON l.id = c.loyalty_level_id
         WHERE c.id = $1 AND c.account_id = $2`,
        [body.customerId, req.auth!.accountId]
      );
      if (rows.length === 0) {
        throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
      }
      const creditLimit = rows[0].credit_limit === null ? 0 : Number(rows[0].credit_limit);
      const check = evaluateCreditCheck({
        currentDebtBalance: Number(rows[0].current_debt_balance),
        creditLimit,
        requestedAmount: body.totalUsd,
      });
      if (!check.approved) {
        throw new ApiError(409, 'CREDIT_DENIED', check.reason ?? 'Credit not approved');
      }
    }

    const { rows: accountRows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = accountRows[0].spreadsheet_id as string;
    const saleId = randomUUID();

    await app.deps.sheetsQueue.enqueue(req.auth!.accountId, () =>
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

    if (body.paymentMethod === 'CREDITO' && body.customerId) {
      await app.deps.pool.query(
        'UPDATE customers SET current_debt_balance = current_debt_balance + $1 WHERE id = $2',
        [body.totalUsd, body.customerId]
      );
    }

    return { saleId };
  });
}
