# Auth + Device Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real device-linking flow — a new device scans or types an invite token, names itself, and gets a session; an ADMIN generates those invites as QR codes — plus the backend bootstrap script and the four sub-project-1 items this work makes reachable. Per `docs/superpowers/specs/2026-09-20-auth-device-linking-design.md`.

**Architecture:** All linking logic lives in `mobile/src/hooks/useDeviceLinking.ts` (a state machine) and `mobile/src/services/` (API calls, hardware ID); the screens under `mobile/app/` stay declarative, per the foundation's existing constraint. A session ending for a reason the user should see (revoked, pending, expired) is recorded in the session store as a non-persisted `endedReason`, which Home renders — that is also what finally gives a stored non-ACTIVE session a cleanup path.

**Tech Stack:** Existing foundation (Expo SDK 57, Expo Router, React Native Paper, Zustand, TanStack Query, `expo-secure-store`, Jest/`jest-expo`) plus `expo-camera` (QR scanning), `expo-application` (hardware ID), `react-native-qrcode-svg` + `react-native-svg` (QR rendering). Backend gains one `tsx` script.

## Global Constraints

- TypeScript `strict: true`, no `any`, in both `mobile/` and `backend/`.
- Business logic lives in `mobile/src/hooks/*` or `mobile/src/services/*`, never inline in a screen under `mobile/app/`.
- Session writes always go through `signIn()`/`signOut()` from `mobile/src/services/session.ts` — never `setSession`/`saveSession`/`clearSession`/`deleteSession` directly from a hook or screen.
- The linking client never chooses a role. The role comes from the invite token in the backend's response. Do not add a role picker to the linking flow (a role self-escalation hole was already fixed in the backend over exactly this).
- Backend errors are surfaced by their `code`, never by raw HTTP status or a generic message.
- Automated tests cover pure logic only (services, hooks, the backend script) — no component-rendering tests. Screens are verified by running the app: `npx expo start --web` from `mobile/` plus the browser tool. Camera scanning cannot be verified on web; that one task states its own verification method.
- Web is a development/verification target, not a shipping platform (recorded in `mobile/AGENTS.md`). Anything platform-specific needs a working web branch so the flow stays verifiable.
- `mobile`: `npx tsc --noEmit` stays at zero errors and `npx jest` stays green (58 tests at plan start). `backend`: `npx vitest run` stays green (72 passing, 1 skipped).

---

## File Structure

```
backend/
  scripts/create-invite.ts              # NEW — bootstrap the first ADMIN invite
  test/scripts/createInvite.test.ts     # NEW
  package.json                          # MODIFIED — "create-invite" script

mobile/
  app/(auth)/home.tsx                   # MODIFIED — real linking flow
  app/(auth)/scan.tsx                   # NEW — camera QR scanner
  app/(app)/invitar.tsx                 # NEW — ADMIN invite generation
  app/(app)/_layout.tsx                 # MODIFIED — register the ADMIN-only tab
  src/hooks/useDeviceLinking.ts         # NEW — the state machine
  src/hooks/useSessionHydration.ts      # MODIFIED — clean up non-ACTIVE sessions
  src/hooks/useRevocationGuard.ts       # MODIFIED — detect accountId change, pass reason
  src/services/api/auth.ts              # MODIFIED — linkDevice(), createInvite()
  src/services/api/client.ts            # MODIFIED — 401 guard, success-body parsing
  src/services/device/hardwareId.ts     # NEW
  src/services/session.ts               # MODIFIED — signOut(reason?)
  src/state/sessionStore.ts             # MODIFIED — endedReason
  src/types/api.ts                      # MODIFIED — link/invite request+response types
  test/…                                # NEW/MODIFIED per task
```

---

### Task 1: Close the four prerequisite items from sub-project 1

**Files:**
- Modify: `mobile/src/services/api/client.ts`
- Modify: `mobile/src/state/sessionStore.ts`
- Modify: `mobile/src/services/session.ts`
- Modify: `mobile/src/hooks/useSessionHydration.ts`
- Modify: `mobile/src/hooks/useRevocationGuard.ts`
- Test: `mobile/test/services/api/client.test.ts` (extend)
- Test: `mobile/test/services/session.test.ts` (extend)
- Test: `mobile/test/hooks/useSessionHydration.test.tsx` (extend)
- Test: `mobile/test/hooks/useRevocationGuard.test.tsx` (extend)

**Interfaces:**
- Produces: `type SessionEndReason = 'REVOKED' | 'PENDING' | 'EXPIRED'`, `endedReason`/`setEndedReason` on the session store, and `signOut(reason?: SessionEndReason)`. Task 5's Home screen reads `endedReason` to explain why the device stopped working.

- [ ] **Step 1: Write the failing tests**

Add to `mobile/test/services/api/client.test.ts`:

```ts
  it('still throws ApiRequestError on a 401 when clearing storage fails', async () => {
    const { deleteSession } = jest.requireMock('../../../src/services/storage/secureSession');
    (deleteSession as jest.Mock).mockRejectedValueOnce(new Error('keychain locked'));
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }),
    });

    await expect(apiFetch('/customers')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('throws ApiRequestError when a success response body is not valid JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });

    await expect(apiFetch('/products')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE_BODY',
    });
  });

  it('resolves to null for a 204 with no body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(apiFetch('/whatever')).resolves.toBeNull();
  });
```

Add to `mobile/test/hooks/useRevocationGuard.test.tsx`:

