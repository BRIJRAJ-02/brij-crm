import { useId, useState, type ReactNode } from 'react';
import { Button } from '../../atoms/Button/Button.tsx';
import { Separator } from '../../atoms/Separator/Separator.tsx';
import { Callout } from '../../molecules/Callout/Callout.tsx';
import { Field } from '../../molecules/Field/Field.tsx';
import { Form, type FormRefusal } from '../../molecules/Form/Form.tsx';
import styles from './SignInForm.module.css';
import { strings } from './strings.ts';

/**
 * What is under way: `idle`, `sending` while the code goes out, `google`
 * while the browser heads to Google, `passkey` while the browser's passkey
 * prompt is open.
 */
export type SignInStatus = 'idle' | 'sending' | 'google' | 'passkey';

/** Props for SignInForm. */
export interface SignInFormProps {
  /** Sends the code to the address: called with the trimmed email once it looks like one. */
  readonly onContinue: (email: string) => void;
  /** Signs in with Google. Without it, the Google button and the "or" under it are hidden. */
  readonly onGoogle?: () => void;
  /**
   * What is under way, `idle` by default. `sending` spins the email's submit
   * as "Sending code" (Enter does nothing more) and turns Google off;
   * `google` spins the Google button as "Opening Google" and turns the
   * email's submit off; `passkey` turns both off (the screen's own passkey
   * button shows the wait).
   */
  readonly status?: SignInStatus;
  /** Why the address was refused, as a sentence that says what to do. Shown on the email field until it changes. */
  readonly error?: string;
  /**
   * A refusal about the sign in as a whole, not the address (sign up closed,
   * too many codes, a refused Google sign in, a session that ended), as a
   * sentence that says what to do. Shown at the top as a danger Callout, and
   * announced; it never marks the email field invalid. Clear it when the next
   * attempt starts.
   */
  readonly notice?: string;
  /** The address to start with: the one used last, coming back from "Use a different email". */
  readonly defaultEmail?: string;
  /** Signing in is off for now: the field and buttons are off. */
  readonly isDisabled?: boolean;
  /** Why it is off, under the field. It describes both buttons too. */
  readonly disabledReason?: string;
  /** Sign up is closed: a quiet line under the buttons says so. */
  readonly isSignUpClosed?: boolean;
  /**
   * Other ways in beside Google, above the "or" (spec 0033's "Sign in with a
   * passkey"): Buttons with `size="lg"` and `isFullWidth="center"`, under
   * Continue with Google. The "or" shows when this or Google is there. Prefer
   * it to `afterEmail` for a way in that doesn't use the typed address, so
   * the email field and its submit stay together. The form doesn't turn these
   * off for `isDisabled` or `status`: the screen does, as it renders them.
   */
  readonly otherWays?: ReactNode;
  /**
   * Under the email field, before its submit: another way in that belongs
   * with the address it was given (a passkey goes in `otherWays`). Empty until
   * a screen fills it.
   */
  readonly afterEmail?: ReactNode;
  /**
   * The browser may offer passkeys in the email field's suggestions (spec
   * 0033, AC-888): its autocomplete gains `webauthn`. Set it only while the
   * screen is waiting for one to be picked.
   */
  readonly isPasskeyAutofill?: boolean;
}

/** Every refusal the form shows is about the one field; the notice shows above everything, apart from the form. */
const EMAIL_FIELD = 'email';
const toEmailField = () => EMAIL_FIELD;

/** What is wrong with a typed address before it is sent, or undefined when it looks like one. */
function problemWith(email: string): FormRefusal | undefined {
  if (email === '') return { code: 'EMAIL_MISSING', message: strings.emailMissing };
  return /^[^\s@]+@[^\s@]+$/.test(email) ? undefined : { code: 'EMAIL_INVALID', message: strings.emailInvalid };
}

