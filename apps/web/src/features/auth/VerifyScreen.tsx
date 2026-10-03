// Brief
// Purpose: the second step of signing in: prove the email is yours with the code sent to it.
// Main task: type the 6 digit code (checked as soon as it is complete), then go on into the app.
// Leaves out: changing the address here ("Use another email" goes back) and any other sign in method.
import { isDataError, type DataLayer } from '@crm/data';
import { AuthLayout, VerifyEmail } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { resendRefusal, verifyRefusal } from './messages.ts';
import { clearPending, saveLastEmail, savePending, sessionStore, type PendingSignIn } from './pending.ts';
import { safeRedirect } from './redirect.ts';
import { strings } from './strings.ts';
import { useSecondsLeft } from './useSecondsLeft.ts';

/** How long to wait between code sends (spec 0005, AC-27). */
export const RESEND_WAIT_SECONDS = 60;

/** Props for the verify screen. */
export interface VerifyScreenProps {
  readonly data: DataLayer;
  /** The address the code went to, and when. */
  readonly pending: PendingSignIn;
  /** The `?redirect=` the sign in started with. */
  readonly redirect: string | undefined;
}

/** When the next code may be sent: 60 seconds after the last one, never later than 60 seconds from now (a clock that moved). */
export function firstResendAt(sentAt: number, now: number): number {
  return Math.min(sentAt, now) + RESEND_WAIT_SECONDS * 1000;
}

/** The verify page: AuthLayout and VerifyEmail, with the resend wait counted here. */
export function VerifyScreen({ data, pending, redirect }: VerifyScreenProps) {
  const navigate = useNavigate();
  // When "Send a new code" is ready again: a minute after each send, or the server's wait after a refused one.
  const [resendAt, setResendAt] = useState(() => firstResendAt(pending.sentAt, Date.now()));
  const [isVerifying, setVerifying] = useState(false);
  const [isResending, setResending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [isCodeSpent, setCodeSpent] = useState(false);
  const [resendError, setResendError] = useState<string | undefined>(undefined);
  const wait = useSecondsLeft(resendAt);

  const waitFrom = (failure: unknown) => {
    if (isDataError(failure) && failure.retryAfterSeconds !== undefined) {
      setResendAt(Date.now() + failure.retryAfterSeconds * 1000);
    }
  };

  const verify = (code: string) => {
    setVerifying(true);
    data.auth.verify(pending.email, code).then(
      () => {
        clearPending(sessionStore(window));
        void navigate({ href: safeRedirect(redirect), replace: true });
      },
      (failure: unknown) => {
        const refusal = verifyRefusal(failure, wait > 0);
        setVerifying(false);
        setError(refusal.message);
        setCodeSpent(refusal.isSpent);
        waitFrom(failure);
      },
    );
  };

  const resend = () => {
    // The code's refusal and the last resend's are about older answers.
    setError(undefined);
    setResendError(undefined);
    setResending(true);
    data.auth.sendCode(pending.email).then(
      () => {
        const now = Date.now();
        savePending(sessionStore(window), { email: pending.email, sentAt: now });
        setResendAt(now + RESEND_WAIT_SECONDS * 1000);
        setCodeSpent(false);
        setResending(false);
      },
      (failure: unknown) => {
        // The refusal comes in the same answer that ends the resend, so "New code sent" is never said.
        setResendError(resendRefusal(failure));
        waitFrom(failure);
        setResending(false);
      },
    );
  };

  const useAnotherEmail = () => {
    const storage = sessionStore(window);
    clearPending(storage);
    // /sign-in starts with this address, to fix a typo in it.
    saveLastEmail(storage, pending.email);
    void navigate({ to: '/sign-in', search: redirect === undefined ? {} : { redirect } });
  };

  return (
    <AuthLayout productName={strings.product} title={strings.verifyTitle}>
      <VerifyEmail
        email={pending.email}
        onVerify={verify}
        isVerifying={isVerifying}
        isCodeSpent={isCodeSpent}
        onResend={resend}
        resendWait={wait}
        isResending={isResending}
        onUseAnotherEmail={useAnotherEmail}
        {...(error === undefined ? {} : { error })}
        {...(resendError === undefined ? {} : { resendError })}
      />
    </AuthLayout>
  );
}
