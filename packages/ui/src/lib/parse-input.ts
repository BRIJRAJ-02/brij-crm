// Forgiving input, one reader for every field (the field polish pass, 30 Oct
// 2026): what people paste from a spreadsheet, an email signature or a chat
// ("$1,200", "1.2k", "(300)", "Ada <ada@x.com>", "mailto:…", "tomorrow", a
// comma list) reads the same in an editor, a grid paste and an import, because
// each editor and each type's `fromText` call these. Pure, tested in Node.
import { CURRENCY_CODES, toCanonicalDecimal } from '@crm/contracts/values';
import { CURRENCY_SYMBOLS, codeOfSymbol } from '../fields/Currency/symbols.ts';
import { decimalSigns, parseLocaleDecimal } from './decimal.ts';
import { parseDateText } from './parse-date-text.ts';

const CODES: ReadonlySet<string> = new Set<string>(CURRENCY_CODES);

/** Quotes a pasted value may come wrapped in: straight, curly and guillemets. */
const QUOTES: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
];

/**
 * Pasted text made plain: zero width marks gone, non breaking and narrow
 * spaces as plain spaces, runs of spaces as one, trimmed, and one pair of
 * wrapping quotes taken off.
 */
export function cleanText(text: string): string {
  const plain = text
    .replaceAll(/[\u200b-\u200d\u2060\ufeff]/gu, '')
    .replaceAll(/[\u00a0\u202f\u2007]/gu, ' ')
    .replaceAll(/[ \t]+/gu, ' ')
    .trim();
  const pair = QUOTES.find(([open, close]) => plain.length >= 2 && plain.startsWith(open) && plain.endsWith(close));
  return pair === undefined ? plain : plain.slice(1, -1).trim();
}

/** An amount as typed or pasted, read: its canonical decimal, the currency it named, and whether it had a "%". */
export interface ParsedAmount {
  /** The canonical decimal ("1200", "-300", "0.5"). */
  readonly amount: string;
  /** The ISO code a symbol or code in the text named ("$" is USD, or the default dollar). */
  readonly currency?: string;
  /** It ended with "%": a percent number keeps the number as typed (12% is 12). */
  readonly isPercent: boolean;
}

/** How far each suffix moves the point: thousands, millions, billions. */
const SUFFIXES: Readonly<Record<string, number>> = { k: 3, m: 6, mm: 6, mn: 6, b: 9, bn: 9 };

/** A canonical decimal times 10^places, exactly (string digits, never a float). */
function shift(decimal: string, places: number): string | undefined {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = (negative ? decimal.slice(1) : decimal).split('.');
  const padded = fraction.padEnd(places, '0');
  const moved = `${whole}${padded.slice(0, places)}${padded.length > places ? `.${padded.slice(places)}` : ''}`;
  return toCanonicalDecimal(`${negative ? '-' : ''}${moved}`);
}

/** Takes a currency symbol or a three letter code off either end of the text. */
function takeCurrency(
  text: string,
  defaultCurrency: string | undefined,
): { readonly rest: string; readonly currency?: string } {
  for (const symbol of CURRENCY_SYMBOLS) {
    const code = codeOfSymbol(symbol, defaultCurrency);
    if (code === undefined) continue;
    if (text.startsWith(symbol)) return { rest: text.slice(symbol.length).trim(), currency: code };
    if (text.endsWith(symbol)) return { rest: text.slice(0, -symbol.length).trim(), currency: code };
  }
  const leading = /^([a-z]{3})\s*(.*)$/iu.exec(text);
  if (leading !== null && CODES.has((leading[1] ?? '').toUpperCase())) {
    return { rest: leading[2] ?? '', currency: (leading[1] ?? '').toUpperCase() };
  }
  const trailing = /^(.*?)\s*([a-z]{3})$/iu.exec(text);
  if (trailing !== null && CODES.has((trailing[2] ?? '').toUpperCase())) {
    return { rest: trailing[1] ?? '', currency: (trailing[2] ?? '').toUpperCase() };
  }
  return { rest: text };
}

