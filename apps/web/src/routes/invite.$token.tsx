import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { InviteScreen } from '../features/invite/InviteScreen.tsx';
import { strings } from '../features/invite/strings.ts';

// An invitation link (spec 0031, AC-805): outside any workspace, in the sign in frame. The invitation as the link
// shows it (nothing for a link that opens nothing, all alike) and who is signed in, if anyone; the screen offers
// Join or Sign in to join, and sign in comes back here.
export const Route = createFileRoute('/invite/$token')({
  loader: async ({ context, params }) => {
    const [invitation, me] = await Promise.all([
      context.data.invitations.peek(params.token).catch((error: unknown) => {
        if (isDataError(error) && (error.code === 'INVITE_INVALID' || error.code === 'INPUT_INVALID')) return undefined;
        throw error;
      }),
      context.data.me.get(),
    ]);
    return { invitation, user: me?.user };
  },
  pendingComponent: () => (
    <LoadingNow>
      <AuthPending title={strings.pendingTitle} isSplit />
    </LoadingNow>
  ),
  errorComponent: InviteError,
  component: InviteRoute,
});

function InviteRoute() {
  const { invitation, user } = Route.useLoaderData();
  const { token } = Route.useParams();
  const { data } = Route.useRouteContext();
  return <InviteScreen data={data} token={token} invitation={invitation} user={user} />;
}

/** The look up failed: the server's words when it gave any (too many lookups), with a retry. */
function InviteError({ error }: ErrorComponentProps) {
  return <AuthError title={strings.pendingTitle} text={isDataError(error) ? error.message : undefined} isSplit />;
}
