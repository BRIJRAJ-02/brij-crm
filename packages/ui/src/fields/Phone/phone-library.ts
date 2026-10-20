// libphonenumber-js (full metadata) is large, so it loads only when a phone
// field shows: through a dynamic import, which the module system caches, so
// nothing here holds state.
import type * as PhoneLib from 'libphonenumber-js/max';
import type PhoneExampleData from 'libphonenumber-js/mobile/examples';
import { useEffect, useState } from 'react';
import type { PhoneParser } from '../types.ts';

/** The parts of libphonenumber-js the field set uses. */
export type PhoneLibrary = typeof PhoneLib;

/** Loads libphonenumber-js on demand. */
export function loadPhoneLibrary(): Promise<PhoneLibrary> {
  return import('libphonenumber-js/max');
}

/** libphonenumber-js, once loaded; `undefined` until then. */
export function usePhoneLibrary(): PhoneLibrary | undefined {
  const [library, setLibrary] = useState<PhoneLibrary | undefined>(undefined);
  useEffect(() => {
    let isLive = true;
    void loadPhoneLibrary().then((loaded) => {
      if (isLive) setLibrary(loaded);
    });
    return () => {
      isLive = false;
    };
  }, []);
  return library;
}

/** The country numbers without a code are read in: the language's region (en-GB gives GB), else the attribute's default. */
export function defaultCountryFor(locale: string, attributeDefault: string | undefined): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region ?? attributeDefault;
  } catch {
    return attributeDefault;
  }
}

/** A PhoneParser over the loaded library: a valid number in E.164 with its country, or `undefined`. */
export function createPhoneParser(library: PhoneLibrary): PhoneParser {
  return {
    parse: (text, defaultCountry) => {
      const parsed = library.parsePhoneNumberFromString(
        text,
        defaultCountry !== undefined && library.isSupportedCountry(defaultCountry) ? defaultCountry : undefined,
      );
      if (parsed === undefined || !parsed.isValid() || parsed.country === undefined) return undefined;
      return { number: parsed.number, country: parsed.country };
    },
  };
}

/** libphonenumber-js's example numbers (mobile), the placeholder a country's field shows. */
export type PhoneExamples = typeof PhoneExampleData;

/** Loads the example numbers on demand, beside the library, never in the first load. */
export function loadPhoneExamples(): Promise<PhoneExamples> {
  return import('libphonenumber-js/mobile/examples').then((module) => module.default);
}

/** The example numbers, once loaded; `undefined` until then, or when `isWanted` is false (nothing loads). */
export function usePhoneExamples(isWanted: boolean): PhoneExamples | undefined {
  const [examples, setExamples] = useState<PhoneExamples | undefined>(undefined);
  useEffect(() => {
    if (!isWanted) return;
    let isLive = true;
    void loadPhoneExamples().then((loaded) => {
      if (isLive) setExamples(loaded);
    });
    return () => {
      isLive = false;
    };
  }, [isWanted]);
  return examples;
}

/** A country's example number written the national way ("081234 56789" for India), or `undefined`. */
export function examplePhone(
  library: PhoneLibrary | undefined,
  examples: PhoneExamples | undefined,
  country: string,
): string | undefined {
  if (library === undefined || examples === undefined || !library.isSupportedCountry(country)) return undefined;
  return library.getExampleNumber(country, examples)?.formatNational();
}

/** What is wrong with a number typed for a country: too short, too long, not a number there; `undefined` when valid. */
export type PhoneProblem = 'too-short' | 'too-long' | 'invalid';

/** Checks a number typed for a country; `undefined` while the library loads or when the number is valid there. */
export function phoneProblemOf(
  library: PhoneLibrary | undefined,
  text: string,
  country: string,
): PhoneProblem | undefined {
  if (library === undefined || text.trim() === '') return undefined;
  const supported = library.isSupportedCountry(country) ? country : undefined;
  const parsed = library.parsePhoneNumberFromString(text, supported);
  if (parsed?.isValid() === true) return undefined;
  const length = library.validatePhoneNumberLength(text, supported);
  if (length === 'TOO_SHORT') return 'too-short';
  if (length === 'TOO_LONG') return 'too-long';
  return 'invalid';
}
