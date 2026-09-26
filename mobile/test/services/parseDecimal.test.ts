import { parseDecimal } from '../../src/services/parseDecimal';

describe('parseDecimal', () => {
  it('accepts a comma as the decimal separator (Spanish keyboard)', () => {
    expect(parseDecimal('36,50')).toBe(36.5);
  });

  it('accepts a period as the decimal separator', () => {
    expect(parseDecimal('36.50')).toBe(36.5);
  });

  it('accepts a whole number', () => {
    expect(parseDecimal('40')).toBe(40);
  });

  it('accepts a leading minus, since a stock adjustment can be negative', () => {
    expect(parseDecimal('-3')).toBe(-3);
    expect(parseDecimal('-2,5')).toBe(-2.5);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseDecimal('  36,5  ')).toBe(36.5);
  });

  it('returns null, never NaN, for an empty or blank string', () => {
    // Number('') is 0, which is how an empty stock field used to become a
    // real stock of zero.
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
  });

  it('returns null for a bare separator or sign', () => {
    expect(parseDecimal(',')).toBeNull();
    expect(parseDecimal('.')).toBeNull();
    expect(parseDecimal('-')).toBeNull();
  });

  it('returns null for more than one separator rather than guessing a thousands grouping', () => {
    // "1.234,56" is 1234.56 in es-VE and garbage in en-US. Guessing wrong by a
    // factor of a thousand in an exchange rate is not recoverable, so both
    // full-form groupings are refused outright.
    expect(parseDecimal('1.234,56')).toBeNull();
    expect(parseDecimal('1,234.56')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
  });

  it('treats a single separator as decimal, even before exactly three digits', () => {
    // The one ambiguity parsing cannot resolve: "1.234" is 1.234 or 1234
    // depending on locale. The rule is fixed and documented — a single
    // separator is always the decimal one — and the screens show the saved
    // value back, so a thousandfold mistake is visible immediately.
    expect(parseDecimal('1.234')).toBe(1.234);
    expect(parseDecimal('1,234')).toBe(1.234);
  });

  it('returns null for anything that is not a plain decimal', () => {
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('12abc')).toBeNull();
    expect(parseDecimal('1e5')).toBeNull();
    expect(parseDecimal('Infinity')).toBeNull();
    expect(parseDecimal('+5')).toBeNull();
    expect(parseDecimal('5.')).toBeNull();
    expect(parseDecimal('.5')).toBeNull();
  });
});
