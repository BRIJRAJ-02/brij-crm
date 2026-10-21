// Brief
// Purpose: the second step of a sign in with two factor on (spec 0033): prove it's you with the app or a backup code.
// Main task: type the app's 6 digit code (checked when complete), or a backup code, or use a passkey (which signs
// in on its own, AC-888), then go on into the app.
// Leaves out: any way round the second factor (no email recovery, owner decision).
import { isDataError, type DataLayer } from '@crm/data';
import { AuthLayout, Button, Callout, Checkbox, CodeInput, Field, Form, Link } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { safeRedirect } from './redirect.ts';
import { strings as signIn } from './strings.ts';
import { strings } from './two-factor-strings.ts';
import { PRODUCT_LOGO } from '../../brand.ts';

/** Props for the second step page. */
export interface TwoFactorScreenProps {
  readonly data: DataLayer;
  /** The `?redirect=` the sign in started with. */
  readonly redirect: string | undefined;
}

/** The second step page: the app's code, or a backup code, and "Remember this device". */
export function TwoFactorScreen({ data, redirect }: TwoFactorScreenProps) {
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
  const [isAsking, setAsking] = useState(false);
  useEffect(() => {
    let live = true;
    void data.auth.passkeys
      .support()
      .then((support) => {
        if (live) setHasPasskeys(support.available);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [data]);
  const usePasskeyInstead = () => {
    setAsking(true);
    setError(undefined);
    data.auth.passkeys.signIn(false).then(
      (outcome) => {
        setAsking(false);
        if (outcome === 'done') void navigate({ href: safeRedirect(redirect), replace: true });
      },
      (failure: unknown) => {
        setAsking(false);
        setError(isDataError(failure) && failure.code !== 'INTERNAL' ? failure.message : strings.failed);
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
      <AuthLayout productName={signIn.product} logo={PRODUCT_LOGO} title={strings.title}>
        <Callout tone="warning" isAnnounced actions={<Link href="/sign-in">{strings.signInAgain}</Link>}>
          {expired === '' ? strings.expired : expired}
        </Callout>
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
    >
      <Form
        submitLabel={strings.continue}
        busyLabel={strings.checking}
        isBusy={isChecking}
        actions={
          <>
            <Button variant="ghost" onPress={() => switchTo(kind === 'totp' ? 'backup' : 'totp')}>
              {kind === 'totp' ? strings.useBackup : strings.useApp}
            </Button>
            {hasPasskeys && (
              <Button
                variant="ghost"
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
          isDisabled={isChecking}
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
