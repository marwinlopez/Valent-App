# Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Node/Fastify backend service that owns Neon (Postgres) and Google Sheets credentials, exposes a REST API for device auth, account config, customers/credit, inventory, and sales, and serializes concurrent Sheets writes safely — per `docs/superpowers/specs/2026-09-19-backend-api-design.md`.

**Architecture:** A single Fastify app (`src/app.ts`) built via dependency injection (`AppDeps = { pool, sheets, sheetsQueue, env }`) so tests can swap a `pg-mem` in-memory Postgres and a mocked Sheets client for the real ones. Routes are grouped by domain module under `src/modules/*`; each module registers itself on the Fastify instance and reads `app.deps` for its collaborators. All Sheets writes go through a single per-account `SheetsQueue` (never called directly from routes) to guarantee serialized, retried writes.

**Tech Stack:** Node.js (>=18) + TypeScript (ESM, strict mode), Fastify 4, `pg`, `googleapis` + `google-auth-library`, `jsonwebtoken`, `zod`, `p-queue`, `vitest`, `pg-mem` (test-only in-memory Postgres).

## Global Constraints

- Node >= 18, TypeScript `strict: true`, project uses native ESM (`"type": "module"` in package.json).
- No ORM — raw SQL via `pg`, migrations are plain `.sql` files applied by a custom runner.
- Every protected route must go through `app.requireAuth` or `app.requireRole([...])` — never read `Authorization` header directly in a route handler.
- Every request body is validated with a `zod` schema before use.
- Every Sheets write (append/update) happens inside `SheetsQueue.enqueue(accountId, task)` — routes never call `SheetsClient` methods directly for writes. Reads may call `SheetsClient` directly (no serialization needed for reads).
- All error responses use the shape `{ error: { code: string, message: string } }` with the HTTP status codes defined in the spec (401/403/409/422).
- Monetary amounts (`cost_usd`, `total_usd`, `total_ves`, credit limits/balances) are JavaScript `number`s rounded to 2 decimal places at the API boundary — never strings.
- JWT secret (`JWT_SECRET` env var) must be at least 16 characters; enforced by the env schema at startup (fail fast, not at first request).
- Tests never hit real Neon or real Google Sheets — `pg-mem` for Postgres, `vi.mock('googleapis')` for Sheets.

---

## File Structure

```
backend/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  migrations/
    001_init.sql
  src/
    config/env.ts
    db/client.ts
    db/migrate.ts
    sheets/client.ts
    sheets/queue.ts
    modules/
      auth/jwt.ts
      auth/routes.ts
      devices/routes.ts
      bcv/routes.ts
      margins/routes.ts
      customers/credit.ts
      customers/qrToken.ts
      customers/routes.ts
      inventory/routes.ts
      sales/routes.ts
    plugins/errorHandler.ts
    plugins/authGuard.ts
    types.ts
    app.ts
    server.ts
  test/
    helpers/testDb.ts
    helpers/testApp.ts
    helpers/factories.ts
    auth.test.ts
    devices.test.ts
    bcv.test.ts
    margins.test.ts
    customers.test.ts
    credit.test.ts
    qrLink.test.ts
    sheets-client.test.ts
    sheets-queue.test.ts
    inventory.test.ts
    sales.test.ts
```

---

### Task 1: Project scaffold, env config, health endpoint

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `backend/.env.example`
- Create: `backend/src/config/env.ts`
- Create: `backend/src/server.ts`
- Test: `backend/test/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source?: NodeJS.ProcessEnv): Env` and `type Env` (fields: `DATABASE_URL: string`, `GOOGLE_SERVICE_ACCOUNT_EMAIL: string`, `GOOGLE_PRIVATE_KEY: string`, `JWT_SECRET: string`, `PORT: number`) from `src/config/env.ts` — every later task that needs config imports this.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "valent-backend",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "vitest run",
    "migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "pg": "^8.12.0",
    "googleapis": "^140.0.1",
    "google-auth-library": "^9.14.1",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.23.8",
    "p-queue": "^8.0.1"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "tsx": "^4.16.2",
    "vitest": "^2.0.5",
    "pg-mem": "^2.9.0",
    "@types/node": "^20.14.15",
    "@types/pg": "^8.11.6",
    "@types/jsonwebtoken": "^9.0.6"
  }
}
```

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `backend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `backend/.env.example`**

```
DATABASE_URL=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
JWT_SECRET=
PORT=3000
```

- [ ] **Step 5: Write the failing test for env loading**

```ts
// backend/test/env.test.ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('parses a valid environment', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://localhost/test',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
      GOOGLE_PRIVATE_KEY: 'fake-key',
      JWT_SECRET: 'a'.repeat(20),
      PORT: '4000',
    });
    expect(env.PORT).toBe(4000);
    expect(env.JWT_SECRET).toHaveLength(20);
  });

  it('throws when JWT_SECRET is too short', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://localhost/test',
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
        GOOGLE_PRIVATE_KEY: 'fake-key',
        JWT_SECRET: 'short',
      })
    ).toThrow();
  });

  it('defaults PORT to 3000 when not set', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://localhost/test',
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
      GOOGLE_PRIVATE_KEY: 'fake-key',
      JWT_SECRET: 'a'.repeat(20),
    });
    expect(env.PORT).toBe(3000);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npm install && npx vitest run test/env.test.ts`
Expected: FAIL — `src/config/env.ts` does not exist yet.

- [ ] **Step 7: Implement `backend/src/config/env.ts`**

```ts
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().min(1),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/env.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Create a minimal `backend/src/server.ts` (no app.ts yet — that's Task 4)**

```ts
import Fastify from 'fastify';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok' }));

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 10: Commit**

```bash
git add backend/package.json backend/tsconfig.json backend/vitest.config.ts backend/.env.example backend/src/config/env.ts backend/src/server.ts backend/test/env.test.ts
git commit -m "feat(backend): scaffold project with env config and health endpoint"
```

---

### Task 2: Neon DB client, migration runner, initial schema

**Files:**
- Create: `backend/src/db/client.ts`
- Create: `backend/src/db/migrate.ts`
- Create: `backend/migrations/001_init.sql`
- Create: `backend/test/helpers/testDb.ts`
- Test: `backend/test/migrate.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `createPool(connectionString: string): Pool` (from `src/db/client.ts`), `runMigrations(pool: Pool, migrationsDir: string): Promise<void>` (from `src/db/migrate.ts`), `createTestPool(): Pool` (from `test/helpers/testDb.ts`, wraps `pg-mem`) — every later task's tests import `createTestPool` and `runMigrations`.

- [ ] **Step 1: Create `backend/src/db/client.ts`**

```ts
import { Pool } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}
```

- [ ] **Step 2: Create `backend/migrations/001_init.sql`**

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basic',
  device_limit INTEGER NOT NULL DEFAULT 3,
  spreadsheet_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  hardware_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS')),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'REVOKED')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, hardware_id)
);

CREATE TABLE bcv_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  rate_date DATE NOT NULL,
  rate NUMERIC(12, 4) NOT NULL,
  created_by_device_id UUID REFERENCES devices(id),
  UNIQUE (account_id, rate_date)
);

CREATE TABLE margin_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  level TEXT NOT NULL CHECK (level IN ('CATEGORIA', 'SUBCATEGORIA', 'DEPARTAMENTO')),
  level_name TEXT NOT NULL,
  percentage NUMERIC(6, 2) NOT NULL,
  UNIQUE (account_id, level, level_name)
);

CREATE TABLE loyalty_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  credit_limit NUMERIC(12, 2) NOT NULL,
  max_payment_term_days INTEGER NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  phone TEXT,
  loyalty_level_id UUID REFERENCES loyalty_levels(id),
  current_debt_balance NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE customer_qr_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  device_id UUID REFERENCES devices(id),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 3: Create `backend/test/helpers/testDb.ts`**

```ts
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';

