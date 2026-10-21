import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, Outlet, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { signInHref } from '../features/auth/redirect.ts';
import { CommandMenuProvider } from '../features/command/CommandMenuProvider.tsx';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

// The workspace frame (spec 0005): signed in and a member. Signed out goes to
// /sign-in and comes back; a workspace that doesn't exist, or that the person
// isn't in, shows the same "not found" inside the frame (the door behind
// objects.list answers both with NOT_FOUND).
export const Route = createFileRoute('/w/$slug')({
  beforeLoad: async ({ context, location, params }) => {
    // The workspace's head beside `me.get` (spec 0007): the first reads wait for it only when live updates are on.
    context.data.live.prepare(params.slug);
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ href: signInHref(location.href), replace: true });
    // Remembered for `/` and sign in on every device (spec 0031, AC-802); never waited for, and silent on failure.
    void context.data.me.rememberWorkspace(params.slug);
    return { me };
  },
  loader: async ({ context, params }) => {
    const workspaceName = context.me.workspaces.find((workspace) => workspace.slug === params.slug)?.name;
    try {
      // The person's role and permissions come with the objects (spec 0009): screens hide what they can't use. Their
      // own sidebar comes in the same round (spec 0034, AC-936), so it never draws the default order first; a failed
      // sidebar read draws the defaults rather than failing the workspace.
      const [objects, access] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.access.mine(params.slug),
        context.data.nav.load(params.slug).catch(() => undefined),
      ]);
      return { workspaceName: workspaceName ?? params.slug, objects, access };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') {
        return { workspaceName: undefined, objects: undefined, access: undefined };
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <WorkspacePage page={pendingPage()} />
    </LoadingNow>
  ),
  errorComponent: WorkspaceError,
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { objects } = Route.useLoaderData();
  const { slug } = Route.useParams();
  if (objects === undefined) {
    return <WorkspacePage page={missingPage(strings.workspaceMissingTitle, strings.workspaceMissingText)} />;
  }
  // The command menu (spec 0039): ⌘K and `/` on every page inside the workspace, and `useCommandMenu()` for the
  // sidebar's Quick actions and search.
  return (
    <CommandMenuProvider slug={slug}>
      <Outlet />
    </CommandMenuProvider>
  );
}

function WorkspaceError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} isFailed />;
}
