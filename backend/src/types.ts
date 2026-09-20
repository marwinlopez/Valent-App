import type { Pool } from 'pg';
import type { Env } from './config/env.js';
import type { SheetsClient } from './sheets/client.js';
import type { SheetsQueue } from './sheets/queue.js';
import type { DeviceTokenPayload, DeviceRole } from './modules/auth/jwt.js';

export interface AppDeps {
  pool: Pool;
  sheets: SheetsClient;
  sheetsQueue: SheetsQueue;
  env: Env;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requireRole: (roles: DeviceRole[]) => (req: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    auth?: DeviceTokenPayload;
  }
}
