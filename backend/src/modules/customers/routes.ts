import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evaluateCreditCheck } from './credit.js';
import { ApiError } from '../../plugins/errorHandler.js';

const createCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  loyaltyLevelId: z.string().uuid().optional(),
});

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customers', { preHandler: app.requireAuth }, async (req) => {
    const { rows } = await app.deps.pool.query(
      'SELECT id, name, phone, loyalty_level_id, current_debt_balance FROM customers WHERE account_id = $1 ORDER BY name',
      [req.auth!.accountId]
    );
    return rows.map((r) => ({ ...r, current_debt_balance: Number(r.current_debt_balance) }));
  });

  app.post('/customers', { preHandler: app.requireAuth }, async (req) => {
    const body = createCustomerSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `INSERT INTO customers (account_id, name, phone, loyalty_level_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, loyalty_level_id, current_debt_balance`,
      [req.auth!.accountId, body.name, body.phone ?? null, body.loyaltyLevelId ?? null]
    );
    return { ...rows[0], current_debt_balance: Number(rows[0].current_debt_balance) };
  });

  app.get('/customers/:id/credit-check', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const { amount } = req.query as { amount?: string };
    const requestedAmount = Number(amount ?? '0');

    const { rows } = await app.deps.pool.query(
      `SELECT c.current_debt_balance, l.credit_limit
       FROM customers c
       LEFT JOIN loyalty_levels l ON l.id = c.loyalty_level_id
       WHERE c.id = $1 AND c.account_id = $2`,
      [id, req.auth!.accountId]
    );
    if (rows.length === 0) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const creditLimit = rows[0].credit_limit === null ? 0 : Number(rows[0].credit_limit);
    return evaluateCreditCheck({
      currentDebtBalance: Number(rows[0].current_debt_balance),
      creditLimit,
      requestedAmount,
    });
  });
}
