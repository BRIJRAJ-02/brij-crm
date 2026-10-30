// The country and currency a workspace starts from when an attribute names
// none: the workspace's own once it has them (FormatScope), else the
// language's region (en-GB is GB and GBP, en-IN is IN and INR), else the US.
// Pure, tested in Node.

/** The euro's countries (2026), so one line covers them. */
const EURO: readonly string[] = [
  'AT',
  'BE',
  'CY',
  'DE',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'SI',
  'SK',
  'AD',
  'MC',
  'SM',
  'VA',
  'ME',
  'XK',
  'BG',
];

/** Each other region's currency, for the regions a CRM's people mostly write from. Any other falls back to the US dollar. */
const CURRENCIES: Readonly<Record<string, string>> = {
  US: 'USD',
  GB: 'GBP',
  IN: 'INR',
  CA: 'CAD',
  AU: 'AUD',
  NZ: 'NZD',
  JP: 'JPY',
  CN: 'CNY',
  HK: 'HKD',
  SG: 'SGD',
  CH: 'CHF',
  SE: 'SEK',
  NO: 'NOK',
  DK: 'DKK',
  PL: 'PLN',
  CZ: 'CZK',
  HU: 'HUF',
  RO: 'RON',
  TR: 'TRY',
  IL: 'ILS',
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  EG: 'EGP',
  ZA: 'ZAR',
  NG: 'NGN',
  KE: 'KES',
  BR: 'BRL',
  MX: 'MXN',
  AR: 'ARS',
  CL: 'CLP',
  CO: 'COP',
  PE: 'PEN',
  KR: 'KRW',
  TW: 'TWD',
  TH: 'THB',
  MY: 'MYR',
  ID: 'IDR',
  PH: 'PHP',
  VN: 'VND',
  PK: 'PKR',
  BD: 'BDT',
  LK: 'LKR',
  NP: 'NPR',
  UA: 'UAH',
  IS: 'ISK',
  MA: 'MAD',
};

/** The region a language names, maximised ("en" is US, "de" is DE), or undefined for one Intl can't read. */
export function countryOfLocale(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined;
  }
}

/** A country's currency (GB is GBP, DE is EUR), or undefined for one the table doesn't hold. */
export function currencyOfCountry(country: string | undefined): string | undefined {
  if (country === undefined) return undefined;
  const code = country.toUpperCase();
  return EURO.includes(code) ? 'EUR' : CURRENCIES[code];
}

/** The workspace's country and currency, each the given one, else the language's region's, else the US's. */
export function regionDefaults(
  locale: string,
  given: { readonly country?: string | undefined; readonly currency?: string | undefined } = {},
): { readonly country: string; readonly currency: string } {
  const country = given.country ?? countryOfLocale(locale) ?? 'US';
  return { country, currency: given.currency ?? currencyOfCountry(country) ?? 'USD' };
}