/**
 * Reads an amount the way people write one: "$1,200", "€5", "1.234,5 €" (in
 * German), "1,200 USD", "USD 1200", "1.2k", "2M", "3bn", "(300)" and "-$300"
 * (both minus), "12%". A symbol or code names the currency ("$" takes the
 * default when that is a dollar). Returns undefined for anything that isn't an
 * amount within 14 digits before the point and 4 after.
 */
export function parseAmount(
  text: string,
  options: { readonly locale: string; readonly defaultCurrency?: string | undefined },
): ParsedAmount | undefined {
  // A typographic minus reads as one.
  let rest = cleanText(text).replaceAll('\u2212', '-');
  if (rest === '') return undefined;
  let negative = false;
  const bracketed = /^\((.*)\)$/u.exec(rest);
  if (bracketed !== null) {
    negative = true;
    rest = (bracketed[1] ?? '').trim();
  }
  const takeSign = () => {
    const sign = /^([+-])\s*/u.exec(rest);
    if (sign === null) return;
    if (sign[1] === '-') negative = !negative;
    rest = rest.slice(sign[0].length);
  };
  takeSign();
  const isPercent = rest.endsWith('%');
  if (isPercent) rest = rest.slice(0, -1).trim();
  const taken = takeCurrency(rest, options.defaultCurrency);
  rest = taken.rest;
  takeSign();
  const suffix = /^(.*?)\s*(k|mm|mn|m|bn|b)$/iu.exec(rest);
  const places = suffix === null ? 0 : (SUFFIXES[(suffix[2] ?? '').toLowerCase()] ?? 0);
  const digits = suffix === null ? rest : (suffix[1] ?? '');
  if (!/\d/u.test(digits)) return undefined;
  const base = parseLocaleDecimal(digits, options.locale) ?? parseLooseDecimal(digits, places);
  if (base === undefined) return undefined;
  const scaled = places === 0 ? base : shift(base, places);
  if (scaled === undefined) return undefined;
  const amount = negative && scaled !== '0' ? (scaled.startsWith('-') ? scaled.slice(1) : `-${scaled}`) : scaled;
  return { amount, isPercent, ...(taken.currency === undefined ? {} : { currency: taken.currency }) };
}

/** "1.23456k" has more decimals than a value holds, but fewer once shifted: read it as plain digits for the shift. */
function parseLooseDecimal(digits: string, places: number): string | undefined {
  if (places === 0) return undefined;
  const match = /^(\d+)(?:[.,](\d+))?$/u.exec(digits.replaceAll(' ', ''));
  if (match === null) return undefined;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > places + 4) return undefined;
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/** The two ways an ambiguous number reads: the sign as the point (1.2) and as a thousands mark (1,200), canonical. */
export interface AmbiguousAmount {
  readonly asDecimal: string;
  readonly asGrouped: string;
}

/**
 * Whether pasted text could mean two numbers: its only separator is the
 * language's decimal sign, with exactly three digits after it and a whole part
 * that isn't 0 ("1.200" in US English is 1.2 here but 1,200 in Germany; "1,200"
 * in German the other way round). A suffix ("1.200k") or a whole part of 0
 * ("0.125") reads one way only. Undefined when it reads one way.
 */
