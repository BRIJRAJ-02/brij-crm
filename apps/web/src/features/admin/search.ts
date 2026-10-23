// Settings › Super admin (spec 0047): the period and search a page's address
// keeps. Only the routes' search and loaders read it: they load up front, so
// a screen (or a route's own split component) never imports it, or it becomes
// a file of its own in the first load. The screens read figures.ts's copy.
import type { OperatorPeriod } from '@crm/data';

/** The periods a page reads, shortest first (the contract's `OPERATOR_PERIODS`). */
export const PERIODS: readonly OperatorPeriod[] = ['7d', '30d', '90d'];

/** The period a page reads when the address names none. */
export const DEFAULT_PERIOD: OperatorPeriod = '30d';

/** A console page's address: its period, kept as `?period=`. */
export interface PeriodSearch {
  readonly period?: OperatorPeriod;
}

/** The period an address names, or none (the default then applies). */
export function periodSearch(search: Record<string, unknown>): PeriodSearch {
  const period = PERIODS.find((each) => each === search['period']);
  return period === undefined || period === DEFAULT_PERIOD ? {} : { period };
}

/** The period an address reads: the one it names, or the default. */
export function periodOf(search: PeriodSearch): OperatorPeriod {
  return search.period ?? DEFAULT_PERIOD;
}

/** The users list's address: the period and the search. */
export interface UsersSearch extends PeriodSearch {
  readonly q?: string;
}

/** The users list's address, read safely: a search of at most 100 characters. */
export function usersSearch(search: Record<string, unknown>): UsersSearch {
  const q = typeof search['q'] === 'string' ? search['q'].trim().slice(0, 100) : '';
  return { ...periodSearch(search), ...(q === '' ? {} : { q }) };
}
