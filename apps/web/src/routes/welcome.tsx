import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { signInHref } from '../features/auth/redirect.ts';
import { strings } from '../features/welcome/strings.ts';
import { WelcomeScreen } from '../features/welcome/WelcomeScreen.tsx';

// Signed in, without a workspace yet: signed out goes to /sign-in (and comes
// back here), and someone who has a workspace goes to it.
export const Route = createFileRoute('/welcome')({
  loader: async ({ context }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ href: signInHref('/welcome'), replace: true });
    const [first] = me.workspaces;
    if (first !== undefined) throw redirect({ to: '/w/$slug', params: { slug: first.slug }, replace: true });
    return { user: me.user };
  },
  pendingComponent: () => <AuthPending title={strings.title} />,
  errorComponent: () => <AuthError title={strings.title} />,
  component: WelcomeRoute,
});

function WelcomeRoute() {
  const { user } = Route.useLoaderData();
  const { data, toasts } = Route.useRouteContext();
  return <WelcomeScreen data={data} toasts={toasts} user={user} />;
}
