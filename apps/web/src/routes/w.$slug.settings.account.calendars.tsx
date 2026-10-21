import { createFileRoute, redirect } from '@tanstack/react-router';

// Calendars moved from Account to Scheduling (21 Oct 2026): links and emails made before the move still open it, with
// the same search.
export const Route = createFileRoute('/w/$slug/settings/account/calendars')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/settings/scheduling/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
