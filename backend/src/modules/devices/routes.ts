import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';

const patchDeviceSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'REVOKED']).optional(),
  name: z.string().min(1).optional(),
});

export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/devices', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const { rows } = await app.deps.pool.query(
      'SELECT id, hardware_id, role, name, status, linked_at FROM devices WHERE account_id = $1 ORDER BY linked_at',
      [req.auth!.accountId]
    );
    return rows;
  });

  app.patch('/devices/:id', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const { id } = req.params as { id: string };
    const body = patchDeviceSchema.parse(req.body);

    const { rows } = await app.deps.pool.query(
      `UPDATE devices SET
         status = COALESCE($1, status),
         name = COALESCE($2, name)
       WHERE id = $3 AND account_id = $4
       RETURNING id, hardware_id, role, name, status, linked_at`,
      [body.status ?? null, body.name ?? null, id, req.auth!.accountId]
    );
    if (rows.length === 0) {
      throw new ApiError(404, 'DEVICE_NOT_FOUND', 'Device not found');
    }
    return rows[0];
  });
}
