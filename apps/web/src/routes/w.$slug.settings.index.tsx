import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings opens on Objects (spec 0012), the one settings page so far; #8, #23 and later features add theirs.
export const Route = createFileRoute('/w/$slug/settings/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/objects', params: { slug: params.slug }, replace: true });
  },
});