export function ambiguousAmount(text: string, locale: string): AmbiguousAmount | undefined {
  const plain = cleanText(text);
  if (/\d\s*(?:k|mm|mn|m|bn|b)$/iu.test(plain)) return undefined;
  const cores = plain.match(/\d[\d.,'\s]*\d|\d/gu) ?? [];
  if (cores.length !== 1) return undefined;
  const { decimal } = decimalSigns(locale);
  const [whole, fraction, ...rest] = cores.join('').split(decimal);
  if (rest.length > 0 || whole === undefined || fraction === undefined) return undefined;
  if (!/^\d+$/u.test(whole) || !/^\d{3}$/u.test(fraction) || /^0+$/u.test(whole)) return undefined;
  const asDecimal = toCanonicalDecimal(`${whole}.${fraction}`);
  const asGrouped = toCanonicalDecimal(`${whole}${fraction}`);
  return asDecimal === undefined || asGrouped === undefined ? undefined : { asDecimal, asGrouped };
}

/**
 * Whether typed text saves as a number whose digits differ from the ones typed:
 * "1.2k" saves as 1200 and "1.200" (US English) as 1.2, while "$1,200" is 1200
 * as typed. An editor says what it saves as only then, never repeating the text.
 */
export function readsDifferently(text: string, amount: string): boolean {
  const digits = (value: string) => value.replaceAll(/\D/gu, '').replace(/^0+/u, '');
  return digits(text) !== digits(amount);
}

/**
 * A canonical decimal as text that reads back one way in any language: one with
 * exactly three decimals gains a trailing 0 ("1.234" is written "1.2340"), so a
 * copied cell pastes back as itself, never refused as ambiguous nor read as 1,234.
 */
export function unambiguousDecimal(decimal: string): string {
  return /\.\d{3}$/u.test(decimal) ? `${decimal}0` : decimal;
}

/**
 * An email address as pasted from anywhere: "mailto:ada@x.com?subject=Hi",
 * "Ada Lovelace <ada@x.com>", "<ada@x.com>.", "ada@x.com," all read as
 * "ada@x.com". The schema still decides whether it is one.
 */
export function cleanEmail(text: string): string {
  let email = cleanText(text);
  const angled = /<([^<>]+)>/u.exec(email);
  if (angled !== null) email = angled[1] ?? '';
  email = email.replace(/^mailto:/iu, '');
  email = email.replace(/\?.*$/u, '');
  email = email.replace(/^[<([{'"\s]+/u, '').replace(/[>)\]}.,;:!'"\s]+$/u, '');
  return email.trim();
}

/**
 * Pasted text for a list attribute, as its values: split on commas,
 * semicolons, tabs and line breaks, each cleaned, the empty ones dropped.
 * `onSpaces` splits on spaces too, for types whose values never hold one
 * (emails, domains, links), so "a@x.com b@x.com" is two; a phone keeps them.
 * A comma inside angle brackets or quotes ("Lovelace, Ada" <ada@x.com>) never splits.
 */
export function splitPasted(text: string, options: { readonly onSpaces?: boolean } = {}): readonly string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  const separator = options.onSpaces === true ? /[,;\t\n\r ]/u : /[,;\t\n\r]/u;
  for (const character of text) {
    if (character === '"') quoted = !quoted;
    if (character === '<') depth += 1;
    if (character === '>') depth = Math.max(0, depth - 1);
    if (depth === 0 && !quoted && separator.test(character)) {
      parts.push(current);
      current = '';
    } else current += character;
  }
  parts.push(current);
  return parts.map(cleanText).filter((part) => part !== '');
}

/** Whether pasted text holds more than one value for a list ("a@x.com, b@x.com"). */
export function isPastedList(text: string, options: { readonly onSpaces?: boolean } = {}): boolean {
  return splitPasted(text, options).length > 1;
}

/** What a typed or pasted day is read against. */
export interface DateInputContext {
  readonly locale: string;
  /** Today, `YYYY-MM-DD`, in the reader's time zone. Without it only a whole date is read, never "tomorrow". */
  readonly today?: string | undefined;
  readonly firstDayOfWeek?: number;
}

/**
 * A day as typed or pasted, `YYYY-MM-DD`, or undefined: words and short forms
 * through `parseDateText` ("tomorrow", "next fri", "in 2 weeks", "Oct 8",
 * "8 October 2026", "8/10"), an ISO instant's day ("2026-10-08T09:00:00Z"),
 * and the language's numeric order. Without `today`, only a date that names
 * its year.
 */
export function parseDateInput(text: string, context: DateInputContext): string | undefined {
  const input = cleanText(text).replace(/[.,]$/u, '');
  if (input === '') return undefined;
  const instant = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}/u.exec(input);
  const day = instant?.[1] ?? input;
  const today = context.today;
  if (today !== undefined) {
    return parseDateText(day, {
      today,
      locale: context.locale,
      ...(context.firstDayOfWeek === undefined ? {} : { firstDayOfWeek: context.firstDayOfWeek }),
    });
  }
  // No today: only a date that says its year. A year far from any real today keeps "Oct 8" from guessing one.
  const found = parseDateText(day, { today: '1000-01-01', locale: context.locale });
  return found === undefined || found.startsWith('1000-') ? undefined : found;
}
