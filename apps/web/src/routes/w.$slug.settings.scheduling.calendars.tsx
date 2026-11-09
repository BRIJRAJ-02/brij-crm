import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Calendars address: Bookings settings › Calendars now (9 November 2026). Links,
// emails and bookmarks still open it, with the same search, so a provider's `?calendar=` is read once where it lands.
export const Route = createFileRoute('/w/$slug/settings/scheduling/calendars')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
