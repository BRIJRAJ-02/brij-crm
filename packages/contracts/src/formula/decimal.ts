// Exact decimal arithmetic for formulas (spec 0015, 0015-formulas.md): numbers
// and amounts are `bigint`s scaled by 10^12, so `0.1 + 0.2` is `0.3`. Plain
// TypeScript, the same in the browser and on the server.

/** Fraction digits kept inside the evaluator. */
export const SCALE_DIGITS = 12;
/** 10^12, the scale every formula number carries. */
export const SCALE = 10n ** BigInt(SCALE_DIGITS);
/** The largest stored magnitude: 14 digits before the point (`DECIMAL_LIMITS`), scaled. */
const STORED_LIMIT = 10n ** 14n * SCALE;

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** A decimal string (`"12.5"`, `"-0.25"`) as a scaled bigint, or undefined when it isn't one. */
export function parseDecimal(text: string): bigint | undefined {
  const match = DECIMAL.exec(text.trim());
  if (match === null) return undefined;
  const [, sign = '', whole = '0', fraction = ''] = match;
  const kept = fraction.slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, '0');
  const magnitude = BigInt(whole) * SCALE + BigInt(kept);
  return sign === '-' ? -magnitude : magnitude;
}

/** `a * b`, both scaled, truncated to 12 places. */
export function multiply(a: bigint, b: bigint): bigint {
  return (a * b) / SCALE;
}

/** `a / b`, both scaled, kept to 12 places (truncated); undefined when `b` is zero. */
export function divide(a: bigint, b: bigint): bigint | undefined {
  if (b === 0n) return undefined;
  return (a * SCALE) / b;
}

/** Rounds a scaled value to `digits` places (0 to 12), half away from zero, still scaled. */
export function roundTo(value: bigint, digits: number): bigint {
  const step = 10n ** BigInt(SCALE_DIGITS - digits);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = ((magnitude + step / 2n) / step) * step;
  return negative ? -rounded : rounded;
}

/** True when a scaled value fits the stored decimals (14 digits before the point). */
export function fitsStored(value: bigint): boolean {
  return value < STORED_LIMIT && value > -STORED_LIMIT;
}

/** A scaled value as the canonical decimal text: no trailing fraction zeros, `0` for zero. */
export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / SCALE;
  const fraction = (magnitude % SCALE).toString().padStart(SCALE_DIGITS, '0').replace(/0+$/, '');
  if (whole === 0n && fraction === '') return '0';
  return `${negative ? '-' : ''}${whole.toString()}${fraction === '' ? '' : `.${fraction}`}`;
}

/** A whole number of days from a scaled value, or undefined when it has a fraction. */
export function wholeOf(value: bigint): number | undefined {
  if (value % SCALE !== 0n) return undefined;
  return Number(value / SCALE);
}

/** A JavaScript integer as a scaled value. */
export function fromInteger(value: number): bigint {
  return BigInt(value) * SCALE;
}
