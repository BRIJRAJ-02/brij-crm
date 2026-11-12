// The doors into the app, as full screens: sign in (an emailed code, or Google), two factor, the first run, accepting an invitation,
// asking to join by company email, a deleted workspace, and email preferences. Each ends back in the app or says what happens next.
import { useEffect, useRef, useState } from 'react';
import { Link } from '../Link/Link.tsx';
import { ArrowLeft, Building2, Clock, MailCheck, RotateCcw } from 'lucide-react';
import { AuthLayout, AuthHeading, AuthFooterLink } from '../AuthLayout/AuthLayout.tsx';
import { SignInForm } from '../SignInForm/SignInForm.tsx';
import { CodeInput } from '../CodeInput/CodeInput.tsx';
import { Onboarding, nameFromEmail, type CalendarResult, type OnboardingValues } from '../Onboarding/Onboarding.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Skeleton, Spinner } from '../Motion/Motion.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { Button } from '../Button/Button.tsx';
import { FullScreenDialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { TextField } from '../Field/Field.tsx';

/** The three kinds of business, as the first run asks. */

/** Which door. */
export type Door = 'signin' | 'twofactor' | 'welcome' | 'invite' | 'join' | 'deleted' | 'email' | 'expired' | 'setup2fa' | 'invite-wrong' | 'invite-used'
  | 'signin-limit' | 'signin-closed' | 'google-error' | 'signed-out' | 'twofactor-expired' | 'opening' | 'invite-page' | 'join-none';
/** The doors as ⌘K lists them. */
export const DOORS: ReadonlyArray<{ readonly id: Door; readonly label: string }> = [
  { id: 'signin', label: 'Sign in' }, { id: 'twofactor', label: 'Two factor at sign in' }, { id: 'welcome', label: 'First run (welcome)' }, { id: 'invite', label: 'Accept an invitation' },
  { id: 'join', label: 'Ask to join by email domain' }, { id: 'deleted', label: 'A deleted workspace' }, { id: 'email', label: 'Email preferences (no sign in)' },
  { id: 'expired', label: 'Session ran out' }, { id: 'setup2fa', label: 'Two factor required by the workspace' }, { id: 'invite-wrong', label: 'Invitation for another email' }, { id: 'invite-used', label: 'Invitation already used' },
  { id: 'signin-limit', label: 'Sign in: too many codes (wait)' }, { id: 'signin-closed', label: 'Sign in: sign up closed' }, { id: 'google-error', label: 'Sign in: Google errors' }, { id: 'signed-out', label: 'Signed out (why)' },
  { id: 'twofactor-expired', label: 'Two factor: sign in expired' }, { id: 'opening', label: 'Opening Timefix' }, { id: 'invite-page', label: 'Invitation to manage a link page' }, { id: 'join-none', label: 'Join: no workspaces for your email' },
];
/** Why Google sign in failed, and why someone was signed out: the prototype footer switches between them. */
const GOOGLE_ERRORS = { cancelled: 'Google sign in was cancelled. Try again, or use your email.', unverified: 'Google hasn’t verified that email. Use your email instead.', closed: 'No account for that Google email, and sign up isn’t open yet.', other: 'Couldn’t sign in with Google. Try again, or use your email.' } as const;
const SIGNED_OUT = { ended: 'You were signed out. Sign in again to carry on.', elsewhere: 'You were signed out from another device. Sign in again to carry on.', removed: 'You were removed from the workspace. Sign in to open your other workspaces.', unsaved: 'You were signed out, so your last change wasn’t saved. Sign in again to carry on.', deleted: 'Your account was deleted.' } as const;
/** "a***@example.com": the first letter, then stars, then the domain. */
export const maskEmail = (e: string) => { const at = e.indexOf('@'); return at < 1 ? '***' : `${e[0]}***${e.slice(at)}`; };
/** "ada.lovelace@x.com" → "Ada Lovelace". */
const nameOf = (e: string) => e.split('@')[0]?.split(/[._-]+/).filter(Boolean).map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ') ?? e;

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
  const [why, setWhy] = useState<string>('cancelled');
  /** First run's calendar connect, for the demo: Google connects; Outlook first says access wasn't given, then fails, then connects. */
  const outlookTries = useRef(0);
  const connectDemo = (c: 'google' | 'outlook') => new Promise<CalendarResult>((r) => { window.setTimeout(() => { if (c === 'google') r('connected'); else { outlookTries.current += 1; r(outlookTries.current === 1 ? 'denied' : outlookTries.current === 2 ? 'failed' : 'connected'); } }, 800); });
  useEffect(() => { setWhy(door === 'signed-out' ? 'ended' : 'cancelled'); }, [door]);
  // After the code: someone new sets up their own workspace; a workspace that asks for two factor gets it set up first; otherwise straight in.
  const signedIn = (email?: string) => {
    if (email && ctx.memberEmails && !ctx.memberEmails.includes(email.trim().toLowerCase())) { setSigner(email.trim().toLowerCase()); onDoor('welcome'); return; }
    if (ctx.twoFactor) onDoor('twofactor'); else if (ctx.require2fa) onDoor('setup2fa'); else onDone();
  };
  // First run: one flow in the split screen, from what you book to You're live, under the name of whoever just signed in.
  if (door === 'welcome') return <FullScreenDialog aria-label="Set up your workspace" onOpenChange={(o) => { if (!o) onDone(); }}><div ref={ref} tabIndex={-1} className="tf-door tf-door--full"><div className="tf-door__back">{back}</div><Onboarding account={signer ?? ctx.email} owner={signer ? nameFromEmail(signer) : ctx.name} connectCalendar={connectDemo} checkSlug={(slug) => new Promise((r) => { window.setTimeout(() => r(!['acme', 'demo'].includes(slug)), 400); })} onFinish={(v) => { if (v.kind === 'team') onFinish?.(v); onFormat?.(v.kind); onDone(); }} onSignOut={() => onDoor('signin')} /></div></FullScreenDialog>;
  if (door === 'opening') return <FullScreenDialog aria-label="Opening Timefix" onOpenChange={(o) => { if (!o) onDone(); }}><div ref={ref} tabIndex={-1} className="tf-door tf-door--full"><div className="tf-door__back">{back}</div><Opening onOpen={onDone} /></div></FullScreenDialog>;
  const proto = (items: Readonly<Record<string, string>>, labels: Readonly<Record<string, string>>) => <span className="tf-rec__muted">Prototype: {Object.keys(items).map((k, n) => <span key={k}>{n > 0 && ' · '}{k === why ? <strong>{labels[k]}</strong> : <AuthFooterLink onPress={() => setWhy(k)}>{labels[k] ?? k}</AuthFooterLink>}</span>)}</span>;
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
      {(door === 'signin-limit' || door === 'signin-closed' || door === 'google-error' || door === 'signed-out') && (
        <AuthLayout aria-label="Sign in" footer={door === 'google-error' ? proto(GOOGLE_ERRORS, { cancelled: 'Cancelled', unverified: 'Not verified', closed: 'Sign up closed', other: 'Other' })
          : door === 'signed-out' ? proto(SIGNED_OUT, { ended: 'Ran out', elsewhere: 'Elsewhere', removed: 'Removed', unsaved: 'Unsaved change', deleted: 'Account deleted' })
          : <span className="tf-rec__muted">{door === 'signin-limit' ? 'Prototype: Continue waits for the countdown; any email.' : `Prototype: ${ctx.email} signs in; any other email is refused.`}</span>}>
          <SignInForm key={`${door}-${why}`} workspace={ctx.workspace} defaultEmail={door === 'signin-limit' ? ctx.email : ''} onGoogle={() => signedIn()}
            notice={door === 'google-error' ? GOOGLE_ERRORS[why as keyof typeof GOOGLE_ERRORS] : door === 'signed-out' ? SIGNED_OUT[why as keyof typeof SIGNED_OUT] : undefined}
            noticeTone={door === 'signed-out' ? (why === 'deleted' ? 'success' : 'info') : 'danger'}
            onSendCode={(email) => (door === 'signin-limit' ? { message: 'Too many codes sent to this email. Try again in {time}.', retryIn: 45 } : door === 'signin-closed' && !(ctx.memberEmails ?? []).includes(email.trim().toLowerCase()) ? 'There’s no account for this email, and sign up isn’t open yet. Check the address.' : undefined)}
            onVerify={(_e, code) => (code === '123456' ? undefined : 'That code isn’t right. Try again.')} onSignedIn={() => signedIn()} />
        </AuthLayout>
      )}
      {door === 'twofactor' && <TwoFactor email={ctx.email} onDone={onDone} onOtherEmail={() => onDoor('signin')} />}
      {door === 'twofactor-expired' && <TwoFactor email={ctx.email} onDone={onDone} expired onOtherEmail={() => onDoor('signin')} />}
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
      {door === 'invite' && <InviteCard workspace={ctx.workspace} slug={ctx.slug} onJoin={() => { onJoin?.(); onDone(); }} onOther={() => onDoor('signin')} />}
      {door === 'invite-page' && <PageInviteCard workspace={ctx.workspace} slug={ctx.slug} onSignIn={() => onDoor('signin')} />}
      {(door === 'join' || door === 'join-none') && <JoinRequest workspace={ctx.workspace} slug={door === 'join-none' ? 'gmail' : ctx.slug} none={door === 'join-none'} onAsk={onAskJoin} onDone={onDone} onOwn={() => onDoor('welcome')} />}
      {door === 'deleted' && <Deleted workspace={ctx.workspace} onRestore={() => { onRestore?.(); onDone(); }} onSignOut={() => onDoor('signin')} />}
      {door === 'email' && <EmailPrefs email={ctx.email} />}
    </div>
    </FullScreenDialog>
  );
}

