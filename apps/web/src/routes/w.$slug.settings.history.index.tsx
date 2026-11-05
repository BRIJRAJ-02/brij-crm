import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings › Workspace › History (spec 0046, AC-4600) is the workspace's changes, at their own address, which sends
// anyone without `audit.read` on to their own sign ins.
export const Route = createFileRoute('/w/$slug/settings/history/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/w/$slug/settings/history/changes', params: { slug: params.slug }, replace: true });
  },
});
