// NumberField's arithmetic (spec 0073, AC-7305): reading what someone typed in their language, writing a value back
// the same way, and stepping. Pure and free of React, so the unit project tests it in Node.
import { memoIntl } from '../../lib/intl-memo.ts';

/** `number` plain; `currency` money, two decimals, its symbol in front; `percent` 0 to 100 with "%" after. */
export type NumberFieldMode = 'number' | 'currency' | 'percent';

/** What a typed text reads as: a number, nothing (an empty field), or not a number at all. */
export type ParsedNumber =
  { readonly kind: 'number'; readonly value: number } | { readonly kind: 'empty' } | { readonly kind: 'invalid' };

/** The marks a language writes numbers with: its group mark (1,234), its decimal mark (0.5) and its ten digits. */
interface NumberMarks {
  readonly group: string;
  readonly decimal: string;
  /** Its own digit for each of 0 to 9 ("০" to "৯" in Bengali), where it writes other than Latin digits. */
  readonly digits: readonly string[];
}

function marksOf(locale: string): NumberMarks {
  return memoIntl(`number-marks:${locale}`, () => {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    const plain = new Intl.NumberFormat(locale, { useGrouping: false });
    return {
      group: parts.find((part) => part.type === 'group')?.value ?? ',',
      decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
      digits: Array.from({ length: 10 }, (_, digit) => plain.format(digit)),
    };
  });
}

/** The marks that only set the direction of the text around a number (Arabic and Persian write them before a minus). */
const DIRECTION_MARKS = /[\u200e\u200f\u061c]/gu;

/** Every kind of space a group mark can be written with (French writes a narrow no break space). */
const SPACES = /[\s\u00a0\u202f]/gu;

/** The apostrophes Swiss German groups with: browsers write ’, keyboards type '. */
const APOSTROPHES = /['\u2019]/gu;

/** A group mark, once the language's own is found: a character no one types. */
const GROUP = '\u0001';

/** `text` with the language's own digits written as Latin ones (Latin digits pass through). */
function latinDigits(text: string, digits: readonly string[]): string {
  if (digits[0] === '0') return text;
  return text.replace(/\p{Nd}/gu, (char) => {
    const digit = digits.indexOf(char);
    return digit === -1 ? char : String(digit);
  });
}

/**
 * Whether `text`, holding one point and no decimal mark of a language whose decimal mark isn't a point, reads that
 * point as a decimal point. Where the language groups with a point (German, Spanish, Portuguese, Indonesian, Turkish,
 * Dutch), the point is its group mark when it could be one: one to three digits, then exactly three after it
 * (`1.234` is 1234). Anything a group can't be is a decimal point: one, two, or four or more digits after it (`2.5`,
 * `12.25`, `1.2345`), or nothing, `0`, or more than three digits before it (`.125`, `0.125`, `1234.567`).
 */
function isDecimalPoint(text: string, group: string): boolean {
  const match = /^-?(\d*)\.(\d+)$/u.exec(text);
  if (match === null) return false;
  if (group !== '.') return true;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  return fraction.length !== 3 || whole === '' || whole === '0' || whole.length > 3;
}

/**
 * Reads `text` as a number in `locale`: its own digits are read as digits, its group marks dropped (wherever they sit,
 * so deleting a digit from `1,234` reads as 123), and its decimal mark read as the point. Where the language's decimal mark isn't a point, a text with
 * one point and no decimal mark reads that point as a decimal point (people type `2.5` on any keyboard) unless it
 * could be the language's group mark: in German `2.5`, `12.25` and `1.2345` are decimals but `1.234` is 1234,
 * which is how German writes it. Anything else (letters, two decimal marks, a group mark after the decimal mark) is
 * `invalid`, never a guess.
 */
export function parseNumber(text: string, locale: string): ParsedNumber {
  const { group, decimal, digits } = marksOf(locale);
  const typed = latinDigits(text.replace(DIRECTION_MARKS, '').trim(), digits).replace(/^[−–]/u, '-');
  if (typed === '') return { kind: 'empty' };
  if (decimal !== '.' && !typed.includes(decimal) && isDecimalPoint(typed, group)) return numberFrom(typed);
  const spaced = group.replace(SPACES, '') === '';
  const swiss = /^['\u2019]$/u.test(group);
  const marked = spaced
    ? typed.replace(/[\s\u00a0\u202f]+/gu, GROUP)
    : swiss
      ? typed.replace(APOSTROPHES, GROUP)
      : typed.replace(SPACES, '').split(group).join(GROUP);
  const [whole = '', fraction, ...more] = marked.split(decimal);
  if (more.length > 0 || fraction?.includes(GROUP) === true) return { kind: 'invalid' };
  const plain = whole.replaceAll(GROUP, '') + (fraction === undefined ? '' : `.${fraction}`);
  if (!/^-?(\d+\.?\d*|\.\d+)$/u.test(plain)) return { kind: 'invalid' };
  return numberFrom(plain);
}

/** A number from plain digits and a point; `-0` is 0. */
function numberFrom(plain: string): ParsedNumber {
  const value = Number(plain);
  return Number.isFinite(value) ? { kind: 'number', value: value + 0 } : { kind: 'invalid' };
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

/**
 * `value` rounded to the decimals the field shows for `mode` (money two, a percent one, a plain number what `step`
 * needs), so what is committed is what the person sees: `12.345` typed as money is saved as 12.35. It rounds as the
 * display does, through `Intl` (half away from zero on the shortest decimal the number writes as, which `toFixed`,
 * rounding the exact binary value, does not always match: -35531.95 shows as -35,532.0).
 */
export function roundToShown(
  value: number,
  mode: NumberFieldMode = 'number',
  step = 1,
  maximumFractionDigits?: number,
): number {
  const { maximumFractionDigits: decimals } = fractionsOf(mode, step, maximumFractionDigits);
  const plain = memoIntl(
    `number-round:${String(decimals)}`,
    () => new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: decimals }),
  );
  return Number(plain.format(value)) + 0;
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
