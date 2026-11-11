// The doors into the app, as full screens: sign in (an emailed code, or Google), two factor, the first run, accepting an invitation,
// asking to join by company email, a deleted workspace, and email preferences. Each ends back in the app or says what happens next.
import { useEffect, useRef, useState } from 'react';
import { Link } from '../Link/Link.tsx';
import { ArrowLeft, Building2, MailCheck, RotateCcw } from 'lucide-react';
import { AuthLayout, AuthHeading, AuthFooterLink } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from '../SignInForm/SignInForm.tsx';
import { CodeInput } from '../CodeInput/CodeInput.tsx';
import { Onboarding, nameFromEmail, type OnboardingValues } from '../Onboarding/Onboarding.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Button } from '../Button/Button.tsx';
import { FullScreenDialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { TextField } from '../Field/Field.tsx';

/** The three kinds of business, as the first run asks. */

/** Which door. */
export type Door = 'signin' | 'twofactor' | 'welcome' | 'invite' | 'join' | 'deleted' | 'email' | 'expired' | 'setup2fa' | 'invite-wrong' | 'invite-used';
/** The doors as ⌘K lists them. */
export const DOORS: ReadonlyArray<{ readonly id: Door; readonly label: string }> = [
  { id: 'signin', label: 'Sign in' }, { id: 'twofactor', label: 'Two factor at sign in' }, { id: 'welcome', label: 'First run (welcome)' }, { id: 'invite', label: 'Accept an invitation' },
  { id: 'join', label: 'Ask to join by email domain' }, { id: 'deleted', label: 'A deleted workspace' }, { id: 'email', label: 'Email preferences (no sign in)' },
  { id: 'expired', label: 'Session ran out' }, { id: 'setup2fa', label: 'Two factor required by the workspace' }, { id: 'invite-wrong', label: 'Invitation for another email' }, { id: 'invite-used', label: 'Invitation already used' },
];

/** Who the doors are about: the workspace and the signed-in person, from the app's data. */
export interface DoorContext {
  readonly workspace: string; readonly slug: string; readonly name: string; readonly email: string; readonly twoFactor: boolean;
  /** Members' emails: signing in with any other goes to setting up a new workspace. */ readonly memberEmails?: ReadonlyArray<string>;
  /** The workspace asks everyone for two factor. */ readonly require2fa?: boolean;
}

/** One door, full screen and modal (focus moves in, Escape leaves), with a way back to the app. */
export function DoorScreen({ door, onDone, onDoor, ctx, onFinish, onRestore, onFormat, onTwoFactorOn, onJoin, onAskJoin }: { readonly door: Door; readonly onDone: () => void; readonly onDoor: (d: Door) => void; readonly ctx: DoorContext;
  /** Accepting the invitation adds the person; asking to join puts a request in Members. */ readonly onJoin?: () => void; readonly onAskJoin?: () => void;
  /** Two factor was set up on the way in. */ readonly onTwoFactorOn?: () => void;
  /** The first run's one question: what this business books. Salons and restaurants land in their own workspace. */ readonly onFormat?: (kind: 'team' | 'salon' | 'restaurant') => void;
  /** The first run's answers, to set the workspace up. */ readonly onFinish?: (v: OnboardingValues) => void; readonly onRestore?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  /** A new address that just got past the code: setup runs under its name. */
  const [signer, setSigner] = useState<string>();
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    // Focus lands in the door's own content first, not on its Back button.
    const first = el.querySelector<HTMLElement>(':scope > :not(.tf-door__back) :is([autofocus], input, button:not([disabled]))') ?? el.querySelector<HTMLElement>('[autofocus], input, button:not([disabled])'); (first ?? el).focus();
    return () => { before?.focus(); };
  }, [door]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>Back to the app</Button>;
  // After the code: someone new sets up their own workspace; a workspace that asks for two factor gets it set up first; otherwise straight in.
  const signedIn = (email?: string) => {
    if (email && ctx.memberEmails && !ctx.memberEmails.includes(email.trim().toLowerCase())) { setSigner(email.trim().toLowerCase()); onDoor('welcome'); return; }
    if (ctx.twoFactor) onDoor('twofactor'); else if (ctx.require2fa) onDoor('setup2fa'); else onDone();
  };
  // First run: one flow in the split screen, from what you book to You're live, under the name of whoever just signed in.
  if (door === 'welcome') return <FullScreenDialog aria-label="Set up your workspace" onOpenChange={(o) => { if (!o) onDone(); }}><div ref={ref} tabIndex={-1} className="tf-door tf-door--full"><div className="tf-door__back">{back}</div><Onboarding account={signer ?? ctx.email} owner={signer ? nameFromEmail(signer) : ctx.name} checkSlug={(slug) => new Promise((r) => { window.setTimeout(() => r(!['acme', 'demo'].includes(slug)), 400); })} onFinish={(v) => { if (v.kind === 'team') onFinish?.(v); onFormat?.(v.kind); onDone(); }} onSignOut={() => onDoor('signin')} /></div></FullScreenDialog>;
  return (
    <FullScreenDialog aria-label={DOORS.find((d) => d.id === door)?.label ?? 'Timefix'} onOpenChange={(o) => { if (!o) onDone(); }}>
    <div ref={ref} tabIndex={-1} className="tf-door">
      <div className="tf-door__back">{back}</div>
      {(door === 'signin' || door === 'expired') && (
        <AuthLayout aria-label="Sign in" footer={<span className="tf-rec__muted">Prototype: {ctx.email} (or any other email to start a new workspace), then the code 123456 · <AuthFooterLink onPress={() => onDoor('join')}>Joining your team?</AuthFooterLink> · <AuthFooterLink onPress={() => onDoor('welcome')}>New to Timefix?</AuthFooterLink></span>}>
          <SignInForm workspace={ctx.workspace} onGoogle={() => signedIn()} notice={door === 'expired' ? <span>You were signed out after 30 days away. Sign in again and you’re back where you were.</span> : undefined}
            onSendCode={(email) => (email.includes('@') ? undefined : 'That doesn’t look like an email.')}
            onVerify={(_e, code) => (code === '123456' ? undefined : 'That code isn’t right. It’s 123456 in this prototype.')} onSignedIn={signedIn} />
        </AuthLayout>
      )}
      {door === 'twofactor' && <TwoFactor email={ctx.email} onDone={onDone} />}
      {door === 'setup2fa' && <SetUpTwoFactor workspace={ctx.workspace} email={ctx.email} onDone={() => { onTwoFactorOn?.(); onDone(); }} onSignOut={() => onDoor('signin')} />}
      {(door === 'invite-wrong' || door === 'invite-used') && (
        <AuthLayout aria-label="Invitation">
          <div className="tf-door__card">
            <span className="tf-door__icon"><MailCheck size={24} strokeWidth={1.75} /></span>
            {door === 'invite-wrong' ? <>
              <AuthHeading title="This invitation is for someone else" description={`It was sent to rahul@${ctx.slug}.com, and you’re signed in as ${ctx.email}.`} />
              <Button variant="primary" size="lg" onPress={() => onDoor('signin')}>Sign in as rahul@{ctx.slug}.com</Button>
              <Button variant="ghost" onPress={onDone}>Stay signed in as {ctx.email}</Button>
            </> : <>
              <AuthHeading title="This invitation was already used" description={`Each link works once. If it was you, sign in. If not, ask whoever invited you for a new one.`} />
              <Button variant="primary" size="lg" onPress={() => onDoor('signin')}>Sign in</Button>
            </>}
          </div>
        </AuthLayout>
      )}
      {door === 'invite' && (
        <AuthLayout aria-label="Invitation">
          <div className="tf-door__card">
            <Avatar name={ctx.workspace} size={56} shape="square" />
            <AuthHeading title={`Join ${ctx.workspace}`} description="Sam Kim invited you as a Member. You’ll see the team’s records, pages and bookings." />
            <Button variant="primary" size="lg" onPress={() => { onJoin?.(); onDone(); }}>Join workspace</Button>
            <span className="tf-rec__muted">Signed in as rahul@{ctx.slug}.com · <Link onPress={() => onDoor('signin')}>Not you?</Link></span>
          </div>
        </AuthLayout>
      )}
      {door === 'join' && <JoinRequest workspace={ctx.workspace} slug={ctx.slug} onAsk={onAskJoin} onDone={onDone} onOwn={() => onDoor('welcome')} />}
      {door === 'deleted' && <Deleted workspace={ctx.workspace} onRestore={() => { onRestore?.(); onDone(); }} onSignOut={() => onDoor('signin')} />}
      {door === 'email' && <EmailPrefs email={ctx.email} />}
    </div>
    </FullScreenDialog>
  );
}

const BACKUP = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;
function TwoFactor({ onDone, email }: { readonly onDone: () => void; readonly email: string }) {
  const [backup, setBackup] = useState(false);
  const [bad, setBad] = useState(false);
  const [code, setCode] = useState('');
  return (
    <AuthLayout aria-label="Two factor" account={email}>
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title={backup ? 'Use a backup code' : 'Enter your code'} description={backup ? 'One of the codes you saved when you set up two factor. Each works once.' : 'From your authenticator app.'} />
        {backup ? <TextField label="Backup code" value={code} onChange={(v) => { setCode(v.toUpperCase()); setBad(false); }} placeholder="ABCD-1234" autoFocus isInvalid={bad} errorMessage={bad ? 'That isn’t one of your backup codes. They look like ABCD-1234.' : undefined} description="Prototype: 4F7Q-29KD" />
          : <CodeInput label="Six-digit code" autoFocus isInvalid={bad} errorMessage={bad ? 'That code didn’t match. Try the newest one.' : undefined} onChange={() => setBad(false)} onComplete={(v) => { if (v === '123456') onDone(); else setBad(true); }} description="Prototype: 123456" />}
        <Checkbox defaultSelected>Remember this device for 30 days</Checkbox>
        {backup && <Button variant="primary" size="lg" isDisabled={!BACKUP.test(code.trim())} onPress={() => { if (code.trim().replace('-', '') === '4F7Q29KD') onDone(); else setBad(true); }}>Continue</Button>}
        <Link onPress={() => { setBackup(!backup); setBad(false); setCode(''); }}>{backup ? 'Use the app instead' : 'Use a backup code'}</Link>
      </div>
    </AuthLayout>
  );
}

function JoinRequest({ onDone, onOwn, workspace, slug, onAsk }: { readonly onAsk?: () => void; readonly onDone: () => void; readonly onOwn: () => void; readonly workspace: string; readonly slug: string }) {
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout aria-label="Join by email">
      <div className="tf-door__card">
        {sent ? <>
          <span className="tf-door__icon"><MailCheck size={24} strokeWidth={1.75} /></span>
          <AuthHeading title="Request sent" description={`An owner or admin at ${workspace} will say yes or no. We’ll email you either way.`} />
          <Button variant="secondary" onPress={onDone}>Done</Button>
        </> : <>
          <Avatar name={workspace} size={56} shape="square" />
          <AuthHeading title={`${workspace} is on Timefix`} description={`People with an @${slug}.com email can ask to join. Owners see your request and decide.`} />
          <Button variant="primary" size="lg" onPress={() => { onAsk?.(); setSent(true); }}>Ask to join</Button>
          <Button variant="ghost" onPress={onOwn}>Make my own workspace instead</Button>
        </>}
      </div>
    </AuthLayout>
  );
}

