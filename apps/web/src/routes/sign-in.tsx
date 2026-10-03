import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { readLastEmail, sessionStore } from '../features/auth/pending.ts';
import { redirectSearch, safeRedirect } from '../features/auth/redirect.ts';
import { SignInScreen } from '../features/auth/SignInScreen.tsx';
import { strings } from '../features/auth/strings.ts';

// Signed out only: someone already signed in goes straight on. Google shows
// only where the API says it is set up; if the status check fails, the email
// code still works, so the page shows without it. `?error=` is a refused
// Google sign in, said on the form in the page's own words.
export const Route = createFileRoute('/sign-in')({
  validateSearch: redirectSearch,
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me !== undefined) throw redirect({ href: safeRedirect(deps.redirect), replace: true });
    const google = await context.data.system.status().then(
      (status) => status.providers.google,
      () => false,
    );
    return { google, email: readLastEmail(sessionStore(window)) };
  },
  pendingComponent: () => <AuthPending title={strings.signInTitle} />,
  errorComponent: () => <AuthError title={strings.signInTitle} />,
  component: SignInRoute,
});

function SignInRoute() {
  const { google, email } = Route.useLoaderData();
  const { redirect: target, error } = Route.useSearch();
  const { data } = Route.useRouteContext();
  return (
    <SignInScreen
      data={data}
      google={google}
      redirect={target}
      returnTo={safeRedirect(target)}
      googleError={error}
      email={email}
    />
  );
}
