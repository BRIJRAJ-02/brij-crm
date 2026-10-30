// Brief
// Purpose: what a workspace shows someone its sign in rules hold back (spec 0033, AC-894): two factor required and
// not set up, or a sign in older than the workspace allows.
// Main task: set up two factor right here (an authenticator app) and continue, or confirm it's you.
// Leaves out: any way past the rule, and the person's other workspaces, which open as usual from the workspace menu.
import { type DataLayer } from '@crm/data';
import { useAccountSecurity } from '@crm/data/react';
import { Button, Callout, EmptyState, Modal, TopBar, type Toasts } from '@crm/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { signInHref } from '../auth/redirect.ts';
import { useStepUp } from '../settings/StepUp.tsx';
import { TwoFactorSection } from '../settings/TwoFactorSection.tsx';
import { strings } from './strings.ts';

/** Which rule held the person back: the door's refusal code. */
export type HeldBack = 'TWO_FACTOR_REQUIRED' | 'SIGN_IN_AGAIN';

/** The page for a workspace whose sign in rules hold this session back, in the frame's place for a page. */
export function signInRulesPage(props: SignInRulesProps) {
  return {
    topBar: <TopBar title={props.workspaceName} />,
    body: props.reason === 'TWO_FACTOR_REQUIRED' ? <TwoFactorRequired {...props} /> : <SignInAgain {...props} />,
  };
}

/** Props for the held back page. */
export interface SignInRulesProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly workspaceName: string;
  readonly reason: HeldBack;
}

/** Reads the workspace again; answers false when it still holds this session back (the page is still here). */
function useContinue() {
  const router = useRouter();
  const [isBusy, setBusy] = useState(false);
  const [stillHeld, setStillHeld] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const go = async () => {
    setBusy(true);
    setStillHeld(false);
    await router.invalidate();
    // Let in, this page is gone; still here, the rule still holds.
    if (live.current) {
      setBusy(false);
      setStillHeld(true);
    }
  };
  return { go, isBusy, stillHeld };
}

/** Two factor required (AC-894): set it up here, then continue into the workspace. */
function TwoFactorRequired({ data, toasts, workspaceName }: SignInRulesProps) {
  const security = useAccountSecurity(data.account.security());
  const [isSettingUp, setSettingUp] = useState(false);
  // An app counts as set up once its backup codes dialog has closed, so the codes are never cut short.
  const [appDone, setAppDone] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const setupRef = useRef<HTMLDivElement>(null);
  const next = useContinue();
  const ready = security.status === 'ready';
  const isSetUp = ready && security.twoFactor.on && (appDone || !isSettingUp);
  // Focus follows the step: into the setup when it opens, onto Continue once it is done.
  useEffect(() => {
    if (isSetUp) continueRef.current?.focus();
  }, [isSetUp]);
  useEffect(() => {
    if (isSettingUp) setupRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [isSettingUp]);

  if (security.status === 'error') {
    return (
      <EmptyState
        tone="error"
        title={strings.twoFactorRequiredTitle(workspaceName)}
        onRetry={() => void data.account.security().reload()}
      >
        {security.message}
      </EmptyState>
    );
  }
  return (
    <>
      <EmptyState
        icon="shield-check"
        title={strings.twoFactorRequiredTitle(workspaceName)}
        isLoading={!ready}
        actions={
          isSetUp ? (
            <Button ref={continueRef} variant="primary" isPending={next.isBusy} onPress={() => void next.go()}>
              {strings.continueToWorkspace}
            </Button>
          ) : isSettingUp ? undefined : (
            <Button variant="primary" onPress={() => setSettingUp(true)}>
              {strings.setUpNow}
            </Button>
          )
        }
      >
        {isSetUp ? strings.twoFactorDone : strings.twoFactorRequiredText}
        {next.stillHeld && (
          <Callout tone="danger" isAnnounced>
            {strings.stillHeld}
          </Callout>
        )}
      </EmptyState>
      {isSettingUp && (
        <div ref={setupRef}>
          <TwoFactorSection
            data={data}
            security={security}
            toasts={toasts}
            onFocusLost={() => {
              setAppDone(true);
              requestAnimationFrame(() => continueRef.current?.focus());
            }}
          />
        </div>
      )}
    </>
  );
}

/**
 * A sign in older than the workspace allows, or from before everyone was
 * signed out: confirming it's you here counts as signing in again, and keeps
 * every other workspace open. Signing out of this device is the fallback,
 * asked first.
 */
function SignInAgain({ data, workspaceName }: SignInRulesProps) {
  const navigate = useNavigate();
  const security = useAccountSecurity(data.account.security());
  const next = useContinue();
  const [isChecking, setChecking] = useState(false);
  const commit = useRef<() => void>(() => undefined);
  const stepUp = useStepUp(data, security, { onComplete: () => commit.current() });
  const [isConfirmingSignOut, setConfirmingSignOut] = useState(false);
  const [isSigningOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const confirm = async () => {
    setChecking(true);
    const proven = await stepUp.prove();
    setChecking(false);
    if (proven) await next.go();
  };
  useEffect(() => {
    commit.current = () => {
      if (!isChecking) void confirm();
    };
  });

  const signOut = () => {
    setSigningOut(true);
    setSignOutFailed(false);
    const back = `${window.location.pathname}${window.location.search}`;
    data.auth.signOut().then(
      () => {
        void navigate({ href: signInHref(back), replace: true });
      },
      () => {
        setSigningOut(false);
        setSignOutFailed(true);
      },
    );
  };

  return (
    <EmptyState
      icon="log-out"
      title={strings.signInAgainTitle(workspaceName)}
      isLoading={security.status === 'loading'}
      actions={
        <>
          <Button variant="primary" isPending={isChecking || next.isBusy} onPress={() => commit.current()}>
            {stepUp.willSend ? strings.sendCode : strings.confirmItsYou}
          </Button>
          <Button onPress={() => setConfirmingSignOut(true)}>{strings.signOutInstead}</Button>
        </>
      }
    >
      {strings.signInAgainText}
      {stepUp.fields}
      {next.stillHeld && (
        <Callout tone="danger" isAnnounced>
          {strings.stillHeldSignIn}
        </Callout>
      )}
      <Modal
        title={strings.signOutTitle}
        variant="confirm"
        tone="danger"
        isOpen={isConfirmingSignOut}
        isBusy={isSigningOut}
        onOpenChange={(open) => {
          if (!open && !isSigningOut) setConfirmingSignOut(false);
        }}
        actions={
          <>
            <Button slot="close" isDisabled={isSigningOut}>
              {strings.cancel}
            </Button>
            <Button variant="danger-solid" isPending={isSigningOut} onPress={signOut}>
              {strings.signOut}
            </Button>
          </>
        }
      >
        {strings.signOutEverywhereText}
        {signOutFailed && (
          <Callout tone="danger" isAnnounced>
            {strings.signInAgainFailed}
          </Callout>
        )}
      </Modal>
    </EmptyState>
  );
}
