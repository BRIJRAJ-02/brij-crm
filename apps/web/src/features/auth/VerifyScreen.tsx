// Brief
// Purpose: the second step of signing in: prove the email is yours with the code sent to it.
// Main task: type the 6 digit code (checked as soon as it is complete), then go on into the app.
// Leaves out: changing the address here ("Use another email" goes back) and any other sign in method.
import { isDataError, type DataLayer } from '@crm/data';
import { AuthLayout, VerifyEmail } from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { clearPending, savePending, sessionStore, type PendingSignIn } from './pending.ts';
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

const messageOf = (error: unknown): string => (isDataError(error) ? error.message : String(error));

/** The verify page: AuthLayout and VerifyEmail, with the resend wait counted here. */
export function VerifyScreen({ data, pending, redirect }: VerifyScreenProps) {
  const navigate = useNavigate();
  const [sentAt, setSentAt] = useState(pending.sentAt);
  const [isVerifying, setVerifying] = useState(false);
  const [isResending, setResending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const wait = Math.min(RESEND_WAIT_SECONDS, useSecondsLeft(sentAt + RESEND_WAIT_SECONDS * 1000));

  const verify = (code: string) => {
    setVerifying(true);
    data.auth.verify(pending.email, code).then(
      () => {
        clearPending(sessionStore(window));
        void navigate({ href: safeRedirect(redirect), replace: true });
      },
      (failure: unknown) => {
        setVerifying(false);
        setError(messageOf(failure));
      },
    );
  };

  const resend = () => {
    setResending(true);
    data.auth.sendCode(pending.email).then(
      () => {
        const now = Date.now();
        savePending(sessionStore(window), { email: pending.email, sentAt: now });
        setSentAt(now);
        setError(undefined);
        setResending(false);
      },
      (failure: unknown) => {
        // The refusal comes in the same answer that ends the resend, so it shows instead of "New code sent".
        setError(messageOf(failure));
        setResending(false);
      },
    );
  };

  const useAnotherEmail = () => {
    clearPending(sessionStore(window));
    void navigate({ to: '/sign-in', search: redirect === undefined ? {} : { redirect } });
  };

  return (
    <AuthLayout productName={strings.product} title={strings.verifyTitle}>
      <VerifyEmail
        email={pending.email}
        onVerify={verify}
        isVerifying={isVerifying}
        onResend={resend}
        resendWait={wait}
        isResending={isResending}
        onUseAnotherEmail={useAnotherEmail}
        {...(error === undefined ? {} : { error })}
      />
    </AuthLayout>
  );
}
