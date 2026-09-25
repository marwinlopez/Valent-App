# POS / PostVenta — Design Spec

Date: 2026-09-25
Sub-project: 4 of 8
Status: Approved for planning

## Context

Sub-projects 0–2 are merged to `master`; sub-project 3 (Inventario) is
complete on the `inventory` branch with an open PR. **This sub-project
branches off `inventory`, not `master`**, because it builds directly on that
work: `calculatePriceVes`, `useProducts()`, the `BarcodeScanner` component,
and the product/stock endpoints.

A `POST_VENTA` device currently lands in a tab shell whose PostVenta tab is
still a placeholder. This sub-project makes it a working point of sale:
scan or search to build a cart, pick a customer, choose a payment method,
and charge — with stock decremented as part of the same operation.

## The backend as it actually is (read, not assumed)

`POST /sales` (ADMIN, POST_VENTA) accepts
`{ customerId?, items[{barcode, name, quantity, unitPriceUsd}], totalUsd,
totalVes, paymentMethod, bcvRateUsed }` and appends one row to the `Ventas`
sheet.

- Payment methods: `EFECTIVO_USD`, `EFECTIVO_VES`, `PAGO_MOVIL`,
  `PUNTO_DE_VENTA`, `CREDITO`.
- For `CREDITO` it re-validates credit server-side inside a Postgres
  transaction with `SELECT ... FOR UPDATE` on the customer row, then commits
  the debt increase **before** appending to Sheets, compensating if the
  append fails. That ordering is deliberate and documented in the route.
- **It does not touch stock**, and it **trusts the client's totals** — it
  records `totalUsd`/`totalVes`/`bcvRateUsed` exactly as sent.

`GET /customers/:id/credit-check?amount=` returns
`{ approved, availableCredit, reason }` for a live pre-check.

## Goals

- Build a cart by scanning or searching the cached catalog, charge it with
  any of the five payment methods, and have stock reflect the sale.
- Never quote a price the system can't compute, and never charge a number
  different from the one the customer was shown.
- Make a credit sale fail *before* the customer is told a total, not after.

## Non-goals

- **No offline mode.** The catalog, the credit check and the sale all
  require the server, as everywhere else in this system. With no connection
  the POS says so and refuses to charge. Offline queueing would need its own
  sub-project: credit can't be validated without the server, two
  disconnected registers can oversell the same stock, and the BCV rate goes
  stale.
- No returns, refunds, or voiding a recorded sale — there is no backend
  endpoint and no spec for what either means for stock and for a credit
  balance.
- No receipt printing or sharing.
- No cash-drawer/shift accounting (opening float, Z-report). Not requested.
- No discounts or price overrides at the register. Prices derive from cost,
  margin and rate; an override would need its own audit story.
- **Not making `POST /sales` idempotent.** See Error handling — it's
  recorded as the follow-up this sub-project deliberately doesn't take on.

## Backend: the sale and the stock decrement become one unit

`POST /sales` gains stock decrementing, inside **one**
`sheetsQueue.enqueue` callback that does the whole read-decide-write cycle:

1. Reject the request if the same barcode appears in more than one line
   (`422 DUPLICATE_LINE`). The cart never produces this — a re-scan
   increments the existing line — but `items` is a trust boundary, and
   decrementing one row twice in a single callback would compute the second
   write from stock the first write already superseded.
2. Read the product rows for every barcode in `items`.
3. Fail the whole sale if any line is unknown (`404 PRODUCT_NOT_FOUND`) or
   short (`409 INSUFFICIENT_STOCK`, naming the product) — **before any
   write**.
4. Append the sale row.
5. Write back each product row with its decremented stock.

Splitting any of that across the queue boundary would reintroduce the exact
race this codebase has already fixed three times. The existing
`writeProductRow` guard (which refuses to write a row containing a
non-finite number) covers the decremented writes too.

**The sale row is appended before the stock writes, deliberately.** If a
write fails partway, this order leaves a recorded sale with stock not fully
decremented — inventory reads high, which a physical count surfaces, and the
revenue is on the books. The reverse order would leave stock decremented
with no sale recorded: inventory shrinks and the money is missing from the
ledger, which nothing surfaces. Same reasoning as the credit ordering this
route already documents — fail toward the discoverable side.

