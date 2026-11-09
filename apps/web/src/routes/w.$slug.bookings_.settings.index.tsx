import { createFileRoute, redirect } from '@tanstack/react-router';

// Bare Bookings settings opens on its first page, Calendars, keeping the search (a provider's `?calendar=`).
export const Route = createFileRoute('/w/$slug/bookings_/settings/')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
