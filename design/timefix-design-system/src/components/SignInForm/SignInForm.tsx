import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../Button/Button.tsx';
import { TextField, useShake } from '../Field/Field.tsx';
import { CodeInput } from '../CodeInput/CodeInput.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { SuccessCheck, TextSwap } from '../Motion/Motion.tsx';
import { AuthHeading, AuthPages } from '../AuthLayout/AuthLayout.tsx';
import './SignInForm.css';

/** Where the person is: typing their email, typing the code, or signed in. */
export type SignInStep = 'email' | 'code' | 'done';

/** An answer from the server: `undefined` when it went through, else the sentence to show. A rate limit is a sentence with `{time}`
 *  and the seconds to wait: the time counts down in place and sending waits until it ends. */
export type SignInAnswer = string | { readonly message: string; readonly retryIn: number } | undefined;

/** "45 seconds", "5 minutes", "2 hours": up to a minute in seconds, up to 90 minutes in whole minutes rounded up, then hours. */
export function waitWords(s: number): string {
  if (s <= 60) return `${s} ${s === 1 ? 'second' : 'seconds'}`;
  if (s <= 90 * 60) { const m = Math.ceil(s / 60); return `${m} ${m === 1 ? 'minute' : 'minutes'}`; }
  const h = Math.ceil(s / 3600); return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** Props for SignInForm. */
export interface SignInFormProps {
  /** Sends the one time code. Resolve to a sentence to refuse the address ("That address can't sign in here."). */
  readonly onSendCode: (email: string) => Promise<SignInAnswer> | SignInAnswer;
  /** Checks the code. Resolve to a sentence when it is wrong; the boxes shake and empty. */
  readonly onVerify: (email: string, code: string) => Promise<SignInAnswer> | SignInAnswer;
  /** Shows "Continue with Google" first, with "or" under it. Leave it out when Google is not set up. */
  readonly onGoogle?: () => void;
  /** Called once the check has drawn, about a second after the code is accepted. */
  readonly onSignedIn?: (email: string) => void;
  /** Seconds before "Resend code" may be pressed again; 30 by default. */
  readonly resendAfter?: number;
  readonly defaultEmail?: string;
  /** A refusal about the sign in as a whole (a cancelled Google sign in, too many codes), shown at the top as a danger Callout. */
  readonly notice?: ReactNode;
  /** The notice's tone: danger for a refusal (default), info for why you were signed out, success for a finished deletion. */
  readonly noticeTone?: 'danger' | 'info' | 'success';
  /** Where the person lands, named on the success page ("Northwind"). */
  readonly workspace?: string;
  /** Starts on a given page, for docs and previews. */
  readonly initialStep?: SignInStep;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INDEX: Readonly<Record<SignInStep, number>> = { email: 0, code: 1, done: 2 };

/** A neutral G tile until the brand marks arrive. */
function GoogleTile() {
  return <span className="tf-signin__g" aria-hidden="true">G</span>;
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The way in, for sign in and sign up alike: Continue with Google, or an email that gets a 6-digit code.
 * Three pages slide side by side (email, code, signed in) while the box eases to each one's height.
 */
export function SignInForm({ onSendCode, onVerify, onGoogle, onSignedIn, resendAfter = 30, defaultEmail = '', notice, noticeTone = 'danger', workspace, initialStep = 'email' }: SignInFormProps) {
  const [step, setStep] = useState<SignInStep>(initialStep);
  const [email, setEmail] = useState(defaultEmail);
  const [emailError, setEmailError] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>(undefined);
  const [wait, setWait] = useState<{ readonly message: string; readonly left: number }>();
  const [checking, setChecking] = useState(false);
  const [left, setLeft] = useState(initialStep === 'code' ? resendAfter : 0);
  const [resent, setResent] = useState(false);
  const { ref: fieldWrap, shake } = useShake<HTMLDivElement>();
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  useEffect(() => {
    if (left <= 0) return;
    const t = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left]);

  // A rate limit counts down in its sentence, then clears so the email can be sent again.
  useEffect(() => {
    if (!wait) return;
    if (wait.left <= 0) { setWait(undefined); setEmailError(undefined); return; }
    setEmailError(wait.message.replace('{time}', waitWords(wait.left)));
    const t = window.setTimeout(() => setWait((w) => (w ? { ...w, left: w.left - 1 } : w)), 1000);
    return () => window.clearTimeout(t);
  }, [wait]);

  useEffect(() => {
    if (step !== 'done') return;
    const t = window.setTimeout(() => signedIn.current?.(email.trim()), 1100);
    return () => window.clearTimeout(t);
  }, [step, email]);

  const refuse = (message: string) => {
    // The field shakes itself when it turns invalid; a second refusal of the same kind shakes it again here.
    if (emailError !== undefined) shake();
    setEmailError(message);
  };

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const value = email.trim();
    if (value === '') return refuse('Enter your email address.');
    if (!EMAIL.test(value)) return refuse('Enter an email address like name@company.com.');
    setSending(true);
    const answer = await onSendCode(value);
    setSending(false);
    if (typeof answer === 'object') { setWait({ message: answer.message, left: answer.retryIn }); return; }
    if (answer !== undefined) return refuse(answer);
    setEmailError(undefined);
    setCode('');
    setCodeError(undefined);
    setResent(false);
    setLeft(resendAfter);
    setStep('code');
  };

  const verify = async (value: string) => {
    setChecking(true);
    const answer = await onVerify(email.trim(), value);
    setChecking(false);
    if (answer !== undefined) { setCodeError(typeof answer === 'object' ? answer.message.replace('{time}', waitWords(answer.retryIn)) : answer); return; }
    setStep('done');
  };

  const resend = async () => {
    const answer = await onSendCode(email.trim());
    if (typeof answer === 'object') { setCodeError(answer.message.replace(' Try again in {time}.', '.')); setLeft(answer.retryIn); return; }
    if (answer !== undefined) { setCodeError(answer); return; }
    setResent(true);
    setLeft(resendAfter);
  };

  return (
    <div className="tf-signin">
      <AuthPages index={INDEX[step]} aria-label="Sign in">
        {[
          <form key="email" className="tf-signin__page" onSubmit={send} noValidate>
            <AuthHeading title="Sign in to Timefix" description="New here? The same steps make your account." />
            {notice !== undefined && <Callout tone={noticeTone} className="tf-signin__notice">{notice}</Callout>}
            {onGoogle && (
              <>
                <Button variant="secondary" size="lg" className="tf-signin__full" icon={<GoogleTile />} onPress={onGoogle} isDisabled={sending}>Continue with Google</Button>
                <div className="tf-signin__or" role="separator"><span>or</span></div>
              </>
            )}
            <div ref={fieldWrap}>
              <TextField label="Email" type="email" size="lg" autoComplete="email" placeholder="name@company.com" value={email}
                onChange={(v) => { setEmail(v); if (emailError !== undefined && !wait) setEmailError(undefined); }}
                isInvalid={emailError !== undefined} errorMessage={emailError} />
            </div>
            <Button type="submit" variant="primary" size="lg" className="tf-signin__full" isPending={sending} isDisabled={wait !== undefined}>
              {sending ? 'Sending code' : onGoogle ? 'Continue with email' : 'Continue'}
            </Button>
          </form>,

          <div key="code" className="tf-signin__page">
            <AuthHeading title="Check your email" description={<>We sent a 6-digit code to <strong>{email.trim() || 'your email'}</strong>. It works for 10 minutes.</>} />
            <CodeInput label="Code from your email" size="lg" value={code} isPending={checking} isInvalid={codeError !== undefined} errorMessage={codeError}
              onChange={(v) => { setCode(v); if (v !== '' && codeError !== undefined) setCodeError(undefined); }}
              onComplete={(v) => { void verify(v); }} />
            <div className="tf-signin__row">
              <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={() => { setStep('email'); setCodeError(undefined); }}>Use a different email</Button>
              <span className="tf-signin__resend" aria-live="polite">
                {left > 0 ? (
                  <span className="tf-signin__wait tf-num"><TextSwap swapKey={resent ? 'sent' : 'wait'}>{resent ? 'New code sent. You can resend it' : 'You can resend the code'}</TextSwap> in {clock(left)}</span>
                ) : (
                  <Button variant="ghost" size="sm" onPress={() => { void resend(); }}>Resend code</Button>
                )}
              </span>
            </div>
          </div>,

          <div key="done" className="tf-signin__page tf-signin__done">
            {step === 'done' && (
              <>
                <span className="tf-signin__mark" aria-hidden="true"><SuccessCheck size={24} /></span>
                <AuthHeading title="You're in" description={workspace ? `Opening ${workspace}…` : 'Opening your workspace…'} />
              </>
            )}
          </div>,
        ]}
      </AuthPages>
    </div>
  );
}
