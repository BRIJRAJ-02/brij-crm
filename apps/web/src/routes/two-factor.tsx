import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { redirectSearch, safeRedirect, type SignInSearch } from '../features/auth/redirect.ts';
import { strings } from '../features/auth/two-factor-strings.ts';
import { TwoFactorScreen } from '../features/auth/TwoFactorScreen.tsx';

// The second step of a sign in held back for it (spec 0033): an email code or Google signed in, but two factor is
// on. The pending sign in lives in an HttpOnly cookie the browser can't read, so a stale one is said by the server.
// Someone already signed in goes straight on.
export const Route = createFileRoute('/two-factor')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => redirectSearch(search),
  loaderDeps: ({ search }) => ({ redirect: search.redirect }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me !== undefined) throw redirect({ href: safeRedirect(deps.redirect), replace: true });
  },
  pendingComponent: () => (
    <LoadingNow>
      <AuthPending title={strings.title} isSplit />
    </LoadingNow>
  ),
  errorComponent: () => <AuthError title={strings.title} isSplit />,
  component: TwoFactorRoute,
});

function TwoFactorRoute() {
  const { redirect: target } = Route.useSearch();
  const { data } = Route.useRouteContext();
  return <TwoFactorScreen data={data} redirect={target} />;
}
