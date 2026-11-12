// NumberField's arithmetic (spec 0073, AC-7305): reading what someone typed in their language, writing a value back
// the same way, and stepping. Pure and free of React, so the unit project tests it in Node.
import { memoIntl } from '../../lib/intl-memo.ts';

/** `number` plain; `currency` money, two decimals, its symbol in front; `percent` 0 to 100 with "%" after. */
export type NumberFieldMode = 'number' | 'currency' | 'percent';

/** What a typed text reads as: a number, nothing (an empty field), or not a number at all. */
export type ParsedNumber =
  { readonly kind: 'number'; readonly value: number } | { readonly kind: 'empty' } | { readonly kind: 'invalid' };

/** The marks a language writes numbers with: its group mark (1,234) and its decimal mark (0.5). */
function marksOf(locale: string): { readonly group: string; readonly decimal: string } {
  return memoIntl(`number-marks:${locale}`, () => {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    return {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
    };
  });
}

/** Drops every kind of space a group mark can be written with (French writes a narrow no break space). */
function withoutSpaces(text: string): string {
  return text.replace(/[\s\u00a0\u202f]/gu, '');
}

/**
 * Reads `text` as a number in `locale`: its group marks are dropped and its decimal mark read as the point. A plain
 * point is accepted too where the language's decimal mark is a comma and the text has no comma, since people type
 * `2.5` on any keyboard. Anything else (letters, two decimal marks) is `invalid`, never a guess.
 */
export function parseNumber(text: string, locale: string): ParsedNumber {
  const { group, decimal } = marksOf(locale);
  let plain = text.trim().replace(/^[−–]/u, '-');
  if (plain === '') return { kind: 'empty' };
  if (decimal !== '.' && !plain.includes(decimal) && /^-?\d+\.\d+$/u.test(plain)) {
    const value = Number(plain);
    return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
  }
  plain = withoutSpaces(plain)
    .split(withoutSpaces(group) || ' ')
    .join('')
    .split(decimal)
    .join('.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/u.test(plain)) return { kind: 'invalid' };
  const value = Number(plain);
  return Number.isFinite(value) ? { kind: 'number', value } : { kind: 'invalid' };
}

/** How many decimals a mode shows: money two, a percent one at most, a plain number what `step` needs (at least two). */
function fractionsOf(mode: NumberFieldMode, step: number, maximumFractionDigits: number | undefined) {
  if (mode === 'currency') return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (maximumFractionDigits !== undefined) return { minimumFractionDigits: 0, maximumFractionDigits };
  const stepDecimals = decimalsOf(step);
  return { minimumFractionDigits: 0, maximumFractionDigits: Math.max(mode === 'percent' ? 1 : 2, stepDecimals) };
}

/** Writes `value` in `locale` as the field shows it: grouped, with the mode's decimals, and no symbol (that sits outside). */
export function formatNumber(
  value: number,
  locale: string,
  mode: NumberFieldMode = 'number',
  step = 1,
  maximumFractionDigits?: number,
): string {
  const fractions = fractionsOf(mode, step, maximumFractionDigits);
  const key = `number-field:${locale}:${String(fractions.minimumFractionDigits)}:${String(fractions.maximumFractionDigits)}`;
  return memoIntl(key, () => new Intl.NumberFormat(locale, fractions)).format(value);
}

/** The narrow symbol a currency is written with in `locale` ("$", "€", "₹"), or its code when it has none. */
export function currencySymbol(currency: string, locale: string): string {
  const format = memoIntl(
    `currency-symbol:${locale}:${currency}`,
    () => new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }),
  );
  return format.formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency;
}

/** How many decimals a number is written with (0.25 has two), so stepping by it never leaves float dust. */
function decimalsOf(value: number): number {
  const text = String(value);
  const point = text.indexOf('.');
  return point === -1 ? 0 : text.length - point - 1;
}

/** `value` held between `min` and `max`. */
export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `value` moved by `steps` of `step`, rounded to the step's decimals and held inside the limits. */
export function stepNumber(value: number, step: number, steps: number, min: number, max: number): number {
  const decimals = Math.max(decimalsOf(step), decimalsOf(value));
  const moved = Number((value + step * steps).toFixed(decimals));
  return clampNumber(moved, min, max);
}
