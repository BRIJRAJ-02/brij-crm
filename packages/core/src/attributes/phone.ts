// The server's one phone parser (spec 0013 names it for text to phone): libphonenumber-js with full metadata, the
// same entry the field set's editor loads in the browser, so a number the editor takes the type change takes too.
// It loads on first use, through a dynamic import the module system caches, so no other request pays for it.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- this is the server's one phone wrapper
import type * as PhoneLib from 'libphonenumber-js/max';
import type { ConvertPhoneParser } from '@crm/contracts/values';

/** libphonenumber-js, loaded on demand. */
async function loadPhoneLibrary(): Promise<typeof PhoneLib> {
  return import('libphonenumber-js/max');
}

/** A parser over libphonenumber-js: a valid number in E.164 with its country, or undefined. */
export async function serverPhoneParser(): Promise<ConvertPhoneParser> {
  const library = await loadPhoneLibrary();
  return {
    parse: (text, defaultCountry) => {
      const country =
        defaultCountry !== undefined && library.isSupportedCountry(defaultCountry) ? defaultCountry : undefined;
      const parsed = library.parsePhoneNumberFromString(text, country);
      if (parsed === undefined || !parsed.isValid() || parsed.country === undefined) return undefined;
      return { number: parsed.number, country: parsed.country };
    },
  };
}
