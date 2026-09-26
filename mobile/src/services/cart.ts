import { calculatePriceVes } from './pricing';
import type { Product } from '../types/api';

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface PricedLine extends CartLine {
  unitPriceUsd: number;
  lineTotalVes: number;
}

export type PricedCart =
  | { ok: true; lines: PricedLine[]; totalUsd: number; totalVes: number }
  | { ok: false; missing: 'cost' | 'margin' | 'bcvRate' };

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Prices a whole cart, or reports the one input that makes it impossible.
 *
 * All-or-nothing on purpose: a cart where one line can't be priced has no
 * honest total, and showing a partial sum invites charging it.
 *
 * USD is the source of truth; bolivars are derived from it, not priced
 * independently. Everything durable in this system is already USD (the cost
 * in the sheet, `loyalty_levels.credit_limit`, `customers.current_debt_balance`),
 * and `totalUsd` is what the credit check tests and what becomes the
 * customer's debt -- a bolivar figure computed separately from the same cost
 * is a second, independently-rounded answer to the same question, and a USD
 * cent is a 36.5x coarser quantum than a Bs céntimo, so on sub-dollar items
 * (most of a bodega's catalog) the two answers can diverge by ~2%.
 *
 * Consequence worth noting: the sum of the per-line bolivar figures below can
 * differ from `totalVes` by a few céntimos, because each is rounded
 * independently from its own USD basis (the line's own USD subtotal, the
 * cart's own USD total). At 36+ Bs/USD a céntimo is far below the smallest
 * coin in circulation. What must hold exactly -- and is what the backend's
 * internal-consistency check (routes.ts's `auditInternalConsistency`) pins --
 * is `totalVes === round2(totalUsd * bcvRate)`.
 */
export function priceCart(
  lines: CartLine[],
  marginFor: (department: string) => number | null,
  bcvRate: number | null
): PricedCart {
  // bcvRate is cart-wide, not per-line, and (now that bolivars derive from
  // USD) only needed to convert the finished USD total -- so it's validated
  // once, up front, by reusing calculatePriceVes's own non-finite/<=0 rate
  // checks (cost 0 and margin 0 never trip on their own) instead of
  // duplicating that logic here. The null check runs first, and separately,
  // because it's what narrows `bcvRate` from `number | null` to `number`
  // below -- calculatePriceVes's own return type doesn't carry that
  // narrowing back to its argument.
  if (bcvRate === null) {
    return { ok: false, missing: 'bcvRate' };
  }
  const rateCheck = calculatePriceVes(0, 0, bcvRate);
  if (!rateCheck.ok) {
    return { ok: false, missing: rateCheck.missing };
  }
  const rate = bcvRate;

  const usdLines: Array<{ line: CartLine; unitPriceUsd: number; lineTotalUsd: number }> = [];
  let totalUsd = 0;

  for (const line of lines) {
    const marginPct = marginFor(line.product.department);
    // The unit price is priced in USD at a rate of 1 -- the same BigInt
    // integer path as before, so no float multiply enters a per-unit price.
    const unitUsd = calculatePriceVes(line.product.costUsd, marginPct, 1);
    if (!unitUsd.ok) {
      return { ok: false, missing: unitUsd.missing };
    }

    const unitPriceUsd = unitUsd.priceVes;
    const lineTotalUsd = round2(unitPriceUsd * line.quantity);
    usdLines.push({ line, unitPriceUsd, lineTotalUsd });
    totalUsd = round2(totalUsd + lineTotalUsd);
  }

  const priced: PricedLine[] = usdLines.map(({ line, unitPriceUsd, lineTotalUsd }) => ({
    ...line,
    unitPriceUsd,
    lineTotalVes: round2(lineTotalUsd * rate),
  }));
  const totalVes = round2(totalUsd * rate);

  return { ok: true, lines: priced, totalUsd, totalVes };
}
