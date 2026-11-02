import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › Account › Notifications address: its switches are sections of Preferences now (the simplify
// pass, 2 November 2026: one screen for everything a person sets about themselves), kept for links and emails.
export const Route = createFileRoute('/w/$slug/settings/account/notifications')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/preferences', params, replace: true });
  },
});
