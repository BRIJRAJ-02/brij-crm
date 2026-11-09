import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Round robin address: Bookings settings › Teams now (9 November 2026), kept for
// links and bookmarks.
export const Route = createFileRoute('/w/$slug/settings/scheduling/round-robin')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/teams',
      params: { slug: params.slug },
      replace: true,
    });
  },
});
