# Auth + Device Linking — Design Spec

Date: 2026-09-20
Sub-project: 2 of 8 (see [Roadmap](#roadmap) below)
Status: Approved for planning

## Context

Sub-project 0 (backend) and sub-project 1 (mobile foundation) are both merged
to `master`. The mobile app currently has a working session store, secure
storage, typed API client, TanStack Query hooks, and a role-gated navigation
shell — but `Home` is still a placeholder and **nothing in the app can
actually create a session**. This sub-project builds the real device-linking
flow: a new device scans (or types) an invite token, names itself, and
receives a JWT; and an ADMIN device can generate those invite tokens as QR
codes.

This is also the first sub-project that persists a session, which makes
several gaps that sub-project 1's final review deliberately parked become
reachable. Closing them is a prerequisite here, not optional cleanup.

## Roadmap

0. Backend API — done, merged
1. Mobile Foundation — done, merged
2. **Auth + device linking** (this spec)
3. Inventory (list, barcode scanner, product detail/new product)
4. POS / PostVenta (checkout, payment methods, live credit validation)
5. Credit & Loyalty (UI in Configuración over existing backend endpoints)
6. QR client linking (self-service catalog/orders for `CLIENTE_PEDIDOS`)
7. Dashboard y Configuración

## The backend contract (verified against the merged code, not assumed)

`POST /auth/link-device` — unauthenticated.
Body: `{ inviteToken: <uuid>, hardwareId: string, deviceName: string }`.
Success: `{ jwt, role, accountId }` — **note it does not return `deviceId`
or `status`**.
Errors: `422 INVALID_INVITE_TOKEN` (unknown, already used, or expired),
`403 DEVICE_REVOKED` (this hardware was revoked and may not re-link),
`403 DEVICE_LIMIT_REACHED` (account is at its `device_limit`).

`POST /devices/invite` — ADMIN only.
Body: `{ role }`. Success: `{ inviteToken, role, expiresAt }` (24h expiry,
single use).

The role is carried by the invite token and is never chosen by the linking
client — that was the fix for a role self-escalation vulnerability found in
the backend's final review, and the mobile app must not reintroduce a way to
pick a role at link time.

## Goals

- A new device can link itself by scanning an ADMIN-generated QR code, with
  manual entry as a fallback.
- The device is named something a human can tell apart in the ADMIN's device
  list.
- Every backend error code is surfaced as a specific, actionable message —
  not a generic failure.
- An ADMIN can generate an invite from inside the app, so the flow is
  testable end to end without hand-written SQL.
- The first ADMIN device of a brand-new account can be bootstrapped through a
  repeatable backend script rather than ad-hoc SQL against production.

## Non-goals (this sub-project)

- No `CLIENTE_PEDIDOS` self-service QR flow — that's sub-project 6. This
  sub-project's QR is for linking *staff devices* via invite tokens.
- No device-management UI (list, rename, revoke). `PATCH /devices/:id` and
  `GET /devices` exist in the backend but their UI belongs to Configuración
  (sub-project 7).
- No listing or cancelling of outstanding invite tokens — the backend has no
  endpoint for it (a known backend follow-up in the root `CLAUDE.md`).
- No self-service company sign-up. Account provisioning stays a manual
  backend step.

## Prerequisites (parked items from sub-project 1, closed here)

These were parked as non-blocking *because nothing persisted a session yet*.
This sub-project makes them reachable, so they are closed first:

1. `mobile/src/services/api/client.ts` — the 401 path's `await signOut()` is
   unguarded, so a rejecting `SecureStore.deleteItemAsync` replaces the
   `ApiRequestError` with a raw storage error for the one status code callers
   most need to recognize. Guard it.
2. `mobile/src/services/api/client.ts` — `readJsonBody` swallows every parse
   failure on a success response, so `apiFetch<T>` can resolve to `null`
   while its signature promises `T`. Restrict the null path to genuine
   204/empty bodies.
3. A stored non-ACTIVE session currently has no cleanup path: `app/index.tsx`
   redirects it to Home before `(app)/` mounts, and `useRevocationGuard`
   lives only under `(app)/`. Fix so a persisted `PENDING`/`REVOKED` session
   is cleaned up (or surfaced) rather than sitting in encrypted storage
   forever.
4. `useRevocationGuard` neither adopts nor *detects* an `accountId` change on
   refresh. Since query keys carry no tenant id, a device whose `/auth/me`
   reports a different `accountId` than the stored session must sign out
   rather than silently mixing tenants.

## Backend: invite bootstrap script

`backend/` gains `npm run create-invite -- --account <uuid> --role <ROLE>`,
which inserts an `invite_tokens` row (same 24h expiry and single-use
semantics as the endpoint) and prints the UUID. This solves the bootstrap
problem: the first ADMIN device of an account cannot receive an invite from
anyone, because no ADMIN exists yet to create one.

The script is ops tooling, not an endpoint — nothing unauthenticated is
added to the API surface.

## Mobile: device identity

New module `mobile/src/services/device/hardwareId.ts` exporting
`getHardwareId(): Promise<string>`:

- **Android**: `Application.getAndroidId()`
- **iOS**: `Application.getIosIdForVendorAsync()`
- **Web** (development-only target, per sub-project 1's recorded decision): a
  generated UUID held in the existing in-memory store, since browsers expose
  no hardware identifier. This keeps the flow testable on web without
  pretending the value is meaningful.

`deviceName` is pre-filled from `Device.deviceName ?? Device.modelName` and
remains editable before confirmation, so an ADMIN doesn't end up with three
identical "Pixel 8" entries.

## Mobile: linking flow

`app/(auth)/home.tsx` becomes a five-state flow. All logic lives in
`mobile/src/hooks/useDeviceLinking.ts`; the screens stay declarative.

1. **Initial** — "Escanear código QR" (primary) and "Ingresar código
   manualmente" (secondary). If the previously stored session was `REVOKED`,
   an explanatory notice appears here too — otherwise the user has no way to
   learn why the device stopped working.
2. **Scanning** — `app/(auth)/scan.tsx` using `expo-camera`. A denied camera
   permission falls through to an explanatory state with a button to open
   system settings and a link to manual entry, rather than a black screen.
3. **Manual entry** — a text field validated against the UUID format before
   submitting. The backend returns 422 anyway, but validating locally avoids
   a round trip and a vaguer message.
4. **Confirm name** — shows the role carried by the invite (read-only) and
   the pre-filled, editable `deviceName`.
5. **Error** — mapped by the backend's error `code`, not by HTTP status:
   `INVALID_INVITE_TOKEN` → the code is invalid, already used, or expired;
   `DEVICE_LIMIT_REACHED` → this account is at its device limit;
   `DEVICE_REVOKED` → this device was revoked, contact the administrator.
   Each returns to the initial state with the message visible.

On success the app builds the `Session` from the response's `jwt`, `role`,
and `accountId`, takes `deviceId` from the existing `readDeviceIdFromJwt`
helper (the endpoint doesn't return it), and sets `status: 'ACTIVE'`
(link-device always leaves the device active — it is the one status the
endpoint's success path guarantees). It persists via the existing
`signIn()`, and sub-project 1's route gate handles navigation.

## Mobile: ADMIN invite generation

`app/(app)/invitar.tsx`, visible only to ADMIN via the existing role-gated
tab shell (sub-project 7 will relocate it inside Configuración): pick a role,
call `POST /devices/invite`, render the returned token as a QR
(`react-native-qrcode-svg` + `react-native-svg`) with the UUID shown below as
selectable text and a countdown to `expiresAt`. A button generates another.

## Testing

Same strategy as sub-project 1 — Jest (`jest-expo`) over pure logic only, no
component-rendering tests; visual verification by running the app. Covered:
`getHardwareId`'s platform branching, `useDeviceLinking`'s state machine and
error-code mapping, the `Session` construction (including `deviceId` from the
JWT and the `status: 'ACTIVE'` default), and each prerequisite fix. The
backend script gets a test against `pg-mem` like the rest of `backend/`.

Camera scanning and QR rendering are verified by running the app, not by
unit tests.

## Future work

- [ ] Device management UI (list/rename/revoke) — sub-project 7.
- [ ] Listing/cancelling outstanding invites — needs a backend endpoint
      first (already tracked as backend debt).
- [ ] `PENDING` device approval flow — the backend models the status but
      `link-device` always writes `ACTIVE`, so no UI can reach it today.
