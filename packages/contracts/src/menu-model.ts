// `@crm/contracts/menu` (spec 0065, H1): the Menu app's closed lists, limits and pure rules, with no Zod, so the
// engine, the editor and the guest menu page (whose bundle never loads Zod) agree: prices as integer minor units and
// how they format and parse, serving times read on the place's own clock, the public paths and cache tags. The Zod
// schemas and the contract live in `menu.ts`. A place's hours helpers ride along (`hospitality-hours.ts`), so the
// guest page reads "open now" by the rules the server uses.
import type { PlaceHoursShape, WeekDay } from './hospitality-model.ts';
import { nextOpening, openAt } from './hospitality-hours.ts';

export * from './hospitality-hours.ts';
export { WEEK_DAYS, type WeekDay } from './hospitality-model.ts';

/** Dietary marks (AC-6522), a closed list. At most one of the spicy levels. */
export const DIET_MARKS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'dairy_free',
  'contains_nuts',
  'halal',
  'spicy_1',
  'spicy_2',
  'spicy_3',
] as const;
/** One dietary mark. */
export type DietMark = (typeof DIET_MARKS)[number];

/** The marks a guest filters by (AC-6529): the ones that say what a dish is free of or suits. */
export const DIET_FILTERS = [
  'vegan',
  'vegetarian',
  'gluten_free',
  'dairy_free',
  'halal',
] as const satisfies readonly DietMark[];

/** The EU 14 allergens (Regulation (EU) No 1169/2011, Annex II), in its order. */
export const EU_ALLERGENS = [
  'celery',
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'lupin',
  'milk',
  'molluscs',
  'mustard',
  'nuts',
  'peanuts',
  'sesame',
  'soya',
  'sulphites',
] as const;
/** One of the EU 14 allergens. */
export type Allergen = (typeof EU_ALLERGENS)[number];

/** How an item holds an allergen: it contains it, or may contain traces. */
export const ALLERGEN_LEVELS = ['contains', 'may'] as const;
/** How an item holds an allergen. */
export type AllergenLevel = (typeof ALLERGEN_LEVELS)[number];

/** How a section lays out its items (AC-6521). */
export const SECTION_LAYOUTS = ['list', 'grid'] as const;
/** How a section lays out its items. */
export type SectionLayout = (typeof SECTION_LAYOUTS)[number];

/** How many options of a group a guest picks (AC-6523): exactly one, up to `max`, or any. */
export const OPTION_RULES = ['one', 'up_to', 'any'] as const;
/** How many options of a group a guest picks. */
export type OptionRule = (typeof OPTION_RULES)[number];

/** The Menu app's limits (spec 0065, Limits, and AC-6520 to AC-6527), in one place. */
export const MENU_LIMITS = {
  menus: 30,
  sectionsPerMenu: 100,
  items: 2000,
  placementsPerSection: 300,
  sizesPerItem: 8,
  groupsPerItem: 6,
  optionsPerGroup: 20,
  groups: 200,
  photos: 1000,
  menuNameMax: 60,
  menuNoteMax: 300,
  sectionNameMax: 60,
  sectionDescriptionMax: 140,
  itemNameMax: 80,
  itemDescriptionMax: 400,
  priceNoteMax: 24,
  sizeNameMax: 40,
  groupNameMax: 40,
  optionNameMax: 40,
  kcalMax: 10_000,
  /** The largest price in minor units: 99,999,999 (999,999.99 in a two digit currency). */
  priceMax: 99_999_999,
  /** Photos in (AC-6527): up to 4 MB. */
  photoMaxBytes: 4 * 1024 * 1024,
  /** Search text a guest types. */
  searchMax: 60,
  /** Picks a guest keeps (AC-6530). */
  picks: 60,
} as const;

/** The two widths a menu photo is kept at (AC-6527): the item sheet's, and the list's and grid's. */
export const MENU_PHOTO_WIDTHS = { large: 1200, small: 400 } as const;
/** One kept width of a menu photo. */
export type MenuPhotoSize = keyof typeof MENU_PHOTO_WIDTHS;

/** A menu or section's serving time (AC-6520, AC-6521): the days, and one range of hours that may cross midnight. */
export interface MenuServingShape {
  readonly days: readonly WeekDay[];
  readonly from: string;
  readonly to: string;
}

/** A serving time as hours, so the place's hours rules read it (one range on each of its days, no exceptions). */
export function servingHours(serving: MenuServingShape): PlaceHoursShape {
  return {
    weekly: Object.fromEntries(serving.days.map((day) => [day, [{ from: serving.from, to: serving.to }]])),
    exceptions: [],
  };
}

