// The reservation page's pure helpers (spec 0066 B7 lite): which days are open on the place's own calendar, how a
// time reads on the place's clock, and Lunch and Dinner (0065 AC-6551). Times are always the place's, since a guest
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

/** The hour (0 to 23) of an instant on the place's clock. */
function hourOf(instant: string, zone: string): number {
  const text = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: zone }).format(
    new Date(instant),
  );
  return Number(text);
}

/** The day's times as Lunch (before 4 PM) and Dinner, each only when it has a time. */
export function services(
  times: readonly string[],
  zone: string,
): readonly { readonly name: 'lunch' | 'dinner'; readonly times: readonly string[] }[] {
  const lunch = times.filter((time) => hourOf(time, zone) < 16);
  const dinner = times.filter((time) => hourOf(time, zone) >= 16);
  return [
    ...(lunch.length === 0 ? [] : [{ name: 'lunch' as const, times: lunch }]),
    ...(dinner.length === 0 ? [] : [{ name: 'dinner' as const, times: dinner }]),
  ];
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
