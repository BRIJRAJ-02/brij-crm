import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Scheduling › Scheduling access address: Bookings settings › Scheduling access now (9 November
// 2026), kept for links and emails.
export const Route = createFileRoute('/w/$slug/settings/scheduling/access')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$slug/bookings/settings/access',
      params: { slug: params.slug },
      replace: true,
    });
  },
});
