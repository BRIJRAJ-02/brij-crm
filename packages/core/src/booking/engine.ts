// The slot engine (spec 0025, AC-624, AC-629): pure. Rules, overrides, busy
// times, bookings, buffers, notice, the booking window, the daily limit and a
// zone go in, slots come out; nothing here touches the database or the
// network, so every edge (zones, DST, midnight, month and year ends) is tested
// on its own. Adapted from an earlier scheduling build, reshaped to this repo:
//
//   slots = weekly rules for the weekday (host zone), replaced by a date override
//         − busy (the calendar's freeBusy), against each slot widened by its buffers
//         − confirmed bookings' blocked ranges (their `during`), likewise
//         − [now, now + minimum notice), and anything starting past now + the window
//         − days that reached the daily limit
//         stepped by the slot step, each slot `durationMinutes` long
//
// Rules and overrides are integer minutes from LOCAL midnight in the host's
// zone (DST proof by construction); everything else is an absolute instant.
// Wall clock to instant happens in one place (`toInstant`), through Luxon,
// never raw Date arithmetic.
import { DateTime } from 'luxon';

/** A span of local minutes from midnight (0 to 1440), the end exclusive. */
export interface MinuteWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/** One weekly range: the weekday (0 Sunday to 6 Saturday) and its local minutes. */
export interface WeeklyRule extends MinuteWindow {
  readonly dayOfWeek: number;
}

/** One date's own hours (`YYYY-MM-DD` in the host's zone): several ranges, or none for a day off. They replace the week's. */
export interface DateOverride {
  readonly date: string;
  readonly windows: readonly MinuteWindow[];
}

/** An absolute span, the end exclusive. */
export interface Span {
  readonly start: Date;
  readonly end: Date;
}

/** A confirmed booking: its meeting, and the range it blocks (its `during`, buffers included; the meeting when absent). */
export interface BookedSpan extends Span {
  readonly blockStart?: Date;
  readonly blockEnd?: Date;
  /** Whether it counts toward this page's daily limit (a booking on another of the host's pages only blocks). Default true. */
  readonly countsToLimit?: boolean;
}

/** Everything the engine reads. */
export interface SlotEngineInput {
  readonly rules: readonly WeeklyRule[];
  readonly overrides: readonly DateOverride[];
  /** Busy times from the host's calendars (absolute instants). */
  readonly busy: readonly Span[];
  /** Confirmed bookings of the host that overlap the range. */
  readonly bookings: readonly BookedSpan[];
  readonly durationMinutes: number;
  /** Minutes a slot blocks before its start and after its end; the visitor still sees `durationMinutes`. */
  readonly bufferBefore: number;
  readonly bufferAfter: number;
  /** The zone the rules and overrides are in (IANA name). */
  readonly hostZone: string;
  /** The clock, passed in. */
  readonly now: Date;
  /** The range asked for: slots starting at or after `from` and before `to`. */
  readonly from: Date;
  readonly to: Date;
  /** Nobody books a slot starting sooner than this. Default 0. */
  readonly minNoticeMinutes?: number;
  /** Nothing starts later than now plus this many days. Default: no limit past `to`. */
  readonly windowDays?: number;
  /** At most this many confirmed bookings start on one host day; a day at it offers nothing. Default: no limit. */
  readonly dailyLimit?: number;
  /**
   * How often a slot starts. Defaults to the duration. Coarser leaves gaps
   * between slots; finer offers overlapping starts (each still blocks its own
   * span, so two of them can never both be booked). Zero or negative falls
   * back to the duration rather than looping forever.
   */
  readonly slotStepMinutes?: number;
}

/** Wall clock minutes to an instant on `day`. 1440 is the following midnight; a time a DST gap skips moves forward. */
function toInstant(day: DateTime, minute: number): DateTime {
  if (minute >= 1440) return day.plus({ days: 1 }).startOf('day');
  return day.set({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0 });
}

/** Half open overlap: touching ends don't overlap, so back to back meetings are allowed. */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return bStart < aEnd && aStart < bEnd;
}

/**
 * A day's windows: the week's ranges for its weekday (several, for split
 * shifts), or the date's override outright (none at all for a day off).
 */
export function windowsForDay(
  day: DateTime,
  rules: readonly WeeklyRule[],
  overrides: ReadonlyMap<string, DateOverride>,
): readonly MinuteWindow[] {
  const override = overrides.get(day.toISODate() ?? '');
  if (override !== undefined) return override.windows;
  return rules
    .filter((rule) => rule.dayOfWeek === day.weekday % 7)
    .map((rule) => ({ startMinute: rule.startMinute, endMinute: rule.endMinute }));
}

