// Countries for the country and phone pickers: each with its flag, its name
// in the reader's language and its dialling code, the search over them (by
// name, ISO code or dial code), the guessed country pinned first, and the
// country a pasted "+CC" number names. Plain functions with no React and no
// DOM, so the library's CountryPicker and PhoneField and the hosted form's
// plain renderer share one behaviour.
import { DIAL_CODES } from '@crm/contracts/forms';

/** One country as the pickers show it. */
export interface Country {
  /** ISO 3166-1 alpha 2 ("IN"). */
  readonly code: string;
  /** Its name in the reader's language ("India"). */
  readonly name: string;
  /** Its dialling code, digits only ("91"). */
  readonly dial: string;
}

/** A country's flag from its two letters, as the two regional indicator symbols that draw it. */
export function flagOf(code: string): string {
  const upper = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(0x1f1e6 + upper.charCodeAt(0) - 65, 0x1f1e6 + upper.charCodeAt(1) - 65);
}

/** Every country with a dialling code, named in `language` and sorted by that name. */
export function countriesIn(language: string): readonly Country[] {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([language], { type: 'region' });
  } catch {
    names = undefined;
  }
  return [...DIAL_CODES.entries()]
    .map(([code, dial]) => ({ code, dial, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, language));
}

/** Lower case with the accents taken off, so "cote" finds Côte d'Ivoire. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Whether a country answers a search: its name holds it, its ISO code is it, or its dial code starts with it. */
export function matchesCountry(country: Country, query: string): boolean {
  const typed = fold(query.trim());
  if (typed === '') return true;
  const digits = typed.replace(/^\+/, '');
  if (/^\d+$/.test(digits)) return country.dial.startsWith(digits);
  return fold(country.name).includes(typed) || country.code.toLowerCase() === typed;
}

/** The countries a search keeps, with the pinned one (the visitor's own) first. */
export function searchCountries(countries: readonly Country[], query: string, pinned?: string): readonly Country[] {
  const kept = countries.filter((country) => matchesCountry(country, query));
  const first = kept.find((country) => country.code === pinned);
  return first === undefined ? kept : [first, ...kept.filter((country) => country !== first)];
}

/**
 * The country a number written with "+" names: the longest dial code it
 * starts with. Several countries share +1 and +7, so the current one is kept
 * when its code fits, and otherwise the first listed (US for +1, RU for +7).
 * `undefined` when the text holds no "+" code at all.
 */
export function countryOfNumber(text: string, current?: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('+')) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  for (let length = Math.min(4, digits.length); length > 0; length -= 1) {
    const prefix = digits.slice(0, length);
    if (current !== undefined && DIAL_CODES.get(current) === prefix) return current;
    const fallback = prefix === '1' ? 'US' : prefix === '7' ? 'RU' : undefined;
    if (fallback !== undefined) return fallback;
    for (const [code, dial] of DIAL_CODES) if (dial === prefix) return code;
  }
  return undefined;
}

/** The national part of a number written with its "+" code, once the code is known. */
export function withoutDialCode(text: string, country: string): string {
  const dial = DIAL_CODES.get(country) ?? '';
  const trimmed = text.trim();
  if (!trimmed.startsWith('+')) return text;
  const rest = trimmed.slice(1).trimStart();
  return rest.startsWith(dial) ? rest.slice(dial.length).trimStart() : rest;
}
