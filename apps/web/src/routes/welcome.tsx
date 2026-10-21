import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { signInHref } from '../features/auth/redirect.ts';
import { shownStep, welcomeLanding, welcomeSearch } from '../features/welcome/steps.ts';
import { strings } from '../features/welcome/strings.ts';
import { WelcomeScreen } from '../features/welcome/WelcomeScreen.tsx';

// First run (spec 0036), for a signed in person: signed out goes to /sign-in
// (and comes back here). Before the workspace exists, someone who already has
// one goes to it. After, `?workspace=` names the one just made, for the
// calendar step, which shows only where calendar sync is set up; a workspace
// that isn't theirs is passed over. `?step=` picks the step and changes
// without a new load; a new `?workspace=` loads again.
export const Route = createFileRoute('/welcome')({
  validateSearch: welcomeSearch,
  loaderDeps: ({ search }) => ({ workspace: search.workspace }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ href: signInHref('/welcome'), replace: true });
    const calendarSync = await context.data.system.status().then(
      (status) => status.calendarSync,
      () => false,
    );
    const landing = welcomeLanding(me.workspaces, deps.workspace, calendarSync);
    if (landing.kind === 'open') throw redirect({ to: '/w/$slug', params: { slug: landing.slug }, replace: true });
    return { user: me.user, calendarSync, workspace: landing.workspace };
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
  const { user, calendarSync, workspace } = Route.useLoaderData();
  const { step, calendar } = Route.useSearch();
  const { data } = Route.useRouteContext();
  return (
    <WelcomeScreen
      data={data}
      user={user}
      step={shownStep(step, workspace !== undefined)}
      calendarSync={calendarSync}
      workspace={workspace}
      calendarResult={calendar}
    />
  );
}
