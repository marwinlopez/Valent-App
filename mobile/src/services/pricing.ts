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
  // A margin at or below -100% prices at or below zero. The margins endpoint
  // validates min(0) on write, but the column allows it and tenants are
  // provisioned with raw SQL, so the price path refuses it rather than
  // publishing a free or negative product.
  if (marginPct <= -100) {
    return { ok: false, missing: 'margin' };
  }

  // Integer math, not floats: `cost * (1 + margin/100) * rate` destroys the
  // answer before rounding can help. For (0.47, 5%, 10) the float product is
  // 4.934999999999999, so any rounding of it yields 4.93 where the exact
  // answer is 4.94 — about 0.7% of realistic shop configurations land one
  // céntimo low, always downward. toFixed(2) and + Number.EPSILON fail the
  // same cases; the information is already gone by then.
  //
  // Ceiling: inputs are rounded to 1e-4 on the way in, so a cost with more
  // than 4 decimals is truncated. Sheet costs are dollars — that is the right
  // place to stop.
  const c = Math.round(costUsd * 1e4); // cost, 1e-4 USD
  const m = Math.round((100 + marginPct) * 100); // multiplier, 1e-4
  const r = Math.round(bcvRate * 1e4); // rate, 1e-4 Bs/USD
  if (!Number.isFinite(c) || !Number.isFinite(m) || !Number.isFinite(r)) {
    return { ok: false, missing: 'bcvRate' };
  }

  // BigInt, not Number: c * m * r reaches ~1.1e18, past 2^53.
  const cents = (BigInt(c) * BigInt(m) * BigInt(r) + 5_000_000_000n) / 10_000_000_000n;
  const priceVes = Number(cents) / 100;
  if (!Number.isFinite(priceVes)) {
    return { ok: false, missing: 'bcvRate' };
  }
  return { ok: true, priceVes };
}
