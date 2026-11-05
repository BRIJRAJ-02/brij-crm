import { createFileRoute, redirect } from '@tanstack/react-router';
import { reservationsSearch } from '../features/tables/search.ts';

// Service's old address: the day view is the Reservations page now (5 November 2026, checklabs' one Reservations
// page), kept for links and bookmarks (the new reservation emails sent before then), with its day.
export const Route = createFileRoute('/w/$slug/service')({
  validateSearch: reservationsSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/w/$slug/reservations', params, search, replace: true });
  },
});
