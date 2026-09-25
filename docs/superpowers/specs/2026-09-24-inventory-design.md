# Inventario — Design Spec

Date: 2026-09-24
Sub-project: 3 of 8
Status: Approved for planning

## Context

Sub-projects 0 (backend), 1 (mobile foundation) and 2 (device linking) are
merged. A linked device now lands in a role-gated tab shell whose `Inventario`
tab is still a placeholder. This sub-project makes it real: list, search,
barcode scanning, product detail with editing, product creation, and stock
adjustment.

It also closes the three items sub-project 2 carried forward, on the same
principle that sub-project applied to sub-project 1's: they are closed before
the new feature is built on top of them.

## The backend as it actually is (read, not assumed)

`backend/src/modules/inventory/routes.ts` today:

- `GET /products?barcode=` — **requires** `barcode`; without it, `422
  MISSING_BARCODE`. There is no list endpoint at all.
- `POST /products` (ADMIN, INVENTARIO) — creates; `409 DUPLICATE_BARCODE` if
  the barcode exists. The duplicate check runs *inside* the `sheetsQueue`
  callback with the write, which is what makes check-then-write atomic.
- `PATCH /products/:barcode/stock` (ADMIN, INVENTARIO, POST_VENTA) — adjusts
  by `delta`; `409 INSUFFICIENT_STOCK` if it would go below zero. No client
  uses it yet.

Every read pulls the whole `Productos` sheet (`getValues` on `Productos!A2:I`)
and does a `findIndex`, so server-side search would be a full sheet read too.

The sheet stores `costUsd` — **not a selling price**. The price in VES is
derived from the cost, the department's margin (`margin_rules` in Postgres)
and the day's rate (`bcv_rates`). Nothing stores it.

## Goals

- An `INVENTARIO` or `ADMIN` device can find a product by scanning or
  searching, see its details and computed price, edit it, adjust its stock,
  and create new products.
- Scanning a code that isn't in the catalog leads straight into creating it,
  with the code pre-filled.
- The price calculation is written once, in a form sub-project 4 (POS) reuses
  unchanged.

## Non-goals

- No department/brand/unit maintenance screens (Configuración, sub-project 7).
- No margin or BCV-rate editing — this sub-project only *reads* them. Setting
  them is Configuración's job.
- No deleting products. The backend has no endpoint and the sheet is the
  system of record; removing rows is out of scope.
- No changing a product's barcode. It is the key used to locate the row;
  changing it is a delete-and-create, which the above excludes.
- No offline queue. The app needs a reachable backend, as elsewhere.

## Prerequisites (carried from sub-project 2, closed first)

1. `mobile/test/services/session.test.ts` — `beforeEach` doesn't reset
   `endedReason`, so under first-reason-wins the test's own
   `signOut('EXPIRED')` is a no-op and its `toBeNull()` assertion proves
   nothing. Reset it, and add the "a second reason does not overwrite the
   first" case — the only thing that actually pins that fix.
2. `mobile/app/index.tsx` maps `CLIENTE_PEDIDOS` to Home, so a device linked
   with that role bounces back to "Vincular dispositivo" with an ACTIVE
   session and no explanation, inviting a second link attempt. Sub-project 6
   owns the real catalog screen; until then Home must *say* what happened —
   "este dispositivo está vinculado como cliente; el catálogo de pedidos aún
   no está disponible" — rather than look unlinked. The session stays valid;
   only the message changes.
3. `signIn()` is non-atomic: `setSession` is synchronous, `saveSession` is
   awaited, so a SecureStore failure leaves the app signed in in memory,
   showing an error, unnavigated, with nothing on disk. Fix: write to disk
   first and only set memory once it lands, so the two can't disagree — a
   failure then leaves the app cleanly signed out with an error, which the
   linking flow already handles as a retry.

## Backend changes

