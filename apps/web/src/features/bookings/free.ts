// Where Bookings' New meeting starts: the next free half hour in the week on screen, inside the member's hours,
// clear of their bookings, calendar events, busy times and closed time. Pure: the clock, the zone and the week come in.
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

/** What `nextFreeSpan` reads. */
export interface FreeSpanInput {
  readonly now: Date;
  /** The Monday of the week on screen. */
  readonly week: string;
  /** How long the meeting is. */
  readonly minutes: number;
  readonly busy: readonly { readonly start: number; readonly end: number }[];
  readonly availability?: BookingAvailability;
  /** The member's zone, the one the week is drawn in. */
  readonly zone: string;
}

/**
 * The first half hour, `minutes` long, inside the member's hours and clear of everything busy: from now in this
 * week, from the week's start in a later one. A week already past, or one with no free time left, gives the next
 * half hour from now.
 */
export function nextFreeSpan({ now, week, minutes, busy, availability, zone }: FreeSpanInput): DrawnSpan {
  const today = dayKeyOf(now, zone);
  const nowMinute = minuteOfDay(now, zone);
  const isFree = (dayKey: string, start: number) => {
    const from = instantAt(dayKey, start, zone).getTime();
    const to = from + minutes * 60_000;
    return busy.every((span) => span.end <= from || span.start >= to);
  };
  for (const dayKey of weekDays(week)) {
    if (dayKey < today) continue;
    for (const [rangeStart, rangeEnd] of workingRanges(availability, dayKey)) {
      const earliest = dayKey === today ? Math.max(rangeStart, nowMinute) : rangeStart;
      let start = Math.ceil(earliest / STEP_MINUTES) * STEP_MINUTES;
      for (; start + minutes <= rangeEnd; start += STEP_MINUTES) {
        if (isFree(dayKey, start)) return { dayKey, startMinute: start, endMinute: start + minutes };
      }
    }
  }
  // Nothing left in the week: the next half hour from now, which the dialog's times can move.
  const next = Math.ceil((nowMinute + 1) / STEP_MINUTES) * STEP_MINUTES;
  if (next + minutes <= 1440) return { dayKey: today, startMinute: next, endMinute: next + minutes };
  return { dayKey: addDays(today, 1), startMinute: 9 * 60, endMinute: 9 * 60 + minutes };
}