```tsx
  it('signs out when /auth/me reports a different accountId', async () => {
    useSessionStore.getState().setSession({
      deviceId: 'd1',
      accountId: 'account-a',
      role: 'ADMIN',
      status: 'ACTIVE',
      jwt: 'jwt',
    });
    (useAuthStatus as jest.Mock).mockReturnValue({
      data: { role: 'ADMIN', status: 'ACTIVE', accountId: 'account-b', jwt: 'jwt' },
    });

    await renderHook(() => useRevocationGuard(), { wrapper });

    await waitFor(() => expect(useSessionStore.getState().session).toBeNull());
  });
```

Add to `mobile/test/hooks/useSessionHydration.test.tsx`:

```tsx
  it('deletes a stored non-ACTIVE session instead of adopting it, and records why', async () => {
    (loadSession as jest.Mock).mockResolvedValue({
      deviceId: 'd1',
      accountId: 'a1',
      role: 'ADMIN',
      status: 'REVOKED',
      jwt: 'jwt',
    });

    await renderHook(() => useSessionHydration());

    await waitFor(() => expect(useSessionStore.getState().hydrated).toBe(true));
    expect(useSessionStore.getState().session).toBeNull();
    expect(useSessionStore.getState().endedReason).toBe('REVOKED');
    expect(deleteSession).toHaveBeenCalled();
  });
```

Add to `mobile/test/services/session.test.ts`:

```ts
  it('signOut records the reason the session ended', async () => {
    await signOut('REVOKED');
    expect(useSessionStore.getState().endedReason).toBe('REVOKED');
  });

  it('signIn clears any previous ended-reason', async () => {
    await signOut('EXPIRED');
    await signIn({ deviceId: 'd1', accountId: 'a1', role: 'ADMIN', status: 'ACTIVE', jwt: 'j' });
    expect(useSessionStore.getState().endedReason).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mobile && npx jest`
Expected: the new cases FAIL (the 401-with-failing-storage test rejects with the raw storage error; the malformed-success-body test resolves to `null`; `endedReason` is undefined).

- [ ] **Step 3: Fix `client.ts`**

Replace the single `readJsonBody` with two asymmetric readers and guard the 401 path:

```ts
/**
 * Error bodies come from anywhere — a proxy's HTML page, an empty 502 — so a
 * parse failure must not escape as a SyntaxError that isn't an ApiRequestError.
 */
async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  return response.json().then((body) => body as ApiErrorBody).catch(() => null);
}

/**
 * Success bodies must parse. A 204 is the only legitimate "no JSON" case;
 * anything else is a real protocol error the caller has to see as an
 * ApiRequestError rather than as a silent `null` typed as `T`.
 */
async function readSuccessBody<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return null as T;
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiRequestError(
      response.status,
      'INVALID_RESPONSE_BODY',
      'The server returned a response that was not valid JSON'
    );
  }
}
```

In `apiFetch`, change the 401 branch and the two body reads:

```ts
  if (response.status === 401) {
    // `.catch`: a failing storage delete must not replace the ApiRequestError
    // with a raw storage error for the one status callers most need to match.
    // Memory and cache are cleared synchronously inside signOut regardless.
    await signOut('EXPIRED').catch(() => undefined);
  }

  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? `Request failed with status ${response.status}`
    );
  }

  return readSuccessBody<T>(response);
```

- [ ] **Step 4: Add `endedReason` to `sessionStore.ts`**

```ts
export type SessionEndReason = 'REVOKED' | 'PENDING' | 'EXPIRED';
```

Add to `SessionState`: `endedReason: SessionEndReason | null;` and
`setEndedReason: (reason: SessionEndReason | null) => void;`, with
`endedReason: null` in the initial state and
`setEndedReason: (endedReason) => set({ endedReason })`.

Leave `clearSession` as-is — it must not touch `endedReason`, since `signOut`
sets the reason immediately after clearing.

- [ ] **Step 5: Thread the reason through `session.ts`**

```ts
export async function signIn(session: Session): Promise<void> {
  useSessionStore.getState().setSession(session);
  // A fresh sign-in must not leave a stale "your device was revoked" banner up.
  useSessionStore.getState().setEndedReason(null);
  await saveSession(session);
}

export async function signOut(reason?: SessionEndReason): Promise<void> {
  useSessionStore.getState().clearSession();
  if (reason) {
    useSessionStore.getState().setEndedReason(reason);
  }
  queryClient.clear();
  await deleteSession();
}
```

Import `type SessionEndReason` from the store.

- [ ] **Step 6: Give a stored non-ACTIVE session a cleanup path in `useSessionHydration.ts`**

Replace the `.then` body:

```ts
      .then(async (session) => {
        if (!session) {
          return;
        }
        if (session.status !== 'ACTIVE') {
          // Nothing else would ever clean this up: both route gates send a
          // non-ACTIVE session to Home, and useRevocationGuard only runs under
          // (app)/, which it never reaches. Drop the dead credential and keep
          // the reason so Home can explain why the device stopped working.
          await signOut(session.status);
          return;
        }
        setSession(session);
      })
```

`session.status` is `'PENDING' | 'REVOKED'` in that branch, both of which are
valid `SessionEndReason` values. Import `signOut` from `../services/session`.

- [ ] **Step 7: Detect an `accountId` change and pass reasons in `useRevocationGuard.ts`**

Change the non-ACTIVE branch to pass the reason, and add the tenant check
before the refresh comparison:

