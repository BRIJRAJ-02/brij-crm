import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseBookingsSearch } from '../features/bookings/search.ts';

// Bookings › List was a tab of its own until 2 November 2026; it is now Meetings' fourth view. A link people
// already hold lands on that view with everything it carried (`tab`, `src`, `link`, `cal`).
export const Route = createFileRoute('/w/$slug/bookings/list')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/meetings',
      params: { slug: params.slug },
      search: { ...parseBookingsSearch(search as Record<string, unknown>), v: 'list' as const },
      replace: true,
    });
  },
});
