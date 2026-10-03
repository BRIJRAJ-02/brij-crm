// Brief
// Purpose: the way in: a sign in code sent to an email (or Google, where it is on).
// Main task: type an email and press Continue, which sends the code and moves to /verify.
// Leaves out: passwords, sign up as a separate step, and any account settings.
import type { DataLayer } from '@crm/data';
import { AuthLayout, SignInForm, type SignInStatus } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { googleRefusal, sendRefusal } from './messages.ts';
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
  /** The `?error=` a refused Google sign in came back with. */
  readonly googleError?: string | undefined;
  /** The address to start with: the one used last, back from "Use another email". */
  readonly email?: string | undefined;
}

/** The sign in page: AuthLayout and SignInForm, sending the code through the data layer. */
export function SignInScreen({ data, google, redirect, returnTo, googleError, email }: SignInScreenProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SignInStatus>('idle');
  // A refused send is about the address, so it shows on the field; a refused
  // Google sign in is about the sign in, so it shows above the form.
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(() =>
    googleError === undefined ? undefined : googleRefusal(googleError),
  );

  // The refused Google sign in is said once: the address drops `?error=`
  // (keeping `?redirect=`), so a reload or a return to this entry doesn't say
  // it again. The notice was read from it as the page started, and stays.
  useEffect(() => {
    if (googleError === undefined) return;
    void navigate({ to: '/sign-in', search: redirect === undefined ? {} : { redirect }, replace: true });
  }, [googleError, redirect, navigate]);

  // Back from Google with the browser's back button, the page comes out of
  // the back/forward cache as it was left: "Opening Google". Start over.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setStatus('idle');
    };
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const sendCode = (address: string) => {
    setNotice(undefined);
    setStatus('sending');
    data.auth.sendCode(address).then(
      () => {
        savePending(sessionStore(window), { email: address, sentAt: Date.now() });
        void navigate({ to: '/verify', search: redirect === undefined ? {} : { redirect } });
      },
      (failure: unknown) => {
        setStatus('idle');
        setError(sendRefusal(failure));
      },
    );
  };

  const signInWithGoogle = () => {
    setNotice(undefined);
    setStatus('google');
    // On success the browser leaves for Google; only a failure comes back here.
    data.auth.signInWithGoogle(returnTo).catch((failure: unknown) => {
      setStatus('idle');
      setNotice(sendRefusal(failure));
    });
  };

  return (
    <AuthLayout productName={strings.product} title={strings.signInTitle} description={strings.signInDescription}>
      <SignInForm
        status={status}
        onContinue={sendCode}
        {...(email === undefined ? {} : { defaultEmail: email })}
        {...(error === undefined ? {} : { error })}
        {...(notice === undefined ? {} : { notice })}
        {...(google ? { onGoogle: signInWithGoogle } : {})}
      />
    </AuthLayout>
  );
}
