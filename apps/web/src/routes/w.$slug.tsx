import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import {
  createFileRoute,
  Outlet,
  redirect,
  useMatch,
  useRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router';
import { atAddress } from '../features/address/address.ts';
import { signInHref } from '../features/auth/redirect.ts';
import { CommandMenuProvider } from '../features/command/CommandMenuProvider.tsx';
import { UnreadTitle } from '../features/inbox/UnreadTitle.tsx';
import { failedPage, missingPage, pendingPage } from '../features/workspace/ObjectScreen.tsx';
import { PreferencesScope } from '../features/workspace/PreferencesScope.tsx';
import { deletedPage } from '../features/workspace/DeletedWorkspace.tsx';
import { signInRulesPage, type HeldBack } from '../features/workspace/SignInRulesPage.tsx';
import { strings } from '../features/workspace/strings.ts';
import { useWorkspaceName, WorkspaceLayout, WorkspacePage } from '../features/workspace/WorkspacePage.tsx';

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
    // An address the workspace held before it moved: the door still finds it, and the page moves to the new one,
    // so bookmarks and shared links keep working. Only for an address none of the person's workspaces has now.
    if (!me.workspaces.some((workspace) => workspace.slug === params.slug)) {
      const moved = await context.data.workspace.get(params.slug).catch(() => undefined);
      if (moved !== undefined && moved.slug !== params.slug) {
        throw redirect({ href: atAddress(location.href, params.slug, moved.slug), replace: true });
      }
    }
    // Remembered for `/` and sign in on every device (spec 0031, AC-802); never waited for, and silent on failure.
    void context.data.me.rememberWorkspace(params.slug);
    return { me };
  },
  loader: async ({ context, params }) => {
    const workspaceName = context.me.workspaces.find((workspace) => workspace.slug === params.slug)?.name;
    try {
      // The person's role and permissions come with the objects (spec 0009): screens hide what they can't use. Their
      // own sidebar comes in the same round (spec 0034, AC-936), so it never draws the default order first; a failed
      // sidebar read draws the defaults rather than failing the workspace. The member's preferences (time zone, date
      // format, week start) come too, before the first page draws a date; a failed read keeps the browser's defaults.
      // The lists the member may read (spec 0048) fill the sidebar's Lists; a failed read leaves it empty.
      const [objects, access, , , lists] = await Promise.all([
        context.data.objects.list(params.slug),
        context.data.access.mine(params.slug),
        context.data.nav.load(params.slug).catch(() => undefined),
        context.data.preferences.load(params.slug).catch(() => undefined),
        context.data.lists.list(params.slug).catch(() => []),
      ]);
      return {
        workspaceName: workspaceName ?? params.slug,
        objects,
        lists,
        access,
        deleted: undefined,
        heldBack: undefined,
      };
    } catch (error) {
      if (isDataError(error) && error.code === 'NOT_FOUND') {
        // A deleted workspace's owner finds it here to restore within its window (spec 0031, AC-823); to anyone
        // else it is the same not found as an unknown address.
        const deleted = await context.data.workspace.deleted(params.slug).catch(() => undefined);
        return {
          workspaceName: undefined,
          objects: undefined,
          lists: undefined,
          access: undefined,
          deleted,
          heldBack: undefined,
        };
      }
      // The workspace's sign in rules hold this session back (spec 0033, AC-894): its own page, never an error.
      if (isDataError(error) && (error.code === 'TWO_FACTOR_REQUIRED' || error.code === 'SIGN_IN_AGAIN')) {
        const heldBack: HeldBack = error.code;
        return {
          workspaceName: workspaceName ?? params.slug,
          objects: undefined,
          lists: undefined,
          access: undefined,
          deleted: undefined,
          heldBack,
        };
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
  const { objects, deleted, heldBack, workspaceName } = Route.useLoaderData();
  const { slug } = Route.useParams();
  // A form's preview stands outside the app frame, as a visitor sees it (its own main landmark).
  const isPreview = useMatch({ from: '/w/$slug/captures_/forms/$formId_/preview', shouldThrow: false }) !== undefined;
  // The frame is mounted here, once, so moving between the pages inside never remounts the sidebar or a menu or
  // confirm open in it; each page fills its bars (WorkspaceLayout).
  const { data, toasts, me } = Route.useRouteContext();
  const router = useRouter();
  if (deleted !== undefined) {
    return (
      <WorkspaceLayout>
        <WorkspacePage
          page={deletedPage(
            deleted,
            () =>
              data.workspace.restore(deleted.slug).then(async () => {
                await router.invalidate();
                toasts.toast({ tone: 'success', message: strings.restored(deleted.name) });
              }),
            // The list leaves deleted workspaces out: none left means Settings can't open anywhere.
            { data, hasOther: me.workspaces.length > 0 },
          )}
        />
      </WorkspaceLayout>
    );
  }
  if (heldBack !== undefined) {
    return (
      <WorkspaceLayout>
        <WorkspacePage page={signInRulesPage({ data, toasts, workspaceName, reason: heldBack })} />
      </WorkspaceLayout>
    );
  }
  if (objects === undefined) {
    return (
      <WorkspaceLayout>
        <WorkspacePage page={missingPage(strings.workspaceMissingTitle, strings.workspaceMissingText)} />
      </WorkspaceLayout>
    );
  }
  // The command menu (spec 0039): ⌘K and `/` on every page inside the workspace, and `useCommandMenu()` for the
  // sidebar's Quick actions and search. The unread count rides in the tab's title (spec 0038).
  return (
    <PreferencesScope data={data} slug={slug}>
      <CommandMenuProvider slug={slug}>
        <UnreadTitle slug={slug} />
        {isPreview ? (
          <Outlet />
        ) : (
          <WorkspaceLayout>
            <Outlet />
          </WorkspaceLayout>
        )}
      </CommandMenuProvider>
    </PreferencesScope>
  );
}

function WorkspaceError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const workspaceName = useWorkspaceName();
  return <WorkspacePage page={failedPage(workspaceName, () => void router.invalidate(), error)} isFailed />;
}
