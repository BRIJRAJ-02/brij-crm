// The addresses spec 0034 moved (AC-929): Captures' tabs became Scheduling's Booking pages and Forms, and Bookings'
// Availability tab its own page. Each old address redirects, replacing the history entry and keeping the query, so a
// link from before (in an email, a bookmark) still lands. Plain functions, so the redirect routes stay tiny.

/** Where an old address now lives, with its query kept: `searchStr` as the router parsed it ("?tab=install"). */
export function movedHref(slug: string, path: string, searchStr: string): string {
  return `/w/${slug}${path}${searchStr}`;
}

/**
 * Where an address under `/captures` now lives, from what follows `/captures/`: Links and its pages under Booking
 * pages, Forms and its forms (and their previews) under Forms; anything else, the bare `/captures` included, opens
 * Booking pages, as Captures opened on Links.
 */
export function capturesPath(splat: string): string {
  const [tab = '', raw, rest] = splat.split('/').filter((part) => part !== '');
  // The id goes back into a path as one segment, whatever was typed.
  const id = raw === undefined ? undefined : encodeURIComponent(raw);
  if (tab === 'forms') {
    if (id === undefined) return '/forms';
    return rest === 'preview' ? `/forms/${id}/preview` : `/forms/${id}`;
  }
  if (tab === 'links' && id !== undefined) return `/booking-pages/${id}`;
  return '/booking-pages';
}
