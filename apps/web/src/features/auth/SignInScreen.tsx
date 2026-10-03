// Brief
// Purpose: the way in: a sign in code sent to an email (or Google, where it is on).
// Main task: type an email and press Continue, which sends the code and moves to /verify.
// Leaves out: passwords, sign up as a separate step, and any account settings.
import { isDataError, type DataLayer } from '@crm/data';
import { AuthLayout, SignInForm, type SignInStatus } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { savePending, sessionStore } from './pending.ts';
import { strings } from './strings.ts';

/** Props for the sign in screen. */
export interface SignInScreenProps {
  readonly data: DataLayer;
  /** Whether "Continue with Google" works here. */
  readonly google: boolean;
  /** The `?redirect=` the page came with, passed on to /verify. */
  readonly redirect: string | undefined;
  /** Where Google comes back to after signing in. */
  readonly returnTo: string;
}

const messageOf = (error: unknown): string => (isDataError(error) ? error.message : String(error));

/** The sign in page: AuthLayout and SignInForm, sending the code through the data layer. */
export function SignInScreen({ data, google, redirect, returnTo }: SignInScreenProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SignInStatus>('idle');
  const [error, setError] = useState<string | undefined>(undefined);

  const sendCode = (email: string) => {
    setStatus('sending');
    data.auth.sendCode(email).then(
      () => {
        savePending(sessionStore(window), { email, sentAt: Date.now() });
        void navigate({ to: '/verify', search: redirect === undefined ? {} : { redirect } });
      },
      (failure: unknown) => {
        setStatus('idle');
        setError(messageOf(failure));
      },
    );
  };

  const signInWithGoogle = () => {
    setStatus('google');
    // On success the browser leaves for Google; only a failure comes back here.
    data.auth.signInWithGoogle(returnTo).catch((failure: unknown) => {
      setStatus('idle');
      setError(messageOf(failure));
    });
  };

  return (
    <AuthLayout productName={strings.product} title={strings.signInTitle} description={strings.signInDescription}>
      <SignInForm
        status={status}
        onContinue={sendCode}
        {...(error === undefined ? {} : { error })}
        {...(google ? { onGoogle: signInWithGoogle } : {})}
      />
    </AuthLayout>
  );
}
