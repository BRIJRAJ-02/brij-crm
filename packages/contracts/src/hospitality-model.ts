// `@crm/contracts/hospitality` (spec 0065, H0): the Hospitality suite's closed lists, limits and pure rules, with no
// Zod, so the engine and the browser's data layer (Settings › Apps and Settings › Business) run the same checks and
// agree on the result. The Zod schemas and the contract live in `hospitality.ts`.

/**
 * The business apps a workspace installs (AC-6501), in the order the Apps page lists them. Spec 0066 adds
 * Appointments (services, staff and the visit engine) and Events (classes and events, B8).
 */
export const HOSPITALITY_APPS = ['menu', 'menu_qr', 'table_seating', 'appointments', 'events'] as const;
/** One Hospitality app. */
export type HospitalityApp = (typeof HOSPITALITY_APPS)[number];

/** The apps an app needs installed first (AC-6505): Menu QR opens the Menu, so it needs it. */
export const APP_NEEDS: Readonly<Record<HospitalityApp, readonly HospitalityApp[]>> = {
  menu: [],
  menu_qr: ['menu'],
  table_seating: [],
  appointments: [],
  events: [],
};

/** The apps that need `app`, so removing it removes them too (AC-6505). */
export function appsNeeding(app: HospitalityApp): readonly HospitalityApp[] {
  return HOSPITALITY_APPS.filter((other) => APP_NEEDS[other].includes(app));
}

/**
 * The apps every workspace has on from the start, with nothing to activate. Events is still being built, so it stays
 * off, even for a workspace that installed it before (it can't be switched off either, so it never keeps a page up).
 */
export const APPS_ON_BY_DEFAULT: readonly HospitalityApp[] = HOSPITALITY_APPS.filter((app) => app !== 'events');

/**
 * Which apps a workspace has on, from its `workspace_apps` rows. A row with `removed` set is an owner's or admin's
 * switch-off and always wins; no row means the app's default. An app whose needed app is off is off too, so Menu QR
 * never outlives Menu. An app still being built (Events) is off whatever its row says. The one rule:
 * `crm_menu_by_key` and `crm_table_place_by_key` (migration 0195) read it the same way.
 */
export function appsOn(
  rows: readonly { readonly app: string; readonly removed: boolean }[],
): ReadonlySet<HospitalityApp> {
  const isOn = (app: HospitalityApp): boolean => {
    if (!APPS_ON_BY_DEFAULT.includes(app)) return false;
    const row = rows.find((each) => each.app === app);
    return row === undefined || !row.removed;
  };
  return new Set(HOSPITALITY_APPS.filter((app) => isOn(app) && APP_NEEDS[app].every(isOn)));
}

/**
 * What a business is (AC-6506; widened 4 Nov 2026, the owner: every business that books places, not only food). The
 * business profile and its places are the shared base of every business app.
 */
export const BUSINESS_KINDS = [
  'restaurant',
  'cafe',
  'bar',
  'bakery',
  'salon',
  'spa',
  'barber',
  'clinic',
  'fitness',
  'other',
] as const;
/** What a business is. */
export type BusinessKind = (typeof BUSINESS_KINDS)[number];

/** What a place books or seats (a resource): a table, a room, a chair, a bed, a court, a station, equipment. */
export const RESOURCE_KINDS = ['table', 'room', 'chair', 'bed', 'court', 'station', 'equipment', 'other'] as const;
/** What a resource is. */
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** The resource a kind of business mostly books, the Add dialog's first choice. */
export const DEFAULT_RESOURCE_KIND: Readonly<Record<BusinessKind, ResourceKind>> = {
  restaurant: 'table',
  cafe: 'table',
  bar: 'table',
  bakery: 'table',
  salon: 'chair',
  barber: 'chair',
  spa: 'room',
  clinic: 'room',
  fitness: 'room',
  other: 'other',
};

