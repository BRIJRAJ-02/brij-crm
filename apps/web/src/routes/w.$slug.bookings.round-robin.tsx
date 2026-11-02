import { createFileRoute, redirect } from '@tanstack/react-router';

// Bookings › Round robin was a tab of its own until 2 November 2026; it is now Hosts › Groups. A link people
// already hold, and the older Settings › Scheduling address that redirects into this one, both land there.
export const Route = createFileRoute('/w/$slug/bookings/round-robin')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/bookings/hosts',
      params: { slug: params.slug },
      search: { view: 'overview' as const },
      replace: true,
    });
  },
});
