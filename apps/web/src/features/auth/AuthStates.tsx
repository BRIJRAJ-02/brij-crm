// Brief
// Purpose: the loading and failed states every page before the app shares
// (sign in, verify, welcome), in the same frame as the page itself.
// Main task: hold the page's place while it checks who is signed in, or offer
// a retry when that check fails. Leaves out: the page's own task.
import { AuthLayout, EmptyState, Skeleton } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { strings } from './strings.ts';

/** The page's frame and title while it checks who is signed in; a Skeleton stands in for its task. */
export function AuthPending({ title }: { readonly title: string }) {
  return (
    <AuthLayout productName={strings.product} title={title} isBusy>
      <Skeleton lines={3} />
    </AuthLayout>
  );
}

/** The page's frame and title when the check failed, with a retry that runs the route again. */
export function AuthError({ title }: { readonly title: string }) {
  const router = useRouter();
  return (
    <AuthLayout productName={strings.product} title={title}>
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void router.invalidate()}>
        {strings.failedText}
      </EmptyState>
    </AuthLayout>
  );
}
