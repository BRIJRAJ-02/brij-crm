// Brief
// Purpose: one way in for everyone, new or returning (spec 0036): Google, where it is on, or a code sent to an email.
// Main task: Continue with Google, or type an email and Continue with email, which sends the code and moves to /verify.
// Leaves out: passwords, passkeys (taken out 22 October 2026), sign up as a separate page, and any account settings.
import type { DataLayer } from '@crm/data';
import { AuthLayout, SignInForm, type SignInStatus } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { googleRefusal, isAboutAddress, sendRefusal } from './messages.ts';
import { savePending, sessionStore } from './pending.ts';
import type { SignedOut } from './redirect.ts';
import { signInFrame } from './AuthStates.tsx';
import { strings } from './strings.ts';
import { PRODUCT_LOGO } from '../../brand.ts';

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
  /** The `?signedOut=` a session that ended under the person came with: said above the form. */
  readonly signedOut?: SignedOut | undefined;
  /** The address to start with: the one used last, back from "Use a different email". */
  readonly email?: string | undefined;
}

/** The sign in or sign up page: AuthLayout and SignInForm, sending the code through the data layer. */
export function SignInScreen({ data, google, redirect, returnTo, googleError, signedOut, email }: SignInScreenProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SignInStatus>('idle');
  // A refused send about the address (not one) shows on the field; any other
  // refusal (sign up closed, too many tries, a refused Google sign in) is
  // about signing in, so it shows above the form.
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(() => {
    if (googleError !== undefined) return googleRefusal(googleError);
    if (signedOut === undefined) return undefined;
    if (signedOut === 'deleted') return strings.signedOutDeleted;
    return signedOut === 'unsaved' ? strings.signedOutUnsaved : strings.signedOutEnded;
  });

  // A refused Google sign in or an ended session is said once: the address
  // drops `?error=` and `?signedOut=` (keeping `?redirect=`), so a reload or a
  // return to this entry doesn't say it again. The notice was read from them
  // as the page started, and stays until the person acts.
  useEffect(() => {
    if (googleError === undefined && signedOut === undefined) return;
    void navigate({ to: '/sign-in', search: redirect === undefined ? {} : { redirect }, replace: true });
  }, [googleError, signedOut, redirect, navigate]);

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
    setError(undefined);
    setStatus('sending');
    data.auth.sendCode(address).then(
      () => {
        savePending(sessionStore(window), { email: address, sentAt: Date.now() });
        void navigate({ to: '/verify', search: redirect === undefined ? {} : { redirect } });
      },
      (failure: unknown) => {
        setStatus('idle');
        if (isAboutAddress(failure)) {
          setError(sendRefusal(failure));
        } else {
          setError(undefined);
          setNotice(sendRefusal(failure));
        }
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
    <AuthLayout productName={strings.product} logo={PRODUCT_LOGO} title={strings.signInTitle} {...signInFrame()}>
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