export function createTestPool(): Pool {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid' as any,
    implementation: () => crypto.randomUUID(),
  });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return pool as unknown as Pool;
}
```

- [ ] **Step 4: Write the failing test for migrations**

```ts
// backend/test/migrate.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestPool } from './helpers/testDb';
import { runMigrations } from '../src/db/migrate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

describe('runMigrations', () => {
  it('creates all expected tables', async () => {
    const pool = createTestPool();
    await runMigrations(pool, migrationsDir);

    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const tableNames = rows.map((r) => r.table_name).sort();
    expect(tableNames).toEqual(
      [
        '_migrations',
        'accounts',
        'bcv_rates',
        'customer_qr_links',
        'customers',
        'devices',
        'loyalty_levels',
        'margin_rules',
      ].sort()
    );
  });

  it('is idempotent — running twice does not error', async () => {
    const pool = createTestPool();
    await runMigrations(pool, migrationsDir);
    await expect(runMigrations(pool, migrationsDir)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run test/migrate.test.ts`
Expected: FAIL — `src/db/migrate.ts` does not exist.

- [ ] **Step 6: Implement `backend/src/db/migrate.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const { rows } = await pool.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
    if (rows.length > 0) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query('BEGIN');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await pool.query('COMMIT');
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  }
}

/* Allows `npm run migrate` against the real DATABASE_URL. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadEnv } = await import('../config/env.js');
  const { createPool } = await import('./client.js');
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
  await runMigrations(pool, dir);
  await pool.end();
  console.log('Migrations applied.');
}
```

Note: this file needs `import { fileURLToPath } from 'node:url';` added to the top alongside the other imports.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/migrate.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add backend/src/db/client.ts backend/src/db/migrate.ts backend/migrations/001_init.sql backend/test/helpers/testDb.ts backend/test/migrate.test.ts
git commit -m "feat(backend): add Neon client, migration runner, and initial schema"
```

---

### Task 3: JWT module, error handler, auth guard plugin

**Files:**
- Create: `backend/src/modules/auth/jwt.ts`
- Create: `backend/src/plugins/errorHandler.ts`
- Create: `backend/src/plugins/authGuard.ts`
- Create: `backend/src/types.ts`
- Test: `backend/test/jwt.test.ts`

**Interfaces:**
- Consumes: `Env` from `src/config/env.ts` (Task 1).
- Produces: `signDeviceToken(payload, secret): string`, `verifyDeviceToken(token, secret): DeviceTokenPayload`, `type DeviceTokenPayload = { deviceId: string; accountId: string; role: 'ADMIN'|'INVENTARIO'|'POST_VENTA'|'CLIENTE_PEDIDOS' }` (from `src/modules/auth/jwt.ts`); `class ApiError extends Error` with `(statusCode: number, code: string, message: string)` and `errorHandlerPlugin(app): Promise<void>` (from `src/plugins/errorHandler.ts`); `authGuardPlugin(app): Promise<void>` decorating `app.requireAuth(req): Promise<void>` and `app.requireRole(roles: Role[]): (req) => Promise<void>`, and `req.auth?: DeviceTokenPayload` (from `src/plugins/authGuard.ts`). All later route modules import `ApiError`, `app.requireAuth`, `app.requireRole`.

- [ ] **Step 1: Write the failing test for jwt.ts**

```ts
// backend/test/jwt.test.ts
import { describe, it, expect } from 'vitest';
import { signDeviceToken, verifyDeviceToken } from '../src/modules/auth/jwt';

describe('device tokens', () => {
  const secret = 'a'.repeat(20);

  it('round-trips a valid payload', () => {
    const token = signDeviceToken({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN' }, secret);
    const payload = verifyDeviceToken(token, secret);
    expect(payload).toEqual({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN' });
  });

  it('throws on a token signed with a different secret', () => {
    const token = signDeviceToken({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN' }, secret);
    expect(() => verifyDeviceToken(token, 'b'.repeat(20))).toThrow();
  });

  it('throws on a malformed token', () => {
    expect(() => verifyDeviceToken('not-a-token', secret)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/jwt.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `backend/src/modules/auth/jwt.ts`**

```ts
import jwt from 'jsonwebtoken';

export type DeviceRole = 'ADMIN' | 'INVENTARIO' | 'POST_VENTA' | 'CLIENTE_PEDIDOS';

export interface DeviceTokenPayload {
  deviceId: string;
  accountId: string;
  role: DeviceRole;
}

export function signDeviceToken(payload: DeviceTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '30d' });
}

export function verifyDeviceToken(token: string, secret: string): DeviceTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid token payload');
  }
  const { deviceId, accountId, role } = decoded as Record<string, unknown>;
  if (typeof deviceId !== 'string' || typeof accountId !== 'string' || typeof role !== 'string') {
    throw new Error('Invalid token payload');
  }
  return { deviceId, accountId, role: role as DeviceRole };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/jwt.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Create `backend/src/plugins/errorHandler.ts` (no dedicated test — exercised via route integration tests in later tasks)**

```ts
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export async function errorHandlerPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof ZodError) {
      reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: err.message } });
      return;
    }
    app.log.error(err);
    reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' } });
  });
}
```

- [ ] **Step 6: Create `backend/src/types.ts`**

```ts
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
```

- [ ] **Step 7: Create `backend/src/plugins/authGuard.ts`**

```ts
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
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/auth/jwt.ts backend/src/plugins/errorHandler.ts backend/src/plugins/authGuard.ts backend/src/types.ts backend/test/jwt.test.ts
git commit -m "feat(backend): add device JWT module, error handler, and auth guard plugin"
```

---

### Task 4: App builder, device linking, and /auth/me

**Files:**
- Create: `backend/src/app.ts`
- Create: `backend/src/modules/auth/routes.ts`
- Create: `backend/test/helpers/testApp.ts`
- Create: `backend/test/helpers/factories.ts`
- Test: `backend/test/auth.test.ts`

**Interfaces:**
- Consumes: `AppDeps` (Task 3 `types.ts`), `createTestPool`/`runMigrations` (Task 2), `ApiError`/`errorHandlerPlugin`/`authGuardPlugin` (Task 3), `signDeviceToken` (Task 3).
- Produces: `buildApp(deps: AppDeps): FastifyInstance` (from `src/app.ts`) — every later task's routes register on this app, and every later test imports `buildTestApp()` from `test/helpers/testApp.ts`. `insertAccount(pool, overrides?): Promise<{ id: string; spreadsheetId: string }>` and `insertDevice(pool, accountId, overrides?): Promise<{ id: string }>` from `test/helpers/factories.ts`.

- [ ] **Step 1: Create `backend/test/helpers/testApp.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { createTestPool } from './testDb.js';
import { runMigrations } from '../../src/db/migrate.js';
import { SheetsQueue } from '../../src/sheets/queue.js';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../../src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', '..', 'migrations');

export async function buildTestApp(): Promise<{ app: FastifyInstance; env: Env }> {
  const pool = createTestPool();
  await runMigrations(pool, migrationsDir);

  const env: Env = {
    DATABASE_URL: 'test',
    GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@example.com',
    GOOGLE_PRIVATE_KEY: 'fake',
    JWT_SECRET: 'a'.repeat(20),
    PORT: 3000,
  };

  const sheets = {
    getValues: vi.fn().mockResolvedValue([]),
    appendRow: vi.fn().mockResolvedValue(undefined),
    updateRow: vi.fn().mockResolvedValue(undefined),
  };

  const app = buildApp({ pool, sheets: sheets as any, sheetsQueue: new SheetsQueue(), env });
  return { app, env };
}
```

- [ ] **Step 2: Create `backend/test/helpers/factories.ts`**

```ts
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export async function insertAccount(
  pool: Pool,
  overrides: Partial<{ name: string; plan: string; deviceLimit: number; spreadsheetId: string }> = {}
): Promise<{ id: string; spreadsheetId: string }> {
  const id = randomUUID();
  const spreadsheetId = overrides.spreadsheetId ?? `sheet-${id}`;
  await pool.query(
    'INSERT INTO accounts (id, name, plan, device_limit, spreadsheet_id) VALUES ($1, $2, $3, $4, $5)',
    [id, overrides.name ?? 'Test Account', overrides.plan ?? 'basic', overrides.deviceLimit ?? 3, spreadsheetId]
  );
  return { id, spreadsheetId };
}

export async function insertDevice(
  pool: Pool,
  accountId: string,
  overrides: Partial<{ hardwareId: string; role: string; name: string; status: string }> = {}
): Promise<{ id: string }> {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO devices (id, account_id, hardware_id, role, name, status) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      id,
      accountId,
      overrides.hardwareId ?? `hw-${id}`,
      overrides.role ?? 'ADMIN',
      overrides.name ?? 'Test Device',
      overrides.status ?? 'ACTIVE',
    ]
  );
  return { id };
}
```

- [ ] **Step 3: Write the failing test for auth routes**

```ts
// backend/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';

describe('POST /auth/link-device', () => {
  it('links a new device and returns a JWT', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: {
        inviteToken: account.id,
        hardwareId: 'hw-123',
        deviceName: 'Pixel 8',
        role: 'INVENTARIO',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe('INVENTARIO');
    expect(body.accountId).toBe(account.id);
    expect(typeof body.jwt).toBe('string');
  });

  it('rejects an unknown invite token', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: 'nonexistent', hardwareId: 'hw-1', deviceName: 'X', role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('GET /auth/me', () => {
  it('returns the current device role for a valid token', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const link = await app.inject({
      method: 'POST',
      url: '/auth/link-device',
      payload: { inviteToken: account.id, hardwareId: 'hw-1', deviceName: 'X', role: 'ADMIN' },
    });
    const { jwt } = link.json();

    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('ADMIN');
    expect(res.json().status).toBe('ACTIVE');
  });

  it('rejects a request with no token', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('reports REVOKED status for a revoked device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { status: 'REVOKED' });
    const { signDeviceToken } = await import('../src/modules/auth/jwt.js');
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REVOKED');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — `src/app.ts` and `src/modules/auth/routes.ts` do not exist.

- [ ] **Step 5: Implement `backend/src/app.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppDeps } from './types.js';
import { errorHandlerPlugin } from './plugins/errorHandler.js';
import { authGuardPlugin } from './plugins/authGuard.js';
import { registerAuthRoutes } from './modules/auth/routes.js';

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorate('deps', deps);

  app.register(errorHandlerPlugin);
  app.register(authGuardPlugin);

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(registerAuthRoutes, { prefix: '/auth' });

  return app;
}
```

- [ ] **Step 6: Implement `backend/src/modules/auth/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { signDeviceToken } from './jwt.js';
import { ApiError } from '../../plugins/errorHandler.js';

const linkDeviceSchema = z.object({
  inviteToken: z.string().min(1),
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
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 8: Commit**

```bash
git add backend/src/app.ts backend/src/modules/auth/routes.ts backend/test/helpers/testApp.ts backend/test/helpers/factories.ts backend/test/auth.test.ts
git commit -m "feat(backend): add app builder and device linking / auth/me routes"
```

---

### Task 5: Device admin endpoints

**Files:**
- Create: `backend/src/modules/devices/routes.ts`
- Modify: `backend/src/app.ts` (register the new routes)
- Test: `backend/test/devices.test.ts`

**Interfaces:**
- Consumes: `app.requireRole` (Task 3), `insertAccount`/`insertDevice` (Task 4), `buildTestApp` (Task 4).
- Produces: `registerDeviceRoutes(app: FastifyInstance): Promise<void>` from `src/modules/devices/routes.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/devices.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function adminToken(app: Awaited<ReturnType<typeof buildTestApp>>['app'], accountId: string) {
  const device = await insertDevice(app.deps.pool, accountId, { role: 'ADMIN' });
  return signDeviceToken({ deviceId: device.id, accountId, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
}

describe('GET /devices', () => {
  it('lists devices for the caller account only', async () => {
    const { app } = await buildTestApp();
    const accountA = await insertAccount(app.deps.pool);
    const accountB = await insertAccount(app.deps.pool);
    await insertDevice(app.deps.pool, accountA.id, { name: 'Device A' });
    await insertDevice(app.deps.pool, accountB.id, { name: 'Device B' });
    const jwt = await adminToken(app, accountA.id);

    const res = await app.inject({ method: 'GET', url: '/devices', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(200);
    const names = res.json().map((d: { name: string }) => d.name);
    expect(names).toContain('Device A');
    expect(names).not.toContain('Device B');
  });

  it('rejects non-ADMIN roles', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'INVENTARIO' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'INVENTARIO' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({ method: 'GET', url: '/devices', headers: { authorization: `Bearer ${jwt}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /devices/:id', () => {
  it('revokes a device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const target = await insertDevice(app.deps.pool, account.id);
    const jwt = await adminToken(app, account.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/devices/${target.id}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { status: 'REVOKED' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('REVOKED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/devices.test.ts`
Expected: FAIL — module not registered.

- [ ] **Step 3: Implement `backend/src/modules/devices/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
    return rows[0];
  });
}
```

- [ ] **Step 4: Register the routes in `backend/src/app.ts`**

Add the import and registration line:

```ts
import { registerDeviceRoutes } from './modules/devices/routes.js';
// ...
app.register(registerDeviceRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/devices.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/devices/routes.ts backend/src/app.ts backend/test/devices.test.ts
git commit -m "feat(backend): add device admin endpoints (list, revoke/rename)"
```

---

### Task 6: BCV rate endpoints

**Files:**
- Create: `backend/src/modules/bcv/routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/bcv.test.ts`

**Interfaces:**
- Consumes: same helpers as Task 5.
- Produces: `registerBcvRoutes(app: FastifyInstance): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/bcv.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

describe('BCV rate', () => {
  it('sets and retrieves the rate for a given date', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const put = await app.inject({
      method: 'PUT',
      url: '/bcv-rate',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { rateDate: '2026-09-19', rate: 42.5 },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: '/bcv-rate?date=2026-09-19',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(get.statusCode).toBe(200);
    expect(Number(get.json().rate)).toBe(42.5);
  });

  it('returns 404 when no rate exists for the date', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const res = await app.inject({
      method: 'GET',
      url: '/bcv-rate?date=2020-01-01',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bcv.test.ts`
Expected: FAIL — route not registered.

- [ ] **Step 3: Implement `backend/src/modules/bcv/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';

const putRateSchema = z.object({
  rateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rate: z.number().positive(),
});

export async function registerBcvRoutes(app: FastifyInstance): Promise<void> {
  app.get('/bcv-rate', { preHandler: app.requireAuth }, async (req) => {
    const { date } = req.query as { date?: string };
    const rateDate = date ?? new Date().toISOString().slice(0, 10);

    const { rows } = await app.deps.pool.query('SELECT rate, rate_date FROM bcv_rates WHERE account_id = $1 AND rate_date = $2', [
      req.auth!.accountId,
      rateDate,
    ]);
    if (rows.length === 0) {
      throw new ApiError(404, 'RATE_NOT_FOUND', `No BCV rate set for ${rateDate}`);
    }
    return { rateDate: rows[0].rate_date, rate: Number(rows[0].rate) };
  });

  app.put('/bcv-rate', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const body = putRateSchema.parse(req.body);
    await app.deps.pool.query(
      `INSERT INTO bcv_rates (account_id, rate_date, rate, created_by_device_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, rate_date) DO UPDATE SET rate = EXCLUDED.rate`,
      [req.auth!.accountId, body.rateDate, body.rate, req.auth!.deviceId]
    );
    return { rateDate: body.rateDate, rate: body.rate };
  });
}
```

- [ ] **Step 4: Register in `backend/src/app.ts`**

```ts
import { registerBcvRoutes } from './modules/bcv/routes.js';
// ...
app.register(registerBcvRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/bcv.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/bcv/routes.ts backend/src/app.ts backend/test/bcv.test.ts
git commit -m "feat(backend): add BCV rate get/set endpoints"
```

---

### Task 7: Margin rules endpoints

**Files:**
- Create: `backend/src/modules/margins/routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/margins.test.ts`

**Interfaces:**
- Produces: `registerMarginsRoutes(app: FastifyInstance): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/margins.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

describe('Margin rules', () => {
  it('creates, lists, and updates a margin rule', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);

    const create = await app.inject({
      method: 'POST',
      url: '/margins',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { level: 'DEPARTAMENTO', levelName: 'Lacteos', percentage: 25 },
    });
    expect(create.statusCode).toBe(200);
    const id = create.json().id;

    const list = await app.inject({ method: 'GET', url: '/margins', headers: { authorization: `Bearer ${jwt}` } });
    expect(list.json()).toHaveLength(1);

    const update = await app.inject({
      method: 'PUT',
      url: `/margins/${id}`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { percentage: 30 },
    });
    expect(Number(update.json().percentage)).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/margins.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `backend/src/modules/margins/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const createSchema = z.object({
  level: z.enum(['CATEGORIA', 'SUBCATEGORIA', 'DEPARTAMENTO']),
  levelName: z.string().min(1),
  percentage: z.number().min(0).max(1000),
});

const updateSchema = z.object({
  percentage: z.number().min(0).max(1000),
});

export async function registerMarginsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/margins', { preHandler: app.requireAuth }, async (req) => {
    const { rows } = await app.deps.pool.query(
      'SELECT id, level, level_name, percentage FROM margin_rules WHERE account_id = $1 ORDER BY level, level_name',
      [req.auth!.accountId]
    );
    return rows;
  });

  app.post('/margins', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const body = createSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `INSERT INTO margin_rules (account_id, level, level_name, percentage)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, level, level_name) DO UPDATE SET percentage = EXCLUDED.percentage
       RETURNING id, level, level_name, percentage`,
      [req.auth!.accountId, body.level, body.levelName, body.percentage]
    );
    return rows[0];
  });

  app.put('/margins/:id', { preHandler: app.requireRole(['ADMIN']) }, async (req) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `UPDATE margin_rules SET percentage = $1 WHERE id = $2 AND account_id = $3
       RETURNING id, level, level_name, percentage`,
      [body.percentage, id, req.auth!.accountId]
    );
    return rows[0];
  });
}
```

- [ ] **Step 4: Register in `backend/src/app.ts`**

```ts
import { registerMarginsRoutes } from './modules/margins/routes.js';
// ...
app.register(registerMarginsRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/margins.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/margins/routes.ts backend/src/app.ts backend/test/margins.test.ts
git commit -m "feat(backend): add margin rules CRUD endpoints"
```

---

### Task 8: Customers CRUD endpoints

**Files:**
- Create: `backend/src/modules/customers/routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/customers.test.ts`

**Interfaces:**
- Produces: `registerCustomerRoutes(app: FastifyInstance): Promise<void>` (this task creates the file; Tasks 9 and 10 add more routes into the same file).

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/customers.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function adminJwt(app: Awaited<ReturnType<typeof buildTestApp>>['app'], accountId: string) {
  const device = await insertDevice(app.deps.pool, accountId, { role: 'ADMIN' });
  return signDeviceToken({ deviceId: device.id, accountId, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
}

describe('Customers', () => {
  it('creates and lists customers for the caller account', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await adminJwt(app, account.id);

    const create = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'Maria Perez', phone: '0414-1234567' },
    });
    expect(create.statusCode).toBe(200);

    const list = await app.inject({ method: 'GET', url: '/customers', headers: { authorization: `Bearer ${jwt}` } });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].name).toBe('Maria Perez');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/customers.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `backend/src/modules/customers/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const createCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  loyaltyLevelId: z.string().uuid().optional(),
});

export async function registerCustomerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/customers', { preHandler: app.requireAuth }, async (req) => {
    const { rows } = await app.deps.pool.query(
      'SELECT id, name, phone, loyalty_level_id, current_debt_balance FROM customers WHERE account_id = $1 ORDER BY name',
      [req.auth!.accountId]
    );
    return rows.map((r) => ({ ...r, current_debt_balance: Number(r.current_debt_balance) }));
  });

  app.post('/customers', { preHandler: app.requireAuth }, async (req) => {
    const body = createCustomerSchema.parse(req.body);
    const { rows } = await app.deps.pool.query(
      `INSERT INTO customers (account_id, name, phone, loyalty_level_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, phone, loyalty_level_id, current_debt_balance`,
      [req.auth!.accountId, body.name, body.phone ?? null, body.loyaltyLevelId ?? null]
    );
    return { ...rows[0], current_debt_balance: Number(rows[0].current_debt_balance) };
  });
}
```

- [ ] **Step 4: Register in `backend/src/app.ts`**

```ts
import { registerCustomerRoutes } from './modules/customers/routes.js';
// ...
app.register(registerCustomerRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/customers.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/customers/routes.ts backend/src/app.ts backend/test/customers.test.ts
git commit -m "feat(backend): add customer create/list endpoints"
```

---

### Task 9: Credit-check pure logic + endpoint

**Files:**
- Create: `backend/src/modules/customers/credit.ts`
- Modify: `backend/src/modules/customers/routes.ts` (add the credit-check route)
- Test: `backend/test/credit.test.ts`

**Interfaces:**
- Produces: `evaluateCreditCheck(input: CreditCheckInput): CreditCheckResult` where `CreditCheckInput = { currentDebtBalance: number; creditLimit: number; requestedAmount: number }` and `CreditCheckResult = { approved: boolean; availableCredit: number; reason: string | null }` (from `src/modules/customers/credit.ts`). Task 14 (Sales) imports `evaluateCreditCheck` to re-validate server-side.

- [ ] **Step 1: Write the failing unit test for the pure function**

```ts
// backend/test/credit.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateCreditCheck } from '../src/modules/customers/credit';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

describe('evaluateCreditCheck (pure)', () => {
  it('approves when requested amount fits within available credit', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 50, creditLimit: 200, requestedAmount: 100 });
    expect(result).toEqual({ approved: true, availableCredit: 150, reason: null });
  });

  it('rejects when requested amount exceeds available credit', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 180, creditLimit: 200, requestedAmount: 50 });
    expect(result.approved).toBe(false);
    expect(result.availableCredit).toBe(20);
    expect(result.reason).toMatch(/exceeds/i);
  });

  it('rejects a non-positive requested amount', () => {
    const result = evaluateCreditCheck({ currentDebtBalance: 0, creditLimit: 200, requestedAmount: 0 });
    expect(result.approved).toBe(false);
  });
});

describe('GET /customers/:id/credit-check', () => {
  it('evaluates credit for a customer with a loyalty level', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'POST_VENTA' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'POST_VENTA' }, app.deps.env.JWT_SECRET);

    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Juan', levelRows[0].id, 100]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/customers/${customerRows[0].id}/credit-check?amount=150`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ approved: true, availableCredit: 200, reason: null });
  });

  it('rejects when the customer has no loyalty level (no credit limit)', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'POST_VENTA' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'POST_VENTA' }, app.deps.env.JWT_SECRET);
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, current_debt_balance) VALUES ($1, $2, $3) RETURNING id',
      [account.id, 'Sin Nivel', 0]
    );

    const res = await app.inject({
      method: 'GET',
      url: `/customers/${customerRows[0].id}/credit-check?amount=10`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.json().approved).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/credit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `backend/src/modules/customers/credit.ts`**

```ts
export interface CreditCheckInput {
  currentDebtBalance: number;
  creditLimit: number;
  requestedAmount: number;
}

export interface CreditCheckResult {
  approved: boolean;
  availableCredit: number;
  reason: string | null;
}

export function evaluateCreditCheck(input: CreditCheckInput): CreditCheckResult {
  const availableCredit = Math.round((input.creditLimit - input.currentDebtBalance) * 100) / 100;

  if (input.requestedAmount <= 0) {
    return { approved: false, availableCredit, reason: 'Requested amount must be positive' };
  }
  if (availableCredit <= 0) {
    return { approved: false, availableCredit, reason: 'No available credit' };
  }
  if (input.requestedAmount > availableCredit) {
    return { approved: false, availableCredit, reason: 'Requested amount exceeds available credit' };
  }
  return { approved: true, availableCredit, reason: null };
}
```

- [ ] **Step 4: Add the credit-check route to `backend/src/modules/customers/routes.ts`**

Add this import at the top:

```ts
import { evaluateCreditCheck } from './credit.js';
import { ApiError } from '../../plugins/errorHandler.js';
```

Add this route inside `registerCustomerRoutes`, after the existing two:

```ts
  app.get('/customers/:id/credit-check', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const { amount } = req.query as { amount?: string };
    const requestedAmount = Number(amount ?? '0');

    const { rows } = await app.deps.pool.query(
      `SELECT c.current_debt_balance, l.credit_limit
       FROM customers c
       LEFT JOIN loyalty_levels l ON l.id = c.loyalty_level_id
       WHERE c.id = $1 AND c.account_id = $2`,
      [id, req.auth!.accountId]
    );
    if (rows.length === 0) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }

    const creditLimit = rows[0].credit_limit === null ? 0 : Number(rows[0].credit_limit);
    return evaluateCreditCheck({
      currentDebtBalance: Number(rows[0].current_debt_balance),
      creditLimit,
      requestedAmount,
    });
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/credit.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/customers/credit.ts backend/src/modules/customers/routes.ts backend/test/credit.test.ts
git commit -m "feat(backend): add credit-check pure logic and endpoint"
```

---

### Task 10: Customer QR-link endpoint

**Files:**
- Create: `backend/src/modules/customers/qrToken.ts`
- Modify: `backend/src/modules/customers/routes.ts` (add the route)
- Test: `backend/test/qrLink.test.ts`

**Interfaces:**
- Produces: `signQrToken(payload: { customerId: string; accountId: string }, secret: string): string` and `verifyQrToken(token: string, secret: string): { customerId: string; accountId: string }` from `src/modules/customers/qrToken.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/qrLink.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';
import { verifyQrToken } from '../src/modules/customers/qrToken';

describe('POST /customers/:id/qr-link', () => {
  it('issues a short-lived QR token for the customer', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const device = await insertDevice(app.deps.pool, account.id, { role: 'ADMIN' });
    const jwt = signDeviceToken({ deviceId: device.id, accountId: account.id, role: 'ADMIN' }, app.deps.env.JWT_SECRET);
    const { rows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, current_debt_balance) VALUES ($1, $2, 0) RETURNING id',
      [account.id, 'Cliente QR']
    );
    const customerId = rows[0].id;

    const res = await app.inject({
      method: 'POST',
      url: `/customers/${customerId}/qr-link`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const { qrToken } = res.json();

    const decoded = verifyQrToken(qrToken, app.deps.env.JWT_SECRET);
    expect(decoded).toEqual({ customerId, accountId: account.id });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/qrLink.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `backend/src/modules/customers/qrToken.ts`**

```ts
import jwt from 'jsonwebtoken';

export interface QrTokenPayload {
  customerId: string;
  accountId: string;
}

export function signQrToken(payload: QrTokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '15m' });
}

export function verifyQrToken(token: string, secret: string): QrTokenPayload {
  const decoded = jwt.verify(token, secret);
  if (typeof decoded === 'string') {
    throw new Error('Invalid QR token payload');
  }
  const { customerId, accountId } = decoded as Record<string, unknown>;
  if (typeof customerId !== 'string' || typeof accountId !== 'string') {
    throw new Error('Invalid QR token payload');
  }
  return { customerId, accountId };
}
```

- [ ] **Step 4: Add the route to `backend/src/modules/customers/routes.ts`**

Add import: `import { signQrToken } from './qrToken.js';`

Add route:

```ts
  app.post('/customers/:id/qr-link', { preHandler: app.requireAuth }, async (req) => {
    const { id } = req.params as { id: string };
    const { rows } = await app.deps.pool.query('SELECT id FROM customers WHERE id = $1 AND account_id = $2', [
      id,
      req.auth!.accountId,
    ]);
    if (rows.length === 0) {
      throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    const qrToken = signQrToken({ customerId: id, accountId: req.auth!.accountId }, app.deps.env.JWT_SECRET);
    return { qrToken };
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/qrLink.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/customers/qrToken.ts backend/src/modules/customers/routes.ts backend/test/qrLink.test.ts
git commit -m "feat(backend): add customer QR-link token generation endpoint"
```

---

### Task 11: Sheets client wrapper

**Files:**
- Create: `backend/src/sheets/client.ts`
- Test: `backend/test/sheets-client.test.ts`

**Interfaces:**
- Produces: `class SheetsClient` with constructor `(config: { clientEmail: string; privateKey: string })` and methods `getValues(spreadsheetId: string, range: string): Promise<string[][]>`, `appendRow(spreadsheetId: string, range: string, row: (string|number)[]): Promise<void>`, `updateRow(spreadsheetId: string, range: string, row: (string|number)[]): Promise<void>` from `src/sheets/client.ts`. Tasks 13 and 14 use these methods (writes always wrapped by the `SheetsQueue` from Task 12).

- [ ] **Step 1: Write the failing test with a mocked `googleapis`**

```ts
// backend/test/sheets-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const valuesGet = vi.fn();
const valuesAppend = vi.fn();
const valuesUpdate = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    sheets: () => ({
      spreadsheets: {
        values: {
          get: valuesGet,
          append: valuesAppend,
          update: valuesUpdate,
        },
      },
    }),
  },
}));

vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(_opts: unknown) {}
  },
}));

const { SheetsClient } = await import('../src/sheets/client');

describe('SheetsClient', () => {
  beforeEach(() => {
    valuesGet.mockReset();
    valuesAppend.mockReset();
    valuesUpdate.mockReset();
  });

  it('getValues returns the rows from the API response', async () => {
    valuesGet.mockResolvedValue({ data: { values: [['a', 'b'], ['c', 'd']] } });
    const client = new SheetsClient({ clientEmail: 'x@example.com', privateKey: 'key' });
    const rows = await client.getValues('sheet-1', 'Productos!A2:Z');
    expect(rows).toEqual([['a', 'b'], ['c', 'd']]);
    expect(valuesGet).toHaveBeenCalledWith({ spreadsheetId: 'sheet-1', range: 'Productos!A2:Z' });
  });

  it('getValues returns an empty array when there are no values', async () => {
    valuesGet.mockResolvedValue({ data: {} });
    const client = new SheetsClient({ clientEmail: 'x@example.com', privateKey: 'key' });
    const rows = await client.getValues('sheet-1', 'Productos!A2:Z');
    expect(rows).toEqual([]);
  });

  it('appendRow calls the append API with USER_ENTERED input', async () => {
    valuesAppend.mockResolvedValue({});
    const client = new SheetsClient({ clientEmail: 'x@example.com', privateKey: 'key' });
    await client.appendRow('sheet-1', 'Productos!A:I', ['123', 'Leche']);
    expect(valuesAppend).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-1',
      range: 'Productos!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [['123', 'Leche']] },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sheets-client.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `backend/src/sheets/client.ts`**

```ts
import { google, type sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';

export interface SheetsClientConfig {
  clientEmail: string;
  privateKey: string;
}

export class SheetsClient {
  private api: sheets_v4.Sheets;

  constructor(config: SheetsClientConfig) {
    const auth = new JWT({
      email: config.clientEmail,
      key: config.privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.api = google.sheets({ version: 'v4', auth });
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const res = await this.api.spreadsheets.values.get({ spreadsheetId, range });
    return (res.data.values as string[][]) ?? [];
  }

  async appendRow(spreadsheetId: string, range: string, row: (string | number)[]): Promise<void> {
    await this.api.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }

  async updateRow(spreadsheetId: string, range: string, row: (string | number)[]): Promise<void> {
    await this.api.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sheets-client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/sheets/client.ts backend/test/sheets-client.test.ts
git commit -m "feat(backend): add Google Sheets API client wrapper"
```

---

### Task 12: Sheets write queue with retry

**Files:**
- Create: `backend/src/sheets/queue.ts`
- Test: `backend/test/sheets-queue.test.ts`

**Interfaces:**
- Produces: `class SheetsQueue` with `enqueue<T>(accountId: string, task: () => Promise<T>): Promise<T>` from `src/sheets/queue.ts`. Tasks 13 and 14 call `app.deps.sheetsQueue.enqueue(accountId, () => sheets.appendRow(...))` for every write.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/sheets-queue.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SheetsQueue } from '../src/sheets/queue';

describe('SheetsQueue', () => {
  it('runs tasks for the same account one at a time, in order', async () => {
    const queue = new SheetsQueue();
    const order: number[] = [];

    const task = (n: number, delay: number) => async () => {
      await new Promise((r) => setTimeout(r, delay));
      order.push(n);
      return n;
    };

    const results = await Promise.all([
      queue.enqueue('acc-1', task(1, 20)),
      queue.enqueue('acc-1', task(2, 5)),
      queue.enqueue('acc-1', task(3, 1)),
    ]);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it('runs tasks for different accounts concurrently', async () => {
    const queue = new SheetsQueue();
    const start = Date.now();

    await Promise.all([
      queue.enqueue('acc-1', () => new Promise((r) => setTimeout(r, 50))),
      queue.enqueue('acc-2', () => new Promise((r) => setTimeout(r, 50))),
    ]);

    expect(Date.now() - start).toBeLessThan(90);
  });

  it('retries on a 429-like error and eventually succeeds', async () => {
    const queue = new SheetsQueue();
    let attempts = 0;
    const flaky = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('rate limited') as Error & { response: { status: number } };
        err.response = { status: 429 };
        throw err;
      }
      return 'ok';
    });

    const result = await queue.enqueue('acc-1', flaky);
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry a non-retryable error', async () => {
    const queue = new SheetsQueue();
    const failing = vi.fn(async () => {
      throw new Error('validation error');
    });

    await expect(queue.enqueue('acc-1', failing)).rejects.toThrow('validation error');
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sheets-queue.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `backend/src/sheets/queue.ts`**

```ts
import PQueue from 'p-queue';

type Task<T> = () => Promise<T>;

interface RetryableError {
  response?: { status?: number };
  code?: number;
}

export class SheetsQueue {
  private queues = new Map<string, PQueue>();

  async enqueue<T>(accountId: string, task: Task<T>): Promise<T> {
    const queue = this.queueFor(accountId);
    const result = await queue.add(() => this.withRetry(task));
    return result as T;
  }

  private queueFor(accountId: string): PQueue {
    let queue = this.queues.get(accountId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.queues.set(accountId, queue);
    }
    return queue;
  }

  private async withRetry<T>(task: Task<T>, attempt = 1): Promise<T> {
    try {
      return await task();
    } catch (err) {
      if (this.isRetryable(err) && attempt < 3) {
        const delayMs = 2 ** attempt * 50;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.withRetry(task, attempt + 1);
      }
      throw err;
    }
  }

  private isRetryable(err: unknown): boolean {
    const e = err as RetryableError;
    const status = e.response?.status ?? e.code;
    return status === 429 || (typeof status === 'number' && status >= 500);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/sheets-queue.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/sheets/queue.ts backend/test/sheets-queue.test.ts
git commit -m "feat(backend): add per-account Sheets write queue with retry"
```

---

### Task 13: Inventory endpoints

**Files:**
- Create: `backend/src/modules/inventory/routes.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/test/helpers/testApp.ts` (make the mocked `sheets` object controllable per-test)
- Test: `backend/test/inventory.test.ts`

**Interfaces:**
- Consumes: `SheetsClient` (Task 11), `SheetsQueue` (Task 12), `app.deps.sheets` / `app.deps.sheetsQueue` (Task 4's `AppDeps`).
- Produces: `registerInventoryRoutes(app: FastifyInstance): Promise<void>`.

Products sheet layout (from spec): columns `A:barcode B:name C:brand D:department E:unit F:cost_usd G:stock H:updated_at I:updated_by`, row 1 is the header, data starts at row 2.

- [ ] **Step 1: Update `backend/test/helpers/testApp.ts` to expose the sheets mock**

Change the return type and the mock so tests can assert on/configure it directly:

```ts
export async function buildTestApp(): Promise<{ app: FastifyInstance; env: Env; sheets: ReturnType<typeof vi.fn> extends never ? never : any }> {
  // ...unchanged pool/env setup...

  const sheets = {
    getValues: vi.fn().mockResolvedValue([]),
    appendRow: vi.fn().mockResolvedValue(undefined),
    updateRow: vi.fn().mockResolvedValue(undefined),
  };

  const app = buildApp({ pool, sheets: sheets as any, sheetsQueue: new SheetsQueue(), env });
  return { app, env, sheets };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// backend/test/inventory.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function jwtFor(app: any, accountId: string, role = 'INVENTARIO') {
  const device = await insertDevice(app.deps.pool, accountId, { role });
  return signDeviceToken({ deviceId: device.id, accountId, role }, app.deps.env.JWT_SECRET);
}

describe('GET /products', () => {
  it('finds a product by barcode', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10', '2026-09-19', 'dev-1'],
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/products?barcode=123',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      barcode: '123',
      name: 'Leche',
      brand: 'Marca X',
      department: 'Lacteos',
      unit: 'unidad',
      costUsd: 2.5,
      stock: 10,
    });
  });

  it('returns 404 when the barcode is not found', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/products?barcode=999',
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /products', () => {
  it('appends a new product row through the sheets queue', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        barcode: '456',
        name: 'Arroz',
        brand: 'Marca Y',
        department: 'Granos',
        unit: 'kg',
        costUsd: 1.2,
        stock: 50,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    const [spreadsheetId, range, row] = sheets.appendRow.mock.calls[0];
    expect(spreadsheetId).toBe(account.spreadsheetId);
    expect(range).toBe('Productos!A:I');
    expect(row[0]).toBe('456');
  });

  it('rejects a duplicate barcode', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([['456', 'Arroz', 'Marca Y', 'Granos', 'kg', '1.2', '50', '', '']]);

    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { barcode: '456', name: 'Arroz', brand: 'Y', department: 'Granos', unit: 'kg', costUsd: 1.2, stock: 50 },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('PATCH /products/:barcode/stock', () => {
  it('reads the current row, applies the delta, and updates it', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['789', 'Pan', 'Marca Z', 'Panaderia', 'unidad', '0.8', '20', '', ''],
    ]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/products/789/stock',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { delta: -5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().stock).toBe(15);
    expect(sheets.updateRow).toHaveBeenCalledTimes(1);
    const [, range, row] = sheets.updateRow.mock.calls[0];
    expect(range).toBe('Productos!A2:I2');
    expect(row[6]).toBe(15);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/inventory.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `backend/src/modules/inventory/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';

const PRODUCTS_RANGE = 'Productos!A2:I';
const PRODUCTS_APPEND_RANGE = 'Productos!A:I';

interface ProductRow {
  rowIndex: number; // 1-based data row, i.e. sheet row = rowIndex + 1
  barcode: string;
  name: string;
  brand: string;
  department: string;
  unit: string;
  costUsd: number;
  stock: number;
}

function parseRow(raw: string[], rowIndex: number): ProductRow {
  return {
    rowIndex,
    barcode: raw[0] ?? '',
    name: raw[1] ?? '',
    brand: raw[2] ?? '',
    department: raw[3] ?? '',
    unit: raw[4] ?? '',
    costUsd: Number(raw[5] ?? 0),
    stock: Number(raw[6] ?? 0),
  };
}

async function findProductRow(
  app: FastifyInstance,
  spreadsheetId: string,
  barcode: string
): Promise<ProductRow | null> {
  const rows = await app.deps.sheets.getValues(spreadsheetId, PRODUCTS_RANGE);
  const index = rows.findIndex((r) => r[0] === barcode);
  if (index === -1) return null;
  return parseRow(rows[index], index + 1);
}

const createProductSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().min(1),
  department: z.string().min(1),
  unit: z.string().min(1),
  costUsd: z.number().nonnegative(),
  stock: z.number().nonnegative(),
});

const stockAdjustSchema = z.object({
  delta: z.number(),
});

export async function registerInventoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/products', { preHandler: app.requireAuth }, async (req) => {
    const { barcode } = req.query as { barcode?: string };
    if (!barcode) {
      throw new ApiError(422, 'MISSING_BARCODE', 'barcode query parameter is required');
    }
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    const product = await findProductRow(app, spreadsheetId, barcode);
    if (!product) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
    }
    const { rowIndex, ...rest } = product;
    return rest;
  });

  app.post('/products', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO']) }, async (req) => {
    const body = createProductSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    const existing = await findProductRow(app, spreadsheetId, body.barcode);
    if (existing) {
      throw new ApiError(409, 'DUPLICATE_BARCODE', `A product with barcode ${body.barcode} already exists`);
    }

    await app.deps.sheetsQueue.enqueue(req.auth!.accountId, () =>
      app.deps.sheets.appendRow(spreadsheetId, PRODUCTS_APPEND_RANGE, [
        body.barcode,
        body.name,
        body.brand,
        body.department,
        body.unit,
        body.costUsd,
        body.stock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ])
    );

    return body;
  });

  app.patch('/products/:barcode/stock', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO', 'POST_VENTA']) }, async (req) => {
    const { barcode } = req.params as { barcode: string };
    const { delta } = stockAdjustSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    const updated = await app.deps.sheetsQueue.enqueue(req.auth!.accountId, async () => {
      const product = await findProductRow(app, spreadsheetId, barcode);
      if (!product) {
        throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
      }
      const newStock = product.stock + delta;
      if (newStock < 0) {
        throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Stock adjustment would go below zero');
      }
      const sheetRow = product.rowIndex + 1;
      await app.deps.sheets.updateRow(spreadsheetId, `Productos!A${sheetRow}:I${sheetRow}`, [
        product.barcode,
        product.name,
        product.brand,
        product.department,
        product.unit,
        product.costUsd,
        newStock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ]);
      return { ...product, stock: newStock };
    });

    const { rowIndex, ...rest } = updated;
    return rest;
  });
}
```

- [ ] **Step 5: Register in `backend/src/app.ts`**

```ts
import { registerInventoryRoutes } from './modules/inventory/routes.js';
// ...
app.register(registerInventoryRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/inventory.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/inventory/routes.ts backend/src/app.ts backend/test/helpers/testApp.ts backend/test/inventory.test.ts
git commit -m "feat(backend): add inventory endpoints backed by the Sheets queue"
```

---

### Task 14: Sales endpoint

**Files:**
- Create: `backend/src/modules/sales/routes.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/sales.test.ts`

**Interfaces:**
- Consumes: `evaluateCreditCheck` (Task 9), `app.deps.sheetsQueue` / `app.deps.sheets` (Task 4/11/12).
- Produces: `registerSalesRoutes(app: FastifyInstance): Promise<void>`. This is the last task in this plan.

Sales sheet layout (from spec): `A:sale_id B:date C:device_id D:customer_id E:items_json F:total_usd G:total_ves H:payment_method I:bcv_rate_used`.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/sales.test.ts
import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers/testApp';
import { insertAccount, insertDevice } from './helpers/factories';
import { signDeviceToken } from '../src/modules/auth/jwt';

async function jwtFor(app: any, accountId: string, role = 'POST_VENTA') {
  const device = await insertDevice(app.deps.pool, accountId, { role });
  return { jwt: signDeviceToken({ deviceId: device.id, accountId, role }, app.deps.env.JWT_SECRET), deviceId: device.id };
}

describe('POST /sales', () => {
  it('records a cash sale and appends it to the Sheets Ventas tab', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        items: [{ barcode: '123', name: 'Leche', quantity: 2, unitPriceUsd: 2.5 }],
        totalUsd: 5,
        totalVes: 210,
        paymentMethod: 'EFECTIVO_USD',
        bcvRateUsed: 42,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sheets.appendRow).toHaveBeenCalledTimes(1);
    const [, range] = sheets.appendRow.mock.calls[0];
    expect(range).toBe('Ventas!A:I');
  });

  it('re-validates credit server-side and rejects a credit sale over the limit', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Plata', 100, 15]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 90]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 50 }],
        totalUsd: 50,
        totalVes: 2100,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 42,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(sheets.appendRow).not.toHaveBeenCalled();
  });

  it('accepts a credit sale within the limit and increases the customer balance', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const { jwt } = await jwtFor(app, account.id);
    const { rows: levelRows } = await app.deps.pool.query(
      'INSERT INTO loyalty_levels (account_id, name, credit_limit, max_payment_term_days) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Oro', 300, 30]
    );
    const { rows: customerRows } = await app.deps.pool.query(
      'INSERT INTO customers (account_id, name, loyalty_level_id, current_debt_balance) VALUES ($1, $2, $3, $4) RETURNING id',
      [account.id, 'Cliente Credito', levelRows[0].id, 0]
    );

    const res = await app.inject({
      method: 'POST',
      url: '/sales',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        customerId: customerRows[0].id,
        items: [{ barcode: '123', name: 'Leche', quantity: 1, unitPriceUsd: 50 }],
        totalUsd: 50,
        totalVes: 2100,
        paymentMethod: 'CREDITO',
        bcvRateUsed: 42,
      },
    });
    expect(res.statusCode).toBe(200);

    const { rows } = await app.deps.pool.query('SELECT current_debt_balance FROM customers WHERE id = $1', [
      customerRows[0].id,
    ]);
    expect(Number(rows[0].current_debt_balance)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sales.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `backend/src/modules/sales/routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../../plugins/errorHandler.js';
import { evaluateCreditCheck } from '../customers/credit.js';

const SALES_APPEND_RANGE = 'Ventas!A:I';

const saleItemSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceUsd: z.number().nonnegative(),
});

const createSaleSchema = z.object({
  customerId: z.string().uuid().optional(),
  items: z.array(saleItemSchema).min(1),
  totalUsd: z.number().nonnegative(),
  totalVes: z.number().nonnegative(),
  paymentMethod: z.enum(['EFECTIVO_USD', 'EFECTIVO_VES', 'PAGO_MOVIL', 'PUNTO_DE_VENTA', 'CREDITO']),
  bcvRateUsed: z.number().positive(),
});

export async function registerSalesRoutes(app: FastifyInstance): Promise<void> {
  app.post('/sales', { preHandler: app.requireRole(['ADMIN', 'POST_VENTA']) }, async (req) => {
    const body = createSaleSchema.parse(req.body);

    if (body.paymentMethod === 'CREDITO') {
      if (!body.customerId) {
        throw new ApiError(422, 'CUSTOMER_REQUIRED', 'customerId is required for credit sales');
      }
      const { rows } = await app.deps.pool.query(
        `SELECT c.current_debt_balance, l.credit_limit
         FROM customers c
         LEFT JOIN loyalty_levels l ON l.id = c.loyalty_level_id
         WHERE c.id = $1 AND c.account_id = $2`,
        [body.customerId, req.auth!.accountId]
      );
      if (rows.length === 0) {
        throw new ApiError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
      }
      const creditLimit = rows[0].credit_limit === null ? 0 : Number(rows[0].credit_limit);
      const check = evaluateCreditCheck({
        currentDebtBalance: Number(rows[0].current_debt_balance),
        creditLimit,
        requestedAmount: body.totalUsd,
      });
      if (!check.approved) {
        throw new ApiError(409, 'CREDIT_DENIED', check.reason ?? 'Credit not approved');
      }
    }

    const { rows: accountRows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = accountRows[0].spreadsheet_id as string;
    const saleId = randomUUID();

    await app.deps.sheetsQueue.enqueue(req.auth!.accountId, () =>
      app.deps.sheets.appendRow(spreadsheetId, SALES_APPEND_RANGE, [
        saleId,
        new Date().toISOString(),
        req.auth!.deviceId,
        body.customerId ?? '',
        JSON.stringify(body.items),
        body.totalUsd,
        body.totalVes,
        body.paymentMethod,
        body.bcvRateUsed,
      ])
    );

    if (body.paymentMethod === 'CREDITO' && body.customerId) {
      await app.deps.pool.query(
        'UPDATE customers SET current_debt_balance = current_debt_balance + $1 WHERE id = $2',
        [body.totalUsd, body.customerId]
      );
    }

    return { saleId };
  });
}
```

- [ ] **Step 4: Register in `backend/src/app.ts`**

```ts
import { registerSalesRoutes } from './modules/sales/routes.js';
// ...
app.register(registerSalesRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/sales.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full test suite**

Run: `cd backend && npx vitest run`
Expected: All tests across all 14 tasks PASS.

- [ ] **Step 7: Update `backend/src/server.ts` to wire the real app together (replaces the Task 1 minimal version)**

```ts
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { SheetsClient } from './sheets/client.js';
import { SheetsQueue } from './sheets/queue.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
await runMigrations(pool, migrationsDir);

const sheets = new SheetsClient({
  clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  privateKey: env.GOOGLE_PRIVATE_KEY,
});
const sheetsQueue = new SheetsQueue();

const app = buildApp({ pool, sheets, sheetsQueue, env });

app.listen({ port: env.PORT, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/sales/routes.ts backend/src/app.ts backend/src/server.ts backend/test/sales.test.ts
git commit -m "feat(backend): add sales endpoint with server-side credit re-validation"
```

---

## Self-Review Notes

- **Spec coverage:** Auth/device linking (Task 4), device admin (Task 5), BCV rate (Task 6), margins (Task 7), customers CRUD (Task 8), credit-check (Task 9), QR link (Task 10), Sheets client + queue (Tasks 11–12), inventory (Task 13), sales with server-side credit re-validation (Task 14) — every endpoint in the spec's "API surface" section has a task. Multi-tenant `spreadsheet_id` resolution is exercised in Tasks 13–14.
- **Type consistency checked:** `AppDeps` (Task 3/4) is used identically in `app.ts`, `testApp.ts`, and `server.ts`. `DeviceTokenPayload`/`DeviceRole` (Task 3) match the `role` enum used in `auth/routes.ts`, `devices/routes.ts` checks, and the `devices.role` CHECK constraint (Task 2). `SheetsQueue.enqueue` signature (Task 12) matches every call site in Tasks 13–14. `evaluateCreditCheck` signature (Task 9) matches its use in Task 14.
- **No placeholders:** every step has real, runnable code; no "TBD"/"add validation later" left in any task.
