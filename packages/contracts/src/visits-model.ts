// `@crm/contracts/visits` (spec 0066, B0): the visit engine's closed lists, limits and pure rules, with no Zod, so the
// engine, the settings screens (B1) and the guest flow (B2, B7) agree on every bound. The planner itself is server
// side, in `packages/core/src/visits/planner.ts`.

/** The engine's bounds (AC-6604 and the cross check of 4 Nov 2026), in one place. */
export const VISIT_LIMITS = {
  /** Services (items) in one visit. */
  items: 5,
  /** Staff a planner run considers at one place. */
  staffPerPlace: 60,
  /** Resources a planner run considers at one place (0065's per place limit). */
  resourcesPerPlace: 300,
  /** Resources joined to seat one party (a resource and up to two of its joins). */
  joinedResources: 3,
  /** Allocation tries for one start before it is dropped as not offered. */
  triesPerStart: 500,
  /** Allocation tries for one request before the rest of the range is dropped. */
  triesPerRequest: 20_000,
  /** Times a search goes back on an earlier choice for one start. */
  backtracks: 3,
  /** How far the earliest free day search looks ahead. */
  earliestDays: 14,
  /** How long a slot answer is cached, unless a write at the place purges it first. */
  slotCacheMs: 30_000,
  /** A variant's length, in minutes. */
  minutesMin: 5,
  minutesMax: 600,
  /** Buffers before and after, in minutes. */
  bufferMax: 120,
  /** Party size. */
  partyMin: 1,
  partyMax: 100,
  /** A hold by party size table's rows (0065 AC-6550's thresholds). */
  holdSizes: 8,
  variantsPerService: 8,
  staffOverridesPerVariant: 60,
  resourceNeedsPerService: 5,
  /** A need's count (two rooms, three chairs). */
  needCount: 5,
  noteMax: 500,
  clientNameMax: 120,
  clientPhoneMax: 40,
  cancelReasonMax: 200,
} as const;

/** A visit's status (AC-6632): live ones hold their staff and resources; no show and cancelled let them go. */
export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'arrived',
  'started',
  'completed',
  'no_show',
  'cancelled',
] as const;
/** One visit status. */
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** The statuses whose holds are live (they block the time). */
export const LIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'booked',
  'confirmed',
  'arrived',
  'started',
  'completed',
];

/** Where a visit came from. */
export const APPOINTMENT_SOURCES = ['online', 'desk', 'walk_in'] as const;
/** One visit source. */
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/** How a price reads (AC-6610). */
export const PRICE_TYPES = ['fixed', 'from', 'free', 'on_request'] as const;
/** One price type. */
export type PriceType = (typeof PRICE_TYPES)[number];

/**
 * Who a service seats (AC-6610): `one` client at a time, or a `party` fitted to a resource's capacity (tables,
 * courts, group rooms).
 */
export const CAPACITY_MODES = ['one', 'party'] as const;
/** One capacity mode. */
export type CapacityMode = (typeof CAPACITY_MODES)[number];

/** Who can do a service: every staff member at the place, only the chosen ones, or nobody (a table, a court). */
export const STAFF_RULES = ['all', 'chosen', 'none'] as const;
/** One staff rule. */
export type StaffRule = (typeof STAFF_RULES)[number];

/** Why a staff member is away (AC-6612). */
export const STAFF_TIME_OFF_REASONS = ['holiday', 'sick', 'training', 'other'] as const;
/** One time off reason. */
export type StaffTimeOffReason = (typeof STAFF_TIME_OFF_REASONS)[number];

/** One row of a hold by party size table: parties of `size` or more hold the resource `minutes`. */
export interface HoldBySize {
  readonly size: number;
  readonly minutes: number;
}

/**
 * How long a party holds its table (ported from checklabs' `turnForParty`, `src/lib/availability.ts`): the row with
 * the largest size at or under the party's, else the variant's own length.
 */
export function holdForParty(minutes: number, rows: readonly HoldBySize[], party: number): number {
  let best: HoldBySize | undefined;
  for (const row of rows) if (row.size <= party && (best === undefined || row.size > best.size)) best = row;
  return best?.minutes ?? minutes;
}