const BACKUP = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;
function TwoFactor({ onDone, email, expired = false, onOtherEmail }: { readonly onDone: () => void; readonly email: string; readonly expired?: boolean; readonly onOtherEmail: () => void }) {
  const [backup, setBackup] = useState(false);
  if (expired) return (
    <AuthLayout aria-label="Two factor" account={email}>
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="Two factor sign in" />
        <Callout tone="danger">This sign in has expired. Sign in again.</Callout>
        <Button variant="primary" size="lg" onPress={onOtherEmail}>Sign in again</Button>
      </div>
    </AuthLayout>
  );
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
        <Link onPress={() => { setBackup(!backup); setBad(false); setCode(''); }}>{backup ? 'Use your authenticator app' : 'Use a backup code'}</Link>
        <Link onPress={onOtherEmail}>Use a different email</Link>
      </div>
    </AuthLayout>
  );
}

/** Join: the workspaces for your email's domain, each with Ask to join; none for a public domain. */
function JoinRequest({ onDone, onOwn, workspace, slug, onAsk, none = false }: { readonly onAsk?: () => void; readonly onDone: () => void; readonly onOwn: () => void; readonly workspace: string; readonly slug: string; readonly none?: boolean }) {
  const [sent, setSent] = useState<ReadonlyArray<string>>([]);
  const list = none ? [] : [{ name: workspace, people: 5 }, { name: `${workspace} Support`, people: 2 }];
  const asked = list.find((w) => sent.includes(w.name));
  return (
    <AuthLayout aria-label="Join by email" footer={list.length > 0 ? <AuthFooterLink onPress={onOwn}>Create a workspace</AuthFooterLink> : undefined}>
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="Join your team" description={none ? `None for @${slug}.com. Ask for an invite.` : `Workspaces for @${slug}.com`} />
        {asked && <Callout tone="info" title={`Asked to join ${asked.name}.`}>An owner or admin will answer. You’ll get an email once you’re in.</Callout>}
        {none ? <Button variant="primary" size="lg" onPress={onOwn}>Create a workspace</Button>
          : <ul className="tf-set__list tf-set__list--center">{list.map((w) => <li key={w.name}><span className="tf-door__ws"><Avatar name={w.name} size={36} shape="square" /><span className="tf-set__stack"><strong>{w.name}</strong><span className="tf-rec__muted tf-num">{w.people} people</span></span></span>
            {sent.includes(w.name) ? <Tag size="sm" status="waiting">Request sent</Tag> : <Button size="sm" variant="secondary" aria-label={`Ask to join ${w.name}`} onPress={() => { if (w.name === workspace) onAsk?.(); setSent([...sent, w.name]); }}>Ask to join</Button>}</li>)}</ul>}
        {list.length > 0 && <Button variant="ghost" onPress={onDone}>Done</Button>}
      </div>
    </AuthLayout>
  );
}

