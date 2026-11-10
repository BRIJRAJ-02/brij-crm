// The doors into the app, as full screens: sign in (an emailed code, or Google), two factor, the first run, accepting an invitation,
// asking to join by company email, a deleted workspace, and email preferences. Each ends back in the app or says what happens next.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, MailCheck, RotateCcw } from 'lucide-react';
import { AuthLayout, AuthHeading, AuthFooterLink } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from '../SignInForm/SignInForm.tsx';
import { CodeInput } from '../CodeInput/CodeInput.tsx';
import { Onboarding, type OnboardingValues } from '../Onboarding/Onboarding.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Button } from '../Button/Button.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { TextField } from '../Field/Field.tsx';

/** Which door. */
export type Door = 'signin' | 'twofactor' | 'welcome' | 'invite' | 'join' | 'deleted' | 'email';
/** The doors as ⌘K lists them. */
export const DOORS: ReadonlyArray<{ readonly id: Door; readonly label: string }> = [
  { id: 'signin', label: 'Sign in' }, { id: 'twofactor', label: 'Two factor at sign in' }, { id: 'welcome', label: 'First run (welcome)' }, { id: 'invite', label: 'Accept an invitation' },
  { id: 'join', label: 'Ask to join by email domain' }, { id: 'deleted', label: 'A deleted workspace' }, { id: 'email', label: 'Email preferences (no sign in)' },
];

/** Who the doors are about: the workspace and the signed-in person, from the app's data. */
export interface DoorContext { readonly workspace: string; readonly slug: string; readonly name: string; readonly email: string; readonly twoFactor: boolean }

/** One door, full screen and modal (focus moves in, Escape leaves), with a way back to the app. */
export function DoorScreen({ door, onDone, onDoor, ctx, onFinish, onRestore }: { readonly door: Door; readonly onDone: () => void; readonly onDoor: (d: Door) => void; readonly ctx: DoorContext;
  /** The first run's answers, to set the workspace up. */ readonly onFinish?: (v: OnboardingValues) => void; readonly onRestore?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const first = el.querySelector<HTMLElement>('[autofocus], input, button:not([disabled])'); (first ?? el).focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onDone(); } };
    el.addEventListener('keydown', key);
    return () => { el.removeEventListener('keydown', key); before?.focus(); };
  }, [door]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>Back to the app</Button>;
  const signedIn = () => (ctx.twoFactor ? onDoor('twofactor') : onDone());
  if (door === 'welcome') return <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Set up your workspace" className="tf-door tf-door--full"><div className="tf-door__back">{back}</div><Onboarding account={ctx.email} owner={ctx.name} checkSlug={(slug) => new Promise((r) => { window.setTimeout(() => r(!['acme', 'demo'].includes(slug)), 400); })} onFinish={(v) => { onFinish?.(v); onDone(); }} onSignOut={() => onDoor('signin')} /></div>;
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={DOORS.find((d) => d.id === door)?.label ?? 'Timefix'} className="tf-door">
      <div className="tf-door__back">{back}</div>
      {door === 'signin' && (
        <AuthLayout aria-label="Sign in" footer={<span className="tf-rec__muted">Prototype: any email, then the code 123456 · <AuthFooterLink onPress={() => onDoor('join')}>Joining your team?</AuthFooterLink> · <AuthFooterLink onPress={() => onDoor('welcome')}>New to Timefix?</AuthFooterLink></span>}>
          <SignInForm workspace={ctx.workspace} onGoogle={signedIn}
            onSendCode={(email) => (email.includes('@') ? undefined : 'That doesn’t look like an email.')}
            onVerify={(_e, code) => (code === '123456' ? undefined : 'That code isn’t right. It’s 123456 in this prototype.')} onSignedIn={signedIn} />
        </AuthLayout>
      )}
      {door === 'twofactor' && <TwoFactor email={ctx.email} onDone={onDone} />}
      {door === 'invite' && (
        <AuthLayout aria-label="Invitation">
          <div className="tf-door__card">
            <Avatar name={ctx.workspace} size={56} shape="square" />
            <AuthHeading title={`Join ${ctx.workspace}`} description="Sam Kim invited you as a Member. You’ll see the team’s records, pages and bookings." />
            <Button variant="primary" size="lg" onPress={onDone}>Join workspace</Button>
            <span className="tf-rec__muted">Signed in as rahul@{ctx.slug}.com · <button type="button" className="tf-rec__link" onClick={() => onDoor('signin')}>Not you?</button></span>
          </div>
        </AuthLayout>
      )}
      {door === 'join' && <JoinRequest workspace={ctx.workspace} slug={ctx.slug} onDone={onDone} onOwn={() => onDoor('welcome')} />}
      {door === 'deleted' && <Deleted workspace={ctx.workspace} onRestore={() => { onRestore?.(); onDone(); }} onSignOut={() => onDoor('signin')} />}
      {door === 'email' && <EmailPrefs email={ctx.email} />}
    </div>
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
        <button type="button" className="tf-rec__link" onClick={() => { setBackup(!backup); setBad(false); setCode(''); }}>{backup ? 'Use the app instead' : 'Use a backup code'}</button>
      </div>
    </AuthLayout>
  );
}

function JoinRequest({ onDone, onOwn, workspace, slug }: { readonly onDone: () => void; readonly onOwn: () => void; readonly workspace: string; readonly slug: string }) {
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
          <Button variant="primary" size="lg" onPress={() => setSent(true)}>Ask to join</Button>
          <Button variant="ghost" onPress={onOwn}>Make my own workspace instead</Button>
        </>}
      </div>
    </AuthLayout>
  );
}

function Deleted({ workspace, onRestore, onSignOut }: { readonly workspace: string; readonly onRestore: () => void; readonly onSignOut: () => void }) {
  const [sure, setSure] = useState(false);
  const until = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <AuthLayout aria-label="Deleted workspace">
      <div className="tf-door__card">
        <span className="tf-door__icon"><Building2 size={24} strokeWidth={1.75} /></span>
        <AuthHeading title={`${workspace} is deleted`} description={sure ? `Everyone gets access back, with everything as it was.` : `It’s kept until ${until}, then everything in it is gone for good. Restore it to bring everyone back.`} />
        {sure ? <><Button variant="primary" size="lg" icon={<RotateCcw size={16} strokeWidth={1.75} />} onPress={onRestore}>Yes, restore {workspace}</Button><Button variant="ghost" onPress={() => setSure(false)}>Not now</Button></>
          : <><Button variant="primary" size="lg" icon={<RotateCcw size={16} strokeWidth={1.75} />} onPress={() => setSure(true)}>Restore workspace</Button><Button variant="ghost" onPress={onSignOut}>Sign out</Button></>}
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
