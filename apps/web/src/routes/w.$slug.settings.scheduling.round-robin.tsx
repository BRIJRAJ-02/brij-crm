import { createFileRoute, redirect } from '@tanstack/react-router';

// Round robin moved from Settings to Bookings (25 October 2026): it is what somebody setting up bookings does
// next, not workspace housekeeping. Links, emails and bookmarks made before the move still open it.
export const Route = createFileRoute('/w/$slug/settings/scheduling/round-robin')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/bookings/round-robin', params: { slug: params.slug }, replace: true });
  },
});