/**
 * What is wrong with a hold by size table, or undefined: at most 8 rows, sizes 1 to 100 without repeats, lengths
 * 5 to 600 minutes.
 */
export function holdBySizeProblem(rows: readonly HoldBySize[]): string | undefined {
  if (rows.length > VISIT_LIMITS.holdSizes) return `Use up to ${String(VISIT_LIMITS.holdSizes)} party sizes.`;
  const sizes = new Set<number>();
  for (const row of rows) {
    if (!Number.isInteger(row.size) || row.size < VISIT_LIMITS.partyMin || row.size > VISIT_LIMITS.partyMax) {
      return 'Give each row a party size from 1 to 100.';
    }
    if (
      !Number.isInteger(row.minutes) ||
      row.minutes < VISIT_LIMITS.minutesMin ||
      row.minutes > VISIT_LIMITS.minutesMax
    ) {
      return 'Give each row a length from 5 to 600 minutes.';
    }
    if (sizes.has(row.size)) return 'Each party size can appear once.';
    sizes.add(row.size);
  }
  return undefined;
}

/**
 * The alphabet of a visit's lookup code (ported from checklabs' reservation lookup): 31 letters and digits a guest
 * reads aloud without confusing (no 0, O, 1, I or L).
 */
export const LOOKUP_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** A lookup code's length. */
export const LOOKUP_LENGTH = 8;
/** A lookup code as typed back: 8 of the alphabet, any case. */
export const LOOKUP_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;

/** A typed lookup code in its stored form (upper case, spaces and dashes dropped), or undefined. */
export function normalLookupCode(typed: string): string | undefined {
  const code = typed.replace(/[\s-]/g, '').toUpperCase();
  return LOOKUP_PATTERN.test(code) ? code : undefined;
}

/**
 * The catalogue's and the team's bounds (B1: AC-6610, AC-6611), in one place, so the screens and the server refuse
 * at the same line.
 */
export const CATALOGUE_LIMITS = {
  categories: 50,
  services: 500,
  /** Staff profiles a workspace keeps (60 at each place, up to 20 places, archived ones aside). */
  staff: 300,
  categoryNameMax: 60,
  serviceNameMax: 80,
  descriptionMax: 600,
  variantNameMax: 60,
  cancelNoteMax: 200,
  staffNameMax: 80,
  staffTitleMax: 60,
  staffBioMax: 600,
  blockReasonMax: 60,
  /** The largest price, in minor units (a hundred million in major units). */
  priceMax: 10_000_000_000,
  /** People one Copy shifts to reaches. */
  copyTo: 60,
  /** Services one bulk change takes. */
  bulk: 100,
  /** Time off longest span, in days, and a block's. */
  timeOffDays: 367,
  blockDays: 31,
} as const;

/** The first service a new catalogue offers by kind of business (Foolproof: a first try works without reading). */
export interface StarterService {
  readonly name: string;
  readonly category: string;
  readonly minutes: number;
}

/** The starter by kind of business ("Haircut, 30 min" for a salon); a restaurant's tables are Table seating's. */
export const STARTER_SERVICES: Readonly<Record<string, StarterService>> = {
  salon: { name: 'Haircut', category: 'Hair', minutes: 30 },
  barber: { name: 'Haircut', category: 'Hair', minutes: 30 },
  spa: { name: 'Massage', category: 'Massage', minutes: 60 },
  clinic: { name: 'Consultation', category: 'Consultations', minutes: 30 },
  fitness: { name: 'Personal training', category: 'Training', minutes: 60 },
};

/** The starter for a kind of business, or a plain one. */
export function starterService(kind: string | undefined): StarterService {
  return (
    (kind === undefined ? undefined : STARTER_SERVICES[kind]) ?? {
      name: 'Appointment',
      category: 'Services',
      minutes: 30,
    }
  );
}

/** A URL slug from a name ("Men's cut & style" → "men-s-cut-style"), at most 80 characters, never empty. */
export function serviceSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    .replace(/-+$/, '');
  return slug === '' ? 'service' : slug;
}
