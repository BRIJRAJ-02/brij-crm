import { createFileRoute, redirect } from '@tanstack/react-router';
import { movedHref } from '../features/workspace/moved.ts';

// Bookings › Availability is now Scheduling › Availability (spec 0034, AC-929): the old address redirects, replacing the history entry and keeping the query.
export const Route = createFileRoute('/w/$slug/bookings_/availability')({
  beforeLoad: ({ params, location }) => {
    throw redirect({ href: movedHref(params.slug, '/availability', location.searchStr), replace: true });
  },
});
