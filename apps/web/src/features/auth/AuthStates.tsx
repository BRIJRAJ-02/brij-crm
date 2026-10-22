// Brief
// Purpose: the loading and failed states every page before the app shares
// (sign in, verify, welcome), in the same frame as the page itself.
// Main task: hold the page's place while it checks who is signed in, or offer
// a retry when that check fails. Leaves out: the page's own task.
import { AuthLayout, Button, Callout, Skeleton, WorkspacePreview } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { strings } from './strings.ts';
import { PRODUCT_LOGO } from '../../brand.ts';

/**
 * Sign in's split card, the frame first run continues in (spec 0036): the
 * calm, empty sketch of the app beside the task, which first run then fills
 * in. No step count here; the count starts at first run's Step 1 of 5.
 */
export function signInFrame() {
  return { preview: <WorkspacePreview workspaceName="" personName="" /> } as const;
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
  return (
    <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={title} {...(isSplit ? signInFrame() : {})}>
      <Callout tone="danger" isAnnounced>
        {text ?? strings.unreachable}
      </Callout>
      <Button size="lg" isFullWidth="center" icon="refresh-cw" onPress={() => void router.invalidate()}>
        {strings.retry}
      </Button>
    </AuthLayout>
  );
}