**`GET /products` with no `barcode` returns the whole catalog.** The smallest
change that unblocks the list: keep the `?barcode=` single lookup, drop the
422, and return the parsed rows when the parameter is absent. No `/search?q=`
endpoint — filtering happens on the device (see below).

**`PUT /products/:barcode`** (ADMIN, INVENTARIO) — updates a product's
fields. `barcode` is the key and is not editable. `404 PRODUCT_NOT_FOUND` if
it doesn't exist.

Both follow the project's concurrency rule without exception: the whole
read-modify-write cycle lives **inside one `sheetsQueue.enqueue` callback**,
never split across it. This is the rule three separate bugs in this codebase
have already come from breaking.

## Mobile: catalog and search

The catalog is a few hundred to ~2.000 products, which fits comfortably on
the device. `useProducts()` fetches it once through TanStack Query; the
search field filters the cached array in memory. That means search is
instant as the user types, and the Sheets API (which is quota-limited) sees
one request instead of one per keystroke.

The scan flow resolves against the same cache: a scanned barcode that's in
the catalog opens the detail screen, one that isn't opens creation with the
code pre-filled. The tradeoff is explicit: a product another device created
seconds ago may not be in this device's cache, so the user could start
creating a duplicate — the backend's `409 DUPLICATE_BARCODE` is the backstop,
and the creation screen surfaces it as "ese código ya existe".

## Mobile: screens

- `app/(app)/inventario.tsx` — list, search field, scan button, FAB to
  create.
- `app/(app)/producto/[barcode].tsx` — detail: fields, computed price, edit,
  and stock adjustment.
- `app/(app)/producto/nuevo.tsx` — creation, accepting an optional pre-filled
  barcode.

## Mobile: the scanner, extracted

`app/(auth)/scan.tsx` (sub-project 2) already contains the camera and its
permission state machine — loading, granted, denied-with-`canAskAgain`,
denied-permanently, and web-unsupported — about fifty lines that inventory
would otherwise duplicate.

Extract it to `src/components/BarcodeScanner.tsx` taking an `onScan`
callback, and have each route render it and own its own navigation. Two call
sites today; sub-project 4's POS is the third.

## Mobile: pricing

`src/services/pricing.ts`, a pure function:

```
priceVes(costUsd, marginPct, bcvRate) = costUsd × (1 + marginPct / 100) × bcvRate
```

rounded to two decimals at the boundary, per the project's money rule. Pure
arithmetic, testable without network, and reused unchanged by POS.

**When an input is missing, say so — never invent a price.** If no BCV rate
is set for the day, or the product's department has no margin rule, the
screen shows the cost and states which input is missing. It does not display
a guess, a zero, or `NaN`. (This project has already been bitten once by a
money path where a non-finite input sailed through every comparison and
silently approved credit.)

## Mobile: data layer

Following the `useAuthStatus` pattern established in sub-project 1:

- `useProducts()` — the cached catalog.
- `useBcvRate()`, `useMargins()` — the pricing inputs. `useBcvRate` is one of
  the three hooks the original brief named and sub-project 1 deliberately did
  not build because nothing consumed it; it has a consumer now.
- Mutations for create, update and stock adjustment, each invalidating the
  catalog query on success so the list and detail stay consistent without
  manual plumbing.

## Testing

Pure logic with Jest, as elsewhere in `mobile/`: the pricing function
(including the missing-rate and missing-margin cases), the scan decision
(in catalog → detail, not in catalog → creation), and the hooks with the API
mocked. Screens are verified by running the app.

Backend: Vitest with `pg-mem` and a mocked Sheets client, matching the
existing inventory tests — including a test that the new `PUT` keeps its
read-modify-write inside one queue callback.

## Future work

- [ ] Server-side search, if a catalog ever outgrows the device.
- [ ] Deleting or archiving products — needs a backend endpoint and a
      decision about what it means for past sales referencing the barcode.
- [ ] Changing a barcode (delete-and-create semantics).
