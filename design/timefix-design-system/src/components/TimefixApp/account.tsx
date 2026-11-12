// Account settings, as the real app has them: claiming or changing your handle, syncing your Google photo, Sign in and security
// (a step-up check before sensitive changes, the setup key to copy, recovery codes to download, devices with session counts and Show more,
// recent activity), and the emails each workspace sends you.
import { useState } from 'react';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { TextField } from '../Field/Field.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { CodeBlock } from '../Code/Code.tsx';
import { QrCode } from '../QrCode/QrCode.tsx';
import { InfoTip } from '../Popover/Popover.tsx';
import { Menu, MenuItem, MenuTrigger } from '../Menu/Menu.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { AppAction, AppState } from './data.ts';
import { StepUp, stepFresh } from './people.tsx';

type Dispatch = (a: AppAction) => void;
/** Handles Timefix keeps for itself. */
const RESERVED = ['admin', 'api', 'settings', 'sign-in', 'signin', 'help', 'support', 'timefix', 'login', 'join', 'status', 'w', 'b', 'f'];
const TAKEN = ['priya', 'sam', 'acme', 'northwind'];
/** Why a handle can't be used, or undefined. */
export function handleProblem(h: string): string | undefined {
  if (h.length < 3) return 'Use at least 3 characters.';
  if (h.length > 40) return 'Use at most 40 characters.';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(h)) return 'Use lowercase letters, numbers and single hyphens.';
  if (RESERVED.includes(h)) return 'That handle is kept for Timefix. Pick another.';
  return undefined;
}
/** A free handle from a name: hyphenated, padded with -me when short or kept, then -2 … -9 until one is free. */
export function suggestHandle(name: string, taken: ReadonlyArray<string> = TAKEN): string {
  let base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (base.length < 3 || RESERVED.includes(base)) base = `${base || 'me'}-me`;
  if (!taken.includes(base)) return base;
  for (let n = 2; n <= 9; n++) if (!taken.includes(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now().toString(36).slice(-3)}`;
}

/** Profile › Handle: a suggestion to claim, or the handle you hold to change; the rules are checked as you type. */
export function HandleField({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const held = state.linkHandle;
  const [v, setV] = useState(held ?? suggestHandle(state.me));
  const problem = handleProblem(v) ?? (TAKEN.includes(v) && v !== held ? 'That handle is taken. Pick another.' : undefined);
  const claim = () => { if (problem || v === held) return; const was = held; dispatch({ type: 'link/handle', handle: v }); toast({ message: was ? `Your page is now timefix.com/${v}. The old address keeps working.` : `timefix.com/${v} is yours`, tone: 'success' }); };
  return (
    <div className="tf-set__row tf-set__labelled">
      <TextField label="Handle" className="tf-set__grow" value={v} maxLength={40} onChange={(x) => setV(x.toLowerCase().replace(/\s+/g, '-'))} onKeyDown={(e) => { if (e.key === 'Enter') claim(); }}
        icon={<span className="tf-bkf__prefix">timefix.com/</span>} isInvalid={Boolean(problem)} errorMessage={problem}
        description={held ? undefined : 'Suggested. Claim it or change it.'} />
      {held && <InfoTip label="About changing your handle">Your old address keeps working if you change it.</InfoTip>}
      <Button variant={held ? 'secondary' : 'primary'} isDisabled={Boolean(problem) || v === held} onPress={claim}>{held ? 'Change' : 'Claim'}</Button>
    </div>
  );
}

/** A Google photo sync result after coming back from Google. */
type PhotoResult = 'synced' | 'none' | 'kept' | 'cancelled' | 'other-email' | 'failed';
const RESULT: Readonly<Record<Exclude<PhotoResult, 'synced'>, { readonly title: string; readonly text: (email: string) => string; readonly tone: 'info' | 'danger' }>> = {
  none: { title: 'No photo at Google', text: () => 'Your Google account has no photo, so nothing changed.', tone: 'info' },
  kept: { title: 'Your photo stays', text: () => 'Your current photo isn’t from Google, so a Google photo doesn’t replace it.', tone: 'info' },
  cancelled: { title: 'Google photo not synced', text: () => 'You didn’t give Timefix access, so nothing changed.', tone: 'info' },
  'other-email': { title: 'Google photo not synced', text: (e) => `That Google account uses a different email. Choose the one for ${e}.`, tone: 'danger' },
  failed: { title: 'Google photo not synced', text: () => 'Your Google photo couldn’t be synced. Try again.', tone: 'danger' },
};
/** The stand-in Google photo: a soft round portrait tile with initials (the prototype has no network). */
const googlePhoto = (name: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#0F766E"/><text x="48" y="58" font-family="Geist,Arial" font-size="34" fill="#fff" text-anchor="middle">${name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</text></svg>`)}`;

/** Profile › Sync Google photo: leaves for Google (simulated), then says what happened. The demo menu picks what Google answers. */
export function GooglePhoto({ state, dispatch, email }: { readonly state: AppState; readonly dispatch: Dispatch; readonly email: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Exclude<PhotoResult, 'synced'>>();
  const linked = state.prefs.googleLinked === true;
  const go = (r: PhotoResult) => {
    setBusy(true); setResult(undefined);
    window.setTimeout(() => {
      setBusy(false);
      if (r === 'synced') { const was = state.prefs.photo; dispatch({ type: 'prefs/set', prefs: { photo: googlePhoto(state.me), googleLinked: true } }); toast({ message: 'Google photo synced. It’s on your profile and booking pages.', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: () => ({ photo: was }) }) } }); }
      else setResult(r);
    }, 700);
  };
  return (
    <div className="tf-set__stack">
      <span className="tf-set__row">
        <Button variant="secondary" isPending={busy} aria-label={linked ? 'Sync Google photo' : 'Sync Google photo and add Google sign in'} onPress={() => go(state.prefs.photo && !state.prefs.photo.startsWith('data:image/svg') ? 'kept' : 'synced')}>{busy ? 'Opening Google' : 'Sync Google photo'}</Button>
        <MenuTrigger><Button size="sm" variant="ghost">What Google answers</Button>
          <Menu aria-label="What Google answers" onAction={(k) => go(String(k) as PhotoResult)}>
            <MenuItem id="synced">Synced</MenuItem><MenuItem id="none">No photo at Google</MenuItem><MenuItem id="kept">Your own photo stays</MenuItem><MenuItem id="cancelled">Access not given</MenuItem><MenuItem id="other-email">A different email</MenuItem><MenuItem id="failed">It failed</MenuItem>
          </Menu></MenuTrigger>
      </span>
      <span className="tf-rec__muted">{linked ? 'Sync to use the photo on your Google account.' : `Choose the Google account for ${email}. It also becomes a way to sign in.`}</span>
      {result && <Callout tone={RESULT[result].tone} title={RESULT[result].title} onDismiss={() => setResult(undefined)}>{RESULT[result].text(email)}</Callout>}
    </div>
  );
}

/** Sign in and security: devices (sessions grouped, Show more), two factor with a step-up, the setup key, codes to copy or download, and recent activity. */
export function SecurityPage({ state, dispatch, onSignOut, require2fa }: { readonly state: AppState; readonly dispatch: Dispatch; readonly onSignOut: () => void; readonly require2fa: boolean }) {
  const { toast } = useToast();
  const p = state.prefs; const me = state.members.find((m) => m.name === state.me);
  const [ask, setAsk] = useState<{ readonly kind: 'device'; readonly id: string } | { readonly kind: 'others' | 'setup' | 'off' | 'codes' | 'show-codes' | 'signout' }>();
  const [verified, setVerified] = useState(false);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<ReadonlyArray<string>>([]);
  const [moreDevices, setMoreDevices] = useState(false);
  const [moreActivity, setMoreActivity] = useState(false);
  const fresh = stepFresh(state) || verified;
  const verify = () => { setVerified(true); dispatch({ type: 'prefs/update', fn: () => ({ stepUpAt: Date.now() }) }); };
  const close = () => { setAsk(undefined); setCode(''); };
  const open = (a: NonNullable<typeof ask>) => { setVerified(false); setCode(''); setAsk(a); };
  const makeCodes = () => Array.from({ length: 10 }, () => `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase());
  const devices = p.devices; const shownDevices = moreDevices ? devices : devices.slice(0, 5);
  const activity = (p.signIns ?? []).filter((x) => x.who === state.me).map((x) => ({ id: x.id, what: x.ok ? 'Signed in' : 'Wrong code', how: x.ok ? 'with an email code' : '', where: `${x.what} · ${x.where}`, at: x.at }))
    .concat(state.history.filter((h) => h.text.startsWith(state.me) && /two factor|backup codes|signed out/.test(h.text)).map((h) => ({ id: h.id, what: h.text.replace(`${state.me} `, '').replace(/^./, (c) => c.toUpperCase()), how: '', where: 'MacBook Pro · Chrome', at: h.at })))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const when = (d: Date) => `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  const needsFactor = ask?.kind === 'off' || ask?.kind === 'codes';
  const confirmLabel = ask?.kind === 'device' ? 'Sign out' : ask?.kind === 'others' ? 'Sign out' : ask?.kind === 'off' ? 'Turn off' : ask?.kind === 'codes' ? 'Make new codes' : '';
  const run = () => {
    if (!ask) return;
    if (ask.kind === 'device') { const d = devices.find((x) => x.id === ask.id); dispatch({ type: 'prefs/set', prefs: { devices: devices.filter((x) => x.id !== ask.id) } }); toast({ message: `Signed out ${d?.what ?? 'that device'}.`, tone: 'success' }); }
    if (ask.kind === 'others') { const n = devices.filter((x) => !x.current).length; dispatch({ type: 'prefs/set', prefs: { devices: devices.filter((x) => x.current) }, note: `${state.me} signed out of other devices` }); toast({ message: n === 0 ? 'No other devices were signed in.' : n === 1 ? 'Signed out of 1 other device.' : `Signed out of ${n} other devices.`, tone: 'success' }); }
    if (ask.kind === 'off') { dispatch({ type: 'prefs/set', prefs: { twoFactor: false }, note: `${state.me} turned off two factor sign in` }); toast({ message: 'Two factor sign in is off.' }); }
    if (ask.kind === 'codes') { setCodes(makeCodes()); dispatch({ type: 'prefs/set', prefs: { backupLeft: 10 }, note: `${state.me} made new backup codes` }); setAsk({ kind: 'show-codes' }); return; }
    close();
  };
  const titles: Readonly<Record<string, { readonly title: string; readonly body: string }>> = {
    device: { title: `Sign out ${ask?.kind === 'device' ? devices.find((x) => x.id === ask.id)?.what ?? '' : ''}?`, body: `From ${ask?.kind === 'device' ? devices.find((x) => x.id === ask.id)?.where ?? '' : ''}. That device signs in again.` },
    others: { title: 'Sign out of all other devices?', body: 'Other devices sign in again.' }, off: { title: 'Turn off two factor sign in?', body: 'Sign in will need only an email code or Google.' }, codes: { title: 'Make new backup codes?', body: 'Your old codes stop working.' },
  };
  return (
    <>
      <SettingsSection title="Signed in devices" action={devices.length > 1 ? <Button variant="secondary" onPress={() => open({ kind: 'others' })}>Sign out of all other devices</Button> : undefined}>
        {devices.length === 0 ? <p className="tf-rec__muted">No devices signed in</p> : <ul className="tf-set__list tf-set__list--center">{shownDevices.map((d) => (
          <li key={d.id}><span className="tf-set__stack"><strong>{d.what} {d.current ? <Tag size="sm" hue="green">This device</Tag> : (d.sessions ?? 1) > 1 ? <Tag size="sm">{d.sessions} sessions</Tag> : null}</strong><span className="tf-rec__muted">{d.current ? 'Active now' : 'Active'} · {d.where}</span></span>
            {!d.current && <Button size="sm" variant="ghost" onPress={() => open({ kind: 'device', id: d.id })}>Sign out</Button>}</li>))}</ul>}
        {devices.length > 5 && <Button size="sm" variant="ghost" onPress={() => setMoreDevices(!moreDevices)}>{moreDevices ? 'Show fewer' : 'Show more'}</Button>}
      </SettingsSection>
      <SettingsSection title="Two factor sign in">
        <div className="tf-set__switch"><span><strong>Authenticator app <InfoTip label="About two factor">Needs your phone, even with your email.</InfoTip></strong><span className="tf-rec__muted">{p.twoFactor ? (require2fa ? `On. Required by ${p.workspace.name}.` : 'On') : 'Off'}</span></span>
          {p.twoFactor ? <Button variant="secondary" isDisabled={require2fa} onPress={() => open({ kind: 'off' })}>Turn off</Button> : <Button variant="primary" onPress={() => open({ kind: 'setup' })}>Set up</Button>}</div>
        {p.twoFactor && <div className="tf-set__switch"><span><strong>Backup codes</strong><span className="tf-rec__muted tf-num">{p.backupLeft ?? 10} left</span></span><Button variant="secondary" onPress={() => open({ kind: 'codes' })}>Make new codes</Button></div>}
      </SettingsSection>
      <SettingsSection title="Recent activity" description="The last 90 days. Something you don’t know? Sign out of all other devices.">
        {activity.length === 0 ? <p className="tf-rec__muted">No activity in the last 90 days</p> : <ul className="tf-set__list tf-set__list--center">{(moreActivity ? activity : activity.slice(0, 5)).map((x) => (
          <li key={x.id}><span className="tf-set__stack"><strong>{x.what}{x.how ? ` ${x.how}` : ''}</strong><span className="tf-rec__muted">{x.where}</span></span><span className="tf-rec__muted tf-num">{when(x.at)}</span></li>))}</ul>}
        {activity.length > 5 && <Button size="sm" variant="ghost" onPress={() => setMoreActivity(!moreActivity)}>{moreActivity ? 'Show fewer' : 'Show more'}</Button>}
      </SettingsSection>
      <SettingsSection title="Sign out" description="Of this device only." action={<Button variant="secondary" onPress={onSignOut}>Sign out</Button>}><span /></SettingsSection>

      {ask && ask.kind !== 'setup' && ask.kind !== 'show-codes' && ask.kind !== 'signout' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={titles[ask.kind]?.title ?? ''} description={titles[ask.kind]?.body}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant={ask.kind === 'off' ? 'danger' : 'primary'} isDisabled={!fresh || (needsFactor && !p.twoFactor)} onPress={run}>{confirmLabel}</Button></>}>
        {fresh ? <p className="tf-rec__muted">You confirmed it’s you a moment ago.</p> : <StepUp twoFactor={p.twoFactor} needsSecondFactor={needsFactor} onVerified={verify} />}
      </Dialog>}
      {ask?.kind === 'setup' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title="Set up two factor sign in" size="wide"
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!fresh || code.replace(/\s/g, '').length !== 6} onPress={() => { setCodes(makeCodes()); dispatch({ type: 'prefs/set', prefs: { twoFactor: true, backupLeft: 10 }, note: `${state.me} turned on two factor sign in` }); setAsk({ kind: 'show-codes' }); }}>Turn on</Button></>}>
        {!fresh ? <StepUp twoFactor={false} onVerified={verify} /> : <div className="tf-set__row tf-set__top">
          <QrCode value={`otpauth://totp/Timefix:${me?.email ?? ''}?secret=JBSWY3DPEHPK3PXP`} label="Two factor QR code" size="sm" />
          <div className="tf-rec__form tf-set__grow">
            <ol className="tf-set__steps"><li>Open an authenticator app.</li><li>Scan the code, or type the key.</li><li>Enter the 6 digit code.</li></ol>
            <CodeBlock title="Setup key" code="JBSW Y3DP EHPK 3PXP" copyLabel="Copy the setup key" />
            <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(v) => setCode(v.replace(/[^\d ]/g, '').slice(0, 7))} description="In the prototype any six digits work." />
          </div></div>}
      </Dialog>}
      {ask?.kind === 'show-codes' && <Dialog isOpen isDismissable={false} showClose={false} onOpenChange={() => undefined} title="Save your backup codes" description="Each works once. Shown only now."
        actions={<><Button variant="secondary" onPress={() => { void saveFile('timefix-backup-codes.txt', new Blob([codes.join('\n')], { type: 'text/plain' })).then((o) => { if (o === 'saved') toast({ message: 'Codes downloaded', tone: 'success' }); }); }}>Download</Button>
          <Button variant="primary" onPress={() => { close(); toast({ message: 'Two factor sign in is on.', tone: 'success' }); }}>I’ve saved these</Button></>}>
        <CodeBlock title="Backup codes" code={codes.join('\n')} copyLabel="Copy the backup codes" />
      </Dialog>}
    </>
  );
}

