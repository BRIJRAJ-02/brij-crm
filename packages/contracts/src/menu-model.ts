// `@crm/contracts/menu` (spec 0065, H1): the Menu app's closed lists, limits and pure rules, with no Zod, so the
// engine, the editor and the guest menu page (whose bundle never loads Zod) agree: prices as integer minor units and
// how they format and parse, serving times read on the place's own clock, the public paths and cache tags. The Zod
// schemas and the contract live in `menu.ts`. A place's hours helpers ride along (`hospitality-hours.ts`), so the
// guest page reads "open now" by the rules the server uses.
import { WEEK_DAYS, type PlaceHoursShape, type WeekDay } from './hospitality-model.ts';
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
  /** How many of one pick (ported from checklabs: 1 to 99). */
  quantityMax: 99,
} as const;

/** The two widths a menu photo is kept at (AC-6527): the item sheet's, and the list's and grid's. */
export const MENU_PHOTO_WIDTHS = { large: 1200, small: 400 } as const;
/** One kept width of a menu photo. */
export type MenuPhotoSize = keyof typeof MENU_PHOTO_WIDTHS;

/**
 * A menu or section's serving times (AC-6520, AC-6521), ported from checklabs' per day schedule
 * (checklabscms/src/lib/schedule.ts, `isScheduleOpen`): each day of the week holds its windows (up to three, in order,
 * the last may run past midnight). No serving times at all means always serving; a week with no day set (`{}`) also
 * means always, as checklabs' empty schedule did; once any day is set, a day with no windows (or left out) is a day it
 * doesn't serve. Unlike checklabs, a window past midnight belongs to the day it starts on (Friday 22:00 to 02:00 serves
 * in Saturday's small hours, not Friday's), the rule the place's hours use, and every reading is on the place's zone.
 */
export interface MenuServingShape {
  readonly weekly: PlaceHoursShape['weekly'];
}

/** Whether serving times say anything: undefined or a week with no day set is "always" (checklabs' empty schedule). */
export function servingIsSet(serving: MenuServingShape | undefined): serving is MenuServingShape {
  return serving !== undefined && Object.keys(serving.weekly).length > 0;
}

/** Serving times as hours, so the place's hours rules read them (no dated exceptions). */
export function servingHours(serving: MenuServingShape): PlaceHoursShape {
  return { weekly: serving.weekly, exceptions: [] };
}

/** Whether something with these serving times is serving at `instant` in `zone`, and when it next starts if not. */
export interface ServingNow {
  readonly now: boolean;
  /** When it next starts serving, when it isn't now (within two weeks). */
  readonly next?: Date;
}

/** Whether a menu (or section) serves at `instant` on the place's clock (AC-6528); no serving times is always. */
export function servingAt(serving: MenuServingShape | undefined, instant: Date, zone: string): ServingNow {
  if (!servingIsSet(serving)) return { now: true };
  const hours = servingHours(serving);
  let open: boolean;
  try {
    open = openAt(hours, instant, zone).open;
  } catch {
    // Failing in UTC too (an Invalid Date), retrying would never end: shown, as with no serving time set.
    if (zone === 'UTC') return { now: true };
    // A zone the platform doesn't know reads as UTC, as checklabs' did.
    return servingAt(serving, instant, 'UTC');
  }
  if (open) return { now: true };
  const next = nextOpening(hours, instant, zone);
  return next === undefined ? { now: false } : { now: false, next: next.at };
}

/**
 * A stored serving time in either shape, as the per day one: the first build kept one range over a list of days
 * (`{ days, from, to }`), never landed; read defensively so a draft saved then still opens. Undefined when it is
 * neither.
 */
export function servingOf(value: unknown): MenuServingShape | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.weekly === 'object' && record.weekly !== null) {
    const weekly: Partial<Record<WeekDay, readonly { from: string; to: string }[]>> = {};
    for (const day of WEEK_DAYS) {
      const ranges = (record.weekly as Record<string, unknown>)[day];
      if (!Array.isArray(ranges)) continue;
      weekly[day] = ranges
        .filter(
          (range): range is { from: string; to: string } =>
            typeof range === 'object' &&
            range !== null &&
            typeof (range as { from?: unknown }).from === 'string' &&
            typeof (range as { to?: unknown }).to === 'string',
        )
        .map((range) => ({ from: range.from, to: range.to }));
    }
    return { weekly };
  }
  if (Array.isArray(record.days) && typeof record.from === 'string' && typeof record.to === 'string') {
    const range = { from: record.from, to: record.to };
    return {
      weekly: Object.fromEntries(
        WEEK_DAYS.map((day) => [day, (record.days as unknown[]).includes(day) ? [range] : []]),
      ),
    };
  }
  return undefined;
}

