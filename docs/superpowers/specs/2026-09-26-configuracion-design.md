# Configuración: tasa BCV y márgenes — Design Spec

Date: 2026-09-26
Sub-project: 5A of 8 (sub-project 5 split in two; 5B is Crédito y Fidelidad)
Status: Approved for planning

## Context

Sub-projects 0–4 are merged to `master`. The `Configuración` tab is still
`<EmptyState title="Configuración" message="Próximamente" />`.

Sub-project 3 stated explicitly that editing margins and the BCV rate was
"Configuración's job", and sub-project 4 made the register **refuse to charge**
without the day's rate and without a margin for the product's department.
Neither editor was ever built. So on `master` today nobody can ring up a single
sale from the app — not because anything is broken, but because the two values
every price depends on have no way in.

That makes this sub-project the one that unblocks live verification, which is
the largest outstanding risk in the whole project: nothing from sub-projects
2, 3 or 4 has ever run against real Postgres, a real Google Sheet, or a real
camera.

## Why sub-project 5 was split

The original pending item read "UI en Configuración sobre los endpoints ya
existentes en el backend". That premise is false. Reading the backend:

- There is **no `loyalty_levels` endpoint at all** — not list, not create, not
  update. The whole "Fidelidad" half has no backend.
- There is **no way to edit a customer**. `loyalty_level_id` can only be set at
  creation, so a customer cannot be promoted and a phone typo cannot be fixed.
- There is **no way to record a payment**. `customers.current_debt_balance` only
  ever increases (a credit sale) and decreases only through the compensation
  path when a Sheets write fails. Debt is write-only: after a few sales every
  customer is permanently maxed out.
- `GET /customers` and `POST /customers` are gated by bare `requireAuth`, so a
  `CLIENTE_PEDIDOS` device can list every customer with their debt balance and
  create customers. Same class of leak as the `GET /products` gate fixed in
  sub-project 3.

Closing those needs a migration, roughly six new endpoints and four more
screens. Bundling that with two screens over already-working endpoints would
produce one long branch and keep live verification blocked until the end. So:

- **5A (this spec):** the BCV rate and margin editors. Two screens, zero new
  backend. Unblocks the register.
- **5B:** loyalty levels, customer editing, and the payments ledger, with all
  the new backend. Decided already and carried into that spec: payments are
  recorded in USD against a new append-only `payments` table, an overpayment is
  rejected with an error naming the amount owed rather than leaving a negative
  balance, and the customer role gates are fixed there.

## The backend as it actually is (read, not assumed)

Both modules are complete and need no changes.

`backend/src/modules/bcv/routes.ts`:
- `GET /bcv-rate?date=` — `requireAuth`. Defaults to today, derived as
  `new Date().toISOString().slice(0, 10)`. **404 `RATE_NOT_FOUND`** when none is
  set.
- `PUT /bcv-rate` — `requireRole(['ADMIN'])`. Body
  `{ rateDate: /^\d{4}-\d{2}-\d{2}$/, rate: number().positive() }`. Upserts on
  `(account_id, rate_date)`, so saving twice is safe.

`backend/src/modules/margins/routes.ts`:
- `GET /margins` — `requireAuth`. Returns `{ id, level, level_name, percentage }`
  ordered by level then name, with `percentage` coerced to a number.
- `POST /margins` — `requireRole(['ADMIN'])`. Body
  `{ level: 'CATEGORIA'|'SUBCATEGORIA'|'DEPARTAMENTO', levelName: string,
  percentage: number().min(0).max(1000) }`. **Upserts** on
  `(account_id, level, level_name)`, so create-or-update is one call.
- `PUT /margins/:id` — `requireRole(['ADMIN'])`. Body `{ percentage }`.
  404 `MARGIN_RULE_NOT_FOUND`.

The mobile side already has the read half: `getBcvRate()` (which returns `null`
on 404, treating a missing rate as an ordinary state) and `getMargins()` in
`mobile/src/services/api/config.ts`, consumed by `usePricingInputs()`.

