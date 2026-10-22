// Brief
// Purpose: the loading and failed states every page before the app shares
// (sign in, verify, welcome), in the same frame as the page itself.
// Main task: hold the page's place while it checks who is signed in, or offer
// a retry when that check fails. Leaves out: the page's own task.
import { AuthLayout, Button, Callout, Skeleton, WorkspacePreview } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { strings } from './strings.ts';
import { PRODUCT_LOGO } from '../../brand.ts';

/**
 * Sign in's split screen, the frame first run continues in (spec 0036): a
 * sample workspace in the sketch beside the task (as Attio and Linear show
 * the product on sign in); first run then draws its own, live. No step
 * count here; the count starts at first run's Step 1 of 4.
 */
export function signInFrame() {
  return { preview: <WorkspacePreview workspaceName="" personName="" sample /> } as const;
}

/**
 * The page's frame and title while it checks who is signed in; a Skeleton
 * stands in for its task. `isSplit` draws first run's split card, with an
 * empty sketch beside it, so the card is already the width it will be.
 */
export function AuthPending({ title, isSplit = false }: { readonly title: string; readonly isSplit?: boolean }) {
  return (
    <AuthLayout
      productName={strings.product}
      logo={PRODUCT_LOGO}
      title={title}
      isBusy
      {...(isSplit ? signInFrame() : {})}
    >
      <Skeleton lines={3} />
    </AuthLayout>
  );
}

/**
 * The page's frame and title when the check failed: why, in an announced
 * Callout (the server's sentence when it said one, a rate limit, else that
 * Timefix can't be reached), and Try again, which runs the route again. The
 * page keeps its own title, so no second heading sits under it. `isSplit` is
 * as AuthPending's.
 */
export function AuthError({
  title,
  text,
  isSplit = false,
}: {
  readonly title: string;
  readonly text?: string | undefined;
  readonly isSplit?: boolean;
}) {
  const router = useRouter();
  // Spins while the route runs again, so a retry that fails as fast still shows it was pressed.
  const [isRetrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    void router.invalidate().finally(() => {
      setRetrying(false);
    });
  };
  return (
    <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={title} {...(isSplit ? signInFrame() : {})}>
      <Callout tone="danger" isAnnounced>
        {text ?? strings.unreachable}
      </Callout>
      <Button variant="primary" size="lg" isFullWidth="center" icon="refresh-cw" isPending={isRetrying} onPress={retry}>
        {strings.retry}
      </Button>
    </AuthLayout>
  );
}
