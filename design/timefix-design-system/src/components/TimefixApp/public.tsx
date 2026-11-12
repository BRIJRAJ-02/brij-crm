// The public pages with no sign in: System status, Email preferences (and its expired link), one-click Unsubscribe that asks first,
// and Connect a partner app (the OAuth consent page). Full screen, in the public look, each with a way back to the app.
import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, MailX } from 'lucide-react';
import { AuthLayout, AuthFooterLink, AuthHeading } from '../AuthLayout/AuthLayout.tsx';
import { FullScreenDialog } from '../Dialog/Dialog.tsx';
import { Button } from '../Button/Button.tsx';
import { Switch, Checkbox, RadioGroup, Radio } from '../Checkbox/Checkbox.tsx';
import { TextField } from '../Field/Field.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Spinner } from '../Motion/Motion.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { newId, type AppAction, type AppState } from './data.ts';

type Dispatch = (a: AppAction) => void;
/** Which public page. */
export type PublicKind = 'status' | 'email' | 'unsubscribe' | 'connect';
/** The public pages as the Demo menu lists them. */
export const PUBLIC_PAGES: ReadonlyArray<{ readonly id: PublicKind; readonly label: string; readonly description: string }> = [
  { id: 'status', label: 'System status', description: 'Is the API and the database answering' },
  { id: 'email', label: 'Email preferences', description: 'From the link in any email, no sign in; and when it has expired' },
  { id: 'unsubscribe', label: 'One-click unsubscribe', description: 'Asks first, then says what stopped' },
  { id: 'connect', label: 'Connect a partner app', description: 'The consent page a partner sends you to' },
];

/** One public page, full screen. */
export function PublicScreen({ kind, state, dispatch, onClose }: { readonly kind: PublicKind; readonly state: AppState; readonly dispatch: Dispatch; readonly onClose: () => void }) {
  return (
    <FullScreenDialog aria-label={PUBLIC_PAGES.find((x) => x.id === kind)?.label ?? 'Timefix'} onOpenChange={(o) => { if (!o) onClose(); }}>
      <div className="tf-door">
        <div className="tf-door__back"><Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={onClose}>Back to the app</Button></div>
        {kind === 'status' && <Status />}
        {kind === 'email' && <EmailPreferences state={state} dispatch={dispatch} />}
        {kind === 'unsubscribe' && <Unsubscribe state={state} dispatch={dispatch} />}
        {kind === 'connect' && <Connect state={state} dispatch={dispatch} onDone={onClose} />}
      </div>
    </FullScreenDialog>
  );
}