/** The kind most of a place's live resources are, or undefined when it has none. */
export function mainResourceKind(
  resources: readonly { readonly kind: ResourceKind; readonly archived: boolean }[],
): ResourceKind | undefined {
  const counts = new Map<ResourceKind, number>();
  for (const resource of resources) {
    if (!resource.archived) counts.set(resource.kind, (counts.get(resource.kind) ?? 0) + 1);
  }
  let best: ResourceKind | undefined;
  for (const [kind, count] of counts) if (best === undefined || count > (counts.get(best) ?? 0)) best = kind;
  return best;
}

/** The days of a weekly pattern, Monday first. */
export const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** One day of a weekly pattern. */
export type WeekDay = (typeof WEEK_DAYS)[number];

/** The rules settled by the cross check (spec 0065, Limits), in one place. */
export const HOSPITALITY_LIMITS = {
  places: 20,
  areasPerPlace: 12,
  resourcesPerPlace: 300,
  /** Resources one bulk add makes. */
  resourcesPerAdd: 100,
  joinsPerResource: 10,
  rangesPerDay: 3,
  exceptions: 100,
  capacityMin: 1,
  capacityMax: 100,
  labelMax: 12,
  areaNameMax: 40,
  placeNameMax: 80,
  businessNameMax: 80,
  descriptionMax: 160,
  noteMax: 60,
  rangeNameMax: 24,
  links: 10,
} as const;

/** One opening range: `HH:MM` to `HH:MM`, crossing midnight when `to` is not after `from` (AC-6508). */
export interface HoursRangeShape {
  readonly from: string;
  readonly to: string;
  /** Lunch, Dinner: what the reservation page groups its times by (Rules settled: Hours). */
  readonly name?: string | undefined;
}

/** A dated exception: closed, or other ranges, with an optional note ("Private event"). */
export interface HoursExceptionShape {
  readonly date: string;
  readonly closed?: boolean | undefined;
  readonly ranges?: readonly HoursRangeShape[] | undefined;
  readonly note?: string | undefined;
}

/** A place's opening hours: a weekly pattern and dated exceptions. */
export interface PlaceHoursShape {
  readonly weekly: { readonly [Day in WeekDay]?: readonly HoursRangeShape[] | undefined };
  readonly exceptions: readonly HoursExceptionShape[];
}

/** Hours with nothing open. */
export const EMPTY_HOURS: PlaceHoursShape = { weekly: {}, exceptions: [] };

/**
 * A new place's week (owner, 4 Nov 2026): a restaurant's, lunch 12:00 to 15:00 and dinner 18:00 to 22:00, Tuesday to
 * Sunday, closed Monday, so the menu and the table pages read sensibly before anyone opens the hours.
 */
export const RESTAURANT_HOURS: PlaceHoursShape = {
  weekly: Object.fromEntries(
    (['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((day) => [
      day,
      [
        { from: '12:00', to: '15:00', name: 'Lunch' },
        { from: '18:00', to: '22:00', name: 'Dinner' },
      ],
    ]),
  ),
  exceptions: [],
};

/**
 * A salon's, a clinic's or a studio's first week (spec 0066 B1, Foolproof): Tuesday to Saturday 09:00 to 18:00, so a
 * new staff member's shifts (which start from the place's hours) and the first bookable times work at once.
 */
export const APPOINTMENT_HOURS: PlaceHoursShape = {
  weekly: Object.fromEntries(
    (['tue', 'wed', 'thu', 'fri', 'sat'] as const).map((day) => [day, [{ from: '09:00', to: '18:00' }]]),
  ),
  exceptions: [],
};

