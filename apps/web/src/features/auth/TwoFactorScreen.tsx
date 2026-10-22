// Brief
// Purpose: the second step of a sign in with two factor on (spec 0033): prove it's you with the app or a backup code.
// Main task: type the app's 6 digit code (checked when complete), or a backup code, or use a passkey (which signs
// in on its own, AC-888), then go on into the app.
// Leaves out: any way round the second factor (no email recovery, owner decision). An account whose only second
// factor is a passkey (`passkeyOnly`) gets the passkey alone.
import { isDataError, type DataLayer } from '@crm/data';
import { AuthLayout, Button, Callout, Checkbox, CodeInput, Field, Form, Link } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { signInFrame } from './AuthStates.tsx';
import { safeRedirect, signInHref } from './redirect.ts';
import { strings as signIn } from './strings.ts';
import { strings } from './two-factor-strings.ts';
import { PRODUCT_LOGO } from '../../brand.ts';

/** Props for the second step page. */
export interface TwoFactorScreenProps {
  readonly data: DataLayer;
  /** The `?redirect=` the sign in started with. */
  readonly redirect: string | undefined;
  /** The account's only second factor is a passkey (AC-888): no code field, the passkey alone. */
  readonly passkeyOnly?: boolean;
}

/** The second step page: the app's code, or a backup code, and "Remember this device". */
export function TwoFactorScreen({ data, redirect, passkeyOnly = false }: TwoFactorScreenProps) {
  const navigate = useNavigate();
  const [kind, setKind] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState('');
  const [remember, setRemember] = useState(false);
  const [isChecking, setChecking] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [expired, setExpired] = useState<string | undefined>(undefined);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // A refused code or the other kind chosen: the field takes focus again (it was off while checking).
  const [focusAsked, setFocusAsked] = useState(0);
  useEffect(() => {
    if (focusAsked > 0) field.current?.focus();
  }, [focusAsked]);
  const refocus = () => setFocusAsked((count) => count + 1);

  const check = (value: string) => {
    setChecking(true);
    setError(undefined);
    data.auth.secondStep(kind, value, remember).then(
      () => {
        void navigate({ href: safeRedirect(redirect), replace: true });
      },
      (failure: unknown) => {
        setChecking(false);
        if (isDataError(failure) && failure.code === 'SIGN_IN_EXPIRED') {
          // Run out, or too many wrong codes: the server's sentence says which.
          setExpired(failure.message);
          return;
        }
        setError(isDataError(failure) && failure.code !== 'INTERNAL' ? failure.message : strings.failed);
        setCode('');
        refocus();
      },
    );
  };

  // A passkey signs in on its own (AC-888): offered here too, where the browser has passkeys.
  const [hasPasskeys, setHasPasskeys] = useState(false);
  const [supportKnown, setSupportKnown] = useState(false);
  const [isAsking, setAsking] = useState(false);
  // A passkey's own failure: above the form, never on the code's field.
  const [passkeyError, setPasskeyError] = useState<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void data.auth.passkeys
      .support()
      .then((support) => {
        if (live) setHasPasskeys(support.available);
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setSupportKnown(true);
      });
    return () => {
      live = false;
    };
  }, [data]);
  const usePasskeyInstead = () => {
    setAsking(true);
    setPasskeyError(undefined);
    data.auth.passkeys.signIn(false).then(
      (outcome) => {
        setAsking(false);
        if (outcome === 'done') void navigate({ href: safeRedirect(redirect), replace: true });
      },
      (failure: unknown) => {
        setAsking(false);
        setPasskeyError(isDataError(failure) && failure.code !== 'INTERNAL' ? failure.message : strings.passkeyFailed);
      },
    );
  };

  const switchTo = (next: 'totp' | 'backup') => {
    setKind(next);
    setError(undefined);
    refocus();
  };

  if (expired !== undefined) {
    return (
      <AuthLayout productName={signIn.product} logo={PRODUCT_LOGO} title={strings.title} {...signInFrame()}>
        <Callout tone="warning" isAnnounced actions={<Link href="/sign-in">{strings.signInAgain}</Link>}>
          {expired === '' ? strings.expired : expired}
        </Callout>
      </AuthLayout>
    );
  }

  if (passkeyOnly) {
    return (
      <AuthLayout
        productName={signIn.product}
        logo={PRODUCT_LOGO}
        title={strings.title}
        description={strings.passkeyHint}
        isBusy={isAsking}
        {...signInFrame()}
      >
        {passkeyError !== undefined && (
          <Callout tone="danger" isAnnounced>
            {passkeyError}
          </Callout>
        )}
        {supportKnown && !hasPasskeys ? (
          <Callout
            tone="warning"
            actions={<Link href={signInHref(safeRedirect(redirect))}>{strings.signInAgain}</Link>}
          >
            {strings.passkeyUnavailable}
          </Callout>
        ) : (
          <Button
            variant="primary"
            size="lg"
            isFullWidth="center"
            icon="key"
            isPending={isAsking || !supportKnown}
            onPress={usePasskeyInstead}
          >
            {strings.passkeyContinue}
          </Button>
        )}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      productName={signIn.product}
      logo={PRODUCT_LOGO}
      title={strings.title}
      description={kind === 'totp' ? strings.appHint : strings.backupHint}
      isBusy={isChecking}
      {...signInFrame()}
    >
      {passkeyError !== undefined && (
        <Callout tone="danger" isAnnounced>
          {passkeyError}
        </Callout>
      )}
      <Form
        submitLabel={strings.continue}
        isDisabled={isAsking}
        busyLabel={strings.checking}
        isBusy={isChecking}
        actions={
          <>
            <Button
              variant="ghost"
              size="lg"
              isFullWidth="center"
              isDisabled={isAsking}
              onPress={() => switchTo(kind === 'totp' ? 'backup' : 'totp')}
            >
              {kind === 'totp' ? strings.useBackup : strings.useApp}
            </Button>
            {hasPasskeys && (
              <Button
                variant="ghost"
                size="lg"
                isFullWidth="center"
                icon="key"
                isPending={isAsking}
                isDisabled={isChecking}
                onPress={usePasskeyInstead}
              >
                {strings.usePasskey}
              </Button>
            )}
          </>
        }
        onSubmit={() => {
          if (kind === 'backup') {
            if (backup.trim() === '') setError(strings.backupMissing);
            else check(backup.trim());
          } else if (code.length === 6) {
            check(code);
          } else {
            setError(strings.appMissing);
            refocus();
          }
        }}
      >
        <Checkbox
          // Before the code, which sends itself once complete, so it is never skipped.
          label={strings.remember}
          isSelected={remember}
          onChange={setRemember}
          isDisabled={isChecking || isAsking}
        />
        {kind === 'totp' ? (
          <CodeInput
            ref={field}
            label={strings.appLabel}
            isLabelHidden
            size="lg"
            value={code}
            onChange={setCode}
            onComplete={check}
            isDisabled={isChecking}
            {...(error === undefined ? {} : { error })}
          />
        ) : (
          <Field
            label={strings.backupLabel}
            value={backup}
            onChange={setBackup}
            ref={field}
            name="backupCode"
            isDisabled={isChecking}
            autoComplete="off"
            {...(error === undefined ? {} : { error })}
          />
        )}
      </Form>
    </AuthLayout>
  );
}
