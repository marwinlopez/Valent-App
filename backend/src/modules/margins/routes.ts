import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';

/* percentage is NUMERIC(6,2), which node-postgres hands back as a string
   ("25.00") against real Postgres -- pg-mem happens to return a number, so
   tests alone would not catch it. The API contract is numbers, never strings. */
function toMarginRule(row: Record<string, unknown>) {
  return { ...row, percentage: Number(row.percentage) };
}

const createSchema = z.object({
  level: z.enum(['CATEGORIA', 'SUBCATEGORIA', 'DEPARTAMENTO']),
  levelName: z.string().min(1),
  percentage: z.number().min(0).max(1000),
});

const updateSchema = z.object({
  percentage: z.number().min(0).max(1000),
});

export async function registerMarginsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/margins', { preHandler: app.requireAuth }, async (req) => {
    const { rows } = await app.deps.pool.query(
      'SELECT id, level, level_name, percentage FROM margin_rules WHERE account_id = $1 ORDER BY level, level_name',
      [req.auth!.accountId]
    );
    return rows.map(toMarginRule);
  });

  app.post('/margins', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const body = createSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `INSERT INTO margin_rules (account_id, level, level_name, percentage)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, level, level_name) DO UPDATE SET percentage = EXCLUDED.percentage
       RETURNING id, level, level_name, percentage`,
      [req.auth!.accountId, body.level, body.levelName, body.percentage]
    );
    return toMarginRule(rows[0]);
  });

  app.put('/margins/:id', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `UPDATE margin_rules SET percentage = $1 WHERE id = $2 AND account_id = $3
       RETURNING id, level, level_name, percentage`,
      [body.percentage, id, req.auth!.accountId]
    );
    if (rows.length === 0) {
      throw new ApiError(404, 'MARGIN_RULE_NOT_FOUND', 'Margin rule not found');
    }
    return toMarginRule(rows[0]);
  });
}
