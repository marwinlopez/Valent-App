# Inventario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the inventory module — catalog list with on-device search, barcode scanning, product detail with editing and stock adjustment, and product creation — plus the two backend endpoints it needs and the three items sub-project 2 carried forward. Per `docs/superpowers/specs/2026-09-24-inventory-design.md`.

**Architecture:** The backend gains a list branch on `GET /products` and a `PUT /products/:barcode`, both keeping their read-modify-write inside one `sheetsQueue` callback. The app fetches the whole catalog once through TanStack Query and filters it in memory; prices are derived on-device by a pure function that reports which input is missing rather than inventing a number. The camera and its permission state machine are extracted out of sub-project 2's QR route into a reusable component that both scanners render.

**Tech Stack:** Existing — backend: Fastify, `pg`, Vitest + `pg-mem`; mobile: Expo SDK 57, Expo Router, React Native Paper, Zustand, TanStack Query, `expo-camera`, Jest/`jest-expo`.

## Global Constraints

- TypeScript `strict: true`, no `any`, in both packages.
- **Every Sheets read-modify-write lives inside ONE `sheetsQueue.enqueue` callback** — never split across it. Three separate bugs in this codebase came from breaking that rule.
- Mobile business logic lives in `src/hooks/` or `src/services/`, never inside `app/`. Screens choose what to render, nothing more.
- Session writes only via `signIn()`/`signOut()`.
- Monetary values are JS numbers rounded to 2 decimals at the boundary — never strings, never `NaN`.
- Backend error responses keep the `{ error: { code, message } }` shape; the app maps by `code`, never by raw HTTP status.
- Mobile tests cover pure logic only (services, hooks) — no component-rendering tests. Screens are verified by running `npx expo start --web` from `mobile/` and driving it with the browser tool. **Start expo directly from the worktree directory** — the launch config resolves against the main checkout and has misdirected the dev server three times now.
- Green at every commit: `mobile` → `npx tsc --noEmit` + `npx jest`; `backend` → `npx vitest run`.
- `mobile/node_modules` and `backend/node_modules` don't exist in a fresh worktree — run `npm install` in each before starting.

---

## File Structure

```
backend/
  src/modules/inventory/routes.ts      # MODIFIED — list branch + PUT
  test/inventory.test.ts               # MODIFIED — new cases

mobile/
  app/(app)/inventario.tsx             # MODIFIED — placeholder becomes the list
  app/(app)/escanear.tsx               # NEW — barcode scan route
  app/(app)/producto/[barcode].tsx     # NEW — detail / edit / stock
  app/(app)/producto/nuevo.tsx         # NEW — creation
  app/(auth)/scan.tsx                  # MODIFIED — renders the extracted component
  app/(auth)/home.tsx                  # MODIFIED — CLIENTE_PEDIDOS message
  app/index.tsx                        # unchanged (see Task 1)
  src/components/BarcodeScanner.tsx    # NEW — camera + permission states
  src/services/pricing.ts              # NEW — pure price calculation
  src/services/api/inventory.ts        # NEW — product endpoints
  src/services/api/config.ts           # NEW — bcv-rate + margins endpoints
  src/services/session.ts              # MODIFIED — disk before memory
  src/hooks/useProducts.ts             # NEW
  src/hooks/usePricingInputs.ts        # NEW — bcv rate + margins together
  src/hooks/useProductMutations.ts     # NEW
  src/types/api.ts                     # MODIFIED — product/config types
  test/…                               # per task
```

---

### Task 1: Close the three items carried from sub-project 2

**Files:**
- Modify: `mobile/test/services/session.test.ts`
- Modify: `mobile/src/services/session.ts`
- Modify: `mobile/app/(auth)/home.tsx`
- Test: `mobile/test/services/session.test.ts`

**Interfaces:**
- Produces: `signIn()` with disk-before-memory ordering. No signature change; later tasks are unaffected.

- [ ] **Step 1: Write the failing tests**

In `mobile/test/services/session.test.ts`, add `endedReason` to the reset in `beforeEach`:

```ts
    useSessionStore.getState().setEndedReason(null);
```

Then add these two cases:

```ts
  it('keeps the first end reason when a second signOut follows', async () => {
    await signOut('REVOKED');
    await signOut('EXPIRED');
    expect(useSessionStore.getState().endedReason).toBe('REVOKED');
  });

  it('does not put a session in memory when writing it to disk fails', async () => {
    const { saveSession } = jest.requireMock('../../src/services/storage/secureSession');
    (saveSession as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));

    await expect(
      signIn({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN', status: 'ACTIVE', jwt: 'j' })
    ).rejects.toThrow('keychain locked');
    expect(useSessionStore.getState().session).toBeNull();
  });
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd mobile && npx jest test/services/session.test.ts`
Expected: FAIL — the first because `signOut` currently overwrites (it will read `'EXPIRED'`), the second because `setSession` runs before `saveSession` so the store holds a session despite the rejection.

(If the first case passes already, the `beforeEach` reset is missing — add it before continuing, since without it the test is asserting against leftover state.)

- [ ] **Step 3: Reorder `signIn` in `mobile/src/services/session.ts`**

```ts
export async function signIn(session: Session): Promise<void> {
  // Disk first. If this throws, nothing was written to memory either, so the
  // two can't disagree — the app stays cleanly signed out and the caller shows
  // a retryable error, instead of being signed in in memory with nothing on
  // disk (which looks fine until the next launch, when it silently unlinks).
  await saveSession(session);
  useSessionStore.getState().setSession(session);
  // A fresh sign-in must not leave a stale "your device was revoked" banner up.
  useSessionStore.getState().setEndedReason(null);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx jest test/services/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Give a CLIENTE_PEDIDOS device an explanation in `mobile/app/(auth)/home.tsx`**

`app/index.tsx` sends a `CLIENTE_PEDIDOS` session to Home, where it currently looks unlinked and invites a second link attempt. Leave `index.tsx` alone; make Home say what happened. Add near the top of the component:

```tsx
  const session = useSession();