function Deleted({ workspace, onRestore, onSignOut }: { readonly workspace: string; readonly onRestore: () => void; readonly onSignOut: () => void }) {
  const until = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <AuthLayout aria-label="Deleted workspace">
      <div className="tf-door__card">
        <span className="tf-door__icon"><Building2 size={24} strokeWidth={1.75} /></span>
        <AuthHeading title={`${workspace} is deleted`} description={`It’s kept until ${until}, then everything in it is gone for good. Restore it to bring everyone back, with everything as it was.`} />
        <Button variant="primary" size="lg" icon={<RotateCcw size={16} strokeWidth={1.75} />} onPress={onRestore}>Restore {workspace}</Button><Button variant="ghost" onPress={onSignOut}>Sign out</Button>
      </div>
    </AuthLayout>
  );
}

function EmailPrefs({ email }: { readonly email: string }) {
  const { toast } = useToast();
  const LIST = ['Booking confirmations and changes', 'Mentions and replies', 'Tasks given to you', 'The daily summary'];
  const [on, setOn] = useState<ReadonlyArray<string>>(LIST);
  const save = (next: ReadonlyArray<string>, message = 'Saved') => { setOn(next); toast({ message, tone: 'success' }); };
  return (
    <AuthLayout aria-label="Email preferences">
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="Your emails from Timefix" description={`For ${email}. No sign in needed.`} />
        {LIST.map((x) => <Switch key={x} isSelected={on.includes(x)} onChange={(v) => save(v ? [...on, x] : on.filter((y) => y !== x))}>{x}</Switch>)}
        <Button variant={on.length === 0 ? 'secondary' : 'ghost'} onPress={() => (on.length === 0 ? save(LIST, 'Emails are back on') : save([], 'Unsubscribed from everything'))}>{on.length === 0 ? 'Turn them back on' : 'Unsubscribe from everything'}</Button>
        {on.length === 0 && <p className="tf-rec__muted">Done. You’ll still get emails you must, like sign-in codes.</p>}
      </div>
    </AuthLayout>
  );
}

/** The workspace asks for two factor: set it up before going in. Signing out is the only other way. */
function SetUpTwoFactor({ workspace, email, onDone, onSignOut }: { readonly workspace: string; readonly email: string; readonly onDone: () => void; readonly onSignOut: () => void }) {
  const [code, setCode] = useState('');
  return (
    <AuthLayout aria-label="Set up two factor" account={email}>
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="Set up two factor to go in" description={`${workspace} asks everyone for a code from an authenticator app at sign in. It takes a minute.`} />
        <span className="tf-rec__muted tf-num">Scan the code in Google Authenticator or 1Password, or type the key: JBSW Y3DP EHPK 3PXP</span>
        <TextField label="Six-digit code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))} autoFocus description="Prototype: any six digits" />
        <Button variant="primary" size="lg" isDisabled={code.length !== 6} onPress={onDone}>Turn on and continue</Button>
        <Link onPress={onSignOut}>Sign out instead</Link>
      </div>
    </AuthLayout>
  );
}
