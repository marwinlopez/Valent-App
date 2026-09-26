/**
 * Parses a decimal as typed on a Spanish keyboard, where the separator is a
 * comma: `Number('36,50')` is `NaN`, and a `NaN` fails every comparison
 * silently — which is how this codebase once approved credit it should have
 * denied.
 *
 * Accepts an optional leading minus, digits, and at most one separator (comma
 * or period) followed by digits. Everything else is `null`, never `NaN`.
 *
 * A single separator is always read as the decimal one, so "1.234" is 1.234,
 * never 1234. That is the one ambiguity parsing cannot resolve; the screens
 * that use this show the saved value back so a thousandfold slip is visible.
 * Two separators ("1.234,56") are refused rather than guessed at.
 */
export function parseDecimal(input: string): number | null {
  const trimmed = input.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}
