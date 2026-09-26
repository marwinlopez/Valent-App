import { priceCart } from '../../src/services/cart';
import type { Product } from '../../src/types/api';

const leche: Product = {
  barcode: '123', name: 'Leche', brand: 'X', department: 'Lacteos',
  unit: 'unidad', costUsd: 2, stock: 10,
};
const arroz: Product = {
  barcode: '456', name: 'Arroz', brand: 'Y', department: 'Granos',
  unit: 'kg', costUsd: 1, stock: 50,
};

const marginFor = (department: string) => (department === 'Lacteos' ? 50 : 0);

describe('priceCart', () => {
  it('prices each line and totals in both currencies', () => {
    // Leche: 2 USD + 50% = 3 USD each, x2 = 6 USD -> 240 Bs at 40
    const result = priceCart([{ product: leche, quantity: 2 }], marginFor, 40);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalUsd).toBe(6);
    expect(result.totalVes).toBe(240);
    expect(result.lines[0].unitPriceUsd).toBe(3);
    expect(result.lines[0].lineTotalVes).toBe(240);
  });

  it('sums several lines', () => {
    // Leche 6 USD + Arroz 1 USD (0% margin) = 7 USD -> 280 Bs
    const result = priceCart(
      [{ product: leche, quantity: 2 }, { product: arroz, quantity: 1 }],
      marginFor,
      40
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalUsd).toBe(7);
    expect(result.totalVes).toBe(280);
  });

  it('prices in USD with the same integer math as the bolivar price', () => {
    // cost 0.15 at 50% is exactly 0.225 -> 0.23. A float `0.15 * 1.5` gives
    // 0.22499999999999998, which rounds to 0.22 — a centimo short, downward,
    // on the figure the credit check and the debt balance are measured in.
    const cheap: Product = { ...leche, barcode: '789', costUsd: 0.15 };
    const result = priceCart([{ product: cheap, quantity: 1 }], () => 50, 40);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].unitPriceUsd).toBe(0.23);
    expect(result.totalUsd).toBe(0.23);
  });

  it('derives totalVes from totalUsd exactly, per line and per unit rounding independently', () => {
    // The register used to show "98.52 Bs (2.76 USD)" for this exact
    // configuration -- but 98.52 / 36.5 = 2.70, not 2.76: totalVes was being
    // summed from independently-rounded per-unit bolivar prices instead of
    // derived from totalUsd. Values below verified independently with
    // node -e (not by running this test and copying its output):
    //   unitPriceUsd = 0.23 (BigInt path, cost 0.15 @ 50%)
    //   totalUsd = round2(0.23 * 12) = 2.76
    //   totalVes = round2(2.76 * 36.5) = 100.74, not the old 98.52
    const cheap: Product = { ...leche, barcode: '789', costUsd: 0.15 };
    const result = priceCart([{ product: cheap, quantity: 12 }], () => 50, 36.5);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalUsd).toBe(2.76);
    expect(result.totalVes).toBe(100.74);
  });

  it('keeps totalVes === round2(totalUsd * bcvRate) exactly, the invariant the backend cross-checks', () => {
    // Verified independently with node -e: totalUsd = 9, totalVes = 328.5.
    const result = priceCart(
      [{ product: leche, quantity: 2 }, { product: arroz, quantity: 3 }],
      marginFor,
      36.5
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalUsd).toBe(9);
    expect(result.totalVes).toBe(328.5);
    expect(result.totalVes).toBe(Math.round(result.totalUsd * 36.5 * 100) / 100);
  });

  it('reports a bad bcvRate (<=0) as missing, not silently converted', () => {
    const result = priceCart([{ product: leche, quantity: 1 }], marginFor, 0);
    expect(result).toEqual({ ok: false, missing: 'bcvRate' });
  });

  it('reports the missing input rather than pricing part of the cart', () => {
    const result = priceCart([{ product: leche, quantity: 1 }], marginFor, null);
    expect(result).toEqual({ ok: false, missing: 'bcvRate' });
  });

  it('reports a department with no margin rule', () => {
    const result = priceCart([{ product: leche, quantity: 1 }], () => null, 40);
    expect(result).toEqual({ ok: false, missing: 'margin' });
  });

  it('totals an empty cart as zero', () => {
    const result = priceCart([], marginFor, 40);
    expect(result).toEqual({ ok: true, lines: [], totalUsd: 0, totalVes: 0 });
  });
});
