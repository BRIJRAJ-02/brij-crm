// The first install's guesses (spec 0068, foolproof from the first click; walk of 4 Nov 2026): a new workspace has no
// country or currency yet and keeps its zone at UTC, so the business card starts from the browser instead: its
// region, that region's currency, and its zone. Pure, so the guesses are tested; the person can change each one.

import type { PlaceHours } from '@crm/data';

/** Lunch and dinner, each a named service window, Tuesday to Sunday: a restaurant's usual week, and Monday off. */
const SERVICES = [
  { from: '12:00', to: '15:00', name: 'Lunch' },
  { from: '18:00', to: '22:00', name: 'Dinner' },
] as const;

/**
 * A new place's first opening hours (spec 0068, foolproof: reservations and the menu work from the first click),
 * lunch 12:00 to 15:00 and dinner 18:00 to 22:00, Tuesday to Sunday. The person changes them under Business.
 */
export const FIRST_HOURS: PlaceHours = {
  weekly: Object.fromEntries(
    (['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => [day, SERVICES.map((range) => ({ ...range }))]),
  ),
  exceptions: [],
};

/** The currency most places in a region price in, for the regions Timefix sells to first; others start empty. */
const CURRENCY_OF: Readonly<Record<string, string>> = {
  GB: 'GBP',
  US: 'USD',
  IN: 'INR',
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  SG: 'SGD',
  AU: 'AUD',
  NZ: 'NZD',
  CA: 'CAD',
  CH: 'CHF',
  JP: 'JPY',
  HK: 'HKD',
  ZA: 'ZAR',
  ...Object.fromEntries(
    [
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
    ].map((country) => [country, 'EUR']),
  ),
};

/** The region of a language tag (`en-GB` → `GB`), or undefined when it names none. */
export function regionOf(language: string | undefined): string | undefined {
  if (language === undefined) return undefined;
  try {
    const region = new Intl.Locale(language).maximize().region;
    return region !== undefined && /^[A-Z]{2}$/.test(region) ? region : undefined;
  } catch {
    return undefined;
  }
}

/** What the card starts from: the workspace's own settings first, else the browser's guesses. */
export function firstBusinessGuess(
  workspace:
    { readonly country?: string | null; readonly currency?: string | null; readonly timeZone?: string } | undefined,
  browser: { readonly language: string | undefined; readonly timeZone: string | undefined },
): { readonly country: string | null; readonly currency: string | null; readonly timeZone: string } {
  const country = workspace?.country ?? regionOf(browser.language) ?? null;
  const currency = workspace?.currency ?? (country === null ? undefined : CURRENCY_OF[country]) ?? null;
  const zone = workspace?.timeZone;
  return {
    country,
    currency,
    timeZone: zone !== undefined && zone !== 'UTC' ? zone : (browser.timeZone ?? zone ?? 'UTC'),
  };
}