```ts
    if (authStatus.status !== 'ACTIVE') {
      void signOut(authStatus.status).catch(() => undefined);
      return;
    }

    if (!session) {
      return;
    }

    if (authStatus.accountId !== session.accountId) {
      // A different tenant behind the same JWT is a re-link, not a refresh.
      // Query keys carry no accountId, so silently adopting it would render
      // the previous account's cached rows.
      void signOut('EXPIRED').catch(() => undefined);
      return;
    }
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd mobile && npx jest` and `npx tsc --noEmit`
Expected: all tests pass (58 existing + the new cases), zero type errors.

- [ ] **Step 9: Commit**

```bash
git add mobile/src mobile/test
git commit -m "fix(mobile): close the session-lifecycle gaps device linking makes reachable"
```

---

### Task 2: Backend script to bootstrap the first ADMIN invite

**Files:**
- Create: `backend/scripts/create-invite.ts`
- Modify: `backend/package.json` (add the `create-invite` script)
- Test: `backend/test/scripts/createInvite.test.ts`

**Interfaces:**
- Produces: `createInvite(pool: Pool, accountId: string, role: DeviceRole): Promise<{ inviteToken: string; expiresAt: string }>` from `backend/scripts/create-invite.ts`, plus a CLI entry point. The CLI is what an operator runs; the exported function is what the test drives.

- [ ] **Step 1: Write the failing test**

```ts
// backend/test/scripts/createInvite.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createTestPool } from '../helpers/testDb';
import { runMigrations } from '../../src/db/migrate';
import { insertAccount } from '../helpers/factories';
import { createInvite } from '../../scripts/create-invite';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

describe('createInvite', () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createTestPool();
    await runMigrations(pool, migrationsDir);
  });

  it('inserts a single-use invite token for the account and role', async () => {
    const account = await insertAccount(pool);

    const result = await createInvite(pool, account.id, 'ADMIN');

    const { rows } = await pool.query(
      'SELECT account_id, role, used_at, expires_at FROM invite_tokens WHERE id = $1',
      [result.inviteToken]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(account.id);
    expect(rows[0].role).toBe('ADMIN');
    expect(rows[0].used_at).toBeNull();
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an account id that does not exist', async () => {
    await expect(
      createInvite(pool, '00000000-0000-0000-0000-000000000000', 'ADMIN')
    ).rejects.toThrow(/account/i);
  });

  it('rejects an unknown role', async () => {
    const account = await insertAccount(pool);
    await expect(createInvite(pool, account.id, 'SUPERUSER' as never)).rejects.toThrow(/role/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run test/scripts/createInvite.test.ts`
Expected: FAIL — `scripts/create-invite.ts` does not exist.

- [ ] **Step 3: Implement `backend/scripts/create-invite.ts`**

```ts
import type { Pool } from 'pg';
import { DEVICE_ROLES, type DeviceRole } from '../src/modules/auth/jwt.js';

export interface CreatedInvite {
  inviteToken: string;
  expiresAt: string;
}

/**
 * Creates an invite token from outside the API.
 *
 * This exists for one case the endpoint cannot serve: the FIRST device of an
 * account. `POST /devices/invite` requires an ADMIN device, and a brand-new
 * account has none — so without this, bootstrapping means hand-written SQL
 * against production. Deliberately a script and not an endpoint: an
 * unauthenticated invite route would hand anyone an ADMIN device.
 */
export async function createInvite(
  pool: Pool,
  accountId: string,
  role: DeviceRole
): Promise<CreatedInvite> {
  if (!DEVICE_ROLES.includes(role)) {
    throw new Error(`Unknown role "${role}". Expected one of: ${DEVICE_ROLES.join(', ')}`);
  }

  const { rows: accountRows } = await pool.query('SELECT id FROM accounts WHERE id = $1', [accountId]);
  if (accountRows.length === 0) {
    throw new Error(`No account with id ${accountId}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO invite_tokens (account_id, role, expires_at)
     VALUES ($1, $2, now() + interval '24 hours')
     RETURNING id, expires_at`,
    [accountId, role]
  );

  return {
    inviteToken: rows[0].id as string,
    expiresAt: new Date(rows[0].expires_at).toISOString(),
  };
}

/* CLI: npm run create-invite -- --account <uuid> --role ADMIN */
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };

  const accountId = valueOf('--account');
  const role = valueOf('--role') as DeviceRole | undefined;

  if (!accountId || !role) {
    console.error('Usage: npm run create-invite -- --account <uuid> --role <ADMIN|INVENTARIO|POST_VENTA|CLIENTE_PEDIDOS>');
    process.exit(1);
  }

  const { loadEnv } = await import('../src/config/env.js');
  const { createPool } = await import('../src/db/client.js');
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  try {
    const invite = await createInvite(pool, accountId, role);
    console.log(`Invite token: ${invite.inviteToken}`);
    console.log(`Role:         ${role}`);
    console.log(`Expires:      ${invite.expiresAt}`);
  } finally {
    await pool.end();
  }
}
```

If `DEVICE_ROLES` is not already exported from `src/modules/auth/jwt.ts`, export it there as
`export const DEVICE_ROLES = ['ADMIN', 'INVENTARIO', 'POST_VENTA', 'CLIENTE_PEDIDOS'] as const;`
and derive `DeviceRole` from it (`typeof DEVICE_ROLES[number]`) rather than duplicating the list.
Check the file first — the backend's `devices/routes.ts` already references a role enum, so reuse
whatever exists instead of introducing a second source of truth.

