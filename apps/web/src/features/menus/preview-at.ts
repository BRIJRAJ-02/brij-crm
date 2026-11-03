// The editor's "Preview at" (spec 0065, AC-6520, after checklabs' `?at=` menu preview): a day of the week and a time
// on the place's own clock, kept in the address as `?at=sat-11:00`, read as the next such moment from today. Pure.
import { addDays, wallToInstant, weekDayOf, WEEK_DAYS } from '@crm/data/menu';

/** A week day the preview can be read on. */
export type PreviewDay = (typeof WEEK_DAYS)[number];

/** A moment to read the menu at: a day of the week and `HH:MM` on the place's clock. */
export interface PreviewAt {
  readonly day: PreviewDay;
  readonly time: string;
}

/** The days, Monday first. */
export const PREVIEW_DAYS: readonly PreviewDay[] = WEEK_DAYS;

/** Every half hour of a day, `00:00` to `23:30`. */
export const PREVIEW_TIMES: readonly string[] = Array.from(
  { length: 48 },
  (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`,
);

const AT = /^(mon|tue|wed|thu|fri|sat|sun)-([01]\d|2[0-3]):([03]0)$/;

/** `?at=` as a moment, or undefined when it isn't one. */
export function parsePreviewAt(value: unknown): PreviewAt | undefined {
  if (typeof value !== 'string') return undefined;
  const match = AT.exec(value);
  if (match === null) return undefined;
  return { day: match[1] as PreviewDay, time: `${match[2] ?? '00'}:${match[3] ?? '00'}` };
}

/** A moment as `?at=` writes it. */
export const formatPreviewAt = (at: PreviewAt): string => `${at.day}-${at.time}`;

/** The instant `at` next reads as in `zone`, from `now` (today counts when the day is today). */
export function previewInstant(at: PreviewAt, zone: string, now: Date = new Date()): Date | undefined {
  let today: string;
  try {
    today = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return undefined;
  }
  const [hours = 0, minutes = 0] = at.time.split(':').map(Number);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(today, offset);
    if (weekDayOf(date) === at.day) return wallToInstant(date, hours * 60 + minutes, zone);
  }
  return undefined;
}
