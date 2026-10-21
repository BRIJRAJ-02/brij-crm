// What Bookings' addresses hold, read and written in one place for both tabs'
// routes (plain functions, no React, so loaders can use them):
// - Calendar: `w` (the week's Monday), `d` (the day picked), `link`, `cal`;
// - List: `tab` (`past`, `cancelled`), `src` (`bookings`, `calendar`), `link`, `cal`.
// The list pages by cursor (More), so the address holds no page.
import type { BookingsTab, MeetingSource } from '@crm/data';
import { dayKeyOf, isDayKey, weekOf } from './week.ts';

/** The address as it is written; anything else in it is dropped. */
export interface RawBookingsSearch {
  readonly w?: string;
  readonly d?: string;
  readonly tab?: 'past' | 'cancelled';
  readonly src?: 'bookings' | 'calendar';
  readonly link?: string;
  readonly cal?: string;
}

/** What the screens read: the week and day, the tab, the source and the filters. */
export interface BookingsSearch {
  /** The Monday of the week shown (`yyyy-MM-dd`). */
  readonly week: string;
  /** The day selected (a narrow screen shows it alone). */
  readonly day: string;
  readonly tab: BookingsTab;
  /** The list's meetings: all, the bookings, or the calendar events. */
  readonly source: MeetingSource;
  /** One booking page's bookings only. */
  readonly link?: string;
  /** The calendars whose events show, of those shown on the member's week; absent is all of them. A view only. */
  readonly cal?: readonly string[];
}

/** Reads an address's query, keeping only well formed values. */
export function parseBookingsSearch(search: Record<string, unknown>): RawBookingsSearch {
  return {
    ...(isDayKey(search.w) ? { w: search.w } : {}),
    ...(isDayKey(search.d) ? { d: search.d } : {}),
    ...(search.tab === 'past' || search.tab === 'cancelled' ? { tab: search.tab } : {}),
    ...(search.src === 'bookings' || search.src === 'calendar' ? { src: search.src } : {}),
    ...(typeof search.link === 'string' && /^[0-9a-f-]{36}$/i.test(search.link) ? { link: search.link } : {}),
    ...(typeof search.cal === 'string' && search.cal.length <= 4_000 ? { cal: search.cal } : {}),
  };
}

/** The address as the screens read it, defaults filled in from `now`. */
export function bookingsSearchOf(raw: RawBookingsSearch, now: Date = new Date()): BookingsSearch {
  const day = raw.d ?? raw.w ?? dayKeyOf(now);
  return {
    week: raw.w ?? weekOf(day),
    day,
    tab: raw.tab ?? 'upcoming',
    source: raw.src ?? 'all',
    ...(raw.link === undefined ? {} : { link: raw.link }),
    ...(raw.cal === undefined ? {} : { cal: raw.cal === '' ? [] : raw.cal.split(',') }),
  };
}

/** The address for a tab's search: only what differs from the defaults. */
export function rawOf(tab: 'calendar' | 'list', search: BookingsSearch): RawBookingsSearch {
  const shared = {
    ...(search.link === undefined ? {} : { link: search.link }),
    ...(search.cal === undefined ? {} : { cal: search.cal.join(',') }),
  };
  if (tab === 'calendar') return { w: search.week, d: search.day, ...shared };
  return {
    ...(search.tab === 'upcoming' ? {} : { tab: search.tab }),
    ...(search.source === 'all' ? {} : { src: search.source }),
    ...shared,
  };
}
