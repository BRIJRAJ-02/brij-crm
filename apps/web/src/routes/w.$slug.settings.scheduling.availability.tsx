import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Availability address: the hours live in Bookings › Availability alone now (the mock's
// IA, 9 November 2026: global Settings keeps account and workspace items). Links still open it there, with
// `?member=` and `?schedule=` kept.
export const Route = createFileRoute('/w/$slug/settings/scheduling/availability')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/availability',
      params: { slug: params.slug },
      search: search as Record<string, unknown>,
      replace: true,
    });
  },
});
