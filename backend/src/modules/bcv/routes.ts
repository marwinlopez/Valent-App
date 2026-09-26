import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';

const putRateSchema = z.object({
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.number().positive(),
});

export async function registerBcvRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bcv-rate', { preHandler: app.requireAuth }, async (req) => {
    const { date } = req.query as { date?: string };
    const rateDate = date ?? new Date().toISOString().slice(0, 10);

    const { rows } = await app.deps.pool.query('SELECT rate FROM bcv_rates WHERE account_id = $1 AND rate_date = $2', [
      req.auth!.accountId,
      rateDate,
    ]);
    if (rows.length === 0) {
      throw new ApiError(404, 'RATE_NOT_FOUND', `No BCV rate set for ${rateDate}`);
    }
    // The queried date, not `rows[0].rate_date`: pg parses a DATE into a JS
    // Date at the server's local midnight, which serializes as a timestamp —
    // and as the previous day on a server east of UTC.
    return { rateDate, rate: Number(rows[0].rate) };
  });

  app.put('/bcv-rate', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const body = putRateSchema.parse(req.body);
    await app.deps.pool.query(
      `INSERT INTO bcv_rates (account_id, rate_date, rate, created_by_device_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, rate_date) DO UPDATE SET rate = EXCLUDED.rate`,
      [req.auth!.accountId, body.rateDate, body.rate, req.auth!.deviceId]
    );
    return { rateDate: body.rateDate, rate: body.rate };
  });
}