- [ ] **Step 4: Add the npm script to `backend/package.json`**

```json
    "create-invite": "tsx scripts/create-invite.ts",
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/scripts/createInvite.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npx vitest run`
Expected: all previously-passing tests still pass, plus the 3 new ones.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts backend/test/scripts backend/package.json backend/src/modules/auth/jwt.ts
git commit -m "feat(backend): add create-invite script to bootstrap an account's first device"
```

---

### Task 3: Dependencies and hardware ID service

**Files:**
- Modify: `mobile/package.json` (dependencies)
- Create: `mobile/src/services/device/hardwareId.ts`
- Test: `mobile/test/services/device/hardwareId.test.ts`

**Interfaces:**
- Produces: `getHardwareId(): Promise<string>` and `getSuggestedDeviceName(): string` from `src/services/device/hardwareId.ts`. Task 4's `useDeviceLinking` consumes both.

- [ ] **Step 1: Install the dependencies**

```bash
cd mobile
npx expo install expo-camera expo-application react-native-svg
npm install react-native-qrcode-svg
```

(`expo-device` is already installed. `npx expo install` resolves versions compatible with the installed SDK; `react-native-qrcode-svg` is not an Expo module so plain `npm install` is right.)

- [ ] **Step 2: Write the failing test**

```ts
// mobile/test/services/device/hardwareId.test.ts
jest.mock('expo-application', () => ({
  getAndroidId: jest.fn(),
  getIosIdForVendorAsync: jest.fn(),
}));
jest.mock('expo-device', () => ({ deviceName: null, modelName: null }));

import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { getHardwareId, getSuggestedDeviceName } from '../../../src/services/device/hardwareId';

describe('getHardwareId', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses the Android id on Android', async () => {
    Platform.OS = 'android';
    (Application.getAndroidId as jest.Mock).mockReturnValue('android-id-123');

    await expect(getHardwareId()).resolves.toBe('android-id-123');
  });

  it('uses the vendor id on iOS', async () => {
    Platform.OS = 'ios';
    (Application.getIosIdForVendorAsync as jest.Mock).mockResolvedValue('ios-vendor-456');

    await expect(getHardwareId()).resolves.toBe('ios-vendor-456');
  });

  it('falls back to a generated id on iOS when the vendor id is unavailable', async () => {
    Platform.OS = 'ios';
    (Application.getIosIdForVendorAsync as jest.Mock).mockResolvedValue(null);

    const id = await getHardwareId();
    expect(id).toMatch(/^web-/);
  });

  it('returns a stable generated id on web across calls', async () => {
    Platform.OS = 'web';

    const first = await getHardwareId();
    const second = await getHardwareId();
    expect(first).toBe(second);
    expect(first).toMatch(/^web-/);
  });
});

