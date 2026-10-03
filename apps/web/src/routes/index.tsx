import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthError, AuthPending } from '../features/auth/AuthStates.tsx';
import { strings } from '../features/auth/strings.ts';

// `/` only sends people on (spec 0005): signed out to /sign-in, without a
// workspace to /welcome, otherwise to their first workspace (oldest by the
// directory's created_at), which opens on People.
export const Route = createFileRoute('/')({
  loader: async ({ context }) => {
    const me = await context.data.me.get();
    if (me === undefined) throw redirect({ to: '/sign-in', replace: true });
    const [first] = me.workspaces;
    if (first === undefined) throw redirect({ to: '/welcome', replace: true });
    throw redirect({ to: '/w/$slug', params: { slug: first.slug }, replace: true });
  },
  pendingComponent: () => <AuthPending title={strings.product} />,
  errorComponent: () => <AuthError title={strings.product} />,
  component: () => null,
});
