// The reservation page's pure helpers (spec 0066 B7 lite): which days are open on the place's own calendar, how a
// time reads on the place's clock, and Lunch and Dinner from the place's service windows (0065 AC-6551). Times are always the place's, since a guest
// books a table where the table is.
import type { PublicTablePage } from '@crm/data/tables';

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** `date` (YYYY-MM-DD) plus `days`. */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Whether the place opens at all on `date`: an exception decides, else the weekly pattern has a range that day. */
export function isOpenOn(hours: PublicTablePage['hours'], date: string): boolean {
  const exception = hours.exceptions.find((each) => each.date === date);
  if (exception !== undefined) return exception.closed !== true && (exception.ranges?.length ?? 0) > 0;
  const day = WEEK[new Date(`${date}T12:00:00.000Z`).getUTCDay()] ?? 'sun';
  return (hours.weekly[day]?.length ?? 0) > 0;
}

/** The open days from `today` through the page's window, in order. */
export function openDays(page: Pick<PublicTablePage, 'hours' | 'today' | 'windowDays'>): readonly string[] {
  const days: string[] = [];
  for (let offset = 0; offset < page.windowDays; offset += 1) {
    const date = addDays(page.today, offset);
    if (isOpenOn(page.hours, date)) days.push(date);
  }
  return days;
}

/** "6:00 PM" or "18:00" for an instant on the place's clock. */
export function timeLabel(instant: string, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(
    new Date(instant),
  );
}

/** "Mon 9 Nov" on the place's clock. */
export function shortDay(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00.000Z`),
  );
}

/** "Monday 9 November" on the place's clock. */
export function longDay(instant: string, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone }).format(
    new Date(instant),
  );
}

/** "HH:MM" of an instant on the place's clock. */
function clockOf(instant: string, zone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: zone,
  }).format(new Date(instant));
}

/** The opening ranges of `date`: its exception's own, else the weekly pattern's. */
export function rangesOn(
  hours: PublicTablePage['hours'],
  date: string,
): readonly { readonly from: string; readonly to: string; readonly name?: string | undefined }[] {
  const exception = hours.exceptions.find((each) => each.date === date);
  if (exception !== undefined) return exception.closed === true ? [] : (exception.ranges ?? []);
  const day = WEEK[new Date(`${date}T12:00:00.000Z`).getUTCDay()] ?? 'sun';
  return hours.weekly[day] ?? [];
}

/** How a group of times is headed: Lunch, Dinner, plain Times, or the range's own name. */
export type ServiceHeading =
  { readonly kind: 'lunch' | 'dinner' | 'times' } | { readonly kind: 'named'; readonly text: string };

/**
 * The day's times grouped by the place's service windows (its opening ranges that day), never by a fixed hour: a
 * range's own name heads it ("Brunch"); else two or more ranges read Lunch (the first) and Dinner (the last), with
 * any between headed by their hours; one range is just Times. A time outside every range joins the range before it.
 */
export function services(
  times: readonly string[],
  zone: string,
  ranges: readonly { readonly from: string; readonly to: string; readonly name?: string | undefined }[],
): readonly { readonly key: string; readonly heading: ServiceHeading; readonly times: readonly string[] }[] {
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from));
  if (sorted.length <= 1) {
    const only = sorted[0];
    return times.length === 0
      ? []
      : [
          {
            key: only?.from ?? 'times',
            heading: only?.name === undefined ? { kind: 'times' } : { kind: 'named', text: only.name },
            times,
          },
        ];
  }
  const groups = sorted.map((range) => ({ range, times: [] as string[] }));
  for (const time of times) {
    const clock = clockOf(time, zone);
    const index = groups.findLastIndex((group) => group.range.from <= clock);
    (groups[Math.max(0, index)] ?? groups[0])?.times.push(time);
  }
  return groups.flatMap((group, index): ReturnType<typeof services> => {
    if (group.times.length === 0) return [];
    const { range } = group;
    const heading: ServiceHeading =
      range.name !== undefined
        ? { kind: 'named', text: range.name }
        : index === 0
          ? { kind: 'lunch' }
          : index === groups.length - 1
            ? { kind: 'dinner' }
            : { kind: 'named', text: `${range.from}–${range.to}` };
    return [{ key: range.from, heading, times: group.times }];
  });
}

/** The place date of an instant. */
export function placeDate(instant: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone }).format(
    new Date(instant),
  );
}

/** A calendar's compact UTC stamp, `20261109T180000Z`. */
export function compact(instant: string): string {
  return instant.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