/**
 * What stays open of one window after the blocked spans are taken out:
 * plain numbers, so it serves milliseconds and minutes alike. `blocked` must
 * be sorted by start; `floor` clips the result below.
 */
export function subtractBlocked(
  windowStart: number,
  windowEnd: number,
  blocked: readonly { readonly start: number; readonly end: number }[],
  floor = -Infinity,
): readonly { readonly start: number; readonly end: number }[] {
  const open: { start: number; end: number }[] = [];
  let cursor = Math.max(windowStart, floor);
  for (const block of blocked) {
    if (block.end <= cursor || block.start >= windowEnd) continue;
    if (block.start > cursor) open.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  if (cursor < windowEnd) open.push({ start: cursor, end: windowEnd });
  return open;
}

/**
 * The bookable slots in the range, chronological. Each day's windows are
 * merged (touching or overlapping) before stepping, per day and never across
 * midnight, so the step restarts at each day's own opening and a DST day
 * never drifts the slots after it.
 */
export function computeSlots(input: SlotEngineInput): readonly Span[] {
  const { durationMinutes, bufferBefore, bufferAfter, hostZone } = input;
  if (!(durationMinutes > 0)) return [];
  const step =
    input.slotStepMinutes !== undefined && input.slotStepMinutes > 0 ? input.slotStepMinutes : durationMinutes;
  const overrides = new Map(input.overrides.map((override) => [override.date, override]));
  const busy = input.busy.map((span) => ({ start: span.start.getTime(), end: span.end.getTime() }));
  const booked = input.bookings.map((booking) => ({
    start: (booking.blockStart ?? booking.start).getTime(),
    end: (booking.blockEnd ?? booking.end).getTime(),
  }));
  const now = DateTime.fromJSDate(input.now, { zone: hostZone });
  const earliest = Math.max(now.plus({ minutes: input.minNoticeMinutes ?? 0 }).toMillis(), input.from.getTime());
  const latest = Math.min(
    input.windowDays === undefined ? Infinity : now.plus({ days: input.windowDays }).toMillis(),
    input.to.getTime(),
  );
  // Confirmed bookings per host day, for the daily limit.
  const perDay = new Map<string, number>();
  for (const booking of input.bookings) {
    if (booking.countsToLimit === false) continue;
    const date = DateTime.fromJSDate(booking.start, { zone: hostZone }).toISODate() ?? '';
    perDay.set(date, (perDay.get(date) ?? 0) + 1);
  }

  const slots: Span[] = [];
  const lastDay = DateTime.fromJSDate(input.to, { zone: hostZone }).startOf('day');
  for (
    let day = DateTime.fromJSDate(input.from, { zone: hostZone }).startOf('day');
    day <= lastDay;
    day = day.plus({ days: 1 }).startOf('day')
  ) {
    const date = day.toISODate() ?? '';
    if (input.dailyLimit !== undefined && (perDay.get(date) ?? 0) >= input.dailyLimit) continue;
    const spans = windowsForDay(day, input.rules, overrides)
      .filter((window) => window.endMinute > window.startMinute)
      .map((window) => ({
        start: toInstant(day, window.startMinute).toMillis(),
        end: toInstant(day, window.endMinute).toMillis(),
      }))
      .sort((a, b) => a.start - b.start);
    // Merge overlapping and touching spans (`<=`): 08–12 and 12–20 join, 08–12 and 14–20 stay two.
    const merged: { start: number; end: number }[] = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last !== undefined && span.start <= last.end)
        merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
      else merged.push(span);
    }
    for (const window of merged) {
      const windowEnd = DateTime.fromMillis(window.end, { zone: hostZone });
      // A slot must end inside its window, so a fine step never offers one that runs past closing.
      for (
        let start = DateTime.fromMillis(window.start, { zone: hostZone });
        start.plus({ minutes: durationMinutes }) <= windowEnd;
        start = start.plus({ minutes: step })
      ) {
        const startMs = start.toMillis();
        if (startMs < earliest || startMs >= latest) continue;
        const endMs = start.plus({ minutes: durationMinutes }).toMillis();
        // Buffers widen what the slot blocks, not what the visitor sees.
        const blockStart = startMs - bufferBefore * 60_000;
        const blockEnd = endMs + bufferAfter * 60_000;
        if (busy.some((span) => overlaps(blockStart, blockEnd, span.start, span.end))) continue;
        if (booked.some((span) => overlaps(blockStart, blockEnd, span.start, span.end))) continue;
        slots.push({ start: new Date(startMs), end: new Date(endMs) });
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}
