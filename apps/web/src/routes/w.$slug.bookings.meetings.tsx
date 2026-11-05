import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseBookingsSearch } from '../features/bookings/search.ts';

// Bookings › Meetings (the IA brief, 5 November 2026): the tab's own address, as Calendly's Meetings, opens its
// calendar, or the list for a `?view=list` link, keeping the rest of the address, as bare `/bookings` does.
export const Route = createFileRoute('/w/$slug/bookings/meetings')({
  beforeLoad: ({ params, search }) => {
    const raw = search as Record<string, unknown>;
    throw redirect({
      to: raw.view === 'list' ? '/w/$slug/bookings/list' : '/w/$slug/bookings/calendar',
      params: { slug: params.slug },
      search: parseBookingsSearch(raw),
      replace: true,
    });
  },
});
