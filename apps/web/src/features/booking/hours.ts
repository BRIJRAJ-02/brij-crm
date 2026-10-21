// Availability as HoursEditor rows and days off, and the checks the server
// makes, so a window that ends before it starts or overlaps another is said
// on its row before anything is sent (spec 0025, AC-624, AC-680). Plain
// functions.
import type { BookingAvailability, DateOverride, TimeRange, Weekday } from '@crm/data';
import { strings } from './strings.ts';

/** The weekdays, Monday first, as the availability keys them. */
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const minutesOf = (time: string): number => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

/** What's wrong with a day's windows, or undefined. */
export function rangesProblem(ranges: readonly (readonly [string, string])[]): string | undefined {
  if (ranges.some(([start, end]) => minutesOf(end) <= minutesOf(start))) return strings.endBeforeStart;
  // A schedule's times sit on 15 minute steps (spec 0035, AC-961); the server refuses any other.
  if (ranges.some((range) => range.some((time) => minutesOf(time) % 15 !== 0))) return strings.quarterHour;
  const sorted = [...ranges].sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
  for (let index = 1; index < sorted.length; index += 1) {
    if (minutesOf(sorted[index]?.[0] ?? '00:00') < minutesOf(sorted[index - 1]?.[1] ?? '00:00')) return strings.overlap;
  }
  return undefined;
}

/** The week as HoursEditor rows, with each day's problem. */
export function weekRows(availability: BookingAvailability) {
  return WEEKDAYS.map((day) => {
    const ranges = availability.weekly[day];
    const problem = rangesProblem(ranges);
    return { id: day, label: strings.weekday[day], ranges, ...(problem === undefined ? {} : { error: problem }) };
  });
}

/** True when every day is fine to send. */
export function availabilityIsValid(availability: BookingAvailability): boolean {
  return (
    WEEKDAYS.every((day) => rangesProblem(availability.weekly[day]) === undefined) &&
    availability.overrides.every((override) => rangesProblem(override.ranges) === undefined)
  );
}

/**
 * Whether two sets of hours are the same hours: the week day by day, the zone, and the date overrides whatever
 * their order. A save hands back the same hours the editor sent, so this is what says nothing is unsaved.
 */
export function sameHours(a: BookingAvailability, b: BookingAvailability): boolean {
  const canonical = (hours: BookingAvailability) =>
    JSON.stringify([
      hours.timeZone,
      WEEKDAYS.map((day) => hours.weekly[day]),
      [...hours.overrides]
        .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
        .map((override) => [override.date, override.ranges, override.note ?? '']),
    ]);
  return canonical(a) === canonical(b);
}

/** The availability with one day's windows replaced. */
export function withDay(
  availability: BookingAvailability,
  day: string,
  ranges: readonly (readonly [string, string])[],
): BookingAvailability {
  if (!(WEEKDAYS as readonly string[]).includes(day)) return availability;
  return {
    ...availability,
    weekly: { ...availability.weekly, [day]: ranges.map((range): TimeRange => [range[0], range[1]]) },
  };
}

/** The days off from today on (a date with no windows), by date. */
export function upcomingDaysOff(availability: BookingAvailability, today: string): readonly DateOverride[] {
  return availability.overrides
    .filter((override) => override.ranges.length === 0 && override.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The availability with a day off added (or its reason changed), or a date opened again. */
export function withDayOff(
  availability: BookingAvailability,
  date: string,
  note: string | undefined,
): BookingAvailability {
  const others = availability.overrides.filter((override) => override.date !== date);
  return {
    ...availability,
    overrides: [...others, { date, ranges: [], ...(note === undefined || note === '' ? {} : { note }) }],
  };
}

/** The availability with a date's override removed: it books by the week again. */
export function openDay(availability: BookingAvailability, date: string): BookingAvailability {
  return { ...availability, overrides: availability.overrides.filter((override) => override.date !== date) };
}

/** A date as a short label ("Thu 24 Dec 2026"). */
export function dateLabel(date: string, language?: string): string {
  const [year = 1970, month = 1, day = 1] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(language, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Today's date in a zone, `YYYY-MM-DD`. */
export function todayIn(zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

/** The browser's zones for a picker, the current one first when it isn't listed. */
export function timeZones(current: string): readonly string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return listed.includes(current) ? listed : [current, ...listed];
}

/** A zone as a picker shows it: the place, with its offset from GMT now beside it ("GMT+05:30"). */
export interface ZoneItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** The zone's offset from GMT at `at`, as "GMT+05:30" (none is "GMT+00:00", which engines spell either way). */
export function zoneOffset(zone: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((each) => each.type === 'timeZoneName');
  const value = part?.value ?? 'GMT';
  return value === 'GMT' ? 'GMT+00:00' : value;
}

/**
 * Zones some browsers still name by their old spelling (Chrome answers Asia/Calcutta where Firefox and Safari answer
 * Asia/Kolkata). The picker shows the current name and lists each place once; the stored value stays as it was.
 */
const RENAMED: Readonly<Record<string, string>> = Object.freeze({
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
});

/** A zone as people read it: its current name, with spaces ("Asia/Kolkata", "America/New York"). */
export function zoneLabel(zone: string): string {
  return (RENAMED[zone] ?? zone).replaceAll('_', ' ');
}

/** The picker's zones, the current one first, each with its offset (as timefix lists them), each place once. */
export function zoneItems(current: string, at: Date): readonly ZoneItem[] {
  const seen = new Set<string>();
  return [current, ...timeZones(current)].flatMap((zone) => {
    const label = zoneLabel(zone);
    if (seen.has(label)) return [];
    seen.add(label);
    return [{ id: zone, label, description: zoneOffset(zone, at) }];
  });
}

/** An offset as typed, the way the list writes it: "utc+5", "+5:30" and "gmt+530" all read as "gmt+05:30". */
function offsetWord(word: string): string {
  return word
    .replace(/^utc/, 'gmt')
    .replace(/([+-])(\d)(\d\d)$/, '$10$2$3')
    .replace(/([+-])(\d)(?=\D|$)/, '$10$2')
    .replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
}

/** A zone search: every word typed is in the place or the offset ("new york", "gmt+5", "+5:30", "utc-8"). */
export function zoneMatches(item: { readonly label: string; readonly description?: string }, query: string): boolean {
  const text = `${item.label} ${item.description ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '')
    .every((word) => text.includes(word) || text.includes(offsetWord(word)));
}

/** The browser's zone. */
export const browserZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;

// A week as words and a clock time as words: the one summary in `@crm/contracts/hours`, through the data layer.
export { clockLabel, weekSummary } from '@crm/data';
