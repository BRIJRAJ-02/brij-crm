import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Rotations address: Bookings settings › Teams now (round robin's groups, the owner
// 22 October 2026, then the mock's IA 9 November 2026), kept for links.
export const Route = createFileRoute('/w/$slug/settings/scheduling/rotations')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/teams',
      params: { slug: params.slug },
      replace: true,
    });
  },
});
