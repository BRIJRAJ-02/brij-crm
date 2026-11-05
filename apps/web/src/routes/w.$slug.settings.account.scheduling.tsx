import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Account › Scheduling access address: Settings › Scheduling › Scheduling access now (5 November
// 2026), kept for links and emails.
export const Route = createFileRoute('/w/$slug/settings/account/scheduling')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/scheduling/access', params: { slug: params.slug }, replace: true });
  },
});
