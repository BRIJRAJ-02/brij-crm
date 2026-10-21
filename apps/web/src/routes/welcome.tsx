import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { signInHref } from '../features/auth/redirect.ts';
import { strings } from '../features/welcome/strings.ts';
import { WelcomeScreen } from '../features/welcome/WelcomeScreen.tsx';
import { homeWorkspace } from '../features/workspace/home.ts';

/** `?another=1`: the workspace menu's Create workspace (spec 0031, AC-801), for someone who already has one. */
interface WelcomeSearch {
  readonly another?: true;
}

// Signed in, without a workspace yet: signed out goes to /sign-in (and comes
// back here), and someone who has a workspace goes to it, unless they came
// from the workspace menu to create another (`?another=1`).
export const Route = createFileRoute('/welcome')({
  validateSearch: (search: Record<string, unknown>): WelcomeSearch =>
    search.another === 1 || search.another === '1' || search.another === true ? { another: true } : {},
  loaderDeps: ({ search }) => ({ another: search.another === true }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me === undefined)
      throw redirect({ href: signInHref(deps.another ? '/welcome?another=1' : '/welcome'), replace: true });
    const home = homeWorkspace(me);
    if (home !== undefined && !deps.another) {
      throw redirect({ to: '/w/$slug', params: { slug: home.slug }, replace: true });
    }
    // Workspaces at the person's email domain they may ask to join (spec 0031, AC-819): a nudge, never a blocker.
    const joinable = await context.data.join.list().catch(() => []);
    return { user: me.user, back: home, joinable: joinable.length };
  },
  pendingComponent: () => (
    <LoadingNow>
      <AuthPending title={strings.title} />
    </LoadingNow>
  ),
  errorComponent: () => <AuthError title={strings.title} />,
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const { user, back, joinable } = Route.useLoaderData();
  const { data, toasts } = Route.useRouteContext();
  return <WelcomeScreen data={data} toasts={toasts} user={user} back={back} joinable={joinable} />;
}
