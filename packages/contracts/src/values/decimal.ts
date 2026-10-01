import * as z from 'zod';

/** Digits allowed before the point, and after it, in any stored number or amount. */
export const DECIMAL_LIMITS = { integerDigits: 15, fractionDigits: 4 } as const;

const DECIMAL_INPUT = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * The one canonical form of a decimal string: no `+` sign, no extra leading
 * zeros, no trailing fraction zeros, and `0` for minus zero, so equal numbers
 * compare equal (`"0012.50"` becomes `"12.5"`). Returns `undefined` when the
 * text is not a plain decimal, or has more than 15 digits before the point or
 * 4 after it once canonical.
 */
export function toCanonicalDecimal(input: string): string | undefined {
  const match = DECIMAL_INPUT.exec(input.trim());
  if (match === null) return undefined;
  const [, sign = '', whole = '', fraction = ''] = match;
  const integer = whole.replace(/^0+(?=\d)/, '');
  const decimals = fraction.replace(/0+$/, '');
  if (integer.length > DECIMAL_LIMITS.integerDigits || decimals.length > DECIMAL_LIMITS.fractionDigits)
    return undefined;
  const isZero = integer === '0' && decimals === '';
  const negative = sign === '-' && !isZero ? '-' : '';
  return decimals === '' ? `${negative}${integer}` : `${negative}${integer}.${decimals}`;
}

/**
 * An exact decimal, stored as a string so nothing is lost to floating point:
 * up to 15 digits before the point and 4 after (`^-?\d{1,15}(\.\d{1,4})?$`).
 * Parsing turns any plain decimal text into its canonical form.
 */
export const Decimal = z.string().transform((input, ctx) => {
  const canonical = toCanonicalDecimal(input);
  if (canonical === undefined) {
    ctx.issues.push({
      code: 'custom',
      input,
      message: 'Enter a number with up to 15 digits before the point and 4 after it, such as 1234.5.',
    });
    return z.NEVER;
  }
  return canonical;
});
export type Decimal = z.infer<typeof Decimal>;