```

(importing `useSession` from `../../src/hooks/useSession`), and render this before the rest of the screen's body, returning early:

```tsx
  if (session?.status === 'ACTIVE' && session.role === 'CLIENTE_PEDIDOS') {
    return (
      <View style={styles.container}>
        <Text variant="headlineSmall">Dispositivo vinculado</Text>
        <Text variant="bodyMedium">
          Este dispositivo está vinculado como cliente. El catálogo de pedidos aún no está
          disponible en esta versión.
        </Text>
      </View>
    );
  }
```

The session stays valid — only the message changes. Sub-project 6 replaces this with the real catalog.

- [ ] **Step 6: Verify the suite and types**

Run: `npx jest && npx tsc --noEmit`
Expected: all green, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src mobile/test "mobile/app/(auth)/home.tsx"
git commit -m "fix(mobile): close the three items carried from device linking"
```

---

### Task 2: Backend — catalog list and product update

**Files:**
- Modify: `backend/src/modules/inventory/routes.ts`
- Test: `backend/test/inventory.test.ts`

**Interfaces:**
- Produces: `GET /products` (no `barcode`) → `Product[]`; `PUT /products/:barcode` → the updated product. Task 4's API module calls both.

The existing file already defines `PRODUCTS_RANGE`, `parseRow`, `findProductRow` and `createProductSchema` — reuse them, do not duplicate.

- [ ] **Step 1: Write the failing tests**

Add to `backend/test/inventory.test.ts`:

```ts
describe('GET /products (list)', () => {
  it('returns every product when no barcode is given', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
      ['456', 'Arroz', 'Marca Y', 'Granos', 'kg', '1.2', '50', '', ''],
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      barcode: '123',
      name: 'Leche',
      brand: 'Marca X',
      department: 'Lacteos',
      unit: 'unidad',
      costUsd: 2.5,
      stock: 10,
    });
    expect(body[0]).not.toHaveProperty('rowIndex');
  });

  it('returns an empty array for an empty catalog', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id);
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/products',
      headers: { authorization: `Bearer ${jwt}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('PUT /products/:barcode', () => {
  it('updates the editable fields and preserves stock', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'INVENTARIO');
    sheets.getValues.mockResolvedValue([
      ['123', 'Leche', 'Marca X', 'Lacteos', 'unidad', '2.5', '10', '', ''],
    ]);

    const res = await app.inject({
      method: 'PUT',
      url: '/products/123',
      headers: { authorization: `Bearer ${jwt}` },
      payload: {
        name: 'Leche entera',
        brand: 'Marca Z',
        department: 'Lacteos',
        unit: 'litro',
        costUsd: 3,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ barcode: '123', name: 'Leche entera', costUsd: 3, stock: 10 });

    const [, range, row] = sheets.updateRow.mock.calls[0];
    expect(range).toBe('Productos!A2:I2');
    expect(row[1]).toBe('Leche entera');
    // stock comes from the sheet, never from the request body — PATCH stock owns it
    expect(row[6]).toBe(10);
  });

  it('returns 404 for a barcode that does not exist', async () => {
    const { app, sheets } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'INVENTARIO');
    sheets.getValues.mockResolvedValue([]);

    const res = await app.inject({
      method: 'PUT',
      url: '/products/999',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'X', brand: 'Y', department: 'Z', unit: 'u', costUsd: 1 },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects a POST_VENTA device', async () => {
    const { app } = await buildTestApp();
    const account = await insertAccount(app.deps.pool);
    const jwt = await jwtFor(app, account.id, 'POST_VENTA');

    const res = await app.inject({
      method: 'PUT',
      url: '/products/123',
      headers: { authorization: `Bearer ${jwt}` },
      payload: { name: 'X', brand: 'Y', department: 'Z', unit: 'u', costUsd: 1 },
    });

    expect(res.statusCode).toBe(403);
  });
});
```

If `jwtFor` in this file doesn't already take a role argument, check how the existing tests build tokens and follow that — do not introduce a second helper.

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd backend && npx vitest run test/inventory.test.ts`
Expected: FAIL — the list cases get 422 `MISSING_BARCODE`, the PUT cases 404 from Fastify (no such route).

- [ ] **Step 3: Add the list branch to `GET /products`**

Replace the current early `422` with a list branch, after the spreadsheet lookup:

```ts
  app.get('/products', { preHandler: app.requireAuth }, async (req) => {
    const { barcode } = req.query as { barcode?: string };
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    // No barcode means "the whole catalog". A read needs no queue — the queue
    // serializes writes; concurrent reads can't corrupt anything.
    if (!barcode) {
      const raw = await app.deps.sheets.getValues(spreadsheetId, PRODUCTS_RANGE);
      return raw.map((row, index) => {
        const { rowIndex, ...rest } = parseRow(row, index + 1);
        return rest;
      });
    }

    const product = await findProductRow(app, spreadsheetId, barcode);
    if (!product) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
    }
    const { rowIndex, ...rest } = product;
    return rest;
  });
```

- [ ] **Step 4: Add the update schema and route**

Next to `createProductSchema`:

```ts
/* No `barcode`: it's the key used to find the row, so changing it would be a
   delete-and-create. No `stock`: PATCH /products/:barcode/stock owns that, and
   accepting it here would let a stale edit form silently overwrite a stock
   level another device just adjusted. */
const updateProductSchema = z.object({
  name: z.string().min(1),
  brand: z.string().min(1),
  department: z.string().min(1),
  unit: z.string().min(1),
  costUsd: z.number().nonnegative(),
});
```

And the route, after `POST /products`:

```ts
  app.put('/products/:barcode', { preHandler: app.requireRole(['ADMIN', 'INVENTARIO']) }, async (req) => {
    const { barcode } = req.params as { barcode: string };
    const body = updateProductSchema.parse(req.body);
    const { rows } = await app.deps.pool.query('SELECT spreadsheet_id FROM accounts WHERE id = $1', [
      req.auth!.accountId,
    ]);
    const spreadsheetId = rows[0].spreadsheet_id as string;

    // Find-then-write must be one queued task: between a lookup outside the
    // queue and the write inside it, another task could move the row and this
    // update would land on the wrong product.
    const updated = await app.deps.sheetsQueue.enqueue(req.auth!.accountId, async () => {
      const product = await findProductRow(app, spreadsheetId, barcode);
      if (!product) {
        throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No product with barcode ${barcode}`);
      }
      const sheetRow = product.rowIndex + 1;
      await app.deps.sheets.updateRow(spreadsheetId, `Productos!A${sheetRow}:I${sheetRow}`, [
        product.barcode,
        body.name,
        body.brand,
        body.department,
        body.unit,
        body.costUsd,
        product.stock,
        new Date().toISOString(),
        req.auth!.deviceId,
      ]);
      return { ...product, ...body };
    });

    const { rowIndex, ...rest } = updated;
    return rest;
  });
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npx vitest run test/inventory.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite**

