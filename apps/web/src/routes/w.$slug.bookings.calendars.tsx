import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Bookings › Calendars address (25 October 2026): Settings › Account › Calendars now, the one place a member
// connects a calendar (5 November 2026); Bookings links there for setup. Links and bookmarks still open it, with the
// same search, so a provider's `?calendar=` is read once where it lands.
export const Route = createFileRoute('/w/$slug/bookings/calendars')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/settings/account/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
