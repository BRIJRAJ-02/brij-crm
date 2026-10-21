// The addresses round 7 gave the scheduling pages (`/availability`, `/booking-pages`, `/forms`, spec 0034) before
// the owner put them back inside Bookings and Captures (22 October 2026). Each redirects to the page's place again,
// replacing the history entry and keeping the query, so a link saved in between (a bookmark, an email) still lands.
// Plain functions, so the redirect routes stay tiny.

/** Where a moved address lives now, with its query kept: `searchStr` as the router parsed it ("?tab=install"). */
export function movedHref(slug: string, path: string, searchStr: string): string {
  return `/w/${slug}${path}${searchStr}`;
}

/** The pages round 7 moved out, by their first segment. */
export type MovedPage = 'availability' | 'booking-pages' | 'forms';

/**
 * Where a round 7 address lives now, from its first segment and what follows it: Availability and its schedules
 * under Bookings, Booking pages and Forms (each page, form and preview) under Captures. The bare address opens the
 * list it named.
 */
export function movedPath(page: MovedPage, splat: string): string {
  const [raw, rest] = splat.split('/').filter((part) => part !== '');
  // The id goes back into a path as one segment, whatever was typed.
  const id = raw === undefined ? undefined : encodeURIComponent(raw);
  switch (page) {
    case 'availability':
      return id === undefined ? '/bookings/availability' : `/bookings/availability/${id}`;
    case 'booking-pages':
      return id === undefined ? '/captures/links' : `/captures/links/${id}`;
    case 'forms':
      if (id === undefined) return '/captures/forms';
      return rest === 'preview' ? `/captures/forms/${id}/preview` : `/captures/forms/${id}`;
  }
}
