// The builder's availability as HoursEditor rows, and the checks the server
// makes, so a range that ends before it starts or overlaps another is said on
// its row before anything is sent (spec 0025, AC-624). Plain functions.
import type { BookingAvailability, DateOverride, TimeRange, Weekday } from '@crm/data';
import { strings } from './strings.ts';

/** The weekdays, Monday first, as the availability keys them. */
export const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const minutesOf = (time: string): number => {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

/** What's wrong with a day's ranges, or undefined: an end at or before its start, or two that overlap. */
export function rangesProblem(ranges: readonly (readonly [string, string])[]): string | undefined {
  if (ranges.some(([start, end]) => minutesOf(end) <= minutesOf(start))) return strings.endBeforeStart;
  const sorted = [...ranges].sort((a, b) => minutesOf(a[0]) - minutesOf(b[0]));
  for (let index = 1; index < sorted.length; index += 1) {
    if (minutesOf(sorted[index]?.[0] ?? '00:00') < minutesOf(sorted[index - 1]?.[1] ?? '00:00')) return strings.overlap;
  }
  return undefined;
}

/** The week as rows, with each day's problem. */
export function weekRows(availability: BookingAvailability) {
  return WEEKDAYS.map((day) => {
    const ranges = availability.weekly[day];
    const problem = rangesProblem(ranges);
    return { id: day, label: strings.weekday[day], ranges, ...(problem === undefined ? {} : { error: problem }) };
  });
}

/** A date as a short label in the browser's language ("Thu 24 Dec 2026"). */
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

/** The overrides as rows, by date, with each one's problem. */
export function overrideRows(overrides: readonly DateOverride[]) {
  return [...overrides]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((override) => {
      const problem = rangesProblem(override.ranges);
      return {
        id: override.date,
        label: dateLabel(override.date),
        ranges: override.ranges,
        ...(problem === undefined ? {} : { error: problem }),
      };
    });
}

/** True when every day and date is fine to send. */
export function availabilityIsValid(availability: BookingAvailability): boolean {
  return (
    WEEKDAYS.every((day) => rangesProblem(availability.weekly[day]) === undefined) &&
    availability.overrides.every((override) => rangesProblem(override.ranges) === undefined)
  );
}

/** The availability with one day's ranges replaced. */
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

/** The availability with one date's ranges set (added when new), or the date removed. */
export function withOverride(
  availability: BookingAvailability,
  date: string,
  ranges: readonly (readonly [string, string])[] | undefined,
): BookingAvailability {
  const others = availability.overrides.filter((override) => override.date !== date);
  return {
    ...availability,
    overrides:
      ranges === undefined
        ? others
        : [...others, { date, ranges: ranges.map((range): TimeRange => [range[0], range[1]]) }],
  };
}

/** The browser's zones for the picker, the page's own first when it isn't listed. */
export function timeZones(current: string): readonly string[] {
  const listed = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return listed.includes(current) ? listed : [current, ...listed];
}
