import { LoadingNow } from '@crm/ui';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { SessionError, SessionPending } from '../features/auth/AuthStates.tsx';
import { strings } from '../features/auth/strings.ts';
import { homeWorkspace } from '../features/workspace/home.ts';

// `/` only sends people on (spec 0005): signed out to /sign-in, without a
// workspace to /welcome, otherwise to the workspace they last opened while
// they are still in it (spec 0031, AC-802), else their oldest.
export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ to: '/sign-in', replace: true });
    const home = homeWorkspace(me);
    if (home === undefined) throw redirect({ to: '/welcome', replace: true });
    throw redirect({ to: '/w/$slug', params: { slug: home.slug }, replace: true });
  },
  // Never sign in's screen for someone who turns out to be signed in: until `me.get` answers, the place held is
  // the app's own, unless this browser's last visit ended signed out (SessionPending).
  pendingComponent: () => (
    <LoadingNow>
      <SessionPending title={strings.openingTitle} />
    </LoadingNow>
  ),
  // A failed check wears the same frame as the loading state it replaces, so it never reads as being signed out.
  errorComponent: () => <SessionError title={strings.openFailedTitle} text={strings.openFailedText} />,
  component: () => null,
});
