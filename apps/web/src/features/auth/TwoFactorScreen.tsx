// Brief
// Purpose: the second step of a sign in with two factor on (spec 0033): prove it's you with the app or a backup code.
// Main task: type the app's 6 digit code (checked when complete), or a backup code, then go on into the app.
// Leaves out: passkeys (milestone 3) and any way round the second factor (no email recovery, owner decision).
import { isDataError, type DataLayer } from '@crm/data';
import { AuthLayout, Button, Callout, Checkbox, CodeInput, Field, Form, Link } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
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
  const [isExpired, setExpired] = useState(false);

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
          setExpired(true);
          return;
        }
        setError(isDataError(failure) && failure.code !== 'INTERNAL' ? failure.message : strings.failed);
        setCode('');
      },
    );
  };

  const switchTo = (next: 'totp' | 'backup') => {
    setKind(next);
    setError(undefined);
  };

  if (isExpired) {
    return (
      <AuthLayout productName={signIn.product} logo={PRODUCT_LOGO} title={strings.title}>
        <Callout tone="warning" isAnnounced actions={<Link href="/sign-in">{strings.signInAgain}</Link>}>
          {strings.expired}
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
          <Button variant="ghost" onPress={() => switchTo(kind === 'totp' ? 'backup' : 'totp')}>
            {kind === 'totp' ? strings.useBackup : strings.useApp}
          </Button>
        }
        onSubmit={() => {
          if (kind === 'backup') {
            if (backup.trim() === '') setError(strings.backupMissing);
            else check(backup.trim());
          } else if (code.length === 6) {
            check(code);
          }
        }}
      >
        {kind === 'totp' ? (
          <CodeInput
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
            isDisabled={isChecking}
            autoComplete="one-time-code"
            {...(error === undefined ? {} : { error })}
          />
        )}
        <Checkbox label={strings.remember} isSelected={remember} onChange={setRemember} isDisabled={isChecking} />
      </Form>
    </AuthLayout>
  );
}
