import { isDataError } from '@crm/data';
import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect, type ErrorComponentProps } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { signInHref } from '../features/auth/redirect.ts';
import { JoinScreen } from '../features/join/JoinScreen.tsx';
import { strings } from '../features/join/strings.ts';

// Domain join (spec 0031, AC-819): outside any workspace, in the sign in frame. The workspaces whose email domain
// is the signed in person's, each with Ask to join or that they already asked; signed out, sign in comes back here.
export const Route = createFileRoute('/join')({
  loader: async ({ context }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ href: signInHref('/join'), replace: true });
    return { user: me.user, joinable: await context.data.join.list() };
  },
  pendingComponent: () => (
    <LoadingNow>
      <AuthPending title={strings.title} />
    </LoadingNow>
  ),
  errorComponent: JoinError,
  component: JoinRoute,
});

function JoinRoute() {
  const { user, joinable } = Route.useLoaderData();
  const { data } = Route.useRouteContext();
  return <JoinScreen data={data} email={user.email} joinable={joinable} />;
}

/** The read failed: the server's words when it gave any, with a retry. */
function JoinError({ error }: ErrorComponentProps) {
  return <AuthError title={strings.title} text={isDataError(error) ? error.message : undefined} />;
}
