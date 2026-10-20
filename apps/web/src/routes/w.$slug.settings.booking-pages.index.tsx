import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings, Booking pages (spec 0025's first address) moved to Captures › Links, and Settings links there no more
// (20 Oct 2026): the old address goes to the list.
export const Route = createFileRoute('/w/$slug/settings/booking-pages/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/captures/links', params: { slug: params.slug }, replace: true });
  },
});