/** An invitation: who sent it, the masked address it went to, and your name for someone new. */
function InviteCard({ workspace, slug, onJoin, onOther }: { readonly workspace: string; readonly slug: string; readonly onJoin: () => void; readonly onOther: () => void }) {
  const email = `rahul.mehta@${slug}.com`;
  const [name, setName] = useState(nameOf(email));
  return (
    <AuthLayout aria-label="Invitation">
      <div className="tf-door__card">
        <Avatar name={workspace} size={56} shape="square" />
        <AuthHeading title={`Join ${workspace}`} description={`Sam Kim invited you as a Member. Sent to ${maskEmail(email)}.`} />
        <div className="tf-door__wide"><TextField label="Your name" value={name} onChange={setName} maxLength={80} description="Shown to your team." isInvalid={!name.trim()} errorMessage="Enter your name." /></div>
        <Button variant="primary" size="lg" isDisabled={!name.trim()} onPress={onJoin}>Join workspace</Button>
        <span className="tf-rec__muted">Signed in as {email} · <Link onPress={onOther}>Use another address</Link></span>
      </div>
    </AuthLayout>
  );
}

/** A page-only invitation: someone may manage one link page without joining the workspace. Setting up the login needs no sign in first. */
function PageInviteCard({ workspace, slug, onSignIn }: { readonly workspace: string; readonly slug: string; readonly onSignIn: () => void }) {
  const [state, setState] = useState<'ask' | 'busy' | 'done'>('ask');
  const email = `maya@${slug}.com`;
  return (
    <AuthLayout aria-label="Manage your page">
      <div className="tf-door__card">
        <span className="tf-door__icon"><MailCheck size={24} strokeWidth={1.75} /></span>
        {state === 'done' ? <>
          <AuthHeading title="Your login is ready" description={`Sign in with ${maskEmail(email)} to manage your page.`} />
          <Button variant="primary" size="lg" onPress={onSignIn}>Sign in</Button>
        </> : <>
          <AuthHeading title="Manage your page" description={`Sam Kim invited you to manage your link page, timefix.com/maya, in ${workspace}. Sent to ${maskEmail(email)}.`} />
          <Button variant="primary" size="lg" isPending={state === 'busy'} onPress={() => { setState('busy'); window.setTimeout(() => setState('done'), 700); }}>{state === 'busy' ? 'Setting up…' : 'Set up my login'}</Button>
          <span className="tf-rec__muted">You only reach your own page, not the rest of {workspace}.</span>
        </>}
      </div>
    </AuthLayout>
  );
}

