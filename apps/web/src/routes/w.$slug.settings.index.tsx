import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings opens on Account › Preferences (spec 0026, AC-686).
export const Route = createFileRoute('/w/$slug/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/preferences', params: { slug: params.slug }, replace: true });
  },
});
