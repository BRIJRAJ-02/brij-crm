// A place's hours (spec 0065, AC-6508) as the library's HoursEditor draws them, and back. Pure, no React. The editor
// writes a window that runs past midnight with its end past `24:00` (Friday 18:00 to `26:00`); a place stores it as
// `18:00` to `02:00`, a range that crosses midnight because its end is not after its start. Names (Lunch, Dinner)
// stay with their window's place in the day.
import type { HoursRange, PlaceHours, WeekDay } from '@crm/data';
import { hoursProblem, WEEK_DAYS } from '@crm/data/hospitality';

/** One window as the editor holds it: `[start, end]`, the end past `24:00` when it runs into the next morning. */
export type EditorRange = readonly [start: string, end: string];

const minutes = (time: string): number => {
  const [hours = '0', mins = '0'] = time.split(':');
  return Number(hours) * 60 + Number(mins);
};

const clock = (value: number): string =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

/** A stored range as the editor draws it. */
export function toEditor(range: HoursRange): EditorRange {
  const start = minutes(range.from);
  const end = minutes(range.to);
  return [range.from, clock(end > start ? end : end + 1440)];
}

/** An editor window as stored, keeping the name the window at this place had. */
export function fromEditor(range: EditorRange, name: string | undefined): HoursRange {
  const end = minutes(range[1]);
  return {
    from: range[0],
    to: clock(end >= 1440 ? end - 1440 : end),
    ...(name === undefined ? {} : { name }),
  };
}

/** The week's rows for the editor, Monday first. */
export function weekRows(
  hours: PlaceHours,
  label: (day: WeekDay) => string,
  error?: { readonly day: WeekDay; readonly message: string },
): {
  readonly id: WeekDay;
  readonly label: string;
  readonly ranges: readonly EditorRange[];
  readonly error?: string;
}[] {
  return WEEK_DAYS.map((day) => ({
    id: day,
    label: label(day),
    ranges: (hours.weekly[day] ?? []).map(toEditor),
    ...(error?.day === day ? { error: error.message } : {}),
  }));
}

/**
 * The hours with one day's windows replaced, and what is wrong with them (the rule the server runs), or undefined
 * when they hold together.
 */
export function withDay(
  hours: PlaceHours,
  day: WeekDay,
  ranges: readonly EditorRange[],
): { readonly hours: PlaceHours; readonly problem?: string } {
  const before = hours.weekly[day] ?? [];
  const next: PlaceHours = {
    ...hours,
    weekly: { ...hours.weekly, [day]: ranges.map((range, index) => fromEditor(range, before[index]?.name)) },
  };
  const problem = hoursProblem(next);
  return problem === undefined ? { hours: next } : { hours: next, problem };
}

/** Whether `day` is a week day key. */
export const isWeekDay = (value: string): value is WeekDay => (WEEK_DAYS as readonly string[]).includes(value);
