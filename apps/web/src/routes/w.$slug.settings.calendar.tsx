import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings, Calendar moved to Scheduling › Calendars (spec 0026, AC-686): its old address, which the API's Google callback still
// sends the browser back to with `?calendar=`, goes to Scheduling › Calendars with the same search.
export const Route = createFileRoute('/w/$slug/settings/calendar')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/settings/scheduling/calendars',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