/** The kinds of business that book people rather than tables: their first place opens on `APPOINTMENT_HOURS`. */
export const APPOINTMENT_KINDS: readonly BusinessKind[] = ['salon', 'spa', 'barber', 'clinic', 'fitness'];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight of `HH:MM`, or undefined when it isn't one. */
export function hoursMinutesOf(time: string): number | undefined {
  const match = TIME.exec(time);
  if (match === null) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** A range's start and end in minutes from the start of its own day; the end passes 1440 when it crosses midnight. */
export function spanOf(range: HoursRangeShape): { readonly start: number; readonly end: number } | undefined {
  const start = hoursMinutesOf(range.from);
  const to = hoursMinutesOf(range.to);
  if (start === undefined || to === undefined || start === to) return undefined;
  return { start, end: to > start ? to : to + 1440 };
}

/** What is wrong with one day's ranges, or undefined: at most 3, each a real range, in order, none overlapping. */
export function rangesProblem(ranges: readonly HoursRangeShape[]): string | undefined {
  if (ranges.length > HOSPITALITY_LIMITS.rangesPerDay) {
    return `A day takes up to ${String(HOSPITALITY_LIMITS.rangesPerDay)} opening times.`;
  }
  let previousEnd = -1;
  for (const range of ranges) {
    const span = spanOf(range);
    if (span === undefined) return 'Give each opening time a start and a different end, such as 12:00 to 15:00.';
    if (span.start < previousEnd) return 'Opening times can’t overlap. Put them in order through the day.';
    previousEnd = span.end;
  }
  // Only the last range may cross midnight, and nothing may run into the next day past the first range's start.
  if (ranges.slice(0, -1).some((range) => (spanOf(range)?.end ?? 0) > 1440)) {
    return 'Only the last opening time of a day can run past midnight.';
  }
  return undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What is wrong with a place's hours, or undefined (AC-6508): each day's ranges as `rangesProblem` says, a range
 * that runs past midnight never past the next day's first opening, every exception a real date at most once, closed
 * or with ranges, and at most 100 of them.
 */
export function hoursProblem(hours: PlaceHoursShape): string | undefined {
  for (const [index, day] of WEEK_DAYS.entries()) {
    const ranges = hours.weekly[day] ?? [];
    const problem = rangesProblem(ranges);
    if (problem !== undefined) return problem;
    const last = ranges.at(-1);
    const next = hours.weekly[WEEK_DAYS[(index + 1) % 7] ?? 'mon']?.[0];
    const lastSpan = last === undefined ? undefined : spanOf(last);
    const nextSpan = next === undefined ? undefined : spanOf(next);
    if (lastSpan !== undefined && nextSpan !== undefined && lastSpan.end - 1440 > nextSpan.start) {
      return 'A late opening time runs into the next day’s first one.';
    }
  }
  if (hours.exceptions.length > HOSPITALITY_LIMITS.exceptions) {
    return `A place takes up to ${String(HOSPITALITY_LIMITS.exceptions)} special days.`;
  }
  const seen = new Set<string>();
  for (const exception of hours.exceptions) {
    if (!DATE.test(exception.date) || Number.isNaN(Date.parse(`${exception.date}T00:00:00Z`))) {
      return 'Give each special day a date.';
    }
    if (seen.has(exception.date)) return 'Each date can have only one special day.';
    seen.add(exception.date);
    if (exception.closed === true && (exception.ranges?.length ?? 0) > 0) {
      return 'A special day is either closed or has its own hours.';
    }
    if (exception.closed !== true && (exception.ranges?.length ?? 0) === 0) {
      return 'Mark a special day closed, or give it its hours.';
    }
    const problem = rangesProblem(exception.ranges ?? []);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/** A table label typed into Add tables: letters and digits, spaces inside, up to 12 characters ("T4", "Bar 2"). */
export const RESOURCE_LABEL_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._/-]*[\p{L}\p{N}])?$/u;

/**
 * The labels "T1 to T10" makes (AC-6509): `prefix` followed by each number from `from` to `to`, or undefined when
 * the run is empty, over the one add's limit, or makes a label that isn't one.
 */
export function resourceLabels(prefix: string, from: number, to: number): readonly string[] | undefined {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) return undefined;
  if (to - from + 1 > HOSPITALITY_LIMITS.resourcesPerAdd) return undefined;
  const labels = Array.from({ length: to - from + 1 }, (_, index) => `${prefix}${String(from + index)}`);
  return labels.every((label) => label.length <= HOSPITALITY_LIMITS.labelMax && RESOURCE_LABEL_PATTERN.test(label))
    ? labels
    : undefined;
}
