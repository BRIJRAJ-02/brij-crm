import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings › Developer, the API keys (parity #34) is parked (the owner, 4 November 2026: "if not built properly remove it
// and add it to be built later"). Its screen and the server stay; the page is out of the navigation and ⌘K, and its
// address opens where Settings opens, so a bookmark or an old link still lands somewhere real.
export const Route = createFileRoute('/w/$slug/settings/developer')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/profile', params: { slug: params.slug }, replace: true });
  },
});