function Status() {
  const [phase, setPhase] = useState<'checking' | 'ok' | 'down'>('checking');
  const [fail, setFail] = useState(false);
  const [at, setAt] = useState(new Date());
  const [ms, setMs] = useState(4);
  useEffect(() => { if (phase !== 'checking') return; const t = window.setTimeout(() => { setPhase(fail ? 'down' : 'ok'); setAt(new Date()); setMs(3 + Math.round(Math.random() * 6)); }, 800); return () => window.clearTimeout(t); }, [phase, fail]);
  return (
    <AuthLayout aria-label="System status" footer={<span className="tf-rec__muted">Prototype: <AuthFooterLink onPress={() => { setFail(!fail); setPhase('checking'); }}>{fail ? 'Answer again' : 'Stop answering'}</AuthFooterLink></span>}>
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="System status" />
        {phase === 'checking' ? <p className="tf-pub__line"><Spinner size={16} label="Checking" /> Checking the API and the database…</p>
          : phase === 'down' ? <Callout tone="danger" title="The API or the database didn’t answer">Check that both are running, then try again.</Callout>
          : <p className="tf-pub__line"><CheckCircle2 size={16} strokeWidth={1.75} className="tf-pub__ok" aria-hidden /> The API and the database are answering. <Tag size="sm" status="done">Healthy</Tag></p>}
        {phase === 'ok' && <dl className="tf-set__facts">{([['Environment', 'Production'], ['Postgres', '18.1'], ['Database round trip', `${ms} ms`], ['Checked', at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tf-num">{v}</dd></div>)}</dl>}
        <Button variant="secondary" isDisabled={phase === 'checking'} onPress={() => setPhase('checking')}>Check again</Button>
      </div>
    </AuthLayout>
  );
}

/** The two topics a workspace emails about, read and written to the same place as Settings › Notifications. */
function useTopics(state: AppState, dispatch: Dispatch) {
  const slug = state.prefs.workspace.slug; const now = state.prefs.emailPrefs?.[slug] ?? { forms: true, mentions: true };
  const set = (k: 'forms' | 'mentions', on: boolean) => dispatch({ type: 'prefs/update', fn: (q) => ({ emailPrefs: { ...(q.emailPrefs ?? {}), [slug]: { ...(q.emailPrefs?.[slug] ?? { forms: true, mentions: true }), [k]: on } } }) });
  return { now, set };
}

function EmailPreferences({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const [expired, setExpired] = useState(false);
  const { now, set } = useTopics(state, dispatch);
  const ws = state.prefs.workspace.name;
  return (
    <AuthLayout aria-label="Email preferences" footer={<span className="tf-rec__muted">Prototype: <AuthFooterLink onPress={() => setExpired(!expired)}>{expired ? 'A fresh link' : 'An expired link'}</AuthFooterLink></span>}>
      {expired ? <div className="tf-door__card">
        <span className="tf-door__icon"><MailX size={24} strokeWidth={1.75} /></span>
        <AuthHeading title="This link has expired" description="The next email has a new link." />
      </div> : <div className="tf-door__card tf-door__card--left">
        <AuthHeading title="Email preferences" description={`Choose which emails you get from ${ws}.`} />
        {([['forms', 'New form submissions', 'An email for each new submission to a form you’re told about.'], ['mentions', 'Mentions', 'An email when someone mentions you in a comment or a note.']] as const).map(([k, title, line]) => (
          <div key={k} className="tf-set__switch"><span><strong>{title}</strong><span className="tf-rec__muted">{line}</span></span><Switch aria-label={title} isSelected={now[k]} onChange={(on) => { set(k, on); toast({ message: 'Saved', tone: 'success' }); }} /></div>))}
        <p className="tf-rec__muted">Emails about signing in, your account and your bookings always come.</p>
      </div>}
    </AuthLayout>
  );
}

function Unsubscribe({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const [phase, setPhase] = useState<'ask' | 'busy' | 'done'>('ask');
  const { set } = useTopics(state, dispatch);
  const ws = state.prefs.workspace.name;
  return (
    <AuthLayout aria-label="Unsubscribe">
      <div className="tf-door__card">
        <span className="tf-door__icon"><MailX size={24} strokeWidth={1.75} /></span>
        {phase === 'done' ? <AuthHeading title="You’re unsubscribed" description={`You won’t get an email when someone mentions you in ${ws} any more.`} />
          : <><AuthHeading title="Unsubscribe" description="Stop getting emails like the one this link came in?" />
            <Button variant="primary" size="lg" isPending={phase === 'busy'} onPress={() => { setPhase('busy'); window.setTimeout(() => { set('mentions', false); setPhase('done'); }, 600); }}>{phase === 'busy' ? 'Unsubscribing' : 'Unsubscribe'}</Button></>}
        <span className="tf-rec__muted">Your other email choices stay as they are.</span>
      </div>
    </AuthLayout>
  );
}

/** A partner asks to connect: pick the workspace to share (or name a new one) and the modules it may use. */
function Connect({ state, dispatch, onDone }: { readonly state: AppState; readonly dispatch: Dispatch; readonly onDone: () => void }) {
  const { toast } = useToast();
  const partner = 'Acme marketing hub';
  const owned = [state.prefs.workspace.name];
  const [ws, setWs] = useState(owned[0] ?? 'new');
  const [name, setName] = useState('');
  const [links, setLinks] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const already = (state.prefs.partners ?? []).some((x) => x.name === partner);
  const go = () => { setTried(true); if (!links || (ws === 'new' && !name.trim())) return; setBusy(true); window.setTimeout(() => {
    if (ws !== 'new') dispatch({ type: 'prefs/set', prefs: { partners: [...(state.prefs.partners ?? []).filter((x) => x.name !== partner), { id: newId('pt'), name: partner, scopes: ['show link pages', 'add people'], at: new Date() }] }, note: `${state.me} connected ${partner}` });
    toast({ message: `${partner} is connected to ${ws === 'new' ? name.trim() : ws}`, tone: 'success' }); onDone(); }, 700); };
  return (
    <AuthLayout aria-label="Connect an app" account={state.members.find((m) => m.name === state.me)?.email}>
      <div className="tf-door__card tf-door__card--left">
        <AuthHeading eyebrow={<Avatar name={partner} size={36} shape="square" />} title={`Connect ${partner} to Timefix`} description="Pick the workspace to share and what it may use. You can change or end this any time." />
        <Callout tone="info" title={`${partner} will be able to`}>Add and remove people in this workspace{links ? '; open Link pages for them, and manage each person’s link page and QR code' : ''}.</Callout>
        <RadioGroup label="Workspace" value={ws} onChange={setWs}>
          {owned.map((w) => <Radio key={w} value={w}><span className="tf-set__stack"><span>{w}</span>{already && <span className="tf-rec__muted">Already connected. Connecting again replaces its access.</span>}</span></Radio>)}
          <Radio value="new">A new workspace</Radio>
        </RadioGroup>
        {ws === 'new' && <TextField label="Workspace name" value={name} onChange={setName} placeholder="Acme" autoFocus isInvalid={tried && !name.trim()} errorMessage="Name the workspace." />}
        <span className="tf-rec__muted">You’re in 1 other workspace. Only its owners can connect it.</span>
        <fieldset className="tf-set__check"><legend>Modules</legend><Checkbox isSelected={links} onChange={setLinks}>Link pages</Checkbox>{tried && !links && <span className="tf-pub__error" role="alert">Tick at least one module.</span>}</fieldset>
        <Button variant="primary" size="lg" isPending={busy} onPress={go}>{busy ? 'Connecting…' : 'Connect'}</Button>
        <Button variant="ghost" onPress={onDone}>Cancel</Button>
      </div>
    </AuthLayout>
  );
}
