import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from './types.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { authGuardPlugin } from './plugins/authGuard.js';
import { registerAuthRoutes } from './modules/auth/routes.js';
import { registerDeviceRoutes } from './modules/devices/routes.js';
import { registerBcvRoutes } from './modules/bcv/routes.js';
import { registerMarginsRoutes } from './modules/margins/routes.js';
import { registerCustomerRoutes } from './modules/customers/routes.js';
import { registerInventoryRoutes } from './modules/inventory/routes.js';
import { registerSalesRoutes } from './modules/sales/routes.js';

export interface BuildAppOptions {
  /**
   * Off by default only for tests: `app.log.warn`/`.error` are the only place
   * the pricing-divergence audit, the internal-consistency checks, and the
   * "sale recorded but stock not decremented" error surface. `logger: false`
   * makes every one of those calls a silent no-op -- fine for a test that
   * spies on `app.log.warn` directly, but not for the real server, where
   * nothing else reads them.
   */
  logger?: boolean;
}

export function buildApp(deps: AppDeps, options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  app.decorate('deps', deps);

  app.register(fp(errorHandlerPlugin));
  app.register(fp(authGuardPlugin));

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(registerAuthRoutes, { prefix: '/auth' });
  app.register(registerDeviceRoutes);
  app.register(registerBcvRoutes);
  app.register(registerMarginsRoutes);
  app.register(registerCustomerRoutes);
  app.register(registerInventoryRoutes);
  app.register(registerSalesRoutes);

  return app;
}
