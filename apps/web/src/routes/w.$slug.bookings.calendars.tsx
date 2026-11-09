import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Bookings › Calendars address (25 October 2026): Bookings settings › Calendars now (9 November 2026).
// Links and bookmarks still open it, with the same search, so a provider's `?calendar=` is read once where it lands.
export const Route = createFileRoute('/w/$slug/bookings/calendars')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
