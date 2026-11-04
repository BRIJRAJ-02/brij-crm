import { createFileRoute, redirect } from '@tanstack/react-router';

// The old Settings › History › Your sign ins address (spec 0046, AC-4619): each member's own sign ins are in Account ›
// Sign in and security now (5 November 2026), where they were listed twice before. Kept for links.
export const Route = createFileRoute('/w/$slug/settings/history/sign-ins')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/account/sign-in', params: { slug: params.slug }, replace: true });
  },
});
