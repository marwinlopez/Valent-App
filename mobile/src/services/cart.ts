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
 */
export function priceCart(
  lines: CartLine[],
  marginFor: (department: string) => number | null,
  bcvRate: number | null
): PricedCart {
  const priced: PricedLine[] = [];
  let totalUsd = 0;
  let totalVes = 0;

  for (const line of lines) {
    const marginPct = marginFor(line.product.department);
    const unitVes = calculatePriceVes(line.product.costUsd, marginPct, bcvRate);
    if (!unitVes.ok) {
      return { ok: false, missing: unitVes.missing };
    }

    // The USD sell price is the same computation at a rate of 1 Bs/USD.
    // Reusing `calculatePriceVes` keeps ONE rounding technique for both
    // currencies. A float `cost * (1 + margin/100)` here would drift a
    // centimo below the bolivar price on exactly the configurations the
    // integer math was written for — cost 0.15 at 50% gives 0.22 by float and
    // 0.23 exactly — and `totalUsd` is what the credit check compares against
    // the limit and what lands in the customer's debt balance.
    const unitUsd = calculatePriceVes(line.product.costUsd, marginPct, 1);
    if (!unitUsd.ok) {
      return { ok: false, missing: unitUsd.missing };
    }

    const unitPriceUsd = unitUsd.priceVes;
    const lineTotalVes = round2(unitVes.priceVes * line.quantity);

    priced.push({ ...line, unitPriceUsd, lineTotalVes });
    totalUsd = round2(totalUsd + unitPriceUsd * line.quantity);
    totalVes = round2(totalVes + lineTotalVes);
  }

  return { ok: true, lines: priced, totalUsd, totalVes };
}