Because `POST /margins` upserts, this sub-project does not need
`PUT /margins/:id` at all — one endpoint covers both creating a department's
margin and changing it. `PUT` stays unused.

## Goals

- An ADMIN can set today's BCV rate and see what is currently set.
- An ADMIN can see which departments in the catalog have a margin and which do
  not, and set one.
- After this sub-project, a real sale can be rung up end to end.

## Non-goals

- **No backdating the rate.** `PUT /bcv-rate` takes any `rateDate`, but nothing
  needs a past day's rate: the register uses today's, and the audit compares
  against today's. Today only, until something needs otherwise.
- **No `CATEGORIA` or `SUBCATEGORIA` rules.** See below — nothing can match them.
- **No deleting margin rules or rates.** There is no endpoint, and deleting a
  margin makes every product in that department unsellable.
- **No fetching the rate automatically from the BCV.** That is a scraper against
  a third-party site, with its own failure modes and its own sub-project.
- No loyalty levels, customer editing or payments — that is 5B.
- No editing departments, brands or units. The products sheet is the system of
  record for those (sub-project 3 excluded it too).

## Navigation

`mobile/app/(app)/configuracion.tsx` becomes the directory
`mobile/app/(app)/configuracion/` with its own `_layout.tsx` holding a Stack —
the same shape as `producto/`, except that this one *is* a visible tab. The
existing `<Tabs.Screen name="configuracion">` entry in `app/(app)/_layout.tsx`
keeps working unchanged, because a tab whose route is a directory resolves to
that directory's layout.

- `configuracion/index.tsx` — a menu. Two entries now; 5B and sub-project 7 add
  theirs beside them.
- `configuracion/tasa.tsx` — the day's rate.
- `configuracion/margenes.tsx` — margins by department.

## The margins screen is not a generic CRUD

This is the one real design decision here.

`marginFor(department)` in `usePricingInputs` matches the margin rule's
`level_name` against the product row's `department` column by **exact string**.
A rule typed by hand with a typo, a different accent, or trailing whitespace
matches nothing. The symptom the user meets is the register refusing to price a
product, with no indication of why — and the cause is three screens away.

So the screen does not take free text. It lists **the departments that actually
exist in the catalog** — derived from `useProducts()`, which is already cached —
and shows, for each, whether it has a margin and what it is. The question it
answers is "which departments can I sell", not "manage my rules". A department
with no margin is the interesting row, and it is visible without hunting.

Consequence, accepted: a department with no products in the sheet cannot be
configured here. That is fine — a margin matching no products is dead
configuration, and the moment a product lands in that department the row
appears.

Only `DEPARTAMENTO` rules are created. The endpoint accepts the other two
levels, but a product row carries a department and nothing else that a rule
could key on, so offering them would let an ADMIN create configuration that
silently does nothing. Existing `CATEGORIA`/`SUBCATEGORIA` rules, if a tenant
was provisioned with any by raw SQL, are **shown as read-only with a note that
nothing matches them** rather than hidden — hiding them would make an
unexplained percentage in the database invisible.

## The decimal separator is a money bug waiting to happen

On a Spanish keyboard the rate is typed `36,50`, and `Number('36,50')` is `NaN`.
That `NaN` would travel straight into `PUT /bcv-rate` (where zod rejects it, so
the failure is at least loud) — but the same input feeds the UI's own validation
first, and `NaN` fails every comparison silently, which is precisely how this
codebase once approved credit it should have denied.

So: a pure `parseDecimal(input: string): number | null` in
`mobile/src/services/` that accepts a comma or a period as the decimal
separator, rejects anything else, and returns `null` rather than `NaN` for
input it cannot parse. It is the only real logic in this sub-project and it gets
unit tests, including the comma case, an empty string, a bare separator,
multiple separators, and a value with surrounding whitespace.

Both screens validate before sending:

- **Rate:** must parse, be finite, and be **greater than zero**. `calculatePriceVes`
  refuses `bcvRate <= 0` (a zero rate would price a whole cart at 0 Bs while the
  USD totals stayed correct — added as a guard in sub-project 4), and
  `PUT /bcv-rate` requires `positive()`. The UI refuses it too, with a reason.
  Three layers, deliberately.
