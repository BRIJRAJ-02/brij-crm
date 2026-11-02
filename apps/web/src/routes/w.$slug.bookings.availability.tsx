import { createFileRoute, redirect } from '@tanstack/react-router';
import { availabilitySearch, rosterSearch } from '../features/booking/links.ts';

// Bookings › Availability was a tab of its own until 2 November 2026; it is now Hours › Mine. A link people
// already hold lands there with its `member` and `schedule`, and `?view=team` — an older link still, from before
// the Roster had a tab — lands on Hours › Team with its week and its search.
export const Route = createFileRoute('/w/$slug/bookings/availability')({
  validateSearch: availabilitySearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/hours',
      params: { slug: params.slug },
      search:
        search.view === 'team'
          ? { v: 'team' as const, ...rosterSearch(search as Record<string, unknown>) }
          : {
              ...(search.member === undefined ? {} : { member: search.member }),
              ...(search.schedule === undefined ? {} : { schedule: search.schedule }),
            },
      replace: true,
    });
  },
});
