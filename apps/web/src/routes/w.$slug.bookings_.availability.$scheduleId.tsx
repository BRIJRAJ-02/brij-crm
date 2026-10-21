import { createFileRoute, redirect } from '@tanstack/react-router';
import { memberSearch, scheduleHref } from '../features/booking/links.ts';

// One schedule's old address (spec 0035, AC-970): the Availability tab is the schedule's editor now (the Calendly way,
// 22 October 2026), so this opens the schedule there, replacing the history entry and keeping `?member=`. `default`
// opens whichever schedule is the default.
export const Route = createFileRoute('/w/$slug/bookings_/availability/$scheduleId')({
  validateSearch: memberSearch,
  beforeLoad: ({ params, search }) => {
    throw redirect({ href: scheduleHref(params.slug, params.scheduleId, search.member), replace: true });
  },
});
