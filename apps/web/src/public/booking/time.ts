// Dates and times in the visitor's zone for the public booking page (spec
// 0025, AC-630, AC-668), with the browser's Intl only (the page never loads a
// date library): day keys, local midnight, months, the zone's label and
// times in 12 or 24 hours.

/** `YYYY-MM-DD` of an instant in `zone`. */
export function dayKey(instant: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((each) => each.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return asUtc - (instant - (instant % 1000));
}

/** The instant a day (`YYYY-MM-DD`) starts in `zone`: its local midnight (or the first moment after a DST gap). */
export function startOfDay(key: string, zone: string): number {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess, zone);
  // Once more at the found instant, for a day whose offset changed since the guess; a midnight a DST gap skips
  // lands on the day before, so the first moment of the day is the first answer.
  const second = guess - offsetAt(first, zone);
  return dayKey(second, zone) === key ? second : first;
}

/** The key of the day `days` after `key`. */
export function addDays(key: string, days: number): string {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** A day key as a UTC noon Date, for formatting the calendar date alone. */
const noon = (key: string) => {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

/** A day's labels in the visitor's language: "Mon", "2", "Monday 2 November", "Mon 2 Nov". */
export function dayLabels(
  key: string,
  locale: string,
): { readonly weekday: string; readonly day: string; readonly label: string; readonly short: string } {
  const date = noon(key);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options }).format(date);
  return {
    weekday: format({ weekday: 'short' }),
    day: format({ day: 'numeric' }),
    label: format({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    short: format({ weekday: 'short', day: 'numeric', month: 'short' }),
  };
}

/** `YYYY-MM` of a day key. */
export const monthOf = (key: string) => key.slice(0, 7);

/** The month `delta` months after `month`. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 1970, number = 1] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** "November 2026". */
export function monthLabel(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    noon(`${month}-01`),
  );
}

/** The locale's first day of the week, 0 Sunday to 6 Saturday (Monday where the browser can't say). */
export function firstDayOfWeek(locale: string): number {
  try {
    const info = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay ?? 1;
    return firstDay % 7;
  } catch {
    return 1;
  }
}

/** The month's cells from the locale's first weekday: blanks, then each day key. */
export function monthCells(month: string, locale: string): readonly (string | undefined)[] {
  const [year = 1970, number = 1] = month.split('-').map(Number);
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() - firstDayOfWeek(locale) + 7) % 7;
  return [
    ...Array.from({ length: lead }, () => undefined),
    ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`),
  ];
}

/** The weekday names in grid order, short and long. */
export function weekdayNames(locale: string): readonly { readonly short: string; readonly long: string }[] {
  const first = firstDayOfWeek(locale);
  // 4 January 2026 is a Sunday.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 4 + ((first + index) % 7), 12));
    const format = (weekday: 'narrow' | 'long') =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday }).format(date);
    return { short: format('narrow'), long: format('long') };
  });
}

/** The zone's offset as GMT says it: "GMT+4", "GMT+5:30". */
export function offsetLabel(zone: string, at: number): string {
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
        .formatToParts(new Date(at))
        .find((part) => part.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

/** Zones Chrome still names by their old spelling (Asia/Calcutta), by their current name. */
const RENAMED: Readonly<Record<string, string>> = Object.freeze({
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Godthab': 'America/Nuuk',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
});

/** "Asia/Dubai" as a person says it: "Dubai time (GMT+4)"; a zone with no city keeps its name. */
export function zoneDisplay(zone: string, at: number): string {
  if (!zone.includes('/') || zone.startsWith('Etc/')) return zone.replaceAll('_', ' ');
  const city = (RENAMED[zone] ?? zone).split('/').pop()?.replaceAll('_', ' ') ?? zone;
  const offset = offsetLabel(zone, at);
  return offset === '' ? `${city} time` : `${city} time (${offset})`;
}

/** Whether the locale writes times in 12 hours. */
export function localeUses12h(locale: string): boolean {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle?.startsWith('h1') ?? false;
}

/** A time of day in the zone: "9:30 AM" or "09:30". */
export function timeLabel(instant: string, zone: string, locale: string, hour12?: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: hour12 === false ? '2-digit' : 'numeric',
    minute: '2-digit',
    ...(hour12 === undefined ? {} : { hour12 }),
  }).format(new Date(instant));
}

/** A slot as the details step heads it: "Tue, Aug 19, 9:30 AM". */
export function slotLabel(instant: string, zone: string, locale: string, hour12?: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(hour12 === undefined ? {} : { hour12 }),
  }).format(new Date(instant));
}

/** A meeting's span in the zone, written as the locale writes a range of times. */
export function rangeLabel(start: string, end: string, zone: string, locale: string, hour12?: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: hour12 === false ? '2-digit' : 'numeric',
    minute: '2-digit',
    ...(hour12 === undefined ? {} : { hour12 }),
  }).formatRange(new Date(start), new Date(end));
}

/** The whole date: "Thursday, 20 August 2026". */
export function longDate(instant: string, zone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant));
}

/** How far a moment is from now, said plainly: "In 3 minutes", "Tomorrow morning", "In 5 days". */
export function relativeLabel(instant: string, now: number, zone: string, locale: string): string {
  const at = Date.parse(instant);
  const minutes = Math.round((at - now) / 60_000);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 0) return relative.format(Math.round(minutes / 60 / 24), 'day');
  const capital = (text: string) => text.replace(/^./, (first) => first.toUpperCase());
  if (minutes < 60) return capital(relative.format(minutes, 'minute'));
  const days = Math.round((startOfDay(dayKey(at, zone), zone) - startOfDay(dayKey(now, zone), zone)) / 86_400_000);
  if (days === 0) return capital(relative.format(Math.round(minutes / 60), 'hour'));
  if (days === 1) {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(at),
    );
    const part = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
    return `${relative.format(1, 'day').replace(/^./, (first) => first.toUpperCase())} ${part}`;
  }
  return relative.format(days, 'day').replace(/^./, (first) => first.toUpperCase());
}