Run: `npx vitest run`
Expected: all previously-passing tests still pass, plus the new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/src backend/test
git commit -m "feat(backend): add catalog listing and product update"
```

---

### Task 3: Price calculation

**Files:**
- Create: `mobile/src/services/pricing.ts`
- Test: `mobile/test/services/pricing.test.ts`

**Interfaces:**
- Produces: `calculatePriceVes(costUsd: number, marginPct: number | null, bcvRate: number | null): PriceResult`, where `PriceResult = { ok: true; priceVes: number } | { ok: false; missing: 'cost' | 'margin' | 'bcvRate' }`. Tasks 7 and 8 render it; sub-project 4's POS reuses it unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/test/services/pricing.test.ts
import { calculatePriceVes } from '../../src/services/pricing';

describe('calculatePriceVes', () => {
  it('applies the margin and the rate', () => {
    // 2 USD + 50% margin = 3 USD, at 40 Bs/USD = 120 Bs
    expect(calculatePriceVes(2, 50, 40)).toEqual({ ok: true, priceVes: 120 });
  });

  it('rounds to two decimals', () => {
    expect(calculatePriceVes(1.117, 0, 1)).toEqual({ ok: true, priceVes: 1.12 });
  });

  it('handles a zero margin', () => {
    expect(calculatePriceVes(3, 0, 10)).toEqual({ ok: true, priceVes: 30 });
  });

  it.each([
    ['bcvRate', 5, 10, null],
    ['margin', 5, null, 40],
  ] as const)('reports %s as missing rather than guessing', (missing, cost, margin, rate) => {
    expect(calculatePriceVes(cost, margin, rate)).toEqual({ ok: false, missing });
  });

  it.each([NaN, Infinity])('treats a non-finite rate (%p) as missing, never producing NaN', (rate) => {
    expect(calculatePriceVes(5, 10, rate)).toEqual({ ok: false, missing: 'bcvRate' });
  });

  it('treats a non-finite cost as missing', () => {
    expect(calculatePriceVes(NaN, 10, 40)).toEqual({ ok: false, missing: 'cost' });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd mobile && npx jest test/services/pricing.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `mobile/src/services/pricing.ts`**

```ts
export type PriceResult =
  | { ok: true; priceVes: number }
  | { ok: false; missing: 'cost' | 'margin' | 'bcvRate' };

/**
 * Derives a selling price in bolívares from a cost in dollars.
 *
 * Nothing stores this price: the cost lives in the products sheet, the margin
 * in `margin_rules`, and the rate in `bcv_rates`, so it is recomputed whenever
 * any of the three changes.
 *
 * Missing or non-finite inputs are reported, never absorbed. A `NaN` that
 * sails through arithmetic and comes out the other side as a number-shaped
 * nothing is exactly how this codebase once silently approved credit it
 * should have denied.
 */
