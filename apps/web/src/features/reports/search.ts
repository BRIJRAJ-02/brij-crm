// The Reports page's address: which report is open (`?r=<id>`, or `?r=new` for a draft), read by the route itself so
// the loader and the screen agree. With none, the first saved report opens, else a new one.

/** What `?r=` says. */
export interface ReportsSearch {
  readonly r?: string;
}

/** The address's value for a new report. */
export const NEW_REPORT = 'new';

/** Reads the address: only a short text. */
export function reportsSearch(search: Record<string, unknown>): ReportsSearch {
  const r = search.r;
  return typeof r === 'string' && r.length > 0 && r.length <= 64 ? { r } : {};
}

/** Where the Reports page is, and which report it opens. */
export function reportsHref(slug: string, report?: string): string {
  const base = `/w/${slug}/reports`;
  return report === undefined ? base : `${base}?r=${encodeURIComponent(report)}`;
}
