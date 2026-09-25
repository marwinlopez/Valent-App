import { calculatePriceVes } from '../../src/services/pricing';

describe('calculatePriceVes', () => {
  it('applies the margin and the rate', () => {
    // 2 USD + 50% margin = 3 USD, at 40 Bs/USD = 120 Bs
    expect(calculatePriceVes(2, 50, 40)).toEqual({ ok: true, priceVes: 120 });
  });

  it('rounds to two decimals', () => {
    expect(calculatePriceVes(1.117, 0, 1)).toEqual({ ok: true, priceVes: 1.12 });
  });

  it('rounds a half-cent up instead of down (float arithmetic got this wrong)', () => {
    // 0.47 * 1.05 * 10 is exactly 4.935; the float product is 4.934999999999999.
    expect(calculatePriceVes(0.47, 5, 10)).toEqual({ ok: true, priceVes: 4.94 });
  });

  it('refuses a margin at or below -100% instead of pricing at or below zero', () => {
    expect(calculatePriceVes(10, -100, 40)).toEqual({ ok: false, missing: 'margin' });
    expect(calculatePriceVes(10, -150, 40)).toEqual({ ok: false, missing: 'margin' });
  });

  it('handles a zero margin', () => {
    expect(calculatePriceVes(3, 0, 10)).toEqual({ ok: true, priceVes: 30 });
  });

  it.each([
    ['bcvRate', 5, 10, null],
    ['margin', 5, null, 40],
  ] as const)('reports %s as missing rather than guessing', (missing, cost, margin, rate) => {
    expect(calculatePriceVes(cost, margin, rate)).toEqual({ ok: false, missing });
  });

  it.each([NaN, Infinity])('treats a non-finite rate (%p) as missing, never producing NaN', (rate) => {
    expect(calculatePriceVes(5, 10, rate)).toEqual({ ok: false, missing: 'bcvRate' });
  });

  it('refuses a rate at or below zero instead of pricing the cart free', () => {
    expect(calculatePriceVes(5, 10, 0)).toEqual({ ok: false, missing: 'bcvRate' });
    expect(calculatePriceVes(5, 10, -40)).toEqual({ ok: false, missing: 'bcvRate' });
  });

  it('treats a non-finite cost as missing', () => {
    expect(calculatePriceVes(NaN, 10, 40)).toEqual({ ok: false, missing: 'cost' });
  });

  it('reports a non-finite result (from a corrupted magnitude) as a missing rate rather than returning Infinity', () => {
    expect(calculatePriceVes(1e308, 0, 10)).toEqual({ ok: false, missing: 'bcvRate' });
  });
});
