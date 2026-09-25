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
