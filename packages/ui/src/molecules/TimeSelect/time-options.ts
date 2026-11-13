// TimeSelect's list (spec 0073, AC-7306): every time of day a step apart, and how a time reads on a 12 or 24 hour
// clock. Pure and free of React, so the unit project tests it in Node, and a summary ("Mon 9:00 AM to 5:00 PM") can
// write a time the same way the list does.
import { memoIntl } from '../../lib/intl-memo.ts';

/** A 12 hour clock ("9:30 AM") or a 24 hour one ("09:30"); left out, the reader's language decides. */
export type HourCycle = 12 | 24;

/** One time in the list: its `HH:MM` id and how it reads. */
export interface TimeOption {
  readonly id: string;
  readonly label: string;
}

/** `HH:MM` for a minute of the day. */
export function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The minute of the day an `HH:MM` time is, or undefined when it isn't one. */
export function minutesOfClock(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (match === null) return undefined;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes < 24 * 60 ? minutes : undefined;
}

/** How `value` (`HH:MM`) reads in `locale`: "9:30 AM" on a 12 hour clock, "09:30" on a 24 hour one. */
export function formatTime(value: string, locale: string, hourCycle?: HourCycle): string {
  const minutes = minutesOfClock(value);
  if (minutes === undefined) return value;
  const cycle = hourCycle === undefined ? 'locale' : String(hourCycle);
  const format = memoIntl(
    `time-select:${locale}:${cycle}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        // A 24 hour clock pads its hour (09:30), as a timetable does.
        hour: hourCycle === 24 ? '2-digit' : 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
        ...(hourCycle === 12 ? { hourCycle: 'h12' as const } : hourCycle === 24 ? { hourCycle: 'h23' as const } : {}),
      }),
  );
  return format.format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));
}

/** What `timeOptions` lists: `step` minutes apart, from `from` (inclusive) to `to` (exclusive), minutes of the day. */
export interface TimeOptionsInput {
  readonly locale: string;
  readonly step?: number;
  readonly hourCycle?: HourCycle;
  readonly from?: number;
  readonly to?: number;
}

/** Every time of day `step` minutes apart (15 by default, as Cal.com lists them), each with its `HH:MM` id. */
export function timeOptions({
  locale,
  step = 15,
  hourCycle,
  from = 0,
  to = 24 * 60,
}: TimeOptionsInput): readonly TimeOption[] {
  const safeStep = Math.max(1, Math.round(step));
  const options: TimeOption[] = [];
  for (let minutes = Math.max(0, from); minutes < Math.min(to, 24 * 60); minutes += safeStep) {
    const id = clockOf(minutes);
    options.push({ id, label: formatTime(id, locale, hourCycle) });
  }
  return options;
}