describe('getSuggestedDeviceName', () => {
  it('prefers the device name over the model name', () => {
    (Device as { deviceName: string | null }).deviceName = 'Telefono de Maria';
    (Device as { modelName: string | null }).modelName = 'Pixel 8';

    expect(getSuggestedDeviceName()).toBe('Telefono de Maria');
  });

  it('falls back to the model name, then to a generic label', () => {
    (Device as { deviceName: string | null }).deviceName = null;
    (Device as { modelName: string | null }).modelName = 'Pixel 8';
    expect(getSuggestedDeviceName()).toBe('Pixel 8');

    (Device as { modelName: string | null }).modelName = null;
    expect(getSuggestedDeviceName()).toBe('Dispositivo sin nombre');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npx jest test/services/device/hardwareId.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `mobile/src/services/device/hardwareId.ts`**

```ts
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';

/**
 * A per-install identifier the backend uses to recognise a returning device
 * (`devices.hardware_id`, unique per account).
 *
 * Web has no hardware identifier at all. Web is a development-only target
 * (see AGENTS.md), so it gets a generated id held for the lifetime of the
 * page — enough to exercise the linking flow, and deliberately not persisted
 * anywhere that would imply it means something.
 */
let generatedId: string | null = null;

function getGeneratedId(): string {
  if (!generatedId) {
    generatedId = `web-${globalThis.crypto.randomUUID()}`;
  }
  return generatedId;
}

export async function getHardwareId(): Promise<string> {
  if (Platform.OS === 'android') {
    return Application.getAndroidId();
  }

  if (Platform.OS === 'ios') {
    // Returns null when the vendor id is briefly unavailable (e.g. before first
    // unlock after a restart); a generated id keeps linking usable rather than
    // failing outright, and a re-link later simply updates the same row.
    const vendorId = await Application.getIosIdForVendorAsync();
    return vendorId ?? getGeneratedId();
  }

  return getGeneratedId();
}

export function getSuggestedDeviceName(): string {
  return Device.deviceName ?? Device.modelName ?? 'Dispositivo sin nombre';
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest test/services/device/hardwareId.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Verify the whole suite and types**

Run: `npx jest` and `npx tsc --noEmit`
Expected: all green, zero type errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/services/device mobile/test/services/device
git commit -m "feat(mobile): add hardware id service and linking dependencies"
```

---

### Task 4: The linking state machine

**Files:**
- Modify: `mobile/src/types/api.ts`
- Modify: `mobile/src/services/api/auth.ts`
- Create: `mobile/src/hooks/useDeviceLinking.ts`
- Test: `mobile/test/services/api/auth.test.ts` (extend)
- Test: `mobile/test/hooks/useDeviceLinking.test.tsx`

**Interfaces:**
- Produces: `linkDevice(body: LinkDeviceRequest): Promise<LinkDeviceResponse>` and `createInvite(role: DeviceRole): Promise<CreateInviteResponse>` from `src/services/api/auth.ts`; `useDeviceLinking()` returning `{ state, error, suggestedName, startManual, submitToken, confirmName, reset }` from `src/hooks/useDeviceLinking.ts`. Tasks 5-7 consume these.

- [ ] **Step 1: Add the request/response types to `mobile/src/types/api.ts`**

```ts
export interface LinkDeviceRequest {
  inviteToken: string;
  hardwareId: string;
  deviceName: string;
}

/** Note: the backend returns neither `deviceId` nor `status` here. */
export interface LinkDeviceResponse {
  jwt: string;
  role: DeviceRole;
  accountId: string;
}

export interface CreateInviteResponse {
  inviteToken: string;
  role: DeviceRole;
  expiresAt: string;
}
```

- [ ] **Step 2: Write the failing tests**

Add to `mobile/test/services/api/auth.test.ts`:

```ts
  it('linkDevice posts the invite token, hardware id and device name', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({ jwt: 'j', role: 'ADMIN', accountId: 'a1' });

    await linkDevice({ inviteToken: 'token', hardwareId: 'hw', deviceName: 'Caja 1' });

    expect(apiFetch).toHaveBeenCalledWith('/auth/link-device', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'token', hardwareId: 'hw', deviceName: 'Caja 1' }),
    });
  });

  it('createInvite posts the chosen role', async () => {
    (apiFetch as jest.Mock).mockResolvedValue({
      inviteToken: 't',
      role: 'INVENTARIO',
      expiresAt: '2026-09-21T00:00:00.000Z',
    });

    await createInvite('INVENTARIO');

    expect(apiFetch).toHaveBeenCalledWith('/devices/invite', {
      method: 'POST',
      body: JSON.stringify({ role: 'INVENTARIO' }),
    });
  });
```

Create `mobile/test/hooks/useDeviceLinking.test.tsx`:

```tsx
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useDeviceLinking } from '../../src/hooks/useDeviceLinking';
import { useSessionStore } from '../../src/state/sessionStore';
import { ApiRequestError } from '../../src/services/api/client';

jest.mock('../../src/services/api/auth', () => ({
  linkDevice: jest.fn(),
  readDeviceIdFromJwt: jest.fn(() => 'device-from-jwt'),
}));
jest.mock('../../src/services/device/hardwareId', () => ({
  getHardwareId: jest.fn(async () => 'hw-1'),
  getSuggestedDeviceName: jest.fn(() => 'Pixel 8'),
}));

import { linkDevice } from '../../src/services/api/auth';

const VALID_TOKEN = '11111111-2222-3333-4444-555555555555';

describe('useDeviceLinking', () => {
  beforeEach(() => {
    useSessionStore.getState().clearSession();
    jest.clearAllMocks();
  });

  it('starts idle with a suggested device name', async () => {
    const { result } = await renderHook(() => useDeviceLinking());
    expect(result.current.state).toBe('idle');
    expect(result.current.suggestedName).toBe('Pixel 8');
  });

  it('rejects a token that is not a UUID without calling the API', async () => {
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken('not-a-uuid');
    });

    expect(linkDevice).not.toHaveBeenCalled();
    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(/código/i);
  });

  it('moves to confirming after a valid token is accepted', async () => {
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });

    expect(result.current.state).toBe('confirming');
  });

  it('signs in with the deviceId read from the JWT and an ACTIVE status', async () => {
    (linkDevice as jest.Mock).mockResolvedValue({ jwt: 'jwt-value', role: 'INVENTARIO', accountId: 'acc-1' });
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    await act(async () => {
      await result.current.confirmName('Caja 1');
    });

    await waitFor(() => expect(useSessionStore.getState().session).not.toBeNull());
    expect(useSessionStore.getState().session).toEqual({
      deviceId: 'device-from-jwt',
      accountId: 'acc-1',
      role: 'INVENTARIO',
      status: 'ACTIVE',
      jwt: 'jwt-value',
    });
  });

  it.each([
    ['INVALID_INVITE_TOKEN', /inválido|usado|expirado/i],
    ['DEVICE_LIMIT_REACHED', /límite/i],
    ['DEVICE_REVOKED', /revocado/i],
  ])('maps the %s error code to a specific message', async (code, expected) => {
    (linkDevice as jest.Mock).mockRejectedValue(new ApiRequestError(422, code, 'backend message'));
    const { result } = await renderHook(() => useDeviceLinking());

    await act(async () => {
      await result.current.submitToken(VALID_TOKEN);
    });
    await act(async () => {
      await result.current.confirmName('Caja 1');
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error).toMatch(expected);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd mobile && npx jest test/hooks/useDeviceLinking.test.tsx`
Expected: FAIL — `src/hooks/useDeviceLinking.ts` does not exist.

- [ ] **Step 4: Add the API calls to `mobile/src/services/api/auth.ts`**

```ts
export async function linkDevice(body: LinkDeviceRequest): Promise<LinkDeviceResponse> {
  return apiFetch<LinkDeviceResponse>('/auth/link-device', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createInvite(role: DeviceRole): Promise<CreateInviteResponse> {
  return apiFetch<CreateInviteResponse>('/devices/invite', {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}
```

Import the new types alongside the existing ones.

- [ ] **Step 5: Implement `mobile/src/hooks/useDeviceLinking.ts`**

```ts
import { useCallback, useState } from 'react';
import { linkDevice, readDeviceIdFromJwt } from '../services/api/auth';
import { getHardwareId, getSuggestedDeviceName } from '../services/device/hardwareId';
import { signIn } from '../services/session';
import { ApiRequestError } from '../services/api/client';

/* No 'scanning' state: the scanner is its own route, so nothing here would ever
   set or read it. */
export type LinkingState = 'idle' | 'manual' | 'confirming' | 'submitting' | 'error';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Messages are chosen per backend error code, not per HTTP status: 422 and 403
 * each cover several distinct situations, and "no se pudo vincular" tells the
 * person in the shop nothing about what to do next.
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  INVALID_INVITE_TOKEN: 'Ese código no es válido, ya fue usado o expiró. Pídele al administrador uno nuevo.',
  DEVICE_LIMIT_REACHED: 'Esta cuenta ya llegó a su límite de dispositivos vinculados.',
  DEVICE_REVOKED: 'Este dispositivo fue revocado. Contacta al administrador.',
};

const FALLBACK_MESSAGE = 'No se pudo vincular el dispositivo. Revisa tu conexión e inténtalo de nuevo.';
const INVALID_FORMAT_MESSAGE = 'Ese código no tiene el formato correcto. Revísalo e inténtalo de nuevo.';

export function useDeviceLinking() {
  const [state, setState] = useState<LinkingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const startManual = useCallback(() => {
    setError(null);
    setState('manual');
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setToken(null);
    setState('idle');
  }, []);

  /** Validates locally first: the backend answers 422 either way, but a round
   *  trip to be told "invalid" is slower and vaguer than saying so here. */
  const submitToken = useCallback(async (candidate: string) => {
    const trimmed = candidate.trim();
    if (!UUID_PATTERN.test(trimmed)) {
      setError(INVALID_FORMAT_MESSAGE);
      setState('error');
      return;
    }
    setError(null);
    setToken(trimmed);
    setState('confirming');
  }, []);

  const confirmName = useCallback(
    async (deviceName: string) => {
      if (!token) {
        setError(FALLBACK_MESSAGE);
        setState('error');
        return;
      }

      setState('submitting');
      setError(null);
      try {
        const hardwareId = await getHardwareId();
        const response = await linkDevice({ inviteToken: token, hardwareId, deviceName: deviceName.trim() });

        // The endpoint returns neither deviceId nor status: deviceId is read
        // from the JWT (an untrusted local hint, never an authorization input),
        // and link-device's success path always leaves the device ACTIVE.
        await signIn({
          deviceId: readDeviceIdFromJwt(response.jwt) ?? '',
          accountId: response.accountId,
          role: response.role,
          status: 'ACTIVE',
          jwt: response.jwt,
        });
      } catch (err) {
        const code = err instanceof ApiRequestError ? err.code : null;
        setError((code && MESSAGE_BY_CODE[code]) ?? FALLBACK_MESSAGE);
        setState('error');
      }
    },
    [token]
  );

  return {
    state,
    error,
    suggestedName: getSuggestedDeviceName(),
    startManual,
    submitToken,
    confirmName,
    reset,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest test/hooks/useDeviceLinking.test.tsx test/services/api/auth.test.ts`
Expected: PASS

- [ ] **Step 7: Verify the whole suite and types**

Run: `npx jest` and `npx tsc --noEmit`
Expected: all green, zero type errors.

- [ ] **Step 8: Commit**

```bash
git add mobile/src mobile/test
git commit -m "feat(mobile): add device linking state machine and auth endpoints"
```

---

### Task 5: Home screen — the real linking flow

**Files:**
- Modify: `mobile/app/(auth)/home.tsx`

**Interfaces:**
- Consumes: `useDeviceLinking` (Task 4), `endedReason` from the session store (Task 1), the UI atoms from sub-project 1.
- Produces: the screen Task 6's scanner returns a scanned token to.

No automated tests (a screen, per the Global Constraints) — verified by running the app.

- [ ] **Step 1: Rewrite `mobile/app/(auth)/home.tsx`**

```tsx
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Text, Banner } from 'react-native-paper';
import { useDeviceLinking } from '../../src/hooks/useDeviceLinking';
import { useSessionStore } from '../../src/state/sessionStore';
import { Button } from '../../src/components/ui/Button';
import { TextInput } from '../../src/components/ui/TextInput';

const ENDED_REASON_MESSAGE = {
  REVOKED: 'Este dispositivo fue revocado por el administrador y ya no tiene acceso.',
  PENDING: 'Este dispositivo está pendiente de aprobación del administrador.',
  EXPIRED: 'Tu sesión expiró. Vincula el dispositivo de nuevo para continuar.',
} as const;

export default function Home() {
  const { state, error, suggestedName, startManual, submitToken, confirmName, reset } = useDeviceLinking();
  const endedReason = useSessionStore((store) => store.endedReason);
  const [tokenInput, setTokenInput] = useState('');
  const [nameInput, setNameInput] = useState(suggestedName);

  return (
    <View style={styles.container}>
      {endedReason ? <Banner visible>{ENDED_REASON_MESSAGE[endedReason]}</Banner> : null}

      <Text variant="headlineSmall">Vincular dispositivo</Text>

      {state === 'error' && error ? (
        <Text variant="bodyMedium" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {state === 'confirming' || state === 'submitting' ? (
        <>
          <Text variant="bodyMedium">Ponle un nombre para reconocerlo en la lista de dispositivos.</Text>
          <TextInput label="Nombre del dispositivo" value={nameInput} onChangeText={setNameInput} />
          <Button loading={state === 'submitting'} disabled={state === 'submitting' || nameInput.trim().length === 0} onPress={() => confirmName(nameInput)}>
            Vincular
          </Button>
          <Button mode="text" onPress={reset}>
            Cancelar
          </Button>
        </>
      ) : state === 'manual' ? (
        <>
          <TextInput label="Código de invitación" value={tokenInput} onChangeText={setTokenInput} autoCapitalize="none" />
          <Button disabled={tokenInput.trim().length === 0} onPress={() => submitToken(tokenInput)}>
            Continuar
          </Button>
          <Button mode="text" onPress={reset}>
            Volver
          </Button>
        </>
      ) : (
        <>
          <Button onPress={() => router.push('/(auth)/scan')}>Escanear código QR</Button>
          <Button mode="outlined" onPress={startManual}>
            Ingresar código manualmente
          </Button>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  error: { textAlign: 'center' },
});
```

Note: the scanner (Task 6) hands its result back by navigating to Home with the token as a route
param. Wire that in Task 6, where both halves exist — do not stub it here.

- [ ] **Step 2: Verify types**

Run: `cd mobile && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Verify visually**

Run `npx expo start --web`, open in the browser tool, and confirm with no session:
- The initial state shows both buttons.
- "Ingresar código manualmente" reveals the text field; submitting `abc` shows the format error; submitting a well-formed UUID moves to the name step with the field pre-filled.
- The name step's "Vincular" button is disabled when the field is emptied.
- With the backend NOT running, confirming shows the connection fallback message rather than a crash or a silent nothing.

Describe concretely what you observed for each.

- [ ] **Step 4: Commit**

```bash
git add "mobile/app/(auth)/home.tsx"
git commit -m "feat(mobile): build the device linking flow on Home"
```

---

### Task 6: QR scanner screen

**Files:**
- Create: `mobile/app/(auth)/scan.tsx`
- Modify: `mobile/app/(auth)/home.tsx` (accept the scanned token as a route param)
- Modify: `mobile/app.json` (camera permission strings)

**Interfaces:**
- Consumes: `useDeviceLinking`'s `submitToken` (via Home).

No automated tests. **Camera scanning cannot be verified on web** — verification for the scan path itself is: the permission-denied and unsupported-platform states render correctly on web, and the code path is reviewed for correctness. Note this honestly in the report rather than claiming a scan was tested.

- [ ] **Step 1: Add the permission strings to `mobile/app.json`**

Under `expo.plugins`, add the camera plugin with a usage description (required for iOS builds):

```json
      [
        "expo-camera",
        {
          "cameraPermission": "La aplicación usa la cámara para escanear el código QR de vinculación."
        }
      ]
```

- [ ] **Step 2: Create `mobile/app/(auth)/scan.tsx`**

```tsx
import { useState } from 'react';
import { View, StyleSheet, Platform, Linking } from 'react-native';
import { router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text } from 'react-native-paper';
import { Button } from '../../src/components/ui/Button';

export default function Scan() {
  const [permission, requestPermission] = useCameraPermissions();
  // Without this, a QR held in frame fires onBarcodeScanned on every frame and
  // pushes a stack of Home screens.
  const [handled, setHandled] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <Message text="El escáner solo está disponible en la app móvil. Usa el ingreso manual del código." />
    );
  }

  if (!permission) {
    return <Message text="Preparando la cámara…" />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text variant="bodyMedium" style={styles.text}>
          Necesitamos permiso para usar la cámara y escanear el código QR.
        </Text>
        {permission.canAskAgain ? (
          <Button onPress={requestPermission}>Dar permiso</Button>
        ) : (
          <Button onPress={() => Linking.openSettings()}>Abrir ajustes</Button>
        )}
        <Button mode="text" onPress={() => router.back()}>
          Ingresar el código manualmente
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (handled) {
            return;
          }
          setHandled(true);
          router.replace({ pathname: '/(auth)/home', params: { token: data } });
        }}
      />
      <View style={styles.overlay}>
        <Button mode="contained" onPress={() => router.back()}>
          Cancelar
        </Button>
      </View>
    </View>
  );
}

