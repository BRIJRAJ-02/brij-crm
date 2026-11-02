import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseBookingsSearch } from '../features/bookings/search.ts';

// Bookings opens on Meetings. A link from before the tabs (`?view=list`, `?view=week`) still lands on its view,
// keeping the rest of its address.
export const Route = createFileRoute('/w/$slug/bookings/')({
  beforeLoad: ({ params, search }) => {
    const raw = search as Record<string, unknown>;
    throw redirect({
      to: '/w/$slug/bookings/meetings',
      params: { slug: params.slug },
      search: raw.view === 'list' ? { ...parseBookingsSearch(raw), v: 'list' as const } : parseBookingsSearch(raw),
      replace: true,
    });
  },
});
