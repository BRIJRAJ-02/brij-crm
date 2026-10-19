import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseBookingsSearch } from '../features/bookings/search.ts';

// Bookings opens on Calendar. A link from before the tabs (`?view=list`, `?view=week`) still lands on its view,
// keeping the rest of its address.
export const Route = createFileRoute('/w/$slug/bookings/')({
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
