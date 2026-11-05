// The business page's own words (spec 0066, B4 lite) beside the library's: the kind of business in words.
import type { PublicBusinessPage } from '@crm/data/business-page';

export const businessStrings = {
  poweredByNewTab: 'Powered by Timefix (opens in a new tab)',
} as const;

const KIND_WORDS: Readonly<Record<PublicBusinessPage['kind'], string>> = {
  restaurant: 'Restaurant',
  cafe: 'Café',
  bar: 'Bar',
  bakery: 'Bakery',
  salon: 'Salon',
  spa: 'Spa',
  barber: 'Barber',
  clinic: 'Clinic',
  fitness: 'Fitness studio',
  other: 'Business',
};

/** What a business is, in words ("Restaurant"). */
export function kindWord(kind: PublicBusinessPage['kind']): string {
  return KIND_WORDS[kind];
}
