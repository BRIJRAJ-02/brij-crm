import { useState } from 'react';
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
  /** A new code is on its way. */
  readonly isResending?: boolean;
  /** Goes back to change the address. */
  readonly onUseAnotherEmail: () => void;
}

const CODE_LENGTH = 6;

/**
 * The step after sign in: "We sent a code to …", the six digit code (checked
 * as soon as the sixth digit is in), "Send a new code" with its wait, and "Use
 * another email". Presentational: the screen owns the countdown and the
 * checks, and passes their state in. A refusal clears the boxes for the next
 * code and is announced; typing again hides it.
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
}: VerifyEmailProps) {
  const { locale } = useFormatSettings();
  const [code, setCode] = useState('');
  const [isErrorShown, setErrorShown] = useState(error !== undefined);
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
  const shown = isErrorShown && !isVerifying ? error : undefined;
  const isWaiting = resendWait > 0;
  const seconds = memoIntl(
    `seconds:${locale}`,
    () => new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'long' }),
  );
  return (
    <div className={styles.root}>
      <p className={styles.sent}>
        {strings.sentTo} <span className={styles.email}>{email}</span>.
      </p>
      <CodeInput
        label={strings.code}
        length={CODE_LENGTH}
        value={code}
        onChange={(next) => {
          setCode(next);
          if (next !== '') setErrorShown(false);
        }}
        onComplete={(complete) => {
          if (!isVerifying) onVerify(complete);
        }}
        {...(shown === undefined ? {} : { error: shown })}
      />
      {isVerifying && (
        <span className={styles.checking} aria-hidden="true">
          <Spinner label={strings.verifying} />
          {strings.verifying}
        </span>
      )}
      <VisuallyHidden>
        <span role="status">{isVerifying ? strings.verifying : (shown ?? '')}</span>
      </VisuallyHidden>
      <div className={styles.foot}>
        <div className={styles.actions}>
          <Button onPress={onResend} isDisabled={isWaiting} isPending={isResending}>
            {isResending ? strings.resending : strings.resend}
          </Button>
          <Button variant="ghost" onPress={onUseAnotherEmail}>
            {strings.useAnotherEmail}
          </Button>
        </div>
        {isWaiting && <p className={styles.wait}>{strings.resendWait(seconds.format(resendWait))}</p>}
      </div>
    </div>
  );
}
