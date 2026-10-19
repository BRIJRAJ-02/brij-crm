import { createFileRoute, redirect } from '@tanstack/react-router';

// Captures opens on its first tab, Links.
export const Route = createFileRoute('/w/$slug/captures/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/captures/links', params: { slug: params.slug }, replace: true });
  },
});
