import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { signInHref } from '../features/auth/redirect.ts';
import { shownStep, welcomeLanding, welcomeSearch } from '../features/welcome/steps.ts';
import { invitableRoles } from '../features/settings/members.ts';
import { strings } from '../features/welcome/strings.ts';
import { WelcomeScreen } from '../features/welcome/WelcomeScreen.tsx';
import { homeWorkspace } from '../features/workspace/home.ts';

// First run (spec 0036), for a signed in person: signed out goes to /sign-in
// (and comes back here). Before the workspace exists, someone who already has
// one goes to it. After, `?workspace=` names the one just made, for Invite
// your team and the calendar step (only where calendar sync is set up); a workspace
// that isn't theirs is passed over. `?step=` picks the step and changes
// without a new load; a new `?workspace=` loads again. `?another=1` (the
// workspace menu's Create workspace, spec 0031) keeps the steps open for
// someone who has a workspace, with a way back to it.
export const Route = createFileRoute('/welcome')({
  validateSearch: welcomeSearch,
  loaderDeps: ({ search }) => ({ workspace: search.workspace, another: search.another === true }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me === undefined)
      throw redirect({ href: signInHref(deps.another ? '/welcome?another=1' : '/welcome'), replace: true });
    const home = homeWorkspace(me);
    const landing = welcomeLanding(me.workspaces, deps.workspace, home, deps.another);
    if (landing.kind === 'open') throw redirect({ to: '/w/$slug', params: { slug: landing.slug }, replace: true });
    // Invite your team offers the roles its maker may invite as, as Settings › Members does; unread, everyone joins
    // as a member and the step has no role column.
    const made = landing.workspace;
    // Read together, so the invite step's roles add no wait after Create workspace.
    const calendarRead = context.data.system.status().then(
      (status) => status.calendarSync,
      () => false,
    );
    // The loader only reads; the component picks the roles, so that code stays out of the first load.
    const rolesRead =
      made === undefined
        ? Promise.resolve(undefined)
        : Promise.all([context.data.access.mine(made.slug), context.data.roles.list(made.slug)]).then(
            ([access, roles]) => ({ actor: access.role, roles }),
            () => undefined,
          );
    // The link page made with the workspace (26 Oct 2026), said on Invite your team: its handle, or nothing.
    const handleRead =
      made === undefined
        ? Promise.resolve(undefined)
        : context.data.profile.get(made.slug).then(
            (profile) => profile.handle,
            () => undefined,
          );
    const [calendarSync, roleRead, linkPageHandle] = await Promise.all([calendarRead, rolesRead, handleRead]);
    return {
      user: me.user,
      calendarSync,
      workspace: landing.workspace,
      leaveTo: deps.another ? home : undefined,
      roleRead,
      linkPageHandle,
    };
  },
  pendingComponent: () => (
    <LoadingNow>
      <AuthPending title={strings.title} isSplit />
    </LoadingNow>
  ),
  errorComponent: () => <AuthError title={strings.title} isSplit />,
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const { user, calendarSync, workspace, leaveTo, roleRead, linkPageHandle } = Route.useLoaderData();
  const allowed = roleRead === undefined ? [] : invitableRoles(roleRead.actor);
  const options = roleRead?.roles.roles.filter((each) => each.builtIn !== undefined && allowed.includes(each.builtIn));
  const inviteRoles =
    roleRead === undefined || options === undefined || options.length === 0
      ? undefined
      : {
          roles: options,
          defaultRole: options.find((each) => each.builtIn === 'member')?.id ?? roleRead.roles.defaultRole,
        };
  const { step, calendar, another } = Route.useSearch();
  const { data } = Route.useRouteContext();
  return (
    <WelcomeScreen
      data={data}
      user={user}
      step={shownStep(step, workspace !== undefined, another === true)}
      calendarSync={calendarSync}
      workspace={workspace}
      calendarResult={calendar}
      leaveTo={leaveTo}
      inviteRoles={inviteRoles}
      linkPageHandle={linkPageHandle}
    />
  );
}
