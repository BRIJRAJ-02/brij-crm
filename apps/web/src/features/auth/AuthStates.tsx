// Brief
// Purpose: the loading and failed states every page before the app shares
// (sign in, verify, welcome), in the same frame as the page itself.
// Main task: hold the page's place while it checks who is signed in, or offer
// a retry when that check fails. Leaves out: the page's own task.
import { AuthLayout, Button, Callout, Skeleton, WorkspacePreview } from '@crm/ui';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { localStore, readSessionHint } from './hint.ts';
import { OpeningApp } from './OpeningApp.tsx';
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
 * Which place to hold while the session is unknown, for a browser that has
 * never said: `app` for `/`, which a signed in person opens far more often
 * than a stranger does, and `signIn` for the sign in pages, whose whole
 * purpose is for someone signed out.
 */
type WhenUnknown = 'app' | 'signIn';

/**
 * The place a page before the app holds while it checks who is signed in
 * (the owner, 24 October 2026: "before checking it flashed the signup page").
 * The screen that follows is sign in's for someone signed out and the app's
 * for someone signed in, and until `me.get` answers neither is known, so this
 * holds the place of whichever this browser's last visit ended in: the app's
 * own loading state (`OpeningApp`), or sign in's own frame when the hint says
 * nobody was signed in, so a signed out person reaches sign in with no
 * detour. A browser that has never said takes `whenUnknown`. A wrong guess
 * costs a loading state, never a wrong screen: the real answer always
 * overrules it, and nothing of anyone's is shown here.
 */
export function SessionPending({
  title,
  whenUnknown = 'app',
}: {
  readonly title: string;
  readonly whenUnknown?: WhenUnknown;
}) {
  if (holdsApp(whenUnknown)) return <OpeningApp />;
  return <AuthPending title={title} isSplit />;
}

/** Whether the app's own place is the one to hold: what the hint says, else `whenUnknown`. */
function holdsApp(whenUnknown: WhenUnknown): boolean {
  const hint = readSessionHint(localStore(window));
  return hint === undefined ? whenUnknown === 'app' : hint === 'in';
}

/**
 * The same choice for a check that failed: inside the app's own frame for
 * someone this browser last saw signed in, so "Can't open Timefix" never
 * arrives dressed as sign in and reads as "you have been signed out".
 */
export function SessionError({
  title,
  text,
  whenUnknown = 'app',
}: {
  readonly title: string;
  readonly text?: string | undefined;
  readonly whenUnknown?: WhenUnknown;
}) {
  return <AuthError title={title} text={text} isSplit={!holdsApp(whenUnknown)} />;
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
