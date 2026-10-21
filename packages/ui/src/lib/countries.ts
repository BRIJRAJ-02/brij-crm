// Countries for the country and phone pickers: each with its flag, its name
// in the reader's language and its dialling code, the search over them (by
// name, ISO code or dial code), the guessed country pinned first, and the
// country a pasted "+CC" number names. Plain functions with no React and no
// DOM, so the library's CountryPicker and PhoneField and the hosted form's
// plain renderer share one behaviour.
import { DIAL_CODES } from '@crm/contracts/forms';
import { COUNTRY_CODES } from '@crm/contracts/values';

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

/**
 * Every country and territory (ISO 3166-1), named in `language` and sorted by
 * that name, for a place rather than a phone (an address's country, a
 * filter's "country is"): those with no dialling code have an empty `dial`.
 */
export function allCountriesIn(language: string): readonly Country[] {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([language], { type: 'region' });
  } catch {
    names = undefined;
  }
  return COUNTRY_CODES.map((code) => ({ code, dial: DIAL_CODES.get(code) ?? '', name: names?.of(code) ?? code })).sort(
    (a, b) => a.name.localeCompare(b.name, language),
  );
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
  // A "+" alone starts a dial code: every country with one, never "No matches" before the digits come.
  if (typed === '+') return country.dial !== '';
  if (/^\d+$/.test(digits)) return country.dial !== '' && country.dial.startsWith(digits);
  return fold(country.name).includes(typed) || country.code.toLowerCase() === typed;
}

/** The countries each named by their own dial code (the United Kingdom for +44, not Guernsey): worked out once per list. */
export function mainCountriesOf(countries: readonly Country[]): ReadonlySet<string> {
  return new Set(
    countries
      .filter((country) => country.dial !== '' && countryOfNumber(`+${country.dial}`) === country.code)
      .map((country) => country.code),
  );
}

/**
 * Where a country goes in a search's list, lower first: 0 when its name
 * starts with what is typed or its ISO code is it, or, for a dial code, when
 * it is the country its own code names (`mainCountriesOf`: the United Kingdom
 * for +44, not Guernsey; the US for +1), so "+44" lists the United Kingdom
 * first; 1 for the rest.
 */
export function countryRank(country: Country, query: string, mains: ReadonlySet<string>): number {
  const typed = fold(query.trim());
  const digits = typed.replace(/^\+/, '');
  if (/^\d+$/.test(digits)) return mains.has(country.code) ? 0 : 1;
  return fold(country.name).startsWith(typed) || country.code.toLowerCase() === typed ? 0 : 1;
}

/** The countries a search keeps, with the pinned one (the visitor's own) first. */
export function searchCountries(countries: readonly Country[], query: string, pinned?: string): readonly Country[] {
  const kept = countries.filter((country) => matchesCountry(country, query));
  const first = kept.find((country) => country.code === pinned);
  return first === undefined ? kept : [first, ...kept.filter((country) => country !== first)];
}

/**
 * The main country of a dial code several countries share, where it isn't the
 * first by ISO code (the order the codes are listed in): +358 is Finland, not
 * Åland, as libphonenumber names them. The others (+44 the United Kingdom,
 * +47 Norway, +61 Australia, +262 Réunion) come first already.
 */
const MAIN_COUNTRY: ReadonlyMap<string, string> = new Map([
  ['1', 'US'],
  ['7', 'RU'],
  ['212', 'MA'],
  ['358', 'FI'],
  ['590', 'GP'],
  ['599', 'CW'],
]);

/**
 * The country a number written with "+" names: the longest dial code it
 * starts with. Several countries share some codes (+1, +7, +44), so the
 * current one is kept when its code fits, and otherwise the code's main
 * country (US for +1, RU for +7, Finland for +358).
 * `undefined` when the text holds no "+" code at all.
 */
export function countryOfNumber(text: string, current?: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('+')) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  for (let length = Math.min(4, digits.length); length > 0; length -= 1) {
    const prefix = digits.slice(0, length);
    if (current !== undefined && DIAL_CODES.get(current) === prefix) return current;
    const fallback = MAIN_COUNTRY.get(prefix);
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
