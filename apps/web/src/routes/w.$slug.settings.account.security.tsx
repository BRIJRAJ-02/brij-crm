import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Account › Security address: Sign in and devices now (the owner, 22 October 2026: the sidebar
// showed Security twice), kept for links and emails.
export const Route = createFileRoute('/w/$slug/settings/account/security')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/sign-in', params, replace: true });
  },
});
