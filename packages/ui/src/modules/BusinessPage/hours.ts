// The business page's hours, read for people (spec 0066, AC-6641): whether the place is open now and until when, or
// when it opens next, and the week as rows with today marked. Pure, on the place's own wall clock (the open and next
// opening rules are contracts' `openAt` and `nextOpening`, the server's own), so it runs in Node tests and on the page.
import { WEEK_DAYS, type PlaceHoursShape, type WeekDay } from '@crm/contracts/hospitality';
import { nextOpening, openAt, rangesOn, weekDayOf } from '@crm/contracts/hospitality-hours';
import { strings } from './strings.ts';

/**
 * The locale a place's times read in: the visitor's language, with the place's country's own clock style ("18:00" for a
 * place in London, "6:00 pm" for one in Bengaluru), whatever the visitor's browser would use. The clock style is the
 * country's main language's (`und-IN` is `hi-IN`, a 12 hour clock); an unknown or missing country keeps the visitor's.
 */
export function placeLocale(visitor: string, country: string | undefined): string {
  if (country === undefined || !/^[A-Z]{2}$/.test(country)) return visitor;
  try {
    // The country's main language, without its script (`en-Latn-GB` falls back to `en`'s 12 hour clock; `en-GB` is 24).
    const native = `${new Intl.Locale('und', { region: country }).maximize().language}-${country}`;
    const hourCycle = new Intl.DateTimeFormat(native, { hour: 'numeric' }).resolvedOptions().hourCycle;
    const language = new Intl.Locale(visitor).language;
    return new Intl.Locale(language, { region: country, ...(hourCycle === undefined ? {} : { hourCycle }) }).toString();
  } catch {
    return visitor;
  }
}

/** A wall time `HH:MM` in the given locale ("18:00", "6:00 PM"). */
export function wallTime(time: string, locale: string): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 5, hours, minutes)),
  );
}

/** The date `YYYY-MM-DD` it is now on the place's wall clock. */
export function placeDate(now: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const part = (type: string) => parts.find((each) => each.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** A week day's name in the visitor's language ("Monday"). */
export function dayName(day: WeekDay, locale: string, style: 'long' | 'short' = 'long'): string {
  // 5 January 2026 was a Monday.
  const date = new Date(Date.UTC(2026, 0, 5 + WEEK_DAYS.indexOf(day)));
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(date);
}

/** Whether the place is open, in words: the state and the line beside it. */
export interface OpenStatus {
  readonly isOpen: boolean;
  /** "Open now" or "Closed". */
  readonly state: string;
  /** "Closes at 23:00", "Opens tomorrow at 12:00", or nothing when it opens nowhere in two weeks. */
  readonly detail?: string;
}

/** The place's open status at `now`, in the visitor's language, on the place's own clock. */
export function openStatus(hours: PlaceHoursShape, now: number, zone: string, locale: string): OpenStatus {
  const instant = new Date(now);
  const open = openAt(hours, instant, zone);
  if (open.open && open.range !== undefined) {
    return { isOpen: true, state: strings.openNow, detail: strings.closesAt(wallTime(open.range.to, locale)) };
  }
  const next = nextOpening(hours, instant, zone);
  if (next === undefined) return { isOpen: false, state: strings.closed };
  const today = placeDate(now, zone);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const time = wallTime(next.range.from, locale);
  const when =
    next.date === today
      ? strings.opensToday(time)
      : next.date === tomorrow
        ? strings.opensTomorrow(time)
        : strings.opensOn(dayName(weekDayOf(next.date), locale), time);
  return { isOpen: false, state: strings.closed, detail: strings.opensAt(when) };
}

/** One day of the week's hours, as the list shows it. */
export interface HoursRow {
  readonly day: WeekDay;
  readonly name: string;
  /** "12:00 – 15:00", one per range; empty when it is closed all day. */
  readonly ranges: readonly string[];
  readonly isToday: boolean;
}

/**
 * The seven days from Monday, each with its ranges in the visitor's language. Today (on the place's clock) reads its
 * own date, so an exception today (closed for a holiday) shows; the other days show the weekly pattern.
 */
export function weekRows(hours: PlaceHoursShape, now: number, zone: string, locale: string): readonly HoursRow[] {
  const today = placeDate(now, zone);
  const todayDay = weekDayOf(today);
  return WEEK_DAYS.map((day) => {
    const ranges = day === todayDay ? rangesOn(hours, today) : (hours.weekly[day] ?? []);
    return {
      day,
      name: dayName(day, locale),
      ranges: ranges.map((range) => `${wallTime(range.from, locale)} – ${wallTime(range.to, locale)}`),
      isToday: day === todayDay,
    };
  });
}

/** The place's city from its zone ("Asia/Kolkata" reads "Kolkata"), for "Times in Kolkata time". */
export function zoneCity(zone: string): string {
  return (zone.split('/').at(-1) ?? zone).replaceAll('_', ' ');
}

/**
 * The section tabs' current section: the last whose top has passed under the tabs, or the last of all once the page
 * is scrolled to its end, where the last sections can never reach the tabs; the first before any has passed.
 */
export function currentSection(
  ids: readonly string[],
  passed: ReadonlySet<string>,
  isAtEnd: boolean,
): string | undefined {
  if (isAtEnd) return ids.at(-1);
  return [...ids].reverse().find((id) => passed.has(id)) ?? ids[0];
}
