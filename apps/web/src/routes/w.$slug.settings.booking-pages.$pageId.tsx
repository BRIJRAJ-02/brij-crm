import { createFileRoute, redirect } from '@tanstack/react-router';

// One booking page's builder under Settings (spec 0025's first address) moved to Captures › Links, then to
// Scheduling › Booking pages (spec 0034): the old address opens the same page's editor there.
export const Route = createFileRoute('/w/$slug/settings/booking-pages/$pageId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/booking-pages/$pageId',
      params: { slug: params.slug, pageId: params.pageId },
      replace: true,
    });
  },
});
