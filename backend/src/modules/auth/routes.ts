import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signDeviceToken, type DeviceRole } from './jwt.js';
import { ApiError } from '../../plugins/errorHandler.js';

/* The client never supplies `role`: it comes from the invite token row, which
   only an ADMIN can create (POST /devices/invite). Accepting a client-supplied
   role here would let any device mint itself an ADMIN token. */
const linkDeviceSchema = z.object({
  inviteToken: z.string().uuid(),
  hardwareId: z.string().min(1),
  deviceName: z.string().min(1),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/link-device', async (req) => {
    const body = linkDeviceSchema.parse(req.body);

    // Reserve a single client for the whole transaction (same pattern as
    // db/migrate.ts and modules/sales/routes.ts): separate pool.query() calls
    // can each be serviced by a different physical connection, so BEGIN/COMMIT
    // would not be atomic and the row lock below would not be held across the
    // validate-then-consume window.
    //
    // `SELECT ... FOR UPDATE` on the invite token closes the TOCTOU race where
    // two concurrent link-device calls both read the same unused token, both
    // pass validation, and both get a device linked from a single-use invite.
    const client = await app.deps.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: inviteRows } = await client.query(
        'SELECT id, account_id, role, expires_at, used_at FROM invite_tokens WHERE id = $1 FOR UPDATE',
        [body.inviteToken]
      );
      if (inviteRows.length === 0) {
        throw new ApiError(422, 'INVALID_INVITE_TOKEN', 'Invite token is not valid');
      }
      const invite = inviteRows[0];
      if (invite.used_at !== null) {
        throw new ApiError(422, 'INVALID_INVITE_TOKEN', 'Invite token has already been used');
      }
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        throw new ApiError(422, 'INVALID_INVITE_TOKEN', 'Invite token has expired');
      }

      const accountId = invite.account_id as string;
      const role = invite.role as DeviceRole;

      const { rows: existing } = await client.query(
        'SELECT id, status FROM devices WHERE account_id = $1 AND hardware_id = $2',
        [accountId, body.hardwareId]
      );

      let deviceId: string;
      if (existing.length > 0) {
        deviceId = existing[0].id as string;
        if (existing[0].status === 'REVOKED') {
          throw new ApiError(403, 'DEVICE_REVOKED', 'This device has been revoked and cannot re-link');
        }
        await client.query('UPDATE devices SET name = $1, role = $2, status = $3 WHERE id = $4', [
          body.deviceName,
          role,
          'ACTIVE',
          deviceId,
        ]);
      } else {
        // Only a brand-new device consumes a slot: re-linking an existing
        // hardwareId does not grow the device count.
        const { rows: accountRows } = await client.query('SELECT device_limit FROM accounts WHERE id = $1', [
          accountId,
        ]);
        const deviceLimit = Number(accountRows[0].device_limit);
        const { rows: countRows } = await client.query(
          "SELECT COUNT(*) AS active_devices FROM devices WHERE account_id = $1 AND status != 'REVOKED'",
          [accountId]
        );
        if (Number(countRows[0].active_devices) >= deviceLimit) {
          throw new ApiError(
            403,
            'DEVICE_LIMIT_REACHED',
            `This account already has its maximum of ${deviceLimit} linked devices`
          );
        }

        const { rows } = await client.query(
          'INSERT INTO devices (account_id, hardware_id, role, name, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [accountId, body.hardwareId, role, body.deviceName, 'ACTIVE']
        );
        deviceId = rows[0].id as string;
      }

      // Consuming the token inside the same transaction as the device upsert
      // keeps a single invite from linking two devices.
      await client.query('UPDATE invite_tokens SET used_at = now() WHERE id = $1', [invite.id]);
      await client.query('COMMIT');

      const jwt = signDeviceToken({ deviceId, accountId, role }, app.deps.env.JWT_SECRET);
      return { jwt, role, accountId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  /* `requireAuthAllowRevoked` (not `requireAuth`): a revoked device must still be
     able to reach this route, otherwise it can never learn *why* it stopped
     working. Every other authenticated route rejects a revoked device. */
  app.get('/me', { preHandler: app.requireAuthAllowRevoked }, async (req) => {
    const auth = req.auth!;
    const { rows } = await app.deps.pool.query('SELECT role, status FROM devices WHERE id = $1 AND account_id = $2', [
      auth.deviceId,
      auth.accountId,
    ]);
    if (rows.length === 0) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Device no longer exists');
    }
    const role = rows[0].role as string;
    const status = rows[0].status as string;
    if (status !== 'ACTIVE') {
      return { role, status, accountId: auth.accountId };
    }
    const jwt = signDeviceToken(
      { deviceId: auth.deviceId, accountId: auth.accountId, role: role as DeviceRole },
      app.deps.env.JWT_SECRET
    );
    return { role, status, accountId: auth.accountId, jwt };
  });
}
