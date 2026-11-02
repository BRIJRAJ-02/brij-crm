import { createFileRoute, redirect } from '@tanstack/react-router';
import { rosterSearch } from '../features/booking/links.ts';

// Bookings › Roster was a tab of its own from 31 October to 2 November 2026; it is now Hours › Team, the team
// scope of the same subject. A link people already hold lands there with its week and its search. Whether the
// reader may see it at all is still `rosterIsShown`, checked by the Hours route's loader, which sends anyone
// else on to their own hours exactly as this tab used to.
export const Route = createFileRoute('/w/$slug/bookings/roster')({
  validateSearch: rosterSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/hours',
      params: { slug: params.slug },
      search: { v: 'team' as const, ...search },
      replace: true,
    });
  },
});