function Message({ text }: { text: string }) {
  return (
    <View style={styles.centered}>
      <Text variant="bodyMedium" style={styles.text}>
        {text}
      </Text>
      <Button mode="text" onPress={() => router.back()}>
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

**Verify the `expo-camera` API against the installed version before assuming it.** `CameraView` +
`useCameraPermissions` + `barcodeScannerSettings` is the SDK 51+ shape; if SDK 57 differs, follow the
installed package's own types rather than guessing, and say so in your report.

- [ ] **Step 3: Consume the scanned token in `mobile/app/(auth)/home.tsx`**

Add at the top of the component:

```tsx
  const { token: scannedToken } = useLocalSearchParams<{ token?: string }>();

  useEffect(() => {
    if (scannedToken) {
      void submitToken(scannedToken);
      // Clear the param so going back to Home later doesn't re-submit a stale token.
      router.setParams({ token: undefined });
    }
  }, [scannedToken, submitToken]);
```

with `useLocalSearchParams` imported from `expo-router` and `useEffect` from `react`.

- [ ] **Step 4: Verify types and the suite**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: zero type errors, all tests still green.

- [ ] **Step 5: Verify visually (web — the states that web can show)**

Run `npx expo start --web` and confirm: navigating to the scanner from Home shows the
"solo está disponible en la app móvil" message with a working "Volver", and Home still works
after returning. State plainly in your report that the camera path itself was not exercised.

- [ ] **Step 6: Commit**

```bash
git add "mobile/app/(auth)" mobile/app.json
git commit -m "feat(mobile): add QR scanner screen for device linking"
```

---

### Task 7: ADMIN invite generation screen

**Files:**
- Create: `mobile/app/(app)/invitar.tsx`
- Modify: `mobile/app/(app)/_layout.tsx` (register the ADMIN-only tab)

**Interfaces:**
- Consumes: `createInvite` (Task 4), `react-native-qrcode-svg` (Task 3).

No automated tests (a screen) — verified by running the app against a running backend.

- [ ] **Step 1: Create `mobile/app/(app)/invitar.tsx`**

```tsx
import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { SegmentedButtons, Text } from 'react-native-paper';
import QRCode from 'react-native-qrcode-svg';
import { createInvite } from '../../src/services/api/auth';
import { Button } from '../../src/components/ui/Button';
import type { DeviceRole } from '../../src/types/api';

const ROLE_OPTIONS: { value: DeviceRole; label: string }[] = [
  { value: 'INVENTARIO', label: 'Inventario' },
  { value: 'POST_VENTA', label: 'Post-Venta' },
  { value: 'ADMIN', label: 'Admin' },
];

export default function Invitar() {
  const [role, setRole] = useState<DeviceRole>('INVENTARIO');
  const mutation = useMutation({ mutationFn: () => createInvite(role) });

  return (
    <View style={styles.container}>
      <Text variant="headlineSmall">Invitar un dispositivo</Text>

      <SegmentedButtons
        value={role}
        onValueChange={(value) => setRole(value as DeviceRole)}
        buttons={ROLE_OPTIONS}
      />

      <Button loading={mutation.isPending} disabled={mutation.isPending} onPress={() => mutation.mutate()}>
        Generar invitación
      </Button>

      {mutation.isError ? (
        <Text variant="bodyMedium">No se pudo generar la invitación. Inténtalo de nuevo.</Text>
      ) : null}

      {mutation.data ? (
        <View style={styles.result}>
          <QRCode value={mutation.data.inviteToken} size={220} />
          <Text variant="bodySmall" selectable>
            {mutation.data.inviteToken}
          </Text>
          <Text variant="bodySmall">
            Válido hasta {new Date(mutation.data.expiresAt).toLocaleString()} · un solo uso
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  result: { alignItems: 'center', gap: 8 },
});
```

- [ ] **Step 2: Register the tab in `mobile/app/(app)/_layout.tsx`**

Add `'invitar'` to the `ADMIN` entry of `TABS_BY_ROLE` (only that entry), and add the screen
alongside the existing four:

```tsx
      <Tabs.Screen
        name="invitar"
        options={{ href: visibleTabs.includes('invitar') ? undefined : null, title: 'Invitar' }}
      />
```

- [ ] **Step 3: Verify types and the suite**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: zero type errors, all green.

- [ ] **Step 4: Verify visually, end to end**

This is the task that finally closes the loop, so verify the real flow:
1. Start the backend (`cd backend && npm run dev`) against a database with at least one account.
2. Create a bootstrap ADMIN invite: `cd backend && npm run create-invite -- --account <uuid> --role ADMIN`.
3. In the app (`npx expo start --web`), link using that token via manual entry, and confirm you land in the ADMIN tab shell with the "Invitar" tab visible.
4. On the Invitar screen, generate an INVENTARIO invite; confirm the QR renders, the UUID is shown, and the expiry reads ~24h out.
5. Confirm a non-ADMIN role does not see the "Invitar" tab (re-link with an INVENTARIO invite, or set the session's role directly as the earlier sub-project's verification did).

Report exactly what you saw at each step. If the backend can't be started in your environment, say
so plainly and report which steps were therefore not exercised — do not describe steps you did not run.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(app)"
git commit -m "feat(mobile): add ADMIN invite generation screen with QR"
```

---

## Self-Review Notes

- **Spec coverage:** prerequisites (Task 1), backend bootstrap script (Task 2), hardware identity (Task 3), linking state machine with error-code mapping and session construction (Task 4), the five-state Home flow (Task 5), the scanner with its permission states (Task 6), ADMIN invite generation (Task 7). Every section of the spec has a task.
- **Type consistency checked:** `SessionEndReason` (Task 1) is used identically in `session.ts`, `useSessionHydration`, `useRevocationGuard`, and Home's `ENDED_REASON_MESSAGE` map. `LinkDeviceResponse` (Task 4) matches the backend's verified `{ jwt, role, accountId }` — with the deliberate absence of `deviceId`/`status` handled in `confirmName`. `DeviceRole` is the same union throughout.
- **Known verification limit, stated rather than hidden:** the camera scan path (Task 6) cannot be exercised on web, which is this project's only available verification target. Its permission and unsupported-platform states can be; the scan itself is reviewed, not run.
