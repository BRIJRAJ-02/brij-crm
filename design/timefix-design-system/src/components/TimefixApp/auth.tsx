// The doors into the app, as full screens: sign in (an emailed code, or Google), two factor, the first run, accepting an invitation,
// asking to join by company email, a deleted workspace, and email preferences. Each ends back in the app or says what happens next.
import { useState } from 'react';
import { ArrowLeft, Building2, MailCheck, RotateCcw } from 'lucide-react';
import { AuthLayout, AuthHeading, AuthFooterLink } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from '../SignInForm/SignInForm.tsx';
import { CodeInput } from '../CodeInput/CodeInput.tsx';
import { Onboarding } from '../Onboarding/Onboarding.tsx';
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

/** One door, full screen, with a way back to the app. */
export function DoorScreen({ door, onDone, onDoor }: { readonly door: Door; readonly onDone: () => void; readonly onDoor: (d: Door) => void }) {
  const back = <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onDone}>Back to the app</Button>;
  if (door === 'welcome') return <div className="tf-door tf-door--full"><div className="tf-door__back">{back}</div><Onboarding account="priya@northwind.com" owner="Priya Raman" checkSlug={(slug) => new Promise((r) => { window.setTimeout(() => r(!['acme', 'demo'].includes(slug)), 400); })} onFinish={onDone} onSignOut={onDone} /></div>;
  return (
    <div className="tf-door">
      <div className="tf-door__back">{back}</div>
      {door === 'signin' && (
        <AuthLayout aria-label="Sign in" footer={<span className="tf-rec__muted">Prototype: any email, then the code 123456 · <AuthFooterLink onPress={() => onDoor('join')}>Joining your team?</AuthFooterLink></span>}>
          <SignInForm workspace="Northwind" onGoogle={() => onDoor('twofactor')}
            onSendCode={(email) => (email.includes('@') ? undefined : 'That doesn’t look like an email.')}
            onVerify={(_e, code) => (code === '123456' ? undefined : 'That code isn’t right. It’s 123456 in this prototype.')} onSignedIn={() => onDoor('twofactor')} />
        </AuthLayout>
      )}
      {door === 'twofactor' && <TwoFactor onDone={onDone} />}
      {door === 'invite' && (
        <AuthLayout aria-label="Invitation">
          <div className="tf-door__card">
            <Avatar name="Northwind" size={56} shape="square" />
            <AuthHeading title="Join Northwind" description="Sam Kim invited you as a Member. You’ll see the team’s records, pages and bookings." />
            <Button variant="primary" size="lg" onPress={() => onDoor('welcome')}>Join workspace</Button>
            <span className="tf-rec__muted">Signed in as rahul@northwind.com · <button type="button" className="tf-rec__link" onClick={() => onDoor('signin')}>Not you?</button></span>
          </div>
        </AuthLayout>
      )}
      {door === 'join' && <JoinRequest onDone={onDone} />}
      {door === 'deleted' && (
        <AuthLayout aria-label="Deleted workspace">
          <div className="tf-door__card">
            <span className="tf-door__icon"><Building2 size={24} strokeWidth={1.75} /></span>
            <AuthHeading title="Northwind is deleted" description="It’s kept until 10 December 2026, then everything in it is gone for good. Restore it to bring everyone back." />
            <Button variant="primary" size="lg" icon={<RotateCcw size={16} strokeWidth={1.75} />} onPress={onDone}>Restore workspace</Button>
            <Button variant="ghost" onPress={onDone}>Back to your workspaces</Button>
          </div>
        </AuthLayout>
      )}
      {door === 'email' && <EmailPrefs />}
    </div>
  );
}

function TwoFactor({ onDone }: { readonly onDone: () => void }) {
  const [backup, setBackup] = useState(false);
  const [bad, setBad] = useState(false);
  const [code, setCode] = useState('');
  return (
    <AuthLayout aria-label="Two factor" account="priya@northwind.com">
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title={backup ? 'Use a backup code' : 'Enter your code'} description={backup ? 'One of the codes you saved when you set up two factor. Each works once.' : 'From your authenticator app.'} />
        {backup ? <TextField label="Backup code" value={code} onChange={setCode} placeholder="ABCD-1234" autoFocus />
          : <CodeInput label="Six-digit code" autoFocus isInvalid={bad} errorMessage={bad ? 'That code didn’t match. Try the newest one.' : undefined} onChange={() => setBad(false)} onComplete={(v) => { if (v === '123456') onDone(); else setBad(true); }} description="Prototype: 123456" />}
        <Checkbox defaultSelected>Remember this device for 30 days</Checkbox>
        {backup && <Button variant="primary" size="lg" isDisabled={code.length < 8} onPress={onDone}>Continue</Button>}
        <button type="button" className="tf-rec__link" onClick={() => setBackup(!backup)}>{backup ? 'Use the app instead' : 'Use a backup code'}</button>
      </div>
    </AuthLayout>
  );
}

function JoinRequest({ onDone }: { readonly onDone: () => void }) {
  const [sent, setSent] = useState(false);
  return (
    <AuthLayout aria-label="Join by email">
      <div className="tf-door__card">
        {sent ? <>
          <span className="tf-door__icon"><MailCheck size={24} strokeWidth={1.75} /></span>
          <AuthHeading title="Request sent" description="An owner or admin at Northwind will say yes or no. We’ll email you either way." />
          <Button variant="secondary" onPress={onDone}>Done</Button>
        </> : <>
          <Avatar name="Northwind" size={56} shape="square" />
          <AuthHeading title="Northwind is on Timefix" description="People with an @northwind.com email can ask to join. Owners see your request and decide." />
          <Button variant="primary" size="lg" onPress={() => setSent(true)}>Ask to join</Button>
          <Button variant="ghost" onPress={onDone}>Make my own workspace instead</Button>
        </>}
      </div>
    </AuthLayout>
  );
}

function EmailPrefs() {
  const [off, setOff] = useState(false);
  return (
    <AuthLayout aria-label="Email preferences">
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="Your emails from Timefix" description="For priya@northwind.com. No sign in needed." />
        {['Booking confirmations and changes', 'Mentions and replies', 'Tasks given to you', 'The daily summary'].map((x) => <Switch key={`${x}-${String(off)}`} defaultSelected={!off}>{x}</Switch>)}
        <Button variant={off ? 'secondary' : 'ghost'} onPress={() => setOff(!off)}>{off ? 'Turn them back on' : 'Unsubscribe from everything'}</Button>
        {off && <p className="tf-rec__muted">Done. You’ll still get emails you must, like sign-in codes.</p>}
      </div>
    </AuthLayout>
  );
}
