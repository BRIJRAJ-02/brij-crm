import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings › Account has no page of its own: it opens on its first entry, Profile.
export const Route = createFileRoute('/w/$slug/settings/account/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/profile', params: { slug: params.slug }, replace: true });
  },
});
