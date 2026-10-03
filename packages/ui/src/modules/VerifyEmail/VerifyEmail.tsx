import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { CodeInput } from '../../molecules/CodeInput/CodeInput.tsx';
import { useFormatSettings } from '../../provider/context.ts';
import styles from './VerifyEmail.module.css';
import { strings } from './strings.ts';

/** Props for VerifyEmail. */
export interface VerifyEmailProps {
  /** Where the code went. */
  readonly email: string;
  /** Checks the code: called once all six digits are in. Not called again while `isVerifying`. */
  readonly onVerify: (code: string) => void;
  /** The code is being checked. */
  readonly isVerifying?: boolean;
  /** Why the code was refused (wrong or expired), as a sentence that says what to do. The boxes clear for the next try. */
  readonly error?: string;
  /**
   * The code can't be used any more (tried too often, or expired): the boxes
   * are off until a new code is sent. While the resend wait runs, focus moves
   * to `error`, which says why; when "Send a new code" is ready, focus moves
   * there.
   */
  readonly isCodeSpent?: boolean;
  /** Sends a new code. */
  readonly onResend: () => void;
  /**
   * Seconds until a new code can be sent. Above zero, "Send a new code" is
   * off and the wait shows under it ("42 seconds", "10 minutes"). The screen
   * counts it down.
   */
  readonly resendWait?: number;
  /**
   * A new code is on its way. When it turns false again without a
   * `resendError`, the code went out: the boxes clear, focus moves to them,
   * and "New code sent" is announced and shown in the wait line.
   */
  readonly isResending?: boolean;
  /**
   * Why the new code wasn't sent (sent too often, offline), as a sentence that
   * says what to do. Shown and announced under "Send a new code", never on
   * the boxes. Clear it when the next resend starts.
   */
  readonly resendError?: string;
  /** Goes back to change the address. */
  readonly onUseAnotherEmail: () => void;
  /** Verifying is off for now: the boxes and both buttons are off. */
  readonly isDisabled?: boolean;
  /** Why it is off, as a sentence under the boxes. */
  readonly disabledReason?: string;
}

const CODE_LENGTH = 6;

/** The resend wait in words: seconds up to a minute, then whole minutes, then whole hours, rounded up so it never says less than the real wait. */
function waitText(locale: string, seconds: number): string {
  const [unit, amount] =
    seconds <= 60
      ? (['second', seconds] as const)
      : seconds <= 90 * 60
        ? (['minute', Math.ceil(seconds / 60)] as const)
        : (['hour', Math.ceil(seconds / 3600)] as const);
  return memoIntl(
    `wait-${unit}:${locale}`,
    () => new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }),
  ).format(amount);
}

/** The ids, space separated, of the lines that describe a button, or undefined for none. */
function describedBy(...ids: readonly (string | undefined)[]): { readonly 'aria-describedby'?: string } {
  const present = ids.filter((id) => id !== undefined);
  return present.length === 0 ? {} : { 'aria-describedby': present.join(' ') };
}

/**
 * The step after sign in: "Enter the code sent to …", the six digit code (checked
 * as soon as the sixth digit is in), "Send a new code" with its wait, and "Use
 * another email". Presentational: the screen owns the countdown and the
 * checks, and passes their state in. A refusal clears the boxes for the next
 * code and is announced; typing again hides it. Once a new code is sent, the
 * boxes clear, focus moves to them and "New code sent" is announced.
 */
