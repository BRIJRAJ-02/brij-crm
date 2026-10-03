import { useState } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form, type FormRefusal } from '../../molecules/Form/Form.tsx';
import styles from './SignInForm.module.css';
import { strings } from './strings.ts';

/** What is under way: `idle`, `sending` while the code goes out, `google` while the browser heads to Google. */
export type SignInStatus = 'idle' | 'sending' | 'google';

/** Props for SignInForm. */
export interface SignInFormProps {
  /** Sends the code to the address: called with the trimmed email once it looks like one. */
  readonly onContinue: (email: string) => void;
  /** Signs in with Google. Without it, the Google button is hidden. */
  readonly onGoogle?: () => void;
  /**
   * What is under way, `idle` by default. `sending` spins Continue as
   * "Sending code" (Enter does nothing more) and turns Google off; `google`
   * spins the Google button as "Opening Google" and turns Continue off.
   */
  readonly status?: SignInStatus;
  /** Why the address was refused, as a sentence that says what to do. Shown on the email field until it changes. */
  readonly error?: string;
  /** The address to start with: the one used last, coming back from "Use another email". */
  readonly defaultEmail?: string;
  /** Signing in is off for now: the field and buttons are off. */
  readonly isDisabled?: boolean;
  /** Why it is off, under the field. */
  readonly disabledReason?: string;
  /** Sign up is closed: a quiet line under the buttons says so. */
  readonly isSignUpClosed?: boolean;
}

/** Every refusal here is about the one field. */
const EMAIL_FIELD = 'email';
const onEmailField = () => EMAIL_FIELD;

/** What is wrong with a typed address before it is sent, or undefined when it looks like one. */
function problemWith(email: string): FormRefusal | undefined {
  if (email === '') return { code: 'EMAIL_MISSING', message: strings.emailMissing };
  return /^[^\s@]+@[^\s@]+$/.test(email) ? undefined : { code: 'EMAIL_INVALID', message: strings.emailInvalid };
}

/**
 * The sign in form: an email field and "Continue", which sends a one time
 * code, and "Continue with Google" when Google is on. Presentational: it says
 * what was typed and pressed, and shows the status and refusal it is given.
 * It checks only that the address looks like one before sending.
 */
export function SignInForm({
  onContinue,
  onGoogle,
  status = 'idle',
  error,
  defaultEmail = '',
  isDisabled = false,
  disabledReason,
  isSignUpClosed = false,
}: SignInFormProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [problem, setProblem] = useState<FormRefusal | undefined>(undefined);
  // Once the person changes the address, the refusal stays hidden until the
  // next attempt.
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  const refusal: FormRefusal | undefined =
    error === undefined || error === dismissed ? undefined : { code: 'REFUSED', message: error };
  const shown = problem ?? refusal;
  return (
    <div className={styles.root}>
      <Form
        submitLabel={strings.continue}
        busyLabel={strings.sending}
        isBusy={status === 'sending'}
        isDisabled={isDisabled || status === 'google'}
        refusals={shown === undefined ? [] : [shown]}
        fieldFor={onEmailField}
        onSubmit={() => {
          const typed = email.trim();
          const found = problemWith(typed);
          setProblem(found);
          if (found !== undefined) return;
          setDismissed(undefined);
          onContinue(typed);
        }}
        {...(onGoogle === undefined
          ? {}
          : {
              actions: (
                <Button
                  size="lg"
                  isFullWidth="center"
                  onPress={onGoogle}
                  isPending={status === 'google'}
                  isDisabled={isDisabled || status === 'sending'}
                >
                  {status === 'google' ? strings.googlePending : strings.google}
                </Button>
              ),
            })}
      >
        <Field
          label={strings.email}
          name={EMAIL_FIELD}
          type="email"
          inputMode="email"
          autoComplete="email"
          isRequired
          value={email}
          onChange={(next) => {
            setEmail(next);
            setProblem(undefined);
            if (error !== undefined) setDismissed(error);
          }}
          isDisabled={isDisabled}
          {...(disabledReason === undefined ? {} : { disabledReason })}
        />
      </Form>
      {isSignUpClosed && <p className={styles.note}>{strings.signUpClosed}</p>}
    </div>
  );
}