export function calculatePriceVes(
  costUsd: number,
  marginPct: number | null,
  bcvRate: number | null
): PriceResult {
  if (bcvRate === null || !Number.isFinite(bcvRate)) {
    return { ok: false, missing: 'bcvRate' };
  }
  if (marginPct === null || !Number.isFinite(marginPct)) {
    return { ok: false, missing: 'margin' };
  }
  if (!Number.isFinite(costUsd)) {
    return { ok: false, missing: 'cost' };
  }

  const raw = costUsd * (1 + marginPct / 100) * bcvRate;
  return { ok: true, priceVes: Math.round(raw * 100) / 100 };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest test/services/pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/services/pricing.ts mobile/test/services/pricing.test.ts
git commit -m "feat(mobile): add price derivation that reports missing inputs"
```

---

### Task 4: Inventory API module and hooks

**Files:**
- Modify: `mobile/src/types/api.ts`
- Create: `mobile/src/services/api/inventory.ts`
- Create: `mobile/src/services/api/config.ts`
- Create: `mobile/src/hooks/useProducts.ts`
- Create: `mobile/src/hooks/usePricingInputs.ts`
- Create: `mobile/src/hooks/useProductMutations.ts`
- Test: `mobile/test/services/api/inventory.test.ts`
- Test: `mobile/test/hooks/usePricingInputs.test.tsx`
- Test: `mobile/test/hooks/useProductMutations.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiRequestError` from `src/services/api/client.ts`.
- Produces: `listProducts()`, `createProduct()`, `updateProduct()`, `adjustStock()` from `api/inventory.ts`; `getBcvRate()`, `getMargins()` from `api/config.ts`; `useProducts()`, `usePricingInputs()`, `useProductMutations()` from `src/hooks/`. Tasks 6-8 consume the hooks.

- [ ] **Step 1: Add the types to `mobile/src/types/api.ts`**

```ts
export interface Product {
  barcode: string;
  name: string;
  brand: string;
  department: string;
  unit: string;
  costUsd: number;
  stock: number;
}

export type CreateProductRequest = Product;
export type UpdateProductRequest = Omit<Product, 'barcode' | 'stock'>;

export interface BcvRateResponse {
  rateDate: string;
  rate: number;
}

/** snake_case because that is what the backend actually returns here — its
 *  response casing is inconsistent across endpoints and normalising it is
 *  tracked as backend debt, not something this module papers over. */
export interface MarginRule {
  id: string;
  level: 'CATEGORIA' | 'SUBCATEGORIA' | 'DEPARTAMENTO';
  level_name: string;
  percentage: number;
}
```

- [ ] **Step 2: Write the failing test for the API module**

```ts
// mobile/test/services/api/inventory.test.ts
jest.mock('../../../src/services/api/client', () => ({
  apiFetch: jest.fn(),
  ApiRequestError: class ApiRequestError extends Error {
    constructor(public statusCode: number, public code: string, message: string) {
      super(message);
    }
  },
}));

import { apiFetch } from '../../../src/services/api/client';
import {
  listProducts,
  createProduct,
  updateProduct,
  adjustStock,
} from '../../../src/services/api/inventory';

const PRODUCT = {
  barcode: '123',
  name: 'Leche',
  brand: 'X',
  department: 'Lacteos',
  unit: 'unidad',
  costUsd: 2.5,
  stock: 10,
};

describe('inventory api', () => {
  beforeEach(() => {
    (apiFetch as jest.Mock).mockReset().mockResolvedValue(PRODUCT);
  });

  it('listProducts requests the catalog', async () => {
    (apiFetch as jest.Mock).mockResolvedValue([PRODUCT]);
    await expect(listProducts()).resolves.toEqual([PRODUCT]);
    expect(apiFetch).toHaveBeenCalledWith('/products');
  });

  it('createProduct posts the whole product', async () => {
    await createProduct(PRODUCT);
    expect(apiFetch).toHaveBeenCalledWith('/products', {
      method: 'POST',
      body: JSON.stringify(PRODUCT),
    });
  });

  it('updateProduct puts the editable fields to the barcode path', async () => {
    const body = { name: 'Leche entera', brand: 'X', department: 'Lacteos', unit: 'litro', costUsd: 3 };
    await updateProduct('123', body);
    expect(apiFetch).toHaveBeenCalledWith('/products/123', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  });

  it('adjustStock patches a delta', async () => {
    await adjustStock('123', -2);
    expect(apiFetch).toHaveBeenCalledWith('/products/123/stock', {
      method: 'PATCH',
      body: JSON.stringify({ delta: -2 }),
    });
  });

  it('encodes a barcode that needs escaping in the path', async () => {
    await adjustStock('a/b', 1);
    expect(apiFetch).toHaveBeenCalledWith('/products/a%2Fb/stock', expect.anything());
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx jest test/services/api/inventory.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `mobile/src/services/api/inventory.ts`**

```ts
import { apiFetch } from './client';
import type { CreateProductRequest, Product, UpdateProductRequest } from '../../types/api';

export async function listProducts(): Promise<Product[]> {
  return apiFetch<Product[]>('/products');
}

export async function createProduct(body: CreateProductRequest): Promise<Product> {
  return apiFetch<Product>('/products', { method: 'POST', body: JSON.stringify(body) });
}

export async function updateProduct(barcode: string, body: UpdateProductRequest): Promise<Product> {
  return apiFetch<Product>(`/products/${encodeURIComponent(barcode)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function adjustStock(barcode: string, delta: number): Promise<Product> {
  return apiFetch<Product>(`/products/${encodeURIComponent(barcode)}/stock`, {
    method: 'PATCH',
    body: JSON.stringify({ delta }),
  });
}
```

- [ ] **Step 5: Implement `mobile/src/services/api/config.ts`**

```ts
import { apiFetch, ApiRequestError } from './client';
import type { BcvRateResponse, MarginRule } from '../../types/api';

/**
 * Returns null when no rate is set for today. A missing rate is an ordinary
 * state (nobody has entered it yet), not an error — the pricing function
 * reports it as a missing input and the screens say so.
 */
export async function getBcvRate(): Promise<BcvRateResponse | null> {
  try {
    return await apiFetch<BcvRateResponse>('/bcv-rate');
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

export async function getMargins(): Promise<MarginRule[]> {
  return apiFetch<MarginRule[]>('/margins');
}
```

- [ ] **Step 6: Implement `mobile/src/hooks/useProducts.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { listProducts } from '../services/api/inventory';

export const PRODUCTS_QUERY_KEY = ['products'] as const;

/** The whole catalog, fetched once and filtered on-device. A few hundred to a
 *  couple thousand rows fit comfortably in memory, search stays instant, and
 *  the Sheets API (quota-limited) sees one request instead of one per
 *  keystroke. */
export function useProducts() {
  return useQuery({ queryKey: PRODUCTS_QUERY_KEY, queryFn: listProducts });
}
```

- [ ] **Step 7: Write the failing test for `usePricingInputs`**

```tsx
// mobile/test/hooks/usePricingInputs.test.tsx
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/config', () => ({
  getBcvRate: jest.fn(),
  getMargins: jest.fn(),
}));

import { getBcvRate, getMargins } from '../../src/services/api/config';
import { usePricingInputs } from '../../src/hooks/usePricingInputs';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('usePricingInputs', () => {
  beforeEach(() => {
    (getBcvRate as jest.Mock).mockReset();
    (getMargins as jest.Mock).mockReset();
  });

  it('resolves the margin for a department', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });
    (getMargins as jest.Mock).mockResolvedValue([
      { id: '1', level: 'DEPARTAMENTO', level_name: 'Lacteos', percentage: 25 },
      { id: '2', level: 'DEPARTAMENTO', level_name: 'Granos', percentage: 10 },
    ]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.bcvRate).toBe(40));
    expect(result.current.marginFor('Lacteos')).toBe(25);
  });

  it('returns a null margin for a department with no rule', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });
    (getMargins as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.bcvRate).toBe(40));
    expect(result.current.marginFor('Lacteos')).toBeNull();
  });

  it('exposes a null rate when none is set for the day', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue(null);
    (getMargins as jest.Mock).mockResolvedValue([]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.bcvRate).toBeNull();
  });

  it('ignores non-department rules when resolving a margin', async () => {
    (getBcvRate as jest.Mock).mockResolvedValue({ rateDate: '2026-09-24', rate: 40 });
    (getMargins as jest.Mock).mockResolvedValue([
      { id: '1', level: 'CATEGORIA', level_name: 'Lacteos', percentage: 99 },
    ]);

    const { result } = await renderHook(() => usePricingInputs(), { wrapper });

    await waitFor(() => expect(result.current.bcvRate).toBe(40));
    expect(result.current.marginFor('Lacteos')).toBeNull();
  });
});
```

- [ ] **Step 8: Run it and confirm it fails**

Run: `npx jest test/hooks/usePricingInputs.test.tsx`
Expected: FAIL — hook does not exist.

- [ ] **Step 9: Implement `mobile/src/hooks/usePricingInputs.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getBcvRate, getMargins } from '../services/api/config';

/**
 * The two inputs a price needs besides the product's own cost.
 *
 * Only `DEPARTAMENTO` rules are consulted: a product row carries a department
 * and nothing else that margin rules key on, so a category or subcategory rule
 * has nothing on the product to match against.
 */
