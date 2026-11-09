import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Bookings › Round robin address (25 October 2026): Bookings settings › Teams now (9 November 2026), the
// groups' one home. Kept so links and bookmarks still open it.
export const Route = createFileRoute('/w/$slug/bookings/round-robin')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/teams',
      params: { slug: params.slug },
      replace: true,
    });
  },
});
