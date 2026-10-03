import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Spinner } from '../../atoms/Spinner/Spinner.tsx';
import { VisuallyHidden } from '../../atoms/VisuallyHidden/VisuallyHidden.tsx';
import { memoIntl } from '../../lib/intl-memo.ts';
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
  /** Sends a new code. */
  readonly onResend: () => void;
  /** Seconds until a new code can be sent. Above zero, "Send a new code" is off and the wait shows under it. The screen counts it down. */
  readonly resendWait?: number;
  /** A new code is on its way. When it turns false again, the boxes clear, focus moves to them and "New code sent" is announced. */
  readonly isResending?: boolean;
  /** Goes back to change the address. */
  readonly onUseAnotherEmail: () => void;
  /** Verifying is off for now: the boxes and both buttons are off. */
  readonly isDisabled?: boolean;
  /** Why it is off, as a sentence under the boxes. */
  readonly disabledReason?: string;
}

const CODE_LENGTH = 6;

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
  onResend,
  resendWait = 0,
  isResending = false,
  onUseAnotherEmail,
  isDisabled = false,
  disabledReason,
}: VerifyEmailProps) {
  const { locale } = useFormatSettings();
  const codeRef = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  const waitId = useId();
  const [code, setCode] = useState('');
  const [isErrorShown, setErrorShown] = useState(error !== undefined);
  // A resend that has finished (isResending back to false) clears the boxes
  // and the old refusal, and says the new code is on its way.
  const [wasResending, setWasResending] = useState(isResending);
  const [resends, setResends] = useState(0);
  const [isResentShown, setResentShown] = useState(false);
  if (wasResending !== isResending) {
    setWasResending(isResending);
    if (!isResending) {
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
  // do is type it.
  useEffect(() => {
    if (resends > 0 && !isDisabled) codeRef.current?.focus();
  }, [resends, isDisabled]);

  const shown = isErrorShown && !isVerifying ? error : undefined;
  const spoken = isVerifying ? strings.verifying : (shown ?? (isResentShown ? strings.resent : ''));
  const isWaiting = resendWait > 0;
  const hasReason = isDisabled && disabledReason !== undefined;
  const seconds = memoIntl(
    `seconds:${locale}`,
    () => new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'long' }),
  );
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
        isDisabled={isDisabled}
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
            onPress={onResend}
            isDisabled={isDisabled || isWaiting}
            isPending={isResending}
            {...describedBy(hasReason ? reasonId : undefined, isWaiting ? waitId : undefined)}
          >
            {isResending ? strings.resending : strings.resend}
          </Button>
          <Button
            variant="ghost"
            onPress={onUseAnotherEmail}
            isDisabled={isDisabled}
            {...describedBy(hasReason ? reasonId : undefined)}
          >
            {strings.useAnotherEmail}
          </Button>
        </div>
        {isWaiting && (
          <p id={waitId} className={styles.wait}>
            {strings.resendWait(seconds.format(resendWait))}
          </p>
        )}
      </div>
    </div>
  );
}
