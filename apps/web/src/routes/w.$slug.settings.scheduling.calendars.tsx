import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Calendars address: Settings › Account › Calendars now (5 November 2026). Links,
// emails and bookmarks still open it, with the same search, so a provider's `?calendar=` is read once where it lands.
export const Route = createFileRoute('/w/$slug/settings/scheduling/calendars')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/settings/account/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
