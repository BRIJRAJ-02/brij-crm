// An address pasted as one line ("London, UK", "10 Downing St, London SW1A 2AA,
// United Kingdom", "1 Main St, Austin, TX 78701, USA") read into its parts, so
// the location editor's first line and a grid paste fill the same boxes. A
// best reading, never a refusal: whatever isn't a country, a postcode or a
// city stays in the address lines for people to move. Pure, tested in Node.
import { LocationValue } from '@crm/contracts/values';
import { allCountriesIn } from '../../lib/countries.ts';
import { cleanText } from '../../lib/parse-input.ts';

/** Names people write for a country that its ISO name or code doesn't match. */
const ALIASES: Readonly<Record<string, string>> = {
  uk: 'GB',
  'u.k.': 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  'great britain': 'GB',
  usa: 'US',
  'u.s.a.': 'US',
  'u.s.': 'US',
  'united states of america': 'US',
  america: 'US',
  uae: 'AE',
};

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** The country a written name or code names (UK is GB), or undefined. */
export function countryFromText(text: string, locale: string): string | undefined {
  const wanted = fold(text);
  if (wanted === '') return undefined;
  const alias = ALIASES[wanted];
  if (alias !== undefined) return alias;
  const countries = allCountriesIn(locale);
  const byCode = countries.find((country) => country.code.toLowerCase() === wanted);
  if (byCode !== undefined) return byCode.code;
  const byName = countries.find((country) => fold(country.name) === wanted);
  if (byName !== undefined) return byName.code;
  // English names too, for a pasted address in another language's workspace.
  return locale.startsWith('en') ? undefined : countryFromText(text, 'en');
}

/** A postcode inside a part: a UK one ("SW1A 2AA"), a US ZIP ("78701", "78701-1234") or 4 to 6 digits elsewhere. */
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}|\d{5}-\d{4}|\d{4,6})\b/iu;

/** A part with its postcode taken out: the postcode, and what was beside it ("TX", "London"). */
function takePostcode(part: string): { readonly postcode?: string; readonly rest: string } {
  const match = POSTCODE.exec(part);
  if (match === null || /^\d+\s+\S/u.test(part)) return { rest: part };
  return { postcode: (match[1] ?? '').toUpperCase(), rest: part.replace(match[0], '').replace(/\s+/gu, ' ').trim() };
}

/**
 * The parts of an address written on one line, split on commas and line
 * breaks: the last part a country when it names one, a postcode wherever one
 * stands (beside a city or a region), then the city, an optional region after
 * it, and the address lines before. Undefined for empty text.
 */
export function locationFromText(text: string, locale: string): LocationValue | undefined {
  const parts = cleanText(text)
    .split(/[,\n;]/u)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0) return undefined;
  const last = parts.at(-1) ?? '';
  const countryCode = countryFromText(last, locale);
  const rest = countryCode === undefined ? parts : parts.slice(0, -1);
  let postcode: string | undefined;
  const cleaned = rest
    .map((part, index) => {
      // An address line keeps its own numbers ("10 Downing St"); a postcode sits in a later part.
      if (postcode !== undefined || (index === 0 && rest.length > 1)) return part;
      const taken = takePostcode(part);
      if (taken.postcode !== undefined) postcode = taken.postcode;
      return taken.rest;
    })
    .filter((part) => part !== '');
  let line1: string | undefined;
  let line2: string | undefined;
  let locality: string | undefined;
  let region: string | undefined;
  if (cleaned.length === 1) locality = cleaned[0];
  else if (cleaned.length === 2) {
    const [first = '', second = ''] = cleaned;
    // "10 Downing St, London" is a street and a city; "Austin, TX" a city and its region.
    if (/\d/u.test(first)) [line1, locality] = [first, second];
    else [locality, region] = [first, second];
  } else if (cleaned.length >= 3) {
    const tail = cleaned.at(-1) ?? '';
    // A short last part is a region ("TX", "Bavaria" after a city); otherwise it is the city.
    const hasRegion = tail.length <= 3 || cleaned.length >= 4;
    region = hasRegion ? tail : undefined;
    locality = hasRegion ? cleaned.at(-2) : tail;
    const lines = cleaned.slice(0, hasRegion ? -2 : -1);
    line1 = lines[0];
    line2 = lines.length > 1 ? lines.slice(1).join(', ') : undefined;
  }
  const value = {
    ...(line1 === undefined ? {} : { line1 }),
    ...(line2 === undefined ? {} : { line2 }),
    ...(locality === undefined ? {} : { locality }),
    ...(region === undefined ? {} : { region }),
    ...(postcode === undefined ? {} : { postcode }),
    ...(countryCode === undefined ? {} : { countryCode }),
  };
  if (Object.keys(value).length === 0) return undefined;
  // The schema has the last word (each part's length, the country's code).
  const parsed = LocationValue.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The editor's parts after a pasted address: when the paste names a city or a
 * country it is a whole address, so every part it didn't name is cleared (an
 * old postcode never stays under a new city); a paste that names neither only
 * fills what it found. Pure.
 */
export function withPastedAddress<K extends string>(
  previous: Readonly<Partial<Record<K, string>>>,
  read: Readonly<Partial<Record<K, string>>>,
  parts: readonly K[],
): Partial<Record<K, string>> {
  const isWhole =
    (read as Partial<Record<string, string>>).locality !== undefined ||
    (read as Partial<Record<string, string>>).countryCode !== undefined;
  const next: Partial<Record<K, string>> = isWhole ? {} : { ...previous };
  for (const part of parts) {
    const found = read[part];
    if (found !== undefined) next[part] = found;
  }
  return next;
}
