import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
}
