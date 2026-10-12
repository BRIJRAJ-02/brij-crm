// Exact comparison of canonical decimal strings (`toCanonicalDecimal`), so a
// range rule never loses digits to floating point: 14 digits before the point
// and 4 after is more than a double holds.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** The parts of a decimal, or undefined for anything that isn't one. */
function partsOf(text: string): { negative: boolean; whole: string; fraction: string } | undefined {
  const match = DECIMAL.exec(text.trim());
  if (match === null) return undefined;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  const isZero = /^0$/.test(integer) && decimals === '';
  return { negative: sign === '-' && !isZero, whole: integer, fraction: decimals };
}

function compareMagnitude(a: { whole: string; fraction: string }, b: { whole: string; fraction: string }): number {
  if (a.whole.length !== b.whole.length) return a.whole.length < b.whole.length ? -1 : 1;
  if (a.whole !== b.whole) return a.whole < b.whole ? -1 : 1;
  const width = Math.max(a.fraction.length, b.fraction.length);
  const x = a.fraction.padEnd(width, '0');
  const y = b.fraction.padEnd(width, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * Compares two decimal strings exactly: negative when `a` is smaller, zero
 * when equal, positive when larger. Undefined when either isn't a decimal.
 */
export function compareDecimal(a: string, b: string): number | undefined {
  const x = partsOf(a);
  const y = partsOf(b);
  if (x === undefined || y === undefined) return undefined;
  if (x.negative !== y.negative) return x.negative ? -1 : 1;
  const magnitude = compareMagnitude(x, y);
  return x.negative ? -magnitude : magnitude;
}
