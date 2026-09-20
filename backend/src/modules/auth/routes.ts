import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signDeviceToken } from './jwt.js';
import { ApiError } from '../../plugins/errorHandler.js';

const linkDeviceSchema = z.object({
  inviteToken: z.string().uuid(),
  hardwareId: z.string().min(1),
  deviceName: z.string().min(1),
  role: z.enum(['ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS']),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/link-device', async (req) => {
    const body = linkDeviceSchema.parse(req.body);

    // The invite token IS the account id for now (see spec's provisioning non-goal).
    const { rows: accountRows } = await app.deps.pool.query('SELECT id FROM accounts WHERE id = $1', [
      body.inviteToken,
    ]);
    if (accountRows.length === 0) {
      throw new ApiError(422, 'INVALID_INVITE_TOKEN', 'Invite token does not match any account');
    }
    const accountId = accountRows[0].id as string;

    const { rows: existing } = await app.deps.pool.query(
      'SELECT id FROM devices WHERE account_id = $1 AND hardware_id = $2',
      [accountId, body.hardwareId]
    );

    let deviceId: string;
    if (existing.length > 0) {
      deviceId = existing[0].id as string;
      await app.deps.pool.query('UPDATE devices SET name = $1, role = $2, status = $3 WHERE id = $4', [
        body.deviceName,
        body.role,
        'ACTIVE',
        deviceId,
      ]);
    } else {
      const { rows } = await app.deps.pool.query(
        'INSERT INTO devices (account_id, hardware_id, role, name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [accountId, body.hardwareId, body.role, body.deviceName, 'ACTIVE']
      );
      deviceId = rows[0].id as string;
    }

    const jwt = signDeviceToken({ deviceId, accountId, role: body.role }, app.deps.env.JWT_SECRET);
    return { jwt, role: body.role, accountId };
  });

  app.get('/me', { preHandler: app.requireAuth }, async (req) => {
    const auth = req.auth!;
    const { rows } = await app.deps.pool.query('SELECT role, status FROM devices WHERE id = $1', [auth.deviceId]);
    if (rows.length === 0) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Device no longer exists');
    }
    return { role: rows[0].role, status: rows[0].status, accountId: auth.accountId };
  });
}