/** Opening Timefix: the app's outline while it checks who you are; after 5 seconds Still opening with Try again; a failed check says Can't open. */
function Opening({ onOpen }: { readonly onOpen: () => void }) {
  const [phase, setPhase] = useState<'opening' | 'slow' | 'failed'>('opening');
  const [tries, setTries] = useState(0);
  useEffect(() => { if (phase !== 'opening') return; const t = window.setTimeout(() => setPhase(tries === 0 ? 'slow' : 'failed'), tries === 0 ? 5000 : 1200); return () => window.clearTimeout(t); }, [phase, tries]);
  const retry = () => { if (phase === 'failed') { onOpen(); return; } setTries((n) => n + 1); setPhase('opening'); };
  return (
    <div className="tf-door__opening" aria-busy={phase === 'opening'}>
      <div className="tf-door__ghost" aria-hidden="true">
        <div className="tf-door__ghostside">{[60, 40, 50, 45, 55].map((w, n) => <Skeleton key={n} width={`${w}%`} height={14} />)}</div>
        <div className="tf-door__ghostmain"><Skeleton width="30%" height={20} />{[90, 80, 85, 70].map((w, n) => <Skeleton key={n} width={`${w}%`} height={12} />)}</div>
      </div>
      <div className="tf-door__openmsg" role="status">
        {phase === 'opening' ? <><Spinner size={20} label="Opening Timefix" /><strong>Opening Timefix</strong></>
          : phase === 'slow' ? <><span className="tf-door__icon"><Clock size={20} strokeWidth={1.75} /></span><AuthHeading title="Still opening Timefix" description="This is taking longer than usual. Check your connection, or try again." /><Button variant="primary" onPress={retry}>Try again</Button></>
          : <><AuthHeading title="Can’t open Timefix" /><Callout tone="danger">Check your connection, then try again.</Callout><Button variant="primary" onPress={retry}>Try again</Button></>}
        {phase !== 'opening' && <span className="tf-rec__muted">{phase === 'slow' ? 'Prototype: Try again fails once, then opens.' : 'Prototype: Try again opens the app.'}</span>}
      </div>
    </div>
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
