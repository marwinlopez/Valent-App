import type { FastifyInstance, FastifyRequest } from 'fastify';
import { verifyDeviceToken } from '../modules/auth/jwt.js';
import { ApiError } from './errorHandler.js';

export async function authGuardPlugin(app: FastifyInstance): Promise<void> {
  app.decorateRequest('auth', undefined);

  app.decorate('requireAuth', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Missing bearer token');
    }
    const token = header.slice('Bearer '.length);
    try {
      req.auth = verifyDeviceToken(token, app.deps.env.JWT_SECRET);
    } catch {
      throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token');
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
}
