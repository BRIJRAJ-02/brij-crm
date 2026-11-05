import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Bookings › Round robin address (25 October 2026): Settings › Scheduling › Round robin now, the groups' one
// home (5 November 2026); Bookings › Pages links there for setup. Kept so links and bookmarks still open it.
export const Route = createFileRoute('/w/$slug/bookings/round-robin')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/scheduling/round-robin', params: { slug: params.slug }, replace: true });
  },
});