/** Notifications › the emails one workspace sends you; the always-sent kinds are said, not switchable. Shared with the public email preferences page. */
export function WorkspaceEmails({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const slug = state.prefs.workspace.slug; const now = state.prefs.emailPrefs?.[slug] ?? { forms: true, mentions: true };
  const set = (k: 'forms' | 'mentions', on: boolean) => { const was = now; dispatch({ type: 'prefs/update', fn: (q) => ({ emailPrefs: { ...(q.emailPrefs ?? {}), [slug]: { ...now, [k]: on } } }) }); toast({ message: 'Notifications saved', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ emailPrefs: { ...(q.emailPrefs ?? {}), [slug]: was } }) }) } }); };
  return (
    <SettingsSection title={`Emails from ${state.prefs.workspace.name}`} description="Choose which emails you get from this workspace." footnote="Emails about signing in, your account and your bookings always come.">
      <div className="tf-set__switch"><span><strong>New form submissions</strong><span className="tf-rec__muted">An email for each new submission to a form you’re told about.</span></span><Switch aria-label="New form submissions" isSelected={now.forms} onChange={(on) => set('forms', on)} /></div>
      <div className="tf-set__switch"><span><strong>Mentions</strong><span className="tf-rec__muted">An email when someone mentions you in a comment or a note.</span></span><Switch aria-label="Mentions" isSelected={now.mentions} onChange={(on) => set('mentions', on)} /></div>
    </SettingsSection>
  );
}
