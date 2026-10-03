import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { readPending, sessionStore } from '../features/auth/pending.ts';
import { redirectSearch, safeRedirect } from '../features/auth/redirect.ts';
import { strings } from '../features/auth/strings.ts';
import { VerifyScreen } from '../features/auth/VerifyScreen.tsx';

// Needs a code on its way (the pending email in this tab's sessionStorage);
// without one it goes back to /sign-in. Someone already signed in goes straight on.
export const Route = createFileRoute('/verify')({
  validateSearch: redirectSearch,
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me !== undefined) throw redirect({ href: safeRedirect(deps.redirect), replace: true });
    const pending = readPending(sessionStore(window));
    if (pending === undefined) {
      throw redirect({ to: '/sign-in', search: deps.redirect === undefined ? {} : deps, replace: true });
    }
    return { pending };
  },
  pendingComponent: () => <AuthPending title={strings.verifyTitle} />,
  errorComponent: () => <AuthError title={strings.verifyTitle} />,
  component: VerifyRoute,
});

function VerifyRoute() {
  const { pending } = Route.useLoaderData();
  const { redirect: target } = Route.useSearch();
  const { data } = Route.useRouteContext();
  return <VerifyScreen data={data} pending={pending} redirect={target} />;
}
