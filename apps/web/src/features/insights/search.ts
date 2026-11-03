// Insights' address (spec 0067, AC-6710): the period (`?range=`) and the pages (`?kind=`, `?page=`), read by the
// route so the loader and the screen agree, and a link to a filtered view (a page's own Insights) is a plain link.

/** The kinds the picker offers today; the rest join with their panels. */
const KINDS = ['form', 'booking', 'link'] as const;
const RANGES = ['7', '30', '90', '365', 'all'] as const;

/** What the address says. */
export interface InsightsSearch {
  readonly range?: (typeof RANGES)[number];
  readonly kind?: (typeof KINDS)[number];
  readonly page?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** Reads the address: only values it knows; anything else is dropped, never an error. */
export function insightsSearch(search: Record<string, unknown>): InsightsSearch {
  // The router reads `?range=90` as a number, so the address is compared as text.
  const range = RANGES.find((each) => each === String(search.range));
  const kind = KINDS.find((each) => each === search.kind);
  const page = typeof search.page === 'string' && UUID.test(search.page) ? search.page : undefined;
  return {
    ...(range === undefined ? {} : { range }),
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
