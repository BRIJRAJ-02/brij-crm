// A logged call or meeting as the screens word and time it (migration 0141): plain functions with no React, so they
// test in Node. Its time is a day and a minute of that day on the clock of the person's time zone; the server keeps
// the instant. Its duration and outcome are worded here, since the library draws only what it is handed.
import {
  ACTIVITY_AHEAD_MS,
  ACTIVITY_DURATION_MAX,
  type Hue,
  type NoteKind,
  type NoteOutcome,
  type NoteSummary,
} from '@crm/data';
import { dayKeyOf, instantAt, minuteOfDay } from '../bookings/week.ts';
import { strings } from './strings.ts';

/** The kinds a person logs: a call or a meeting. */
export type LoggedKind = Exclude<NoteKind, 'note'>;

/** The lengths offered as chips, in minutes; any other goes through Custom. */
export const DURATION_CHOICES: readonly number[] = [15, 30, 60];

/** The steps the time list moves in, in minutes. */
export const TIME_STEP = 5;

/** The colour each outcome's tag takes: the good ones green, a miss grey, a left message blue, a no show red. */
export const OUTCOME_HUES: Readonly<Record<NoteOutcome, Hue>> = {
  connected: 'green',
  no_answer: 'gray',
  left_message: 'blue',
  held: 'green',
  cancelled: 'gray',
  no_show: 'red',
};

/** A length in words: "15 min", "1 h", "1 h 30 min". */
export function durationWords(minutes: number): string {
  if (minutes < 60) return strings.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? strings.hours(hours) : strings.hoursMinutes(hours, rest);
}

/** An outcome as a coloured tag's label and hue; undefined for none (or one this app doesn't know). */
export function outcomeTag(outcome: string | undefined): { readonly label: string; readonly hue: Hue } | undefined {
  if (outcome === undefined || !(outcome in OUTCOME_HUES)) return undefined;
  const known = outcome as NoteOutcome;
  return { label: strings.outcomes[known], hue: OUTCOME_HUES[known] };
}

/** A custom length typed in minutes: a whole number from 1 to 1,440, else undefined. */
export function parseMinutes(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const minutes = Number(trimmed);
  return minutes >= 1 && minutes <= ACTIVITY_DURATION_MAX ? minutes : undefined;
}

/** When something happened, as the dialog holds it: a day (`yyyy-MM-dd`) and a minute of that day, on the zone's clock. */
export interface When {
  readonly day: string;
  readonly minute: number;
}

/** The clock reading of an instant (ISO 8601) in `zone`, to the minute. */
export function whenOf(instant: string, zone: string): When {
  const at = new Date(instant);
  return { day: dayKeyOf(at, zone), minute: minuteOfDay(at, zone) };
}

/** Now, on the zone's clock, rounded down to a time step: what a new entry opens on. */
export function nowWhen(nowMs: number, zone: string): When {
  const at = new Date(nowMs);
  const minute = minuteOfDay(at, zone);
  return { day: dayKeyOf(at, zone), minute: minute - (minute % TIME_STEP) };
}

/** The instant (ISO 8601 in UTC, to the millisecond) the zone's clock reads `when`. */
export function instantOf(when: When, zone: string): string {
  return instantAt(when.day, when.minute, zone).toISOString();
}

/** Whether `when` is more than a day past now: the server refuses it, so the dialog says so first. */
export function isTooFarAhead(when: When, zone: string, nowMs: number): boolean {
  return instantAt(when.day, when.minute, zone).getTime() > nowMs + ACTIVITY_AHEAD_MS;
}

/** One entry of the time list: its minute of the day as the id, and the clock's words as the label. */
export interface TimeItem {
  readonly id: string;
  readonly label: string;
}

/**
 * The times of a day every `TIME_STEP` minutes in the language's own clock ("2:05 PM" or "14:05"), and `extra` (an
 * entry's own minute when it is off the steps), in order.
 */
export function timeItems(locale: string, extra?: number): readonly TimeItem[] {
  const format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const label = (minute: number) => format.format(new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60)));
  const minutes: number[] = [];
  for (let minute = 0; minute < 1440; minute += TIME_STEP) minutes.push(minute);
  if (extra !== undefined && !minutes.includes(extra)) {
    minutes.push(extra);
    minutes.sort((a, b) => a - b);
  }
  return minutes.map((minute) => ({ id: String(minute), label: label(minute) }));
}

/** The duration chips: the three lengths, and the entry's own when it is another one. */
export function durationChoices(
  current: number | undefined,
): readonly { readonly id: string; readonly label: string }[] {
  const lengths =
    current === undefined || DURATION_CHOICES.includes(current)
      ? DURATION_CHOICES
      : [...DURATION_CHOICES, current].sort((a, b) => a - b);
  return lengths.map((minutes) => ({ id: String(minutes), label: durationWords(minutes) }));
}

/** A note summary's face in a list or the timeline: its kind, its worded duration and its outcome tag. */
export function activityFace(note: Pick<NoteSummary, 'kind' | 'durationMinutes' | 'outcome'>):
  | {
      readonly kind: LoggedKind;
      readonly duration?: string;
      readonly outcome?: { readonly label: string; readonly hue: Hue };
    }
  | undefined {
  if (note.kind === 'note') return undefined;
  const tag = outcomeTag(note.outcome);
  return {
    kind: note.kind,
    ...(note.durationMinutes === undefined ? {} : { duration: durationWords(note.durationMinutes) }),
    ...(tag === undefined ? {} : { outcome: tag }),
  };
}
