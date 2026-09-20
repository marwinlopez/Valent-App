import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';
import { DEVICE_ROLES } from '../auth/jwt.js';

const patchDeviceSchema = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'REVOKED']).optional(),
  name: z.string().min(1).optional(),
});

const createInviteSchema = z.object({
  role: z.enum(DEVICE_ROLES),
});

export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/devices', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const { rows } = await app.deps.pool.query(
      'SELECT id, hardware_id, role, name, status, linked_at FROM devices WHERE account_id = $1 ORDER BY linked_at',
      [req.auth!.accountId]
    );
    return rows;
  });

  /* Single-use, ADMIN-issued invite. The role lives on this row, which is why
     POST /auth/link-device does not accept a role from the client. The 24h TTL
     is meant to outlive an admin handing the code to whoever is setting the new
     device up, without leaving a usable code lying around for weeks. */
  app.post('/devices/invite', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const body = createInviteSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `INSERT INTO invite_tokens (account_id, role, expires_at, created_by_device_id)
       VALUES ($1, $2, now() + interval '24 hours', $3)
       RETURNING id, role, expires_at`,
      [req.auth!.accountId, body.role, req.auth!.deviceId]
    );
    return {
      inviteToken: rows[0].id as string,
      role: rows[0].role as string,
      expiresAt: new Date(rows[0].expires_at).toISOString(),
    };
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
    // A revocation made here takes effect on the very next request instead of
    // waiting out the auth guard's status-cache TTL.
    app.invalidateDeviceStatus(id);
    return rows[0];
  });
}
