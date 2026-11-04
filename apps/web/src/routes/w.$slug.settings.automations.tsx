import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings › Automations (parity #53) is parked (the owner, 4 November 2026: "if not built properly remove it
// and add it to be built later"). Its screen and the server stay; the page is out of the navigation and ⌘K, and its
// address opens where Settings opens, so a bookmark or an old link still lands somewhere real.
export const Route = createFileRoute('/w/$slug/settings/automations')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/profile', params: { slug: params.slug }, replace: true });
  },
});