The credit transaction is unchanged and still runs before the Sheets work.

### Total auditing, without a second pricing implementation

The client's totals remain authoritative — that is what the customer was
shown and agreed to, and recomputing authoritatively would mean a rate
change between quote and charge silently charging a different amount.

The backend already reads every product to decrement stock, so it also
computes an expected total and **logs a warning when the client's differs**,
including the sale id and both figures. Concretely: for each line, ordinary
float arithmetic over the product's `costUsd`, its department's margin, the
day's rate and the line quantity; summed; compared against `totalVes`. It
warns when the absolute difference exceeds `0.01 × <number of lines>`, so
accumulated per-line rounding doesn't raise false alarms.

Deliberately approximate: the backend is auditing, not adjudicating, so it
does not need to agree to the last unit — which is exactly why plain floats
are adequate here. Copying `calculatePriceVes` into the backend would create
a second source of truth that can drift silently, the failure this project
already avoided by keeping one `DEVICE_ROLES`.

If a line's margin or the rate is missing server-side, the audit is skipped
for that sale rather than warning — the backend can't form an expectation,
and a warning that fires on every sale in an unconfigured account is noise
that trains people to ignore the real ones.

## Mobile: the register

`app/(app)/post-venta.tsx`, with cart state in `src/hooks/useCart.ts` so the
screen stays a renderer.

- **Adding a line:** scan (reusing `BarcodeScanner`) or search the cached
  catalog (reusing `filterProducts`). Scanning a product already in the cart
  increments its quantity rather than adding a second line.
- **A line** shows the product, an adjustable quantity, and a unit price from
  `calculatePriceVes` — the same function the inventory screens use.
- **Totals** in USD and in VES.
- **Customer:** optional, and **required for `CREDITO`** (the backend returns
  `422 CUSTOMER_REQUIRED` without one).
- **Payment method:** the five the backend accepts.
- **Live credit check:** selecting `CREDITO` calls
  `GET /customers/:id/credit-check?amount=<current total>` and shows whether
  there's room. Without room, that method is blocked and another must be
  chosen. This is so nobody waits at the counter for a rejection — the
  backend's own re-validation at charge time remains the real defense.

## Error handling

- **A product whose price can't be computed cannot be added to the cart.**
  If the day's BCV rate is missing, or the product's department has no margin
  rule, adding it is refused with the reason. Same "say what's missing, never
  invent" rule as Inventario, applied earlier — before a cart is built that
  can't be charged.
- **With no BCV rate, the POS refuses to charge at all** and says so at the
  top. No rate means no bolívar price.
- **Insufficient stock** at charge time: the backend names the product, the
  whole sale is rejected with nothing written, and the cart stays intact so
  the quantity can be corrected.
- **Credit denied:** show the backend's `reason`, not a generic failure.
- **A sale whose outcome is unknown** (the request went out, the response
  didn't come back): `POST /sales` is **not idempotent**, so a retry could
  record the sale twice and decrement stock twice. The POS therefore **does
  not retry automatically**. It says the result is unknown and directs the
  user to verify in the Dashboard before charging again — the honest answer.
  Making `POST /sales` idempotent (same shape as the `requestId` ledger the
  stock endpoint now uses) is the recorded follow-up; this sub-project
  already reshapes that endpoint substantially and doing both at once would
  make the change hard to review.

## Testing

Mobile, pure logic with Jest as elsewhere: `useCart` (add, re-add an existing
product, change quantity, remove, totals in both currencies, refusing a
product with no computable price) and the error-code mapping. Screens are
verified by running the app.

Backend, Vitest with `pg-mem` and a mocked Sheets client: that the sale
append and every stock write happen in one queue callback (mirroring the
existing `PUT` test), that a single short line aborts the whole sale **with
nothing written**, that credit still blocks above the limit, and that the
audit logs a discrepancy when the client's total differs.

## Future work

- [ ] Idempotency for `POST /sales` (a `requestId` ledger like the stock
      endpoint's), so a lost response can be retried safely.
- [ ] Returns / refunds / voiding a sale, including what each means for
      stock and for a credit balance.
- [ ] Offline sales queue — its own sub-project, with the credit, stock and
      stale-rate problems named above.
- [ ] Receipts.
