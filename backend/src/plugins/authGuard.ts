import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyDeviceToken } from '../modules/auth/jwt.js';
import { ApiError } from './errorHandler.js';

/* Device tokens live for 30 days, so a signature check alone would keep a
   revoked device working for up to a month. Every authenticated request
   therefore resolves the device's *current* status from Postgres. To keep that
   off the hot path, statuses are cached per app instance for a short window --
   revocation is a rare, admin-driven event, and PATCH /devices/:id drops the
   cache entry directly, so the TTL only matters for a status changed by another
   process (or another instance) out of band. */
const STATUS_CACHE_TTL_MS = 30_000;

interface CachedStatus {
  status: string | null;
  cachedAt: number;
}

export async function authGuardPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('auth', undefined);

  const statusCache = new Map<string, CachedStatus>();

  async function deviceStatus(deviceId: string): Promise<string | null> {
    const cached = statusCache.get(deviceId);
    if (cached && Date.now() - cached.cachedAt < STATUS_CACHE_TTL_MS) {
      return cached.status;
    }
    const { rows } = await app.deps.pool.query('SELECT status FROM devices WHERE id = $1', [deviceId]);
    const status = rows.length === 0 ? null : (rows[0].status as string);
    statusCache.set(deviceId, { status, cachedAt: Date.now() });
    return status;
  }

  async function attachAuth(req: FastifyRequest): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    let payload;
    try {
      payload = verifyDeviceToken(token, app.deps.env.JWT_SECRET);
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
    }
    req.auth = { ...payload, dbStatus: await deviceStatus(payload.deviceId) };
  }

  /* Verifies the token and loads the device's live status without acting on it.
     Only GET /auth/me uses this: a revoked device has to be able to read back
     `status: 'REVOKED'` so the client can show the right screen instead of an
     unexplained 401. */
  app.decorate('requireAuthAllowRevoked', attachAuth);

  /* The default for every other authenticated route: secure by default, so a
     route added later cannot accidentally serve a revoked device. */
  app.decorate('requireAuth', async (req: FastifyRequest) => {
    await attachAuth(req);
    if (req.auth!.dbStatus !== 'ACTIVE') {
      throw new ApiError(401, 'DEVICE_REVOKED', 'This device has been revoked');
    }
  });

  app.decorate('requireRole', (roles) => {
    return async (req: FastifyRequest) => {
      await app.requireAuth(req);
      if (!req.auth || !roles.includes(req.auth.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Insufficient role');
      }
    };
  });

  /* Lets a status change made through this instance take effect immediately
     rather than after the cache TTL. */
  app.decorate('invalidateDeviceStatus', (deviceId: string) => {
    statusCache.delete(deviceId);
  });
}