/** Whether something with this serving time is serving at `instant` in `zone`, and when it next starts if not. */
export interface ServingNow {
  readonly now: boolean;
  /** When it next starts serving, when it isn't now (within two weeks). */
  readonly next?: Date;
}

/** Whether a menu (or section) serves at `instant` on the place's clock (AC-6528); no serving time is always. */
export function servingAt(serving: MenuServingShape | undefined, instant: Date, zone: string): ServingNow {
  if (serving === undefined || serving.days.length === 0) return { now: true };
  const hours = servingHours(serving);
  if (openAt(hours, instant, zone).open) return { now: true };
  const next = nextOpening(hours, instant, zone);
  return next === undefined ? { now: false } : { now: false, next: next.at };
}

/** The digits after the point a currency prices with (its minor units: JPY 0, GBP 2, BHD 3), by Intl. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** An integer of minor units as an exact decimal string ("950" in GBP is "9.50"), never through a float. */
export function minorToDecimal(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const sign = minor < 0 ? '-' : '';
  const whole = String(Math.abs(Math.trunc(minor)));
  if (digits === 0) return `${sign}${whole}`;
  const padded = whole.padStart(digits + 1, '0');
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/**
 * A price for a guest (AC-6532): minor units in the workspace currency, in the place's locale, always with the
 * currency's own minor units. The decimal goes to Intl as a string, so no price is ever a float.
 */
export function formatPrice(minor: number, currency: string, locale: string): string {
  const digits = currencyDigits(currency);
  const decimal = minorToDecimal(minor, currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      // Intl takes a decimal string exactly (ES2023); the cast is only for older type libraries.
    }).format(decimal as unknown as number);
  } catch {
    return `${currency} ${decimal}`;
  }
}

/** A price difference for an option: "+£1.50", "−£0.50", or nothing for none. */
export function formatPriceDelta(minor: number, currency: string, locale: string): string {
  if (minor === 0) return '';
  return `${minor > 0 ? '+' : '−'}${formatPrice(Math.abs(minor), currency, locale)}`;
}

/**
 * A typed price as minor units, or undefined when it isn't one: digits with at most the currency's minor digits
 * after a point or comma ("9.5" in GBP is 950, "1200" in JPY is 1200, "1.250" in BHD is 1250). Never a float.
 */
export function parsePrice(text: string, currency: string): number | undefined {
  const digits = currencyDigits(currency);
  // `\s` covers the no-break space a pasted "1 200" carries.
  const cleaned = text.trim().replace(/\s/g, '');
  const match = /^(\d{1,9})(?:[.,](\d*))?$/.exec(cleaned);
  if (match === null) return undefined;
  const fraction = match[2] ?? '';
  if (fraction.length > digits) return undefined;
  const minor = Number(`${match[1] ?? '0'}${fraction.padEnd(digits, '0')}`);
  return Number.isSafeInteger(minor) && minor <= MENU_LIMITS.priceMax ? minor : undefined;
}

/** The shape of a menu key in a guest address (`/m/<key>`): 16 URL safe characters. */
export const MENU_KEY_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** Whether `key` can be a menu key; anything else never reaches the database. */
export const isMenuKey = (key: string): boolean => MENU_KEY_PATTERN.test(key);

/** The edge cache tags of places' guest menus (Rules settled: Routes): `menu:<placeId>`, each once. */
export function menuCacheTags(...placeIds: readonly string[]): readonly string[] {
  return [...new Set(placeIds.filter((id) => /^[0-9a-f-]{36}$/.test(id)))].map((id) => `menu:${id}`);
}

/** The guest menu's address on our origin. */
export const menuPagePath = (key: string): string => `/m/${key}`;

/** The guest menu's read on our origin. */
export const menuReadPath = (key: string): string => `/api/public/menu/${key}`;

/** The guest menu's look (its brand's accent and the Warm preset's variables), versioned. */
export const menuLookPath = (key: string, version: string): string => `/api/public/menu/${key}/look.css?v=${version}`;

/** The business's logo on a guest menu, versioned. */
export const menuLogoPath = (key: string, version: string): string => `/api/public/menu/${key}/logo?v=${version}`;

/** One menu photo at one width, versioned (AC-6527). */
export const menuPhotoPath = (key: string, photoId: string, size: MenuPhotoSize, version: string): string =>
  `/api/public/menu/${key}/photos/${photoId}/${size}?v=${version}`;

/** An item's price with the options a guest picked, in minor units (AC-6530). */
export function pickPrice(base: number, deltas: readonly number[], quantity = 1): number {
  return (base + deltas.reduce((sum, delta) => sum + delta, 0)) * quantity;
}
