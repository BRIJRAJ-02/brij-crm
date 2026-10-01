// Typed numbers, read in the viewer's own format (AC-5, AC-11). Exact decimal
// strings in and out: never through a JS number, which would lose digits.
import { toCanonicalDecimal } from '@crm/contracts/values';

/** The group and decimal signs a language writes numbers with: `,` and `.` in en-US, `.` and `,` in de-DE. */
export function decimalSigns(locale: string): { readonly group: string; readonly decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12_345.6);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

const SPACES = /[\s\u00a0\u202f]/gu;

function escape(sign: string): string {
  return sign.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Reads a typed number in the language's format (`1.234,5` in de-DE is
 * `1234.5`), falling back to the canonical form (`1234.5`) when the text isn't
 * grouped the language's way. Returns the canonical decimal string, or
 * `undefined` when it isn't a number within 15 digits before the point and 4
 * after.
 */
export function parseLocaleDecimal(text: string, locale: string): string | undefined {
  const compact = text.replaceAll(SPACES, '');
  if (compact === '') return undefined;
  const { group, decimal } = decimalSigns(locale);
  const groupSign = group.replaceAll(SPACES, '') === '' ? '' : escape(group);
  const pattern = new RegExp(
    `^([+-]?)(\\d{1,3}(?:${groupSign === '' ? '(?!)' : groupSign}\\d{3})+|\\d+)(?:${escape(decimal)}(\\d+))?$`,
    'u',
  );
  const match = pattern.exec(compact);
  if (match !== null) {
    const [, sign = '', whole = '', fraction] = match;
    const digits = groupSign === '' ? whole : whole.replaceAll(new RegExp(groupSign, 'gu'), '');
    const local = toCanonicalDecimal(`${sign}${digits}${fraction === undefined ? '' : `.${fraction}`}`);
    if (local !== undefined) return local;
  }
  return toCanonicalDecimal(compact);
}
