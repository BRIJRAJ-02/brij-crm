import { createFileRoute, redirect } from '@tanstack/react-router';

// Settings › Workspace › History (spec 0046, AC-4600) has no page of its own: it opens Workspace changes for a holder
// of `audit.read`, else Your sign ins. The access is the workspace's cached answer; a failed read opens the sign ins,
// which every member may read.
export const Route = createFileRoute('/w/$slug/settings/history/')({
  beforeLoad: async ({ context, params }) => {
    const access = await context.data.access.mine(params.slug).catch(() => undefined);
    if (access?.permissions.includes('audit.read') === true) {
      throw redirect({ to: '/w/$slug/settings/history/changes', params: { slug: params.slug }, replace: true });
    }
    throw redirect({ to: '/w/$slug/settings/history/sign-ins', params: { slug: params.slug }, replace: true });
  },
});
