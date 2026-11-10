// `@crm/contracts/menu` (spec 0065, H1): the Menu app's closed lists, limits and pure rules, with no Zod, so the
// engine, the editor and the guest menu page (whose bundle never loads Zod) agree: prices as integer minor units and
// how they format and parse, serving times read on the place's own clock, the public paths and cache tags. The Zod
// schemas and the contract live in `menu.ts`. A place's hours helpers ride along (`hospitality-hours.ts`), so the
// guest page reads "open now" by the rules the server uses.
import { brandVariables, BRAND_HEX_PATTERN, contrastRatio, CONTROL_CONTRAST, TEXT_CONTRAST } from './brand-colour.ts';
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
 * The edge cache tag every guest menu answer of one business carries (security review, 4 Nov 2026; per business since
 * the owner's decision of 10 Nov 2026): deleting the workspace or the operator closing its business apps forgets every
 * place's copies at once. It takes the business's opaque cache id (`businessCacheId` in `@crm/core`), never the
 * workspace's id, and never one two businesses share, since the menu's JSON and HTML show it to anybody. Anything not
 * such an id is left out.
 */
export function menuWorkspaceTags(cacheId: string): readonly string[] {
  return /^[0-9a-f]{32}$/.test(cacheId) ? [`menu-ws:${cacheId}`] : [];
}

/**
 * The shape of a table's code (spec 0065, H2): 22 base64url characters, 122 random bits from a v4 uuid, which a
 * table's printed QR carries as `/m/<menu key>?t=<code>`. Anything else never reaches the limiter or the database.
 */
export const TABLE_CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Whether `code` can be a table's code. */
export const isTableCode = (code: string): boolean => TABLE_CODE_PATTERN.test(code);

/** The address a table's QR opens: the place's guest menu with the table's code (H2). */
export const menuTablePagePath = (key: string, code: string): string => `/m/${key}?t=${code}`;

/** The guest menu's read of the table a QR named, which also counts the scan (H2). */
export const menuTablePath = (key: string, code: string): string => `/api/public/menu/${key}/tables/${code}`;

/**
 * How a guest sees a table's label (H2): "Table 4" for a bare number or a "T" and a number (the Add tables run's
 * "T1 to T10"), otherwise the label as the owner typed it ("Bar 2", "Window").
 */
export function tableDisplayName(label: string): string {
  const trimmed = label.trim();
  const number = /^(?:t\s*)?(\d{1,4})$/i.exec(trimmed)?.[1];
  return number === undefined ? trimmed : `Table ${number}`;
}

/** The guest menu's address on our origin. */
export const menuPagePath = (key: string): string => `/m/${key}`;

/** The guest menu's read on our origin. */
export const menuReadPath = (key: string): string => `/api/public/menu/${key}`;

/** The guest menu's look (its preset, palette, faces and corners, as custom properties), versioned. */
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
 * The Warm preset (spec 0065, AC-6570; H1 builds it alone, H5 adds Clean and Night): checklabs' guest look ("Nova",
 * which its guest app hard codes in `menu.module.css`; its saved themes never reach the guest), value for value. A
 * white ground and cards, cream chips (`#f5f1ea`), one near black (`#1a1a1a`) for the words, the pills, the + and the
 * selection bar, a mid grey (`#6b6b6b`) for the quiet words, a 6% black hairline, a 72% white glass bar and a 40%
 * black scrim. Every text pair passes AA (the grey is 5.3:1 on white, 4.8:1 on the cream). Dark is ours (checklabs
 * has none): the same roles on a near black, and it never changes the light look. The look stylesheet writes these
 * as `--menu-*` custom properties; the brand's accent, when it has one, takes `accent` and `onAccent`.
 */
