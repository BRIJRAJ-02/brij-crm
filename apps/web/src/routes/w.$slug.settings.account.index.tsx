import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings › Account has no page of its own: it opens on Preferences (spec 0026).
export const Route = createFileRoute('/w/$slug/settings/account/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/preferences', params: { slug: params.slug }, replace: true });
  },
});
