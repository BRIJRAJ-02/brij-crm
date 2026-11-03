// Insights' address (spec 0067, AC-6710): the period (`?range=`, or a custom `?from=` and `?to=`) and the pages
// (`?kind=`, `?page=`), read by the route so the loader and the screen agree, and a link to a filtered view (a
// page's own Insights) is a plain link.

/** The kinds the picker offers today; the rest join with their panels. */
const KINDS = ['form', 'booking', 'link'] as const;
const RANGES = ['7', '30', '90', '365', 'all'] as const;

/** The longest custom period, in days (the API's own limit). */
export const CUSTOM_MAX_DAYS = 400;

/** What the address says. */
export interface InsightsSearch {
  readonly range?: (typeof RANGES)[number];
  /** A custom period, both UTC days included; with them, `range` is ignored. */
  readonly from?: string;
  readonly to?: string;
  readonly kind?: (typeof KINDS)[number];
  readonly page?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** How many days `from` to `to` holds, both included. */
export function daysOf(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Reads the address: only values it knows; anything else is dropped, never an error. */
export function insightsSearch(search: Record<string, unknown>): InsightsSearch {
  // The router reads `?range=90` as a number, so the address is compared as text.
  const range = RANGES.find((each) => each === String(search.range));
  const kind = KINDS.find((each) => each === search.kind);
  const page = typeof search.page === 'string' && UUID.test(search.page) ? search.page : undefined;
  const from = typeof search.from === 'string' && DAY.test(search.from) ? search.from : undefined;
  const to = typeof search.to === 'string' && DAY.test(search.to) ? search.to : undefined;
  const isCustom = from !== undefined && to !== undefined && from <= to && daysOf(from, to) <= CUSTOM_MAX_DAYS;
  return {
    ...(isCustom ? { from, to } : range === undefined ? {} : { range }),
    ...(kind === undefined ? {} : { kind }),
    ...(page === undefined || kind === undefined ? {} : { page }),
  };
}

/** Where Insights is, optionally filtered to one page (each page's own Insights link). */
export function insightsHref(slug: string, filter: { readonly kind?: string; readonly page?: string } = {}): string {
  const params = new URLSearchParams({
    ...(filter.kind === undefined ? {} : { kind: filter.kind }),
    ...(filter.page === undefined ? {} : { page: filter.page }),
  }).toString();
  return `/w/${slug}/insights${params === '' ? '' : `?${params}`}`;
}
