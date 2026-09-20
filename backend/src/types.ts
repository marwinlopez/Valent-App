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

/* The token's claims plus the device status read from Postgres on this request
   (null when the device row is gone). */
export interface RequestAuth extends DeviceTokenPayload {
  dbStatus: string | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    requireAuth: (req: FastifyRequest) => Promise<void>;
    requireAuthAllowRevoked: (req: FastifyRequest) => Promise<void>;
    requireRole: (roles: DeviceRole[]) => (req: FastifyRequest) => Promise<void>;
    invalidateDeviceStatus: (deviceId: string) => void;
  }
  interface FastifyRequest {
    auth?: RequestAuth;
  }
}
