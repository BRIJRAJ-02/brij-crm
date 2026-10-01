// libphonenumber-js (full metadata) is large, so it loads only when a phone
// field shows: through a dynamic import, which the module system caches, so
// nothing here holds state.
import type * as PhoneLib from 'libphonenumber-js/max';
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