export function VerifyEmail({
  email,
  onVerify,
  isVerifying = false,
  error,
  isCodeSpent = false,
  onResend,
  resendWait = 0,
  isResending = false,
  resendError,
  onUseAnotherEmail,
  isDisabled = false,
  disabledReason,
}: VerifyEmailProps) {
  const { locale } = useFormatSettings();
  const codeRef = useRef<HTMLInputElement>(null);
  const resendRef = useRef<HTMLButtonElement>(null);
  const anotherRef = useRef<HTMLButtonElement>(null);
  const spentRef = useRef<HTMLSpanElement>(null);
  const reasonId = useId();
  const waitId = useId();
  const [code, setCode] = useState('');
  const [isErrorShown, setErrorShown] = useState(error !== undefined);
  // A resend that has finished (isResending back to false) without a refusal
  // sent the code: the boxes and the old refusal clear, and it says the new
  // code is on its way. A refused resend leaves the boxes as they were.
  const [wasResending, setWasResending] = useState(isResending);
  const [resends, setResends] = useState(0);
  const [isResentShown, setResentShown] = useState(false);
  if (wasResending !== isResending) {
    setWasResending(isResending);
    if (isResending) setResentShown(false);
    else if (resendError === undefined) {
      setCode('');
      setErrorShown(false);
      setResentShown(true);
      setResends((count) => count + 1);
    }
  }
  // Each answer (a refusal, or the same refusal after another try) clears the
  // boxes for the next code and shows the refusal again.
  const [answer, setAnswer] = useState({ error, isVerifying });
  if (answer.error !== error || answer.isVerifying !== isVerifying) {
    setAnswer({ error, isVerifying });
    if (error !== undefined && !isVerifying) {
      setCode('');
      setErrorShown(true);
    }
  }
  // Focus was on "Send a new code"; once the code is sent, the next thing to
  // do is type it. Each resend moves focus once, at most: the last one acted
  // on is kept, so turning the screen off and on again moves nothing, and a
  // resend that lands while it is off is passed over.
  const actedOn = useRef(0);
  useEffect(() => {
    if (resends === actedOn.current) return;
    actedOn.current = resends;
    if (!isDisabled) codeRef.current?.focus();
  }, [resends, isDisabled]);

  // A spent code turns the boxes off, and focus would be lost with them.
  // While the wait runs, it goes to the message that says why (or, without
  // one, "Use another email"); once "Send a new code" is ready, there, the
  // next thing to do.
  const isResendReady = !isDisabled && !isResending && resendWait <= 0;
  useEffect(() => {
    if (!isCodeSpent) return;
    // Only when focus was in the boxes (now off), lost with them, or on the
    // message this put it on; never taken from elsewhere.
    const active = document.activeElement;
    const isOurs =
      active === null || active === document.body || active === codeRef.current || active === spentRef.current;
    if (!isOurs) return;
    if (isResendReady) resendRef.current?.focus();
    else if (active !== spentRef.current) (spentRef.current ?? anotherRef.current)?.focus();
  }, [isCodeSpent, isResendReady]);

  const shown = isErrorShown && !isVerifying ? error : undefined;
  const spoken = isVerifying ? strings.verifying : (shown ?? (isResentShown ? strings.resent : ''));
  const isWaiting = resendWait > 0;
  const hasReason = isDisabled && disabledReason !== undefined;
  const refusedResend = isResending ? undefined : resendError;
  const time = waitText(locale, resendWait);
  const [before, address, after] = strings.sentTo(<span className={styles.email}>{email}</span>);
  return (
    <div className={styles.root}>
      <p className={styles.sent}>
        {before}
        {address}
        {after}
      </p>
      <CodeInput
        ref={codeRef}
        label={strings.code}
        length={CODE_LENGTH}
        value={code}
        isDisabled={isDisabled || isCodeSpent}
        onChange={(next) => {
          setCode(next);
          if (next !== '') {
            setErrorShown(false);
            setResentShown(false);
          }
        }}
        onComplete={(complete) => {
          if (!isVerifying) onVerify(complete);
        }}
        {...(shown === undefined ? {} : { error: shown })}
        {...(isCodeSpent ? { errorRef: spentRef } : {})}
      />
      {hasReason && (
        <p id={reasonId} className={styles.reason}>
          {disabledReason}
        </p>
      )}
      {isVerifying && (
        <span className={styles.checking} aria-hidden="true">
          <Spinner label={strings.verifying} />
          {strings.verifying}
        </span>
      )}
      <VisuallyHidden>
        <span role="status">{spoken}</span>
      </VisuallyHidden>
      <div className={styles.foot}>
        <div className={styles.actions}>
          <Button
            ref={resendRef}
            onPress={onResend}
            isDisabled={isDisabled || isWaiting}
            isPending={isResending}
            {...describedBy(hasReason ? reasonId : undefined, isWaiting ? waitId : undefined)}
          >
            {isResending ? strings.resending : strings.resend}
          </Button>
          <Button
            ref={anotherRef}
            variant="ghost"
            onPress={onUseAnotherEmail}
            isDisabled={isDisabled}
            {...describedBy(hasReason ? reasonId : undefined)}
          >
            {strings.useAnotherEmail}
          </Button>
        </div>
        {refusedResend !== undefined && <Callout tone="danger">{refusedResend}</Callout>}
        {isWaiting && (
          <p id={waitId} className={styles.wait}>
            {isResentShown ? strings.resentWait(time) : strings.resendWait(time)}
          </p>
        )}
      </div>
    </div>
  );
}
