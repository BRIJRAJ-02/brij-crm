import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseBookingsSearch } from '../features/bookings/search.ts';

// Bookings › Calendar was a tab of its own until 2 November 2026; it is now Meetings' week, day and Team day.
// A link people already hold lands on the same view with everything it carried (`w`, `d`, `v`, the Team day's
// filters, `link`, `cal`).
export const Route = createFileRoute('/w/$slug/bookings/calendar')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/meetings',
      params: { slug: params.slug },
      search: parseBookingsSearch(search as Record<string, unknown>),
      replace: true,
    });
  },
});
