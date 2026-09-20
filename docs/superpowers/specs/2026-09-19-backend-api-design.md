# Backend API — Design Spec

Date: 2026-09-19
Sub-project: 0 of 8 (see [Roadmap](#roadmap) below)
Status: Approved for planning

## Context

Valent-App is a hybrid Inventory + POS mobile app (Expo/React Native) that needs
two persistence backends:

- **Neon (Postgres)**: accounts, subscription plans, device roles, BCV rate,
  margin rules, customer credit/loyalty profiles.
- **Google Sheets (API v4)**: product catalog, stock, and sales transactions,
  under high read/write concurrency from multiple simultaneous devices.

The mobile app **must not** hold direct credentials to either system: a shipped
APK/IPA can be decompiled, so any embedded Neon connection string or Google
Service Account key would give any installer of the app full read/write access
to the business's database and spreadsheet. This spec defines a backend API
service that owns those credentials and is the only thing that talks to Neon
and Sheets directly. Every mobile client talks to this backend over HTTPS with
a per-device JWT.

This is sub-project **0** in the overall roadmap:

## Roadmap

0. **Backend API** (this spec)
1. Mobile Foundation (Expo Router, M3 theme, Zustand + TanStack Query, API client, RBAC nav shell)
2. Auth + device linking (mobile screens)
3. Inventory (list, barcode scanner, product detail/new product)
4. POS / PostVenta (checkout, payment methods, live credit validation)
5. Credit & Loyalty (levels, limits, approval — backend logic lives here, UI in Configuración)
6. QR client linking (generation, scan, self-service catalog/orders)
7. Dashboard & Configuración

Each sub-project gets its own spec → plan → implementation cycle.

## Goals

- Own all secrets (Neon connection string, Google Service Account key, JWT
  signing secret). Nothing sensitive ships in the mobile bundle.
- Provide a typed REST contract the mobile Foundation (sub-project 1) can
  build its API client against.
- Serialize all writes to a given account's Google Sheet through a single
  in-process queue, so concurrent devices never overwrite each other's stock
  or sales updates.
- Re-validate business rules server-side (especially credit approval) rather
  than trusting the mobile client.

## Non-goals (this sub-project)

- No mobile UI. No screens.
- No multi-instance/horizontal scaling of the Sheets queue (single-process
  in-memory queue is sufficient at current scale — see [Future work](#future-work)).
- No implementation of every endpoint the full app will eventually need —
  only the surface needed to unblock sub-projects 1–2 (auth/device linking)
  plus the data endpoints described below. Endpoints specific to POS/QR
  business logic not yet designed will be added when those sub-projects are
  brainstormed.
- **No tenant/account provisioning flow.** This is a multi-tenant product
  (multiple companies, each with their own account, device limits, and
  Google Sheet), but every mobile screen described in the original request
  operates on an *already-provisioned* account (device linking via invite
  token, not company sign-up). Creating a new `accounts` row and its
  associated Google Sheet is an out-of-band admin operation for this
  sub-project — a one-off SQL insert / manual script is enough for now. A
  proper admin-facing provisioning flow can be its own future sub-project if
  self-service company sign-up becomes a requirement.

## Stack

- Node.js + TypeScript
- Fastify (HTTP server)
- `pg` or `@neondatabase/serverless` (Neon Postgres client)
- `googleapis` (Google Sheets API v4 client, Service Account auth)
- `jsonwebtoken` (device JWT issuance/verification)
- `zod` (request/response validation)
- `p-queue` (per-account concurrency queue for Sheets writes)
- `vitest` (unit + integration tests)

## Project structure

```
backend/
  src/
    config/          # env var loading/validation
    db/              # Neon client, SQL migrations
    sheets/          # Sheets API client + per-account write queue
    modules/
      auth/          # device linking, JWT issue/verify
      accounts/      # accounts, plans, device limits
      bcv/           # official daily rate
      margins/       # margin rules by category/subcategory/department
      customers/     # customer profiles, loyalty levels, credit
      inventory/     # product/stock proxy to Sheets
      sales/         # sales transaction proxy to Sheets
    plugins/         # fastify auth guard, centralized error handler
    server.ts
  migrations/
  test/
  .env.example
```

## Data model — Neon (Postgres)

```sql
accounts (
  id, name, plan, device_limit, spreadsheet_id, created_at
)

devices (
  id, account_id, hardware_id, role, name, status, linked_at
  -- role: ADMIN | INVENTARIO | POST_VENTA | CLIENTE_PEDIDOS
  -- status: PENDING | ACTIVE | REVOKED
)

bcv_rates (
  id, account_id, rate_date, rate, created_by_device_id
)

margin_rules (
  id, account_id, level, level_name, percentage
  -- level: CATEGORIA | SUBCATEGORIA | DEPARTAMENTO
)

loyalty_levels (
  id, account_id, name, credit_limit, max_payment_term_days
)

customers (
  id, account_id, name, phone, loyalty_level_id, current_debt_balance
)

customer_qr_links (
  id, customer_id, device_id, linked_at
)
```

Migrations live in `backend/migrations/`, applied with a plain SQL migration
runner (no ORM — the schema is small and stable enough that raw SQL is
simpler than an ORM abstraction).

## Data model — Google Sheets

This is a multi-tenant product: one spreadsheet per account. The Service
Account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`) is shared
across all tenants and must be granted editor access to each tenant's
spreadsheet individually (done as part of the manual account-provisioning
step, see [Non-goals](#non-goals-this-sub-project)). The `sheets` module
resolves `accounts.spreadsheet_id` per request and never reads a spreadsheet
ID from an env var — `GOOGLE_SHEETS_ID` does not exist as a global env var
in the multi-tenant design; it was an artifact of the earlier single-tenant
assumption and is removed from the env var list below.

- **Productos**: `barcode | name | brand | department | unit | cost_usd | stock | updated_at | updated_by`
- **Ventas**: `sale_id | date | device_id | customer_id | items_json | total_usd | total_ves | payment_method | bcv_rate_used`

## API surface

All protected endpoints require `Authorization: Bearer <jwt>`. JWT payload:
`{ deviceId, accountId, role }`, 30-day expiry, implicitly refreshed on each
successful `GET /auth/me`.

**Auth**
- `POST /auth/link-device` — `{ inviteToken, hardwareId, deviceName }` →
  validates invite token against `accounts`, upserts `devices` row, returns
  `{ jwt, role, accountId }`
- `GET /auth/me` — returns current role/status (lets the app detect a
  revoked device)

**Config** (ADMIN role)
- `GET/PUT /bcv-rate`
- `GET/POST/PUT /margins`
- `GET /devices`, `PATCH /devices/:id` (revoke/rename)

**Customers / credit**
- `GET /customers`, `POST /customers`
- `GET /customers/:id/credit-check?amount=` → `{ approved, availableCredit, reason }`
- `POST /customers/:id/qr-link` → short-lived QR linking token

**Inventory** (proxied to Sheets)
- `GET /products?barcode=`, `GET /products/search?q=`
- `POST /products`, `PUT /products/:barcode`
- `PATCH /products/:barcode/stock`

**Sales** (proxied to Sheets; writes `customers.current_debt_balance` when
payment method is credit)
- `POST /sales` — re-validates credit approval server-side before accepting,
  regardless of what the mobile client already checked

## Concurrency strategy

A single Node process holds one in-memory `p-queue` (concurrency: 1) per
`accountId`. Every Sheets write (new sale, stock adjustment, new product) is
enqueued and executed sequentially against the Sheets API using
`spreadsheets.values.append` / `batchUpdate`, with exponential-backoff retry
(up to 3 attempts) on Google 429/5xx responses.

Read-modify-write operations (stock adjustment) read the current value
*inside* the same queued task, so no other request from this process can
interleave. Row lookups are keyed by barcode (not row index) and re-resolved
before writing, so a row deleted/reordered by an out-of-band edit doesn't
corrupt a stale-row-index write.

Because the backend runs as a single persistent process (not serverless),
the in-memory queue is sufficient at current scale.

## Error handling

All endpoints return `{ error: { code, message } }` with correct HTTP status:
- 401 invalid/missing JWT
- 403 insufficient role
- 409 concurrency conflict after retries exhausted
- 422 zod validation failure

## Testing

- Vitest unit tests per module (`margins`, `bcv`, `customers` credit-check
  logic tested as pure functions, no network).
- Integration tests for `sheets/queue` against a mocked Sheets API that
  injects 429 failures to verify retry behavior.
- Neon: a dedicated Neon test branch (or `pg-mem` for fast pure-unit tests)
  rather than mocking Postgres — no real production data touched by tests.

## Deployment

Persistent Node process on Railway or Render (not serverless — required by
the in-memory concurrency queue). Environment variables:

```
DATABASE_URL=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
JWT_SECRET=
```

(`spreadsheet_id` is per-account data in Neon, not a global env var — see
[Data model — Google Sheets](#data-model--google-sheets).)

`.env.example` ships with these exact names, no values. Real values are
filled in locally and in the hosting provider's environment variable panel —
never committed.

## Future work

- [ ] If the backend needs to scale to multiple instances, move the Sheets
      write queue from in-memory `p-queue` to a shared external lock (Redis).
- [ ] Design a self-service tenant/account provisioning flow (currently a
      manual admin step — see [Non-goals](#non-goals-this-sub-project)) if
      self-service company sign-up becomes a requirement.
- [ ] Endpoints for POS/QR-specific flows will be added when sub-projects
      4 and 6 are brainstormed.