/**
 * The way in, for signing in and signing up alike: "Continue with Google"
 * first when Google is on, a quiet "or", then the email field and "Continue
 * with email", which sends a one time code. Presentational: it says what was
 * typed and pressed, and shows the status and refusals it is given. It checks
 * only that the address looks like one before sending.
 */
export function SignInForm({
  onContinue,
  onGoogle,
  status = 'idle',
  error,
  notice,
  defaultEmail = '',
  isDisabled = false,
  disabledReason,
  isSignUpClosed = false,
  afterEmail,
  otherWays,
  isPasskeyAutofill = false,
}: SignInFormProps) {
  const [email, setEmail] = useState(defaultEmail);
  const [problem, setProblem] = useState<FormRefusal | undefined>(undefined);
  // Once the person changes the address, the refusal stays hidden until the
  // next attempt.
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  const refusal: FormRefusal | undefined =
    error === undefined || error === dismissed ? undefined : { code: 'REFUSED', message: error };
  const shown = problem ?? refusal;
  // The notice is about how the person got here (a refused Google sign in, a
  // session that ended); once they submit, even an address that doesn't look
  // like one, it has been read, so it steps aside rather than being announced
  // again beside the field's own refusal. A notice the screen clears and sets
  // again (the next refusal) shows again.
  const [readNotice, setReadNotice] = useState<string | undefined>(undefined);
  if (notice === undefined && readNotice !== undefined) setReadNotice(undefined);
  const shownNotice = notice === readNotice ? undefined : notice;
  // The reason shows under the field; it describes both buttons as well, so
  // each says why it is off.
  const reasonId = useId();
  const hasReason = isDisabled && disabledReason !== undefined;
  return (
    <div className={styles.root}>
      {/* Danger is announced as an alert: about the sign in, not the address, so never on the field. */}
      {shownNotice !== undefined && <Callout tone="danger">{shownNotice}</Callout>}
      {(onGoogle !== undefined || otherWays !== undefined) && (
        // The ways in that need no address, together, space-8 apart as a Form's buttons are.
        <div className={styles.ways}>
          {onGoogle !== undefined && (
            <Button
              size="lg"
              isFullWidth="center"
              provider="google"
              onPress={onGoogle}
              isPending={status === 'google'}
              isDisabled={isDisabled || status === 'sending' || status === 'passkey'}
              {...(hasReason ? { 'aria-describedby': reasonId } : {})}
            >
              {status === 'google' ? strings.googlePending : strings.google}
            </Button>
          )}
          {otherWays}
        </div>
      )}
      {(onGoogle !== undefined || otherWays !== undefined) && <Separator label={strings.or} />}
      <Form
        submitLabel={onGoogle === undefined && otherWays === undefined ? strings.continue : strings.continueWithEmail}
        busyLabel={strings.sending}
        isBusy={status === 'sending'}
        isDisabled={isDisabled || status === 'google' || status === 'passkey'}
        refusals={shown === undefined ? [] : [shown]}
        fieldFor={toEmailField}
        {...(hasReason ? { submitDescribedBy: reasonId } : {})}
        onSubmit={() => {
          const typed = email.trim();
          const found = problemWith(typed);
          setProblem(found);
          setReadNotice(notice);
          if (found !== undefined) return;
          setDismissed(undefined);
          onContinue(typed);
        }}
      >
        <Field
          label={strings.email}
          name={EMAIL_FIELD}
          type="email"
          inputMode="email"
          autoComplete={isPasskeyAutofill ? 'email webauthn' : 'email'}
          placeholder={strings.emailPlaceholder}
          isRequired
          value={email}
          onChange={(next) => {
            setEmail(next);
            setProblem(undefined);
            if (error !== undefined) setDismissed(error);
          }}
          isDisabled={isDisabled}
          {...(disabledReason === undefined ? {} : { disabledReason })}
          {...(hasReason ? { descriptionId: reasonId } : {})}
        />
        {afterEmail}
      </Form>
      {isSignUpClosed && <p className={styles.note}>{strings.signUpClosed}</p>}
    </div>
  );
}