export const WARM_PRESET = {
  light: {
    ground: '#ffffff',
    card: '#ffffff',
    chip: '#f5f1ea',
    line: '#0000000f',
    glass: '#ffffffb8',
    text: '#1a1a1a',
    quiet: '#6b6b6b',
    ink: '#1a1a1a',
    onInk: '#ffffff',
    accent: '#1a1a1a',
    onAccent: '#ffffff',
    bar: '#1a1a1a',
    onBar: '#ffffff',
    onBarQuiet: '#cfcfcf',
    barAccent: '#f0a37c',
    highlight: '#1a1a1a',
    scrim: '#00000066',
  },
  dark: {
    ground: '#141414',
    card: '#1c1c1c',
    chip: '#2b2824',
    line: '#ffffff17',
    glass: '#141414b8',
    text: '#f5f5f5',
    quiet: '#a8a8a8',
    ink: '#f5f5f5',
    onInk: '#141414',
    accent: '#f5f5f5',
    onAccent: '#141414',
    bar: '#f5f5f5',
    onBar: '#141414',
    onBarQuiet: '#4d4d4d',
    barAccent: '#f0a37c',
    highlight: '#f5f5f5',
    scrim: '#000000a6',
  },
} as const;

/**
 * The guest menu's face (checklabs' guest app draws in the device's own UI face: its Tailwind default names a font
 * variable nobody sets, so every browser falls back to `ui-sans-serif, system-ui`). The look stylesheet writes it as
 * `--menu-face`, once, for both themes.
 */
export const MENU_FACE = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * The guest menu's press feel (checklabs' guest app, value for value): the overshoot its presses settle on, and how far
 * each part eases down while held (a dish's row and an option's row 0.985, the selection bar 0.98, a grid card, Add and
 * the other buttons 0.97, a section's pill 0.94, Close and a sheet's quantity buttons 0.88, the + and a row's stepper
 * buttons 0.82). The look stylesheet writes them as `--menu-press-*` custom properties, since the library's CSS takes
 * curves and scales only from tokens, and writes every scale as 1 under reduced motion, so nothing moves there.
 */
export const MENU_PRESS = {
  ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  row: '0.985',
  bar: '0.98',
  card: '0.97',
  pill: '0.94',
  close: '0.88',
  add: '0.82',
} as const;

/** The custom property each press value sets. */
export const MENU_PRESS_PROPERTIES = {
  ease: '--menu-press-ease',
  row: '--menu-press-row',
  bar: '--menu-press-bar',
  card: '--menu-press-card',
  pill: '--menu-press-pill',
  close: '--menu-press-close',
  add: '--menu-press-add',
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
  highlight: '--menu-highlight',
  scrim: '--menu-scrim',
} as const;

/** The presets the Design page offers, in the order they show (spec 0065, AC-6570 as amended). Warm is the default. */
export const MENU_PRESETS = ['warm', 'clean', 'night', 'linen', 'noir', 'ronin'] as const;
/** One preset. */
export type MenuPreset = (typeof MENU_PRESETS)[number];

/**
 * The faces a guest look may draw in: the device's own, and the brand kit's font pack (`PAGE_FONTS`, spec 0060, every
 * face self hosted). A closed list: nothing a person types ever reaches a font's name.
 */
export const MENU_FONTS = [
  'device',
  'sans',
  'mono',
  'grotesk',
  'editorial',
  'classic',
  'friendly',
  'geometric',
  'display',
] as const;
/** One face of the guest look. */
export type MenuFont = (typeof MENU_FONTS)[number];

/** What each face writes as `--menu-face` or `--menu-display-face`: a constant, never anything typed. */
export const MENU_FONT_FACES: Readonly<Record<MenuFont, string>> = {
  device: MENU_FACE,
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
  grotesk: 'var(--font-pack-grotesk)',
  editorial: 'var(--font-pack-editorial)',
  classic: 'var(--font-pack-classic)',
  friendly: 'var(--font-pack-friendly)',
  geometric: 'var(--font-pack-geometric)',
  display: 'var(--font-pack-display)',
};

/** How round a guest look's corners are. */
export const MENU_RADII = ['square', 'soft', 'round'] as const;
/** One corner choice. */
export type MenuRadius = (typeof MENU_RADII)[number];

/** What each corner choice writes as `--menu-round`: a number the library's own radii are multiplied by. */
export const MENU_RADIUS_SCALES: Readonly<Record<MenuRadius, string>> = { square: '0.25', soft: '1', round: '1.5' };

/** The four colours an owner picks: the page, its words, its buttons and its prices. */
export const MENU_PALETTE_ROLES = ['surface', 'ink', 'brand', 'highlight'] as const;
/** One of the four. */
export type MenuPaletteRole = (typeof MENU_PALETTE_ROLES)[number];
/** The four colours, each a checked hex. */
export type MenuPalette = Readonly<Record<MenuPaletteRole, string>>;

