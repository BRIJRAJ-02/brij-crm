// A place's opening hours, read at an instant (spec 0065, AC-6508; Rules settled: Hours). Pure: a range belongs to the
// date it starts on (Friday 18:00 to 02:00 is Friday's), an exception on a date replaces only the ranges starting
// that date, and every comparison is made on the place's own wall clock, so a clock change never moves an opening
// time. A wall time a clock change skips reads forward (02:30 on the spring change opens at 03:00), one it repeats
// reads as its first, as calendars do.
import {
  spanOf,
  WEEK_DAYS,
  type HoursRangeShape,
  type PlaceHoursShape,
  type WeekDay,
} from '@crm/contracts/hospitality';

/** A wall clock reading in a zone: the date (`YYYY-MM-DD`) and the minutes since its midnight. */
interface Wall {
  readonly date: string;
  readonly minutes: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** The zone's formatter, made once (a zone the platform doesn't know throws a RangeError). */
function formatOf(zone: string): Intl.DateTimeFormat {
  let found = formats.get(zone);
  if (found === undefined) {
    found = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(zone, found);
  }
  return found;
}

/** The parts of `instant` on the zone's wall clock. */
function partsOf(instant: number, zone: string) {
  const parts = formatOf(zone).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

/** `instant` on the zone's wall clock. */
function wallOf(instant: number, zone: string): Wall {
  const p = partsOf(instant, zone);
  return {
    date: `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
    minutes: p.hour * 60 + p.minute,
  };
}

/** The zone's offset from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const p = partsOf(instant, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a wall time on `date` reads as in `zone`, `minutes` after its midnight (past 1440 for the next day).
 * It tries the zone's offsets six hours either side, so a clock change between them is seen: a repeated time reads
 * as its first, a skipped one forward by the gap.
 */
export function wallToInstant(date: string, minutes: number, zone: string): Date {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day) + minutes * 60_000;
  const wanted = wallOf(wall, 'UTC');
  const candidates = [wall - offsetAt(wall - SIX_HOURS, zone), wall - offsetAt(wall + SIX_HOURS, zone)];
  const reads = candidates.filter((candidate) => {
    const read = wallOf(candidate, zone);
    return read.date === wanted.date && read.minutes === wanted.minutes;
  });
  return new Date(reads.length > 0 ? Math.min(...reads) : Math.max(...candidates));
}

const SIX_HOURS = 6 * 3_600_000;

/** The day of the week of a `YYYY-MM-DD` date. */
export function weekDayOf(date: string): WeekDay {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return WEEK_DAYS[(day + 6) % 7] ?? 'mon';
}

/** The date `days` after `date`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The ranges that start on `date` (AC-6508): the exception's for that date when there is one (none when it is
 * closed), else the weekly pattern's for its day of the week.
 */
export function rangesOn(hours: PlaceHoursShape, date: string): readonly HoursRangeShape[] {
  const exception = hours.exceptions.find((each) => each.date === date);
  if (exception !== undefined) return exception.closed === true ? [] : (exception.ranges ?? []);
  return hours.weekly[weekDayOf(date)] ?? [];
}

/** Whether a place is open, and in which range, at an instant. */
export interface OpenNow {
  readonly open: boolean;
  /** The range it is open in, and the date that range started on. */
  readonly range?: HoursRangeShape;
  readonly since?: string;
  /** When that range closes. */
  readonly closesAt?: Date;
}

/**
 * Whether the place is open at `instant`, on its own wall clock in `zone`: in one of today's ranges, or in last
 * night's range that runs past midnight.
 */
export function openAt(hours: PlaceHoursShape, instant: Date, zone: string): OpenNow {
  const now = wallOf(instant.getTime(), zone);
  const yesterday = addDays(now.date, -1);
  for (const [date, offset] of [
    [now.date, 0],
    [yesterday, 1440],
  ] as const) {
    for (const range of rangesOn(hours, date)) {
      const span = spanOf(range);
      if (span === undefined) continue;
      const minute = now.minutes + offset;
      if (minute >= span.start && minute < span.end) {
        return { open: true, range, since: date, closesAt: wallToInstant(date, span.end, zone) };
      }
    }
  }
  return { open: false };
}

/** How far ahead `nextOpening` looks: two weeks, past any run of closed days a place would have. */
const LOOK_AHEAD_DAYS = 14;

/**
 * The next time the place opens after `instant` (strictly later), with the range and its date, or undefined when
 * nothing opens in the next two weeks. "Opens at 18:00" on a closed place reads it.
 */
export function nextOpening(
  hours: PlaceHoursShape,
  instant: Date,
  zone: string,
): { readonly at: Date; readonly range: HoursRangeShape; readonly date: string } | undefined {
  const today = wallOf(instant.getTime(), zone).date;
  for (let day = 0; day <= LOOK_AHEAD_DAYS; day += 1) {
    const date = addDays(today, day);
    for (const range of rangesOn(hours, date)) {
      const span = spanOf(range);
      if (span === undefined) continue;
      const at = wallToInstant(date, span.start, zone);
      if (at.getTime() > instant.getTime()) return { at, range, date };
    }
  }
  return undefined;
}
