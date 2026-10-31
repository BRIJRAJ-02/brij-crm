// What Bookings' addresses hold, read and written in one place for both tabs'
// routes (plain functions, no React, so loaders can use them):
// - Calendar: `w` (the week's Monday), `d` (the day picked), `v` (`day` for the day view, `team` for the Team day),
//   `link`, `cal`; the Team day's filters `who` (people's ids), `booked` and `order` (spec 0030, AC-766);
// - List: `tab` (`past`, `cancelled`), `src` (`bookings`, `calendar`), `link`, `cal`.
// The list pages by cursor (More), so the address holds no page.
import type { BookingsTab, MeetingSource } from '@crm/data';
import { dayKeyOf, isDayKey, weekOf } from './week.ts';

/** The address as it is written; anything else in it is dropped. */
export interface RawBookingsSearch {
  readonly w?: string;
  readonly d?: string;
  readonly v?: 'day' | 'team';
  /** The Team day's people, by id, comma separated; absent is everyone the reader may see. */
  readonly who?: string;
  readonly booked?: '1';
  readonly order?: 'title';
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
  /** The calendar's Day or Week (D and W); absent is the week. Kept in the address, so a reload or a link keeps it. */
  readonly view?: 'week' | 'day' | 'team';
  /** The Team day's people (spec 0030, AC-766): absent is everyone the reader may see. */
  readonly members?: readonly string[];
  /** The Team day: only people with a booking that day. */
  readonly withBookings?: boolean;
  /** The Team day's order (AC-1438): by job title; absent is me first, then by name. */
  readonly order?: 'title';
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
    ...(search.v === 'day' || search.v === 'team' ? { v: search.v } : {}),
    ...(typeof search.who === 'string' && /^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,49}$/i.test(search.who)
      ? { who: search.who }
      : {}),
    ...(search.booked === '1' || search.booked === 1 ? { booked: '1' as const } : {}),
    ...(search.order === 'title' ? { order: 'title' as const } : {}),
    ...(search.tab === 'past' || search.tab === 'cancelled' ? { tab: search.tab } : {}),
    ...(search.src === 'bookings' || search.src === 'calendar' ? { src: search.src } : {}),
    ...(typeof search.link === 'string' && /^[0-9a-f-]{36}$/i.test(search.link) ? { link: search.link } : {}),
    ...(typeof search.cal === 'string' && search.cal.length <= 4_000 ? { cal: search.cal } : {}),
  };
}

/** The address as the screens read it, defaults filled in from `now` (today as it is in `zone`, the member's). */
export function bookingsSearchOf(raw: RawBookingsSearch, now: Date, firstDay: number, zone: string): BookingsSearch {
  const day = raw.d ?? raw.w ?? dayKeyOf(now, zone);
  return {
    // A link's week starts on the member's week start too, so Today and the grid agree.
    week: weekOf(raw.w ?? day, firstDay),
    day,
    ...(raw.v === undefined ? {} : { view: raw.v }),
    ...(raw.who === undefined ? {} : { members: raw.who.split(',') }),
    ...(raw.booked === undefined ? {} : { withBookings: true }),
    ...(raw.order === undefined ? {} : { order: raw.order }),
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
  if (tab === 'calendar') {
    return {
      w: search.week,
      d: search.day,
      ...(search.view === 'day' || search.view === 'team' ? { v: search.view } : {}),
      ...(search.members === undefined || search.members.length === 0 ? {} : { who: search.members.join(',') }),
      ...(search.withBookings === true ? { booked: '1' as const } : {}),
      ...(search.order === undefined ? {} : { order: search.order }),
      ...shared,
    };
  }
  return {
    ...(search.tab === 'upcoming' ? {} : { tab: search.tab }),
    ...(search.source === 'all' ? {} : { src: search.source }),
    ...shared,
  };
}