/** A guest look's choices, as saved (`MenuLook` in `menu.ts` is the schema); a role left out of `palette` is the preset's. */
export interface MenuLookChoice {
  readonly preset: MenuPreset;
  readonly palette?: Readonly<Partial<Record<MenuPaletteRole, string>>> | undefined;
  readonly heading: MenuFont;
  readonly body: MenuFont;
  readonly radius: MenuRadius;
  readonly cover?: { readonly id: string; readonly version: string } | undefined;
}

/** Whether a page draws on its visitor's light or dark, or always one of them. */
export type MenuScheme = 'follow' | 'light' | 'dark';

/** A preset: its palette (and its dark one, when it follows the visitor), faces, corners and scheme. */
interface MenuPresetLook {
  readonly palette: MenuPalette;
  readonly darkPalette?: MenuPalette;
  readonly heading: MenuFont;
  readonly body: MenuFont;
  readonly radius: MenuRadius;
  readonly scheme: MenuScheme;
  /** Whether the brand kit's accent takes the buttons, unless the owner picked their own Brand colour. */
  readonly takesBrandAccent: boolean;
}

/**
 * The six presets (AC-6570 as amended): Warm after checklabs' guest look, Clean in the app's own neutrals, Night for
 * bars, and Linen, Noir and Ronin after checklabs' retired palettes with their font pairs restated in our pack (Inter
 * for the body; Fraunces and Cormorant, which we don't host, become Editorial and Classic). Linen's and Ronin's
 * highlights are moved until they read at 4.5:1 as prices. `menu-model.test.ts` proves each passes AA in its own colours.
 */
export const MENU_PRESET_LOOKS: Readonly<Record<MenuPreset, MenuPresetLook>> = {
  warm: {
    palette: { surface: '#ffffff', ink: '#1a1a1a', brand: '#1a1a1a', highlight: '#1a1a1a' },
    darkPalette: { surface: '#141414', ink: '#f5f5f5', brand: '#f5f5f5', highlight: '#f5f5f5' },
    heading: 'device',
    body: 'device',
    radius: 'soft',
    scheme: 'follow',
    takesBrandAccent: true,
  },
  clean: {
    palette: { surface: '#ffffff', ink: '#18191c', brand: '#18191c', highlight: '#18191c' },
    darkPalette: { surface: '#18191c', ink: '#f4f5f7', brand: '#f4f5f7', highlight: '#f4f5f7' },
    heading: 'sans',
    body: 'sans',
    radius: 'soft',
    scheme: 'follow',
    takesBrandAccent: true,
  },
  night: {
    palette: { surface: '#12141a', ink: '#f2f2f0', brand: '#f2f2f0', highlight: '#f0a37c' },
    heading: 'geometric',
    body: 'sans',
    radius: 'soft',
    scheme: 'dark',
    takesBrandAccent: true,
  },
  linen: {
    palette: { surface: '#f8f6f1', ink: '#1f1d1a', brand: '#1f2937', highlight: '#8f5a30' },
    heading: 'editorial',
    body: 'sans',
    radius: 'soft',
    scheme: 'light',
    takesBrandAccent: false,
  },
  noir: {
    palette: { surface: '#0a0a0a', ink: '#fafafa', brand: '#d4af37', highlight: '#d4af37' },
    heading: 'grotesk',
    body: 'grotesk',
    radius: 'square',
    scheme: 'dark',
    takesBrandAccent: false,
  },
  ronin: {
    palette: { surface: '#0a0a0a', ink: '#ffffff', brand: '#dc2626', highlight: '#f87171' },
    heading: 'classic',
    body: 'sans',
    radius: 'round',
    scheme: 'dark',
    takesBrandAccent: false,
  },
};

/** A preset's own look, as the Design page sets it when that preset is chosen; a saved cover stays. */
export function presetLook(preset: MenuPreset, cover?: MenuLookChoice['cover']): MenuLookChoice {
  const { heading, body, radius } = MENU_PRESET_LOOKS[preset];
  return { preset, heading, body, radius, ...(cover === undefined ? {} : { cover }) };
}

