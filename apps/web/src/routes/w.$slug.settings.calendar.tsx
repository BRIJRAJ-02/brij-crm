import { createFileRoute, redirect } from '@tanstack/react-router';

// The address the API's calendar callback sends the browser back to, with `?calendar=` (spec 0026, AC-686): it goes
// on to Settings › Account › Calendars, the one place calendars are connected (5 November 2026), with the same search.
export const Route = createFileRoute('/w/$slug/settings/calendar')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/settings/account/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