/**
 * Tax and service rates in basis points (hundredths of a percent: 1250 is 12.5%), whole numbers so no rate is ever a
 * float. Ported from checklabs' inclusive model (checklabscms/src/lib/pos/totals.ts, `rollupCheck`): prices as shown
 * already hold the tax; service is added on top. Each rate is 0 to 100%.
 */
export const RATE_MAX = 10_000;

/** A rate in basis points as a percent for people: 1250 is "12.5", 500 is "5", 1275 is "12.75". */
export function formatRate(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(Math.abs(basisPoints) % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

/** A typed percent ("12.5", "12,5 %", "5") as basis points, or undefined when it isn't one from 0 to 100. */
export function parseRate(text: string): number | undefined {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?\s*%?$/.exec(text.trim());
  if (match === null) return undefined;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints <= RATE_MAX ? basisPoints : undefined;
}

/**
 * The note a menu's foot shows for its rates (AC-6520): "Prices include 5% tax. 12.5% service is added.", either
 * half left out at 0, and nothing when both are. The editor writes it while the owner hasn't changed the note.
 */
export function rateNote(taxRate: number, serviceRate: number): string {
  const parts = [
    ...(taxRate > 0 ? [`Prices include ${formatRate(taxRate)}% tax.`] : []),
    ...(serviceRate > 0 ? [`${formatRate(serviceRate)}% service is added.`] : []),
  ];
  return parts.join(' ');
}

/** A guest's picks added up (AC-6530): what they total, the tax already inside it, and the service on top. */
export interface PicksTotal {
  readonly subtotal: number;
  /** The tax already inside the subtotal (shown, never added). */
  readonly tax: number;
  readonly service: number;
  readonly total: number;
}

/**
 * Ported from checklabs' `rollupCheck` (checklabscms/src/lib/pos/totals.ts), minus the tip: the tax inside an
 * inclusive subtotal is subtotal × rate ÷ (100% + rate), service is subtotal × rate, the total is subtotal plus
 * service. Each part rounds half up to a whole minor unit, as checklabs' `Math.round`; rates outside 0 to 100% count
 * as 0 (checklabs' `clampPct` capped at 100; we refuse such rates on the way in).
 */
export function picksTotal(subtotal: number, taxRate: number, serviceRate: number): PicksTotal {
  const base = Math.max(0, Math.round(subtotal));
  const rate = (value: number) => (Number.isInteger(value) && value >= 0 && value <= RATE_MAX ? value : 0);
  const tax = rate(taxRate) > 0 ? Math.round((base * rate(taxRate)) / (RATE_MAX + rate(taxRate))) : 0;
  const service = rate(serviceRate) > 0 ? Math.round((base * rate(serviceRate)) / RATE_MAX) : 0;
  return { subtotal: base, tax, service, total: base + service };
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

/**
 * The header the guest menu's server render (`apps/web/api/menu.mjs`) puts the edge secret in when it reads the menu
 * for a guest (security review, should-fix 4). The middleware overwrites `x-crm-edge` and `x-forwarded-for` with its
 * own on that read, so the render vouches for the guest's address in headers of its own. One name for both sides:
 * the render sends it (`apps/web/menu-read.ts`), the api checks it (`apps/api/src/edge.ts`).
 */
export const RENDER_HEADER = 'x-crm-render';

/** The guest's own address, as the render's request saw it; the api believes it only beside a valid `RENDER_HEADER`. */
export const GUEST_IP_HEADER = 'x-crm-guest-ip';

/** The edge cache tags of places' guest menus (Rules settled: Routes): `menu:<placeId>`, each once. */
export function menuCacheTags(...placeIds: readonly string[]): readonly string[] {
  return [...new Set(placeIds.filter((id) => /^[0-9a-f-]{36}$/.test(id)))].map((id) => `menu:${id}`);
}

/**
 * The edge cache tag every guest menu answer of a workspace carries (security review, 4 Nov 2026): deleting the
 * workspace or the operator closing its business apps forgets every place's copies at once. It takes the business's
 * opaque cache id (`businessCacheId` in `@crm/core`), never the workspace's id, which the menu's JSON and HTML would
 * otherwise show to anybody. Anything not such an id is left out.
 */
export function menuWorkspaceTags(cacheId: string): readonly string[] {
  return /^[0-9a-f]{32}$/.test(cacheId) ? [`menu-ws:${cacheId}`] : [];
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

/**
 * One line of picks in minor units (ported from checklabs' cart math): the chosen size's price, else the item's
 * own; plus every chosen option's difference; times the quantity, a whole number from 1 to 99. Undefined for a
 * quantity outside that, or an item with neither a price nor the size asked for. Never a float.
 */
export function linePrice(input: {
  readonly basePrice?: number;
  readonly sizePrices: readonly number[];
  readonly size?: number;
  readonly optionDeltas: readonly number[];
  readonly quantity: number;
}): number | undefined {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MENU_LIMITS.quantityMax)
    return undefined;
  const unit = input.size === undefined ? input.basePrice : input.sizePrices[input.size];
  if (unit === undefined) return undefined;
  return pickPrice(unit, input.optionDeltas, input.quantity);
}

/**
 * Whether a guest's choices in one option group are allowed (ported from checklabs' modifier groups, with the min it
 * lacked): at least `min` and at most the group's own ceiling (one, `max`, or any). The item sheet enables Add only
 * when every group says yes.
 */
export function choicesAllowed(
  group: { readonly rule: OptionRule; readonly min?: number; readonly max?: number },
  chosen: number,
): boolean {
  const most = group.rule === 'one' ? 1 : group.rule === 'up_to' ? (group.max ?? 1) : Number.POSITIVE_INFINITY;
  return chosen >= (group.min ?? 0) && chosen <= most;
}

/**
 * The Warm preset (spec 0065, AC-6570; H1 builds it alone, H5 adds Clean and Night): after the checklabs guest look,
 * a warm off white ground, near black text, soft chips and a glass bar, light and dark. Every pair passes AA (text on
 * ground and chip at 4.5:1 or more). The look stylesheet writes these as `--menu-*` custom properties; the brand's
 * accent, when it has one, takes `accent` and `onAccent`.
 */
export const WARM_PRESET = {
  light: {
    ground: '#f6f1ea',
    card: '#fffdf9',
    chip: '#ece4d9',
    line: '#e2d8cb',
    glass: '#f6f1eae0',
    text: '#1c1915',
    quiet: '#655b50',
    ink: '#1c1915',
    onInk: '#fffdf9',
    accent: '#a8492a',
    onAccent: '#ffffff',
    bar: '#1c1915',
    onBar: '#f6f1ea',
    onBarQuiet: '#cbbfb1',
    barAccent: '#f0a37c',
  },
  dark: {
    ground: '#171411',
    card: '#221e1a',
    chip: '#2e2823',
    line: '#3a332c',
    glass: '#171411e0',
    text: '#f4eee6',
    quiet: '#b9ad9f',
    ink: '#f4eee6',
    onInk: '#171411',
    accent: '#e3946b',
    onAccent: '#171411',
    bar: '#0e0c0a',
    onBar: '#f4eee6',
    onBarQuiet: '#b9ad9f',
    barAccent: '#f0a37c',
  },
} as const;

/** The custom property each preset colour sets. */
export const MENU_LOOK_PROPERTIES = {
  ground: '--menu-ground',
  card: '--menu-card',
  chip: '--menu-chip',
  line: '--menu-line',
  glass: '--menu-glass',
  text: '--menu-text',
  quiet: '--menu-quiet',
  ink: '--menu-ink',
  onInk: '--menu-on-ink',
  accent: '--menu-accent',
  onAccent: '--menu-on-accent',
  bar: '--menu-bar',
  onBar: '--menu-on-bar',
  onBarQuiet: '--menu-on-bar-quiet',
  barAccent: '--menu-bar-accent',
} as const;
