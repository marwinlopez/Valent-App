import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from './types.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { authGuardPlugin } from './plugins/authGuard.js';
import { registerAuthRoutes } from './modules/auth/routes.js';

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('deps', deps);

  app.register(fp(errorHandlerPlugin));
  app.register(fp(authGuardPlugin));

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(registerAuthRoutes, { prefix: '/auth' });

  return app;
}
