// Where Bookings' New meeting starts: the next free half hour in the week on screen, inside the member's hours,
// clear of their bookings, calendar events, busy times and closed time; with none left there, the first in the next
// two weeks (Q72). Pure: the clock, the zone and the weeks come in.
import type { BookingAvailability, BookingsCalendarView } from '@crm/data';
import type { DrawnSpan } from './span.ts';
import { addDays, dayKeyOf, dayStart, instantAt, minuteOfDay, weekDays } from './week.ts';

/** New meeting starts on the half hour. */
const STEP_MINUTES = 30;

/** A member's day when their hours aren't known: 9:00 to 17:00, Monday to Friday. */
const DEFAULT_DAY: readonly (readonly [number, number])[] = [[9 * 60, 17 * 60]];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** "09:30" as minutes from midnight. */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** The member's working ranges on a day, as minutes: their hours, or 9:00 to 17:00 on weekdays when unknown. */
export function workingRanges(
  availability: BookingAvailability | undefined,
  dayKey: string,
): readonly (readonly [number, number])[] {
  const weekday = WEEKDAY_KEYS[dayStart(dayKey).getDay()] ?? 'mon';
  if (availability === undefined) return weekday === 'sat' || weekday === 'sun' ? [] : DEFAULT_DAY;
  const override = availability.overrides.find((each) => each.date === dayKey);
  const ranges = override === undefined ? availability.weekly[weekday] : override.ranges;
  return ranges.map(([start, end]) => [minutesOf(start), end === '24:00' ? 1440 : minutesOf(end)] as const);
}

/** What holds a member's time in a week's read: confirmed bookings, timed calendar events, busy times, closed time. */
export function busyOf(
  week: BookingsCalendarView | undefined,
): readonly { readonly start: number; readonly end: number }[] {
  if (week === undefined) return [];
  const spans = [
    ...week.bookings.filter((booking) => booking.status === 'confirmed'),
    ...week.events.filter((event) => !event.allDay),
    ...week.busy,
    ...week.blocks,
  ];
  return spans.map((span) => ({ start: Date.parse(span.startsAt), end: Date.parse(span.endsAt) }));
}

/** How many weeks after the one on screen New meeting looks in when that week has no free time left (Q72). */
export const LOOK_AHEAD_WEEKS = 2;

/**
 * The weeks New meeting looks in after the week on screen, when that week has no free time left: the next two that
 * aren't over yet, starting on the week on screen's first day (so a past week on screen looks in this week and the
 * next).
 */
export function lookAheadWeeks(week: string, now: Date, zone: string): readonly string[] {
  const today = dayKeyOf(now, zone);
  let first = addDays(week, 7);
  // Whole weeks behind today, at once: a week on screen long past doesn't step a week at a time.
  // Days rounded first, so a clock change inside the gap doesn't lose a week.
  const days = Math.round((dayStart(today).getTime() - dayStart(first).getTime()) / 86_400_000);
  const behind = Math.floor(days / 7);
  if (behind > 0) first = addDays(first, behind * 7);
  return Array.from({ length: LOOK_AHEAD_WEEKS }, (_, index) => addDays(first, index * 7));
}

/** What `nextFreeSpan` and `freeSpanIn` read. */
export interface FreeSpanInput {
  readonly now: Date;
  /** The first day of the week on screen. */
  readonly week: string;
  /**
   * Later weeks to look in, in order, when the week on screen has no free time left (`lookAheadWeeks`); their
   * busy times are in `busy` too. None, by default.
   */
  readonly laterWeeks?: readonly string[];
  /** How long the meeting is. */
  readonly minutes: number;
  readonly busy: readonly { readonly start: number; readonly end: number }[];
  readonly availability?: BookingAvailability;
  /** The member's zone, the one the week is drawn in. */
  readonly zone: string;
}

/**
 * The first half hour, `minutes` long, inside the member's hours and clear of everything busy, in the week on
 * screen and then each later week given: from now in this week, from a week's start in a later one. Nothing when
 * none of them has free time left.
 */
export function freeSpanIn({
  now,
  week,
  laterWeeks = [],
  minutes,
  busy,
  availability,
  zone,
}: FreeSpanInput): DrawnSpan | undefined {
  const today = dayKeyOf(now, zone);
  const nowMinute = minuteOfDay(now, zone);
  const isFree = (dayKey: string, start: number) => {
    const from = instantAt(dayKey, start, zone).getTime();
    const to = from + minutes * 60_000;
    return busy.every((span) => span.end <= from || span.start >= to);
  };
  for (const dayKey of [week, ...laterWeeks].flatMap(weekDays)) {
    if (dayKey < today) continue;
    for (const [rangeStart, rangeEnd] of workingRanges(availability, dayKey)) {
      const earliest = dayKey === today ? Math.max(rangeStart, nowMinute) : rangeStart;
      let start = Math.ceil(earliest / STEP_MINUTES) * STEP_MINUTES;
      for (; start + minutes <= rangeEnd; start += STEP_MINUTES) {
        if (isFree(dayKey, start)) return { dayKey, startMinute: start, endMinute: start + minutes };
      }
    }
  }
  return undefined;
}

/**
 * Where New meeting starts: the first free half hour (`freeSpanIn`), else the next half hour from now, which the
 * dialog's times can move.
 */
export function nextFreeSpan(input: FreeSpanInput): DrawnSpan {
  return freeSpanIn(input) ?? nextHalfHour(input);
}

/** The next half hour from now, `minutes` long (tomorrow at nine when today has no room): what the look falls back to. */
export function nextHalfHour({ now, minutes, zone }: Pick<FreeSpanInput, 'now' | 'minutes' | 'zone'>): DrawnSpan {
  const today = dayKeyOf(now, zone);
  const next = Math.ceil((minuteOfDay(now, zone) + 1) / STEP_MINUTES) * STEP_MINUTES;
  if (next + minutes <= 1440) return { dayKey: today, startMinute: next, endMinute: next + minutes };
  return { dayKey: addDays(today, 1), startMinute: 9 * 60, endMinute: 9 * 60 + minutes };
}

/** A span of held time, in epoch milliseconds. */
type Held = { readonly start: number; readonly end: number };

/** What `findFreeSpan` reads: `nextFreeSpan`'s input, less the busy times, which it reads a week at a time. */
export interface FindFreeSpanInput extends Omit<FreeSpanInput, 'busy' | 'laterWeeks'> {
  /** A week's busy times, read first where they haven't been; undefined when its read failed. */
  readonly busyIn: (week: string) => Promise<readonly Held[] | undefined>;
}

/**
 * Where New meeting starts, reading as it goes (Q72): the first free half hour in the week on screen, else in the next
 * two weeks, each read only when the one before is full. A week whose read failed ends the look, since its free time
 * isn't known; only then the next half hour from now.
 */
export async function findFreeSpan({ busyIn, ...input }: FindFreeSpanInput): Promise<DrawnSpan> {
  const shown = await busyIn(input.week);
  if (shown === undefined) return nextHalfHour(input);
  const busy: Held[] = [...shown];
  const laterWeeks: string[] = [];
  const found = freeSpanIn({ ...input, busy });
  if (found !== undefined) return found;
  for (const week of lookAheadWeeks(input.week, input.now, input.zone)) {
    const held = await busyIn(week);
    if (held === undefined) break;
    busy.push(...held);
    laterWeeks.push(week);
    const later = freeSpanIn({ ...input, laterWeeks, busy });
    if (later !== undefined) return later;
  }
  return nextHalfHour(input);
}
