import { createFileRoute, redirect } from '@tanstack/react-router';

// Calendars moved from Settings to Bookings (25 October 2026): connecting one is what makes every other Bookings
// tab work, and it sat three levels into Settings. Links, emails and bookmarks still open it, with the same
// search, so a provider's callback (`?calendar=`) lands where it always did and is read once.
export const Route = createFileRoute('/w/$slug/settings/scheduling/calendars')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