- **Percentage:** must parse and be finite, and within the backend's
  `0 … 1000`. Zero is allowed and means selling at cost. Negative is not: the
  column would accept it and `calculatePriceVes` refuses anything at or below
  −100%, but the backend's own `min(0)` is the contract, so the UI matches it.

## Which "today" the rate is written for

`PUT /bcv-rate` requires a `rateDate`; it does not default one. `GET /bcv-rate`
derives today as `new Date().toISOString().slice(0, 10)` — **UTC**. The sale
audit in sub-project 4 derives it the same way.

If the app computed the date in local time, then from 20:00 to midnight in
Caracas (UTC−4) the two would disagree: at 21:00 on the 26th local it is 01:00
on the 27th UTC, so the ADMIN would save a rate for the 26th while the register
asked for the 27th and reported that no rate was set. For four hours every
evening, the rate written and the rate read would be different rows.

So the app sends `rateDate` computed with **the identical expression**, not a
local-time equivalent, and the rule is stated in a comment at the call site so
nobody "fixes" it to local time. The screen labels the rate with the date it
was saved for, so the ADMIN can see which day it applies to.

The consequence — that "today's rate" rolls over at 20:00 Caracas rather than
at midnight — is pre-existing, consistent between every writer and reader, and
already recorded in the sub-project 4 ledger. Moving the whole system to a
local business date touches the backend's date derivation everywhere,
including the sale audit, and is out of scope here. What this sub-project must
not do is introduce a *second* definition of "today".

## Error handling

Both screens distinguish the four states this project has already been bitten
by conflating — loading, request failure, "configured and here it is", and "not
configured yet":

- **Loading:** a `Skeleton`, as elsewhere.
- **Request failed:** says so and offers a retry. Never reported as "not
  configured" — that is the exact misdiagnosis fixed on the register in
  sub-project 4, where a failed `GET /bcv-rate` told a cashier on a flaky
  connection to go set a rate that already existed.
- **No rate set:** an ordinary state, said plainly, with the input ready.
- **Save failed:** the backend's error surfaced by code, not a generic message.
  A non-ADMIN device reaching either screen gets 403 from the backend; the tab
  is already ADMIN-only via `TABS_BY_ROLE`, so this is the second layer.

On a successful save, the relevant query is invalidated so the register and the
product screens see the new value without a manual refresh — the same reason
`useSale` invalidates the catalog.

## Data layer

Following the established pattern (`useProductMutations`, which pairs each
mutation with the query key it invalidates):

- `putBcvRate(rateDate, rate)` and `upsertMargin(level, levelName, percentage)`
  added to `mobile/src/services/api/config.ts`, beside the existing getters.
- `useSetBcvRate()` invalidating `['bcv-rate']`, and `useSaveMargin()`
  invalidating `['margins']`, in `mobile/src/hooks/`.

Business logic stays out of `app/`, per the project rule.

## Testing

- `parseDecimal` — Jest, pure, as described above.
- The two mutations — hook tests following `mobile/test/hooks/useProductMutations.test.tsx`:
  invalidation on success, no invalidation on failure.
- Screens are verified by running the app (`npx expo start --web` from the
  worktree, with Bash — not the preview tool, which resolves against the main
  checkout).
- Run jest with `--forceExit`: this project has a pre-existing teardown leak
  where a plain `npx jest` finishes the run and then never exits.

No backend tests, because no backend code changes.

## Definition of done

Beyond the suites: a rate and at least one department margin entered through
these screens, and a sale rung up on the register against them. That single run
is also what would first surface the four live-verification risks listed under
sub-project 4 in `CLAUDE.md` — chief among them whether a real camera scan adds
exactly one unit.

## Future work

- [ ] Backdating or correcting a past day's rate, if reconciliation ever needs it.
- [ ] A rate history view (the table keeps every day; nothing reads more than today).
- [ ] Fetching the BCV rate automatically.
- [ ] `CATEGORIA`/`SUBCATEGORIA` margins, which first need the product rows to
      carry a category at all.
