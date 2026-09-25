import { calculatePriceVes } from '../../src/services/pricing';

describe('calculatePriceVes', () => {
  it('applies the margin and the rate', () => {
    // 2 USD + 50% margin = 3 USD, at 40 Bs/USD = 120 Bs
    expect(calculatePriceVes(2, 50, 40)).toEqual({ ok: true, priceVes: 120 });
  });

  it('rounds to two decimals', () => {
    expect(calculatePriceVes(1.117, 0, 1)).toEqual({ ok: true, priceVes: 1.12 });
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

  it('treats a non-finite cost as missing', () => {
    expect(calculatePriceVes(NaN, 10, 40)).toEqual({ ok: false, missing: 'cost' });
  });
});