/** The look of a workspace that never saved one: Warm. */
export const DEFAULT_MENU_LOOK: MenuLookChoice = presetLook('warm');

/** A colour's red, green and blue. */
const rgbOf = (hex: string): readonly [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** `one` moved `share` of the way to `other`, in sRGB: a quiet step, never a new hue of its own. */
function mixHex(one: string, other: string, share: number): string {
  const [from, to] = [rgbOf(one), rgbOf(other)];
  const channel = (index: 0 | 1 | 2) =>
    Math.round(from[index] + (to[index] - from[index]) * share)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** Black or white, whichever reads better on `hex`: always at least 4.58:1, so a button's label is never unreadable. */
const labelOn = (hex: string): string =>
  contrastRatio('#000000', hex) >= contrastRatio('#ffffff', hex) ? '#000000' : '#ffffff';

/** The least contrast of `hex` on any of `surfaces`. */
const leastOn = (hex: string, surfaces: readonly string[]): number =>
  Math.min(...surfaces.map((surface) => contrastRatio(hex, surface)));

/**
 * `hex` as it is when it reads at `least` on every surface; otherwise moved step by step towards black or white,
 * whichever reads better there, until it does. An owner's colour that can't be read is never drawn as it is.
 */
function readableOn(hex: string, surfaces: readonly string[], least: number): string {
  if (leastOn(hex, surfaces) >= least) return hex;
  const target = leastOn('#000000', surfaces) >= leastOn('#ffffff', surfaces) ? '#000000' : '#ffffff';
  for (let step = 1; step < 20; step += 1) {
    const moved = mixHex(hex, target, step / 20);
    if (leastOn(moved, surfaces) >= least) return moved;
  }
  return target;
}

/** The colours one look draws, by the name of the custom property each sets (`MENU_LOOK_PROPERTIES`). */
export type MenuLookRoles = Readonly<Record<keyof typeof MENU_LOOK_PROPERTIES, string>>;

/** Every role worked out from four colours: each that carries words is checked against what it sits on. */
function rolesOfPalette(palette: MenuPalette): MenuLookRoles {
  const ground = palette.surface;
  const chip = mixHex(ground, palette.ink, 0.07);
  const surfaces = [ground, chip];
  const text = readableOn(palette.ink, surfaces, TEXT_CONTRAST);
  const accent = readableOn(palette.brand, [ground], CONTROL_CONTRAST);
  const onInk = labelOn(text);
  return {
    ground,
    card: ground,
    chip,
    line: `${text}1a`,
    glass: `${ground}b8`,
    text,
    quiet: readableOn(mixHex(text, ground, 0.35), surfaces, TEXT_CONTRAST),
    ink: text,
    onInk,
    accent,
    onAccent: labelOn(accent),
    bar: text,
    onBar: onInk,
    onBarQuiet: readableOn(mixHex(onInk, text, 0.2), [text], TEXT_CONTRAST),
    barAccent: readableOn(palette.highlight, [text], CONTROL_CONTRAST),
    highlight: readableOn(palette.highlight, surfaces, TEXT_CONTRAST),
    scrim: '#00000066',
  };
}

/** The brand kit's accent pair, as a guest look reads it. */
export interface MenuLookAccents {
  readonly accent?: string | undefined;
  readonly accentDark?: string | undefined;
}

/** Whether the owner picked their own page or words colour, which pins the page to one scheme. */
const repaints = (look: MenuLookChoice): boolean =>
  look.palette?.surface !== undefined || look.palette?.ink !== undefined;

/** The four colours a look starts from, in one mode: the owner's where they picked one, else the preset's. */
export function menuLookPalette(look: MenuLookChoice, mode: 'light' | 'dark'): MenuPalette {
  const preset = MENU_PRESET_LOOKS[look.preset];
  const base = mode === 'dark' && !repaints(look) ? (preset.darkPalette ?? preset.palette) : preset.palette;
  return { ...base, ...look.palette };
}

/**
 * The scheme a look draws on: a preset's own; picking the page's or the words' colour pins it to the side that colour
 * reads as, since one picked colour has no second value for the other side.
 */
export function menuLookScheme(look: MenuLookChoice): MenuScheme {
  if (!repaints(look)) return MENU_PRESET_LOOKS[look.preset].scheme;
  const surface = menuLookPalette(look, 'light').surface;
  return contrastRatio('#ffffff', surface) > contrastRatio('#000000', surface) ? 'dark' : 'light';
}

/**
 * Every colour a look draws in one mode (spec 0065, AC-6570 as amended). Warm alone keeps its table, value for value;
 * every other look works its roles out of the four colours. Words are held to 4.5:1 on what they sit on and a button
 * to 3:1 on the page, whatever the owner picked, and a button's label is black or white, whichever reads better. The
 * brand kit's accent takes the buttons on a preset that takes it, through the contrast guard, unless the owner picked
 * their own Brand colour. Runs on the server for the stylesheet and in the editor for the preview, so they agree.
 */
export function menuLookRoles(look: MenuLookChoice, accents: MenuLookAccents, mode: 'light' | 'dark'): MenuLookRoles {
  const palette = menuLookPalette(look, mode);
  const preset = MENU_PRESET_LOOKS[look.preset];
  const derived = rolesOfPalette(palette);
  const roles: MenuLookRoles =
    look.preset === 'warm' && !repaints(look)
      ? {
          ...WARM_PRESET[mode],
          ...(look.palette?.brand === undefined ? {} : { accent: derived.accent, onAccent: derived.onAccent }),
          ...(look.palette?.highlight === undefined
            ? {}
            : { highlight: derived.highlight, barAccent: derived.barAccent }),
        }
      : derived;
  const accent = accents.accent;
  if (!preset.takesBrandAccent || look.palette?.brand !== undefined || accent === undefined) return roles;
  if (!BRAND_HEX_PATTERN.test(accent)) return roles;
  const drawn = brandVariables({
    accent,
    ...(accents.accentDark === undefined ? {} : { accentDark: accents.accentDark }),
  })[mode];
  const onPage = readableOn(drawn.accent, [roles.ground], CONTROL_CONTRAST);
  return { ...roles, accent: onPage, onAccent: onPage === drawn.accent ? drawn.onAccent : labelOn(onPage) };
}

/** One colour's check on the Design page: the ratio, and whether it passes AA for what that colour does. */
export interface MenuContrast {
  readonly ratio: number;
  readonly passes: boolean;
}

/**
 * The badges on the Design page, of the colours as picked, before anything is moved to keep them readable: the words
 * on the page (4.5:1), a button on the page (3:1) and the prices on the page (4.5:1). The page itself carries no badge.
 */
export function menuLookContrast(
  palette: MenuPalette,
): Readonly<Record<Exclude<MenuPaletteRole, 'surface'>, MenuContrast>> {
  const check = (hex: string, least: number): MenuContrast => {
    const ratio = contrastRatio(hex, palette.surface);
    return { ratio, passes: ratio >= least };
  };
  return {
    ink: check(palette.ink, TEXT_CONTRAST),
    brand: check(palette.brand, CONTROL_CONTRAST),
    highlight: check(palette.highlight, TEXT_CONTRAST),
  };
}

/** The faces and the corners, which don't change with the mode: `[name, value]` pairs of constants. */
export function menuLookShape(look: MenuLookChoice): readonly (readonly [string, string])[] {
  return [
    ['--menu-face', MENU_FONT_FACES[look.body]],
    ['--menu-display-face', MENU_FONT_FACES[look.heading]],
    ['--menu-round', MENU_RADIUS_SCALES[look.radius]],
  ];
}

/**
 * The colours in one mode, as `[name, value]` pairs: what the stylesheet writes and what the preview sets. A value
 * that isn't a whole hex is left out, so nothing else can ever reach CSS.
 */
export function menuLookColours(
  look: MenuLookChoice,
  accents: MenuLookAccents,
  mode: 'light' | 'dark',
): readonly (readonly [string, string])[] {
  const roles = menuLookRoles(look, accents, mode);
  return (Object.keys(MENU_LOOK_PROPERTIES) as (keyof typeof MENU_LOOK_PROPERTIES)[])
    .filter((name) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(roles[name]))
    .map((name) => [MENU_LOOK_PROPERTIES[name], roles[name]] as const);
}