export function usePricingInputs() {
  const rateQuery = useQuery({ queryKey: ['bcv-rate'], queryFn: getBcvRate });
  const marginsQuery = useQuery({ queryKey: ['margins'], queryFn: getMargins });

  const margins = marginsQuery.data;

  const marginFor = useCallback(
    (department: string): number | null => {
      const rule = margins?.find(
        (m) => m.level === 'DEPARTAMENTO' && m.level_name === department
      );
      return rule ? rule.percentage : null;
    },
    [margins]
  );

  return {
    bcvRate: rateQuery.data?.rate ?? null,
    marginFor,
    isLoading: rateQuery.isLoading || marginsQuery.isLoading,
    isError: rateQuery.isError || marginsQuery.isError,
  };
}
```

- [ ] **Step 10: Write the failing test for the mutations**

```tsx
// mobile/test/hooks/useProductMutations.test.tsx
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

jest.mock('../../src/services/api/inventory', () => ({
  createProduct: jest.fn(),
  updateProduct: jest.fn(),
  adjustStock: jest.fn(),
}));

import { createProduct, adjustStock } from '../../src/services/api/inventory';
import { useProductMutations } from '../../src/hooks/useProductMutations';
import { PRODUCTS_QUERY_KEY } from '../../src/hooks/useProducts';

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useProductMutations', () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (createProduct as jest.Mock).mockReset().mockResolvedValue({});
    (adjustStock as jest.Mock).mockReset().mockResolvedValue({});
  });

  it('invalidates the catalog after a successful create', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useProductMutations(), { wrapper });

    await act(async () => {
      await result.current.create.mutateAsync({
        barcode: '1', name: 'A', brand: 'B', department: 'C', unit: 'u', costUsd: 1, stock: 0,
      });
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PRODUCTS_QUERY_KEY }));
  });

  it('invalidates the catalog after a stock adjustment', async () => {
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useProductMutations(), { wrapper });

    await act(async () => {
      await result.current.adjust.mutateAsync({ barcode: '1', delta: 5 });
    });

    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: PRODUCTS_QUERY_KEY }));
  });

  it('does not invalidate when the mutation fails', async () => {
    (createProduct as jest.Mock).mockRejectedValue(new Error('nope'));
    const spy = jest.spyOn(queryClient, 'invalidateQueries');
    const { result } = await renderHook(() => useProductMutations(), { wrapper });

    await act(async () => {
      await result.current.create
        .mutateAsync({
          barcode: '1', name: 'A', brand: 'B', department: 'C', unit: 'u', costUsd: 1, stock: 0,
        })
        .catch(() => undefined);
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 11: Run it and confirm it fails**

Run: `npx jest test/hooks/useProductMutations.test.tsx`
Expected: FAIL — hook does not exist.

- [ ] **Step 12: Implement `mobile/src/hooks/useProductMutations.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createProduct, updateProduct, adjustStock } from '../services/api/inventory';
import { PRODUCTS_QUERY_KEY } from './useProducts';
import type { CreateProductRequest, UpdateProductRequest } from '../types/api';

/**
 * Create, update and stock-adjust, each invalidating the cached catalog on
 * success so the list and the detail screen stay consistent without any screen
 * having to push the change around by hand.
 */
export function useProductMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });

  const create = useMutation({
    mutationFn: (body: CreateProductRequest) => createProduct(body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ barcode, body }: { barcode: string; body: UpdateProductRequest }) =>
      updateProduct(barcode, body),
    onSuccess: invalidate,
  });

  const adjust = useMutation({
    mutationFn: ({ barcode, delta }: { barcode: string; delta: number }) =>
      adjustStock(barcode, delta),
    onSuccess: invalidate,
  });

  return { create, update, adjust };
}
```

- [ ] **Step 13: Run the suite and types**

Run: `npx jest && npx tsc --noEmit`
Expected: all green, zero type errors.

- [ ] **Step 14: Commit**

```bash
git add mobile/src mobile/test
git commit -m "feat(mobile): add inventory api, catalog hook and product mutations"
```

---

### Task 5: Extract the barcode scanner

**Files:**
- Create: `mobile/src/components/BarcodeScanner.tsx`
- Modify: `mobile/app/(auth)/scan.tsx`

**Interfaces:**
- Produces: `<BarcodeScanner barcodeTypes prompt webMessage onScan onCancel />` from `src/components/BarcodeScanner.tsx`. Task 6's scan route renders it too.

This is a refactor with no behavior change for the existing QR route. There is no new test (the project has no component-rendering tests); correctness is established by `tsc`, the unchanged suite, and re-verifying the QR route's web state.

- [ ] **Step 1: Create `mobile/src/components/BarcodeScanner.tsx`**

Move the camera and permission logic out of `app/(auth)/scan.tsx` verbatim, parameterised:

```tsx
import { useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text } from 'react-native-paper';
import { Button } from './ui/Button';

type BarcodeType = 'qr' | 'ean13' | 'ean8' | 'upc_a' | 'upc_e' | 'code128';

interface BarcodeScannerProps {
  barcodeTypes: BarcodeType[];
  /** Shown when permission hasn't been granted — say what it's for. */
  prompt: string;
  /** Shown on web, where the camera isn't available. */
  webMessage: string;
  onScan: (data: string) => void;
  onCancel: () => void;
}

export function BarcodeScanner({
  barcodeTypes,
  prompt,
  webMessage,
  onScan,
  onCancel,
}: BarcodeScannerProps) {
  const [permission, requestPermission] = useCameraPermissions();
  // Without this, a code held in frame fires onBarcodeScanned on every frame.
  const [handled, setHandled] = useState(false);

  if (Platform.OS === 'web') {
    return <Message text={webMessage} onCancel={onCancel} />;
  }

  if (!permission) {
    return <Message text="Preparando la cámara…" onCancel={onCancel} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text variant="bodyMedium" style={styles.text}>
          {prompt}
        </Text>
        {permission.canAskAgain ? (
          <Button onPress={requestPermission}>Dar permiso</Button>
        ) : (
          <Button onPress={() => Linking.openSettings()}>Abrir ajustes</Button>
        )}
        <Button mode="text" onPress={onCancel}>
          Volver
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes }}
        onBarcodeScanned={({ data }) => {
          if (handled) {
            return;
          }
          setHandled(true);
          onScan(data);
        }}
      />
      <View style={styles.overlay}>
        <Button mode="contained" onPress={onCancel}>
          Cancelar
        </Button>
      </View>
    </View>
  );
}

function Message({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <View style={styles.centered}>
      <Text variant="bodyMedium" style={styles.text}>
        {text}
      </Text>
      <Button mode="text" onPress={onCancel}>
        Volver
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  text: { textAlign: 'center' },
  overlay: { position: 'absolute', bottom: 48, left: 24, right: 24 },
});
```

- [ ] **Step 2: Reduce `mobile/app/(auth)/scan.tsx` to a route that renders it**

```tsx
import { router } from 'expo-router';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';

export default function Scan() {
  return (
    <BarcodeScanner
      barcodeTypes={['qr']}
      prompt="Necesitamos permiso para usar la cámara y escanear el código QR."
      webMessage="El escáner solo está disponible en la app móvil. Usa el ingreso manual del código."
      onScan={(data) => router.replace({ pathname: '/(auth)/home', params: { token: data } })}
      onCancel={() => router.back()}
    />
  );
}
```

- [ ] **Step 3: Verify nothing regressed**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: zero type errors, suite unchanged and green.

Then run the app (`npx expo start --web`, started from the worktree) and confirm the QR route still shows the web-unsupported message with a working "Volver", exactly as before.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/components/BarcodeScanner.tsx "mobile/app/(auth)/scan.tsx"
git commit -m "refactor(mobile): extract the barcode scanner for reuse"
```

---

### Task 6: Inventory list screen and the scan route

**Files:**
- Modify: `mobile/app/(app)/inventario.tsx`
- Create: `mobile/app/(app)/escanear.tsx`
- Create: `mobile/src/hooks/useProductSearch.ts`
- Test: `mobile/test/hooks/useProductSearch.test.ts`

**Interfaces:**
- Consumes: `useProducts()` (Task 4), `BarcodeScanner` (Task 5).
- Produces: `filterProducts(products: Product[], query: string): Product[]` from `src/hooks/useProductSearch.ts` — Task 6's screen uses it; keeping it a pure exported function is what makes the search testable without rendering.

- [ ] **Step 1: Write the failing test for the filter**

```ts
// mobile/test/hooks/useProductSearch.test.ts
import { filterProducts } from '../../src/hooks/useProductSearch';
import type { Product } from '../../src/types/api';

const products: Product[] = [
  { barcode: '7591234567890', name: 'Leche entera', brand: 'La Campiña', department: 'Lacteos', unit: 'litro', costUsd: 2.5, stock: 10 },
  { barcode: '7590987654321', name: 'Arroz blanco', brand: 'Primor', department: 'Granos', unit: 'kg', costUsd: 1.2, stock: 50 },
];

describe('filterProducts', () => {
  it('returns everything for an empty query', () => {
    expect(filterProducts(products, '')).toHaveLength(2);
    expect(filterProducts(products, '   ')).toHaveLength(2);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterProducts(products, 'leche')).toEqual([products[0]]);
    expect(filterProducts(products, 'LECHE')).toEqual([products[0]]);
  });

  it('matches on brand and on barcode', () => {
    expect(filterProducts(products, 'primor')).toEqual([products[1]]);
    expect(filterProducts(products, '7591234')).toEqual([products[0]]);
  });

  it('matches on a partial word anywhere in the name', () => {
    expect(filterProducts(products, 'entera')).toEqual([products[0]]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterProducts(products, 'zzz')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest test/hooks/useProductSearch.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `mobile/src/hooks/useProductSearch.ts`**

```ts
import type { Product } from '../types/api';

/** Case-insensitive substring match across the fields someone would actually
 *  type: what it's called, who makes it, and the code on the package. */
export function filterProducts(products: Product[], query: string): Product[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return products;
  }
  return products.filter(
    (p) =>
      p.name.toLowerCase().includes(needle) ||
      p.brand.toLowerCase().includes(needle) ||
      p.barcode.includes(needle)
  );
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest test/hooks/useProductSearch.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the list screen, `mobile/app/(app)/inventario.tsx`**

```tsx
import { useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Searchbar, Text, FAB, List } from 'react-native-paper';
import { useProducts } from '../../src/hooks/useProducts';
import { filterProducts } from '../../src/hooks/useProductSearch';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { Button } from '../../src/components/ui/Button';

export default function Inventario() {
  const { data, isLoading, isError } = useProducts();
  const [query, setQuery] = useState('');

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Skeleton height={48} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>
    );
  }

  if (isError) {
    return <EmptyState title="No se pudo cargar el inventario" message="Revisa tu conexión e inténtalo de nuevo." />;
  }

  const products = filterProducts(data ?? [], query);

  return (
    <View style={styles.container}>
      <Searchbar placeholder="Buscar por nombre, marca o código" value={query} onChangeText={setQuery} />
      <Button mode="outlined" onPress={() => router.push('/(app)/escanear')}>
        Escanear código
      </Button>

      {products.length === 0 ? (
        <EmptyState
          title={query ? 'Sin resultados' : 'Inventario vacío'}
          message={query ? 'Ningún producto coincide con la búsqueda.' : 'Agrega tu primer producto con el botón +.'}
        />
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.barcode}
          renderItem={({ item }) => (
            <List.Item
              title={item.name}
              description={`${item.brand} · ${item.barcode}`}
              right={() => <Text variant="bodyMedium">{item.stock}</Text>}
              onPress={() => router.push(`/(app)/producto/${encodeURIComponent(item.barcode)}`)}
            />
          )}
        />
      )}

      <FAB icon="plus" style={styles.fab} onPress={() => router.push('/(app)/producto/nuevo')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
```

- [ ] **Step 6: Build the scan route, `mobile/app/(app)/escanear.tsx`**

```tsx
import { router } from 'expo-router';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import { useProducts } from '../../src/hooks/useProducts';

export default function Escanear() {
  const { data } = useProducts();

  return (
    <BarcodeScanner
      barcodeTypes={['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'qr']}
      prompt="Necesitamos permiso para usar la cámara y escanear el código del producto."
      webMessage="El escáner solo está disponible en la app móvil. Busca el producto por nombre o código."
      onScan={(barcode) => {
        // Resolved against the cached catalog: known code opens the product,
        // unknown code starts creating it with the code already filled in. A
        // product another device just added may not be in this cache yet — the
        // backend's DUPLICATE_BARCODE is the backstop for that.
        const known = data?.some((p) => p.barcode === barcode);
        router.replace(
          known
            ? `/(app)/producto/${encodeURIComponent(barcode)}`
            : { pathname: '/(app)/producto/nuevo', params: { barcode } }
        );
      }}
      onCancel={() => router.back()}
    />
  );
}
```

- [ ] **Step 7: Verify types and the suite**

Run: `npx tsc --noEmit && npx jest`
Expected: zero type errors — note the `producto/[barcode]` and `producto/nuevo` routes don't exist until Tasks 7-8, so typed-routes may reject those hrefs. If so, that is expected and self-resolving; note it and continue (it happened in the previous sub-project too). The suite must be green regardless.

- [ ] **Step 8: Verify visually**

Run the app from the worktree and confirm: the list renders with a skeleton then content (with the backend down you'll get the error state — that is also worth confirming), typing in the search box filters live, and the "Escanear código" button reaches the scanner's web-unsupported message.

- [ ] **Step 9: Commit**

```bash
git add "mobile/app/(app)" mobile/src/hooks/useProductSearch.ts mobile/test/hooks/useProductSearch.test.ts
git commit -m "feat(mobile): add inventory list with search and the barcode scan route"
```

---

### Task 7: Product detail — view, edit, adjust stock

**Files:**
- Create: `mobile/app/(app)/producto/[barcode].tsx`

**Interfaces:**
- Consumes: `useProducts()`, `usePricingInputs()`, `useProductMutations()` (Task 4), `calculatePriceVes()` (Task 3).

No unit test (a screen). The logic it renders is already covered by Tasks 3, 4 and 6's tests.

- [ ] **Step 1: Create the screen**

```tsx
import { useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text, Divider } from 'react-native-paper';
import { useProducts } from '../../../src/hooks/useProducts';
import { usePricingInputs } from '../../../src/hooks/usePricingInputs';
import { useProductMutations } from '../../../src/hooks/useProductMutations';
import { calculatePriceVes } from '../../../src/services/pricing';
import { Button } from '../../../src/components/ui/Button';
import { TextInput } from '../../../src/components/ui/TextInput';
import { EmptyState } from '../../../src/components/ui/EmptyState';
import { useToast } from '../../../src/feedback/ToastProvider';

const MISSING_INPUT_MESSAGE = {
  bcvRate: 'Falta la tasa BCV del día para calcular el precio.',
  margin: 'Este departamento no tiene un margen configurado.',
  cost: 'El costo del producto no es válido.',
} as const;

export default function ProductoDetalle() {
  const { barcode } = useLocalSearchParams<{ barcode: string }>();
  const { data } = useProducts();
  const { bcvRate, marginFor } = usePricingInputs();
  const { update, adjust } = useProductMutations();
  const { showToast } = useToast();

  const product = data?.find((p) => p.barcode === barcode);

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', brand: '', department: '', unit: '', costUsd: '' });
  const [delta, setDelta] = useState('');

  if (!product) {
    return <EmptyState title="Producto no encontrado" message="Puede que otro dispositivo lo haya modificado." />;
  }

  const price = calculatePriceVes(product.costUsd, marginFor(product.department), bcvRate);

  const startEditing = () => {
    setForm({
      name: product.name,
      brand: product.brand,
      department: product.department,
      unit: product.unit,
      costUsd: String(product.costUsd),
    });
    setEditing(true);
  };

  const save = async () => {
    const costUsd = Number(form.costUsd);
    if (!Number.isFinite(costUsd) || costUsd < 0) {
      showToast('El costo debe ser un número válido.');
      return;
    }
    try {
      await update.mutateAsync({
        barcode: product.barcode,
        body: {
          name: form.name.trim(),
          brand: form.brand.trim(),
          department: form.department.trim(),
          unit: form.unit.trim(),
          costUsd,
        },
      });
      setEditing(false);
      showToast('Producto actualizado.');
    } catch {
      showToast('No se pudo guardar el producto.');
    }
  };

  const applyDelta = async () => {
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0) {
      showToast('Indica cuántas unidades entraron o salieron.');
      return;
    }
    try {
      await adjust.mutateAsync({ barcode: product.barcode, delta: value });
      setDelta('');
      showToast('Stock actualizado.');
    } catch {
      showToast('No se pudo ajustar el stock.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">{product.name}</Text>
      <Text variant="bodySmall">{product.barcode}</Text>

      <Divider />

      <Text variant="bodyMedium">Costo: {product.costUsd} USD</Text>
      <Text variant="bodyMedium">
        {price.ok ? `Precio: ${price.priceVes} Bs` : MISSING_INPUT_MESSAGE[price.missing]}
      </Text>
      <Text variant="bodyMedium">Existencia: {product.stock} {product.unit}</Text>

      <Divider />

      {editing ? (
        <View style={styles.section}>
          <TextInput label="Nombre" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <TextInput label="Marca" value={form.brand} onChangeText={(v) => setForm({ ...form, brand: v })} />
          <TextInput label="Departamento" value={form.department} onChangeText={(v) => setForm({ ...form, department: v })} />
          <TextInput label="Unidad" value={form.unit} onChangeText={(v) => setForm({ ...form, unit: v })} />
          <TextInput label="Costo USD" value={form.costUsd} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, costUsd: v })} />
          <Button loading={update.isPending} disabled={update.isPending} onPress={save}>
            Guardar
          </Button>
          <Button mode="text" disabled={update.isPending} onPress={() => setEditing(false)}>
            Cancelar
          </Button>
        </View>
      ) : (
        <View style={styles.section}>
          <Text variant="bodyMedium">Marca: {product.brand}</Text>
          <Text variant="bodyMedium">Departamento: {product.department}</Text>
          <Button mode="outlined" onPress={startEditing}>
            Editar
          </Button>
        </View>
      )}

      <Divider />

      <View style={styles.section}>
        <Text variant="titleSmall">Ajustar existencia</Text>
        <TextInput
          label="Unidades (negativo para salida)"
          value={delta}
          keyboardType="numbers-and-punctuation"
          onChangeText={setDelta}
        />
        <Button loading={adjust.isPending} disabled={adjust.isPending} onPress={applyDelta}>
          Aplicar ajuste
        </Button>
      </View>

      <Button mode="text" onPress={() => router.back()}>
        Volver
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  section: { gap: 8 },
});
```

- [ ] **Step 2: Verify types and the suite**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: zero type errors, suite green.

- [ ] **Step 3: Verify visually**

With the backend unreachable the screen shows "Producto no encontrado" (the catalog query fails, so nothing matches) — confirm that, then confirm the route renders at all by navigating to `/(app)/producto/123` directly. Full behaviour needs a live backend; say plainly in your report which parts you could and could not exercise.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(app)/producto"
git commit -m "feat(mobile): add product detail with editing and stock adjustment"
```

---

### Task 8: New product screen

**Files:**
- Create: `mobile/app/(app)/producto/nuevo.tsx`

**Interfaces:**
- Consumes: `useProductMutations()` (Task 4), `usePricingInputs()` + `calculatePriceVes()` (Tasks 3-4).

- [ ] **Step 1: Create the screen**

```tsx
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { Text } from 'react-native-paper';
import { useProductMutations } from '../../../src/hooks/useProductMutations';
import { usePricingInputs } from '../../../src/hooks/usePricingInputs';
import { calculatePriceVes } from '../../../src/services/pricing';
import { Button } from '../../../src/components/ui/Button';
import { TextInput } from '../../../src/components/ui/TextInput';
import { useToast } from '../../../src/feedback/ToastProvider';
import { ApiRequestError } from '../../../src/services/api/client';

export default function NuevoProducto() {
  // Pre-filled when arriving from a scan of a code that isn't in the catalog.
  const { barcode: scannedBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const { create } = useProductMutations();
  const { bcvRate, marginFor } = usePricingInputs();
  const { showToast } = useToast();

  const [form, setForm] = useState({
    barcode: scannedBarcode ?? '',
    name: '',
    brand: '',
    department: '',
    unit: '',
    costUsd: '',
    stock: '',
  });

  const costUsd = Number(form.costUsd);
  const preview = calculatePriceVes(costUsd, marginFor(form.department), bcvRate);

  const submit = async () => {
    const stock = Number(form.stock);
    if (!Number.isFinite(costUsd) || costUsd < 0 || !Number.isFinite(stock) || stock < 0) {
      showToast('El costo y la existencia deben ser números válidos.');
      return;
    }
    try {
      await create.mutateAsync({
        barcode: form.barcode.trim(),
        name: form.name.trim(),
        brand: form.brand.trim(),
        department: form.department.trim(),
        unit: form.unit.trim(),
        costUsd,
        stock,
      });
      showToast('Producto creado.');
      router.replace('/(app)/inventario');
    } catch (err) {
      // The catalog cache can be stale, so a scan can land here for a barcode
      // another device just created. This is that case, named.
      if (err instanceof ApiRequestError && err.code === 'DUPLICATE_BARCODE') {
        showToast('Ese código ya existe en el inventario.');
        return;
      }
      showToast('No se pudo crear el producto.');
    }
  };

  const complete =
    form.barcode.trim() && form.name.trim() && form.brand.trim() && form.department.trim() && form.unit.trim();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text variant="headlineSmall">Nuevo producto</Text>

      <TextInput label="Código de barras" value={form.barcode} onChangeText={(v) => setForm({ ...form, barcode: v })} />
      <TextInput label="Nombre" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
      <TextInput label="Marca" value={form.brand} onChangeText={(v) => setForm({ ...form, brand: v })} />
      <TextInput label="Departamento" value={form.department} onChangeText={(v) => setForm({ ...form, department: v })} />
      <TextInput label="Unidad de medida" value={form.unit} onChangeText={(v) => setForm({ ...form, unit: v })} />
      <TextInput label="Costo USD" value={form.costUsd} keyboardType="decimal-pad" onChangeText={(v) => setForm({ ...form, costUsd: v })} />
      <TextInput label="Existencia inicial" value={form.stock} keyboardType="number-pad" onChangeText={(v) => setForm({ ...form, stock: v })} />

      {preview.ok ? <Text variant="bodyMedium">Precio estimado: {preview.priceVes} Bs</Text> : null}

      <Button loading={create.isPending} disabled={create.isPending || !complete} onPress={submit}>
        Crear producto
      </Button>
      <Button mode="text" onPress={() => router.back()}>
        Cancelar
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
```

- [ ] **Step 2: Verify types and the suite**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: zero type errors (the typed-routes complaints from Task 6 resolve here, since both product routes now exist), suite green.

- [ ] **Step 3: Verify visually**

Confirm the form renders, the create button stays disabled until the required fields are filled, and the estimated price appears once a department with a configured margin and a cost are entered (this needs the backend for margins/rate — say plainly what you could not exercise).

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(app)/producto/nuevo.tsx"
git commit -m "feat(mobile): add product creation with scanned-barcode prefill"
```

---

## Self-Review Notes

- **Spec coverage:** prerequisites (Task 1), both backend endpoints (Task 2), pricing (Task 3), data layer (Task 4), scanner extraction (Task 5), list + search + scan flow (Task 6), detail/edit/stock (Task 7), creation (Task 8). Every section of the spec has a task.
- **Type consistency:** `Product` (Task 4) is the shape the backend returns in Task 2 (`barcode, name, brand, department, unit, costUsd, stock` — no `rowIndex`). `UpdateProductRequest` omits `barcode` and `stock`, matching Task 2's `updateProductSchema` exactly. `calculatePriceVes`'s signature (Task 3) matches its two call sites in Tasks 7-8. `PRODUCTS_QUERY_KEY` is defined once in Task 4 and imported by the mutations and their test.
- **Known sequencing wrinkle, stated rather than hidden:** Task 6 links to product routes that Tasks 7-8 create, so Expo's typed routes may reject those hrefs until Task 8 lands. The same thing happened in sub-project 2 and resolved itself; Task 6 says so explicitly instead of leaving the next implementer to rediscover it.
- **No placeholders:** every step carries the code it needs.
