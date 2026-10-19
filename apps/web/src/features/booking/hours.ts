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

/** Every day open all day: the new page's "Any time". */
export function anyTime(timeZone: string): BookingAvailability {
  const allDay: TimeRange[] = [['00:00', '24:00']];
  return {
    timeZone,
    weekly: { mon: allDay, tue: allDay, wed: allDay, thu: allDay, fri: allDay, sat: allDay, sun: allDay },
    overrides: [],
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

/** The browser's zone. */
export const browserZone = (): string => new Intl.DateTimeFormat().resolvedOptions().timeZone;
