import { createFileRoute, redirect } from '@tanstack/react-router';
import { routingSearch } from '../features/routing/load.ts';

// The old Settings › Scheduling › Routing address: routing lives in Bookings › Routing alone now (the mock's IA,
// 9 November 2026: global Settings keeps account and workspace items). Links still open it there, with their search.
export const Route = createFileRoute('/w/$slug/settings/scheduling/routing')({
  beforeLoad: ({ params, search }) => {
    throw redirect({
      to: '/w/$slug/bookings/routing',
      params: { slug: params.slug },
      search: routingSearch(search as Record<string, unknown>),
      replace: true,
    });
  },
});
