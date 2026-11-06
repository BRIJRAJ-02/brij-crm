import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { AuthPending } from '../features/auth/AuthStates.tsx';
import { signInHref } from '../features/auth/redirect.ts';
import { connectHref, connectRequest, connectSearch } from '../features/partners/connect-request.ts';
import { ConnectRefused, ConnectScreen } from '../features/partners/ConnectScreen.tsx';
import { connectStrings as strings } from '../features/partners/strings.ts';

// The OAuth connect page (spec 0070, AC-7011, AC-7012), outside any workspace. Signed out, sign in (or sign up)
// comes back here with the same request. The server checks the request before the page shows anything: a refused
// one (an unknown app, an address it didn't register, no state, no S256) shows why, and never sends the browser on.
// Every address the page leaves for is one the server built from the app's registered one.
export const Route = createFileRoute('/oauth/partner/authorize')({
  validateSearch: connectSearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ context, deps }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ href: signInHref(connectHref(deps.search)), replace: true });
    const request = connectRequest(deps.search);
    try {
      return { user: me.user, request, offer: await context.data.partnerConnect.offer(request), refused: undefined };
    } catch (error) {
      // The request itself was refused: said on the page, never followed.
      if (isDataError(error) && (error.code === 'NOT_FOUND' || error.code === 'CONFIG_INVALID')) {
        return { user: me.user, request, offer: undefined, refused: error.message };
      }
      throw error;
    }
  },
  pendingComponent: () => (
    <LoadingNow>
      <AuthPending title={strings.loadingTitle} />
    </LoadingNow>
  ),
  errorComponent: ConnectError,
  component: ConnectRoute,
});

function ConnectRoute() {
  const { user, request, offer, refused } = Route.useLoaderData();
  const { data } = Route.useRouteContext();
  if (offer === undefined) return <ConnectRefused text={refused} />;
  return (
    <ConnectScreen
      data={data}
      request={request}
      offer={offer}
      user={user}
      leave={(href) => {
        window.location.assign(href);
      }}
    />
  );
}

/** Anything else that failed (offline, a server fault): the server's words when it gave any, with Try again. */
function ConnectError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <ConnectRefused
      text={isDataError(error) ? error.message : strings.failedText}
      onRetry={() => void router.invalidate()}
    />
  );
}
