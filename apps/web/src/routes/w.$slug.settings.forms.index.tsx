import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings, Forms (spec 0023's first address) moved to Captures › Forms, then to Scheduling › Forms (spec 0034), and
// Settings links there no more (20 Oct 2026): the old address goes to the list.
export const Route = createFileRoute('/w/$slug/settings/forms/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/forms', params: { slug: params.slug }, replace: true });
  },
});
