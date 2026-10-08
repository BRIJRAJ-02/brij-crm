import { isDataError } from '@crm/data';
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { signInHref } from '../features/auth/redirect.ts';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// The workspace frame (spec 0005): signed in and a member. Signed out goes to
// /sign-in and comes back; a workspace that doesn't exist, or that the person
// isn't in, shows the same "not found" inside the frame (the door behind
// objects.list answers both with NOT_FOUND).
export const Route = createFileRoute('/w/$slug')({
  beforeLoad: async ({ context, location }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ href: signInHref(location.href), replace: true });
    return { me };
  },
  loader: async ({ context, params }) => {
    const workspaceName = context.me.workspaces.find((workspace) => workspace.slug === params.slug)?.name;
    try {
      // The person's role and permissions come with the objects (spec 0009): screens hide what they can't use.
      const [objects, access] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.access.mine(params.slug),
      ]);
      return { workspaceName: workspaceName ?? params.slug, objects, access };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') {
        return { workspaceName: undefined, objects: undefined, access: undefined };
      }
      throw error;
    }
  },
  pendingComponent: () => <WorkspacePage page={pendingPage()} />,
  errorComponent: WorkspaceError,
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { objects } = Route.useLoaderData();
  if (objects === undefined) {
    return <WorkspacePage page={missingPage(strings.workspaceMissingTitle, strings.workspaceMissingText)} />;
  }
  return <Outlet />;
}

function WorkspaceError() {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate())} isFailed />;
}
