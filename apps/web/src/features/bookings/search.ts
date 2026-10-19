// What Bookings' addresses hold, read and written in one place for both tabs'
// routes (plain functions, no React, so loaders can use them):
// - Calendar: `w` (the week's Monday), `d` (the day picked), `link`, `conn`;
// - List: `tab` (`past`, `cancelled`), `page`, `per`, `sort`, `link`.
import type { BookingsTab } from '@crm/data';
import { dayKeyOf, isDayKey, weekOf } from './week.ts';

/** The address as it is written; anything else in it is dropped. */
export interface RawBookingsSearch {
  readonly w?: string;
  readonly d?: string;
  readonly tab?: 'past' | 'cancelled';
  readonly page?: number;
  readonly per?: number;
  readonly sort?: 'asc' | 'desc';
  readonly link?: string;
  readonly conn?: string;
}

/** What the screens read: the week and day, the tab, the page, the sort and the filters. */
export interface BookingsSearch {
  /** The Monday of the week shown (`yyyy-MM-dd`). */
  readonly week: string;
  /** The day selected (a narrow screen shows it alone). */
  readonly day: string;
  readonly tab: BookingsTab;
  readonly page: number;
  readonly per: number;
  /** `asc` soonest first; `desc` latest first. Upcoming defaults to asc, Past to desc. */
  readonly sort?: 'asc' | 'desc';
  /** One booking page's bookings only. */
  readonly link?: string;
  /** The connections whose events show; absent is all of them. */
  readonly conn?: readonly string[];
}

/** Rows per page the list offers. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;

const number = (value: unknown) => (typeof value === 'number' ? value : Number(value));

/** Reads an address's query, keeping only well formed values. */
export function parseBookingsSearch(search: Record<string, unknown>): RawBookingsSearch {
  const page = number(search.page);
  const per = number(search.per);
  return {
    ...(isDayKey(search.w) ? { w: search.w } : {}),
    ...(isDayKey(search.d) ? { d: search.d } : {}),
    ...(search.tab === 'past' || search.tab === 'cancelled' ? { tab: search.tab } : {}),
    ...(Number.isInteger(page) && page > 1 ? { page } : {}),
    ...(PAGE_SIZES.some((size) => size === per) && per !== 10 ? { per } : {}),
    ...(search.sort === 'asc' || search.sort === 'desc' ? { sort: search.sort } : {}),
    ...(typeof search.link === 'string' && /^[0-9a-f-]{36}$/i.test(search.link) ? { link: search.link } : {}),
    ...(typeof search.conn === 'string' && search.conn.length <= 2_000 ? { conn: search.conn } : {}),
  };
}

/** The address as the screens read it, defaults filled in from `now`. */
export function bookingsSearchOf(raw: RawBookingsSearch, now: Date = new Date()): BookingsSearch {
  const day = raw.d ?? raw.w ?? dayKeyOf(now);
  return {
    week: raw.w ?? weekOf(day),
    day,
    tab: raw.tab ?? 'upcoming',
    page: raw.page ?? 1,
    per: raw.per ?? 10,
    ...(raw.sort === undefined ? {} : { sort: raw.sort }),
    ...(raw.link === undefined ? {} : { link: raw.link }),
    ...(raw.conn === undefined ? {} : { conn: raw.conn === '' ? [] : raw.conn.split(',') }),
  };
}

/** The address for a tab's search: only what differs from the defaults. */
export function rawOf(tab: 'calendar' | 'list', search: BookingsSearch): RawBookingsSearch {
  const shared = {
    ...(search.link === undefined ? {} : { link: search.link }),
  };
  if (tab === 'calendar') {
    return {
      w: search.week,
      d: search.day,
      ...shared,
      ...(search.conn === undefined ? {} : { conn: search.conn.join(',') }),
    };
  }
  return {
    ...(search.tab === 'upcoming' ? {} : { tab: search.tab }),
    ...(search.page > 1 ? { page: search.page } : {}),
    ...(search.per === 10 ? {} : { per: search.per }),
    ...(search.sort === undefined ? {} : { sort: search.sort }),
    ...shared,
  };
}
