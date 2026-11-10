// Settings, one tree (app-ia.md): Account, Workspace, Data, Bookings, Developer, with "Find a setting". Everyday Bookings pages stay in
// Bookings; their settings here link there. Ending actions (delete account, delete workspace, remove member) ask first in a dialog.
import { useEffect, useState, type ReactNode } from 'react';
import { AppWindow, Bell, Building2, CalendarDays, Code2, Database, History, KeyRound, ListChecks, Shield, SlidersHorizontal, Trash2, User, Users, Workflow } from 'lucide-react';
import { SettingsLayout, SettingsNav, SettingsSection, type SettingsNavGroup } from '../SettingsLayout/SettingsLayout.tsx';
import { TeamList } from '../TeamList/TeamList.tsx';
import { InviteRows } from '../InviteRows/InviteRows.tsx';
import { RolePowers } from '../RolePowers/RolePowers.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { QrCode } from '../QrCode/QrCode.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { AttributeSettings } from '../AttributeSettings/AttributeSettings.tsx';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { newId, type AppAction, type AppState, type Member, type ObjectSchema, type Prefs } from './data.ts';
import type { Door } from './auth.tsx';
import { RenameDialog } from './records.tsx';
import { HOME_SECTIONS } from './home.tsx';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
type Page = 'profile' | 'preferences' | 'notifications' | 'security' | 'calendars' | 'general' | 'members' | 'roles' | 'apps' | 'history' | 'objects' | 'lists' | 'trash' | 'bookings' | 'developer';
const GROUPS: ReadonlyArray<Omit<SettingsNavGroup, 'items'> & { readonly items: ReadonlyArray<{ readonly id: Page; readonly label: string; readonly icon: ReactNode; readonly words?: string }> }> = [
  { title: 'Account', items: [{ id: 'profile', label: 'Profile', icon: <User {...i16} />, words: 'name photo delete account' }, { id: 'preferences', label: 'Preferences', icon: <SlidersHorizontal {...i16} />, words: 'theme dark time zone date week start page home' },
    { id: 'notifications', label: 'Notifications', icon: <Bell {...i16} />, words: 'email digest mentions' }, { id: 'security', label: 'Sign in and security', icon: <Shield {...i16} />, words: 'two factor 2fa devices sessions' }, { id: 'calendars', label: 'Calendars', icon: <CalendarDays {...i16} />, words: 'google outlook icloud connect' }] },
  { title: 'Workspace', items: [{ id: 'general', label: 'General', icon: <Building2 {...i16} />, words: 'name address brand logo colour currency delete workspace' }, { id: 'members', label: 'Members and teams', icon: <Users {...i16} />, words: 'invite people roles teams domain' },
    { id: 'roles', label: 'Roles and access', icon: <KeyRound {...i16} />, words: 'permissions sign in rules require two factor' }, { id: 'apps', label: 'Apps and connections', icon: <AppWindow {...i16} />, words: 'menu table seating appointments connected' }, { id: 'history', label: 'History', icon: <History {...i16} />, words: 'audit changes sign-ins' }] },
  { title: 'Data', items: [{ id: 'objects', label: 'Objects', icon: <Database {...i16} />, words: 'attributes fields people companies deals custom' }, { id: 'lists', label: 'Lists', icon: <ListChecks {...i16} /> }, { id: 'trash', label: 'Trash', icon: <Trash2 {...i16} />, words: 'deleted restore' }] },
  { title: 'More', items: [{ id: 'bookings', label: 'Bookings', icon: <CalendarDays {...i16} />, words: 'round robin scheduling access business places services staff' }, { id: 'developer', label: 'Developer', icon: <Code2 {...i16} />, words: 'api keys tokens webhooks' }] },
];

/** Props for SettingsScreen. */
export interface SettingsScreenProps {
  readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onBookings: (tab: string) => void;
  /** The page it opens on. */ readonly start?: string;
  /** Sign out, delete account or workspace: leaves for that screen. */ readonly onDoor?: (d: Door) => void;
  /** The workspace's kind, from Bookings: decides which apps and Bookings links fit. */ readonly kind?: 'team' | 'salon' | 'restaurant';
  /** Opens a list from Settings › Lists. */ readonly onOpenList?: (id: string) => void;
}

/** Settings. */
export function SettingsScreen({ state, dispatch, onBookings, start, onDoor, kind = 'team', onOpenList }: SettingsScreenProps) {
  const [page, setPage] = useState<Page>(((start ?? '').split(':')[0] as Page | '') || 'profile');
  const [find, setFind] = useState('');
  /** Phone: the list of settings first, then one page with a way back (a start page opens straight on it). */
  const [picked, setPicked] = useState(start !== undefined);
  /** "+ New object" opens its dialog once; coming back to Objects later doesn't reopen it. */
  const [freshObject, setFreshObject] = useState(start === 'objects:new');
  useEffect(() => { if (page !== 'objects') setFreshObject(false); }, [page]);
  const q = find.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((x) => !q || `${x.label} ${x.words ?? ''}`.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0);
  const item = GROUPS.flatMap((g) => g.items).find((x) => x.id === page);
  return (
    <div className={picked ? 'tf-set tf-set--page' : 'tf-set'}>
      <SettingsLayout title={item?.label ?? 'Settings'} nav={<div className="tf-set__nav"><SearchField label="Find a setting" placeholder="Find a setting" size="sm" value={find} onChange={setFind} />
        {groups.length === 0 ? <p className="tf-rec__muted">No setting matches “{find}”.</p> : <SettingsNav groups={groups} current={page} onNavigate={(id) => { setPage(id as Page); setPicked(true); }} />}</div>}>
        <Button size="sm" variant="ghost" className="tf-set__back" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={() => setPicked(false)}>All settings</Button>
        <Body page={page} state={state} dispatch={dispatch} onBookings={onBookings} onDoor={onDoor} kind={kind} onOpenList={onOpenList} newObject={freshObject && page === 'objects'} onGoPage={(x) => { setPage(x); setPicked(true); }} />
      </SettingsLayout>
    </div>
  );
}

type Dispatch = (a: AppAction) => void;
type Ask =
  | { readonly kind: 'account' | 'workspace' }
  | { readonly kind: 'devices' } | { readonly kind: 'device'; readonly id: string } | { readonly kind: '2fa-off' } | { readonly kind: 'signout' }
  | { readonly kind: 'team'; readonly id?: string } | { readonly kind: 'remove'; readonly id: string } | { readonly kind: 'key' } | { readonly kind: 'revoke'; readonly id: string }
  | { readonly kind: 'guest'; readonly id: string } | { readonly kind: 'transfer' } | { readonly kind: 'leave' } | { readonly kind: 'partner' } | { readonly kind: 'unpartner'; readonly id: string };

const ROLE_ID = (r: Member['role']) => r.toLowerCase();
const ROLE_NAME = (id: string): Member['role'] => (id === 'owner' ? 'Owner' : id === 'admin' ? 'Admin' : id === 'guest' ? 'Guest' : 'Member');
const APPS = [
  { id: 'menu', title: 'Menu and QR codes', hint: 'A menu at your link, a code on every table', kinds: ['restaurant'] },
  { id: 'seating', title: 'Table seating', hint: 'Reservations, tables and a waitlist', kinds: ['restaurant'] },
  { id: 'appointments', title: 'Appointments', hint: 'Services with prices, booked with your staff', kinds: ['salon'] },
] as const;

function Body({ page, state, dispatch, onBookings, onDoor, kind, newObject = false, onOpenList, onGoPage }: { readonly onGoPage?: (p: Page) => void; readonly onOpenList?: (id: string) => void; readonly newObject?: boolean; readonly page: Page; readonly state: AppState; readonly dispatch: Dispatch; readonly onBookings: (tab: string) => void; readonly onDoor?: (d: Door) => void; readonly kind: 'team' | 'salon' | 'restaurant' }) {
  const { toast } = useToast();
  const p = state.prefs;
  const ws = p.workspace;
  /** One change to prefs, with a Saved toast and, for workspace-wide changes, a history line. */
  const set = (patch: Partial<Prefs>, note?: string, message = 'Saved') => { dispatch({ type: 'prefs/set', prefs: patch, note }); toast({ message, tone: 'success' }); };
  const [ask, setAsk] = useState<Ask>();
  const [typed, setTyped] = useState('');
  const [code, setCode] = useState('');
  const [twofa, setTwofa] = useState<'setup' | 'codes'>();
  const [inviting, setInviting] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [teamMembers, setTeamMembers] = useState<ReadonlyArray<string>>([]);
  const [reassign, setReassign] = useState(state.me);
  const [keyName, setKeyName] = useState('');
  const [keyScope, setKeyScope] = useState<'read' | 'write'>('read');
  const [newKey, setNewKey] = useState<string>();
  const me = state.members.find((m) => m.name === state.me);
  const sw = (label: string, on: boolean, change: (on: boolean) => void, hint?: string) => (
    <div key={label} className="tf-set__switch"><span><strong>{label}</strong>{hint && <span className="tf-rec__muted">{hint}</span>}</span><Switch aria-label={label} isSelected={on} onChange={change} /></div>
  );
  const close = () => { setAsk(undefined); setTyped(''); setCode(''); };
  let body: ReactNode;
  /** Pages only owners and admins open; a preview as a member or guest shows why they can't. */
  const ADMIN_ONLY: ReadonlyArray<Page> = ['general', 'members', 'roles', 'apps', 'objects', 'trash', 'developer', 'history'];
  if (state.previewRole && ADMIN_ONLY.includes(page)) return <SettingsSection title="Only owners and admins open this" description={`A ${state.previewRole.toLowerCase()} sees their own settings: profile, preferences, notifications, sign in and calendars.`}><Button variant="secondary" onPress={() => dispatch({ type: 'preview/set', role: undefined })}>Stop previewing</Button></SettingsSection>;
  switch (page) {
    case 'profile': body = <>
      <SettingsSection title="You"><div className="tf-set__row"><Avatar name={state.me} size={56} /><div className="tf-rec__form tf-set__grow">
        <CommitField label="Name" value={state.me} onCommit={(v) => { dispatch({ type: 'me/rename', name: v }); toast({ message: 'Name saved', tone: 'success' }); }} />
        <TextField label="Email" value={me?.email ?? ''} isReadOnly description="You sign in with this." /></div></div>
        {sw('Show my photo on my booking and link pages', p.showPhoto, (on) => set({ showPhoto: on }))}</SettingsSection>
      <SettingsSection title="Delete account" tone="danger" description="You leave every workspace. Workspaces where you're the only owner need a new owner first." action={<Button variant="danger" onPress={() => setAsk({ kind: 'account' })}>Delete account</Button>}><span /></SettingsSection>
    </>; break;
    case 'preferences': body = <><SettingsSection title="Look and start">
      <div className="tf-rec__form tf-set__narrow">
        <Select label="Theme" value={p.theme} onChange={(v) => v && set({ theme: v as Prefs['theme'] })} items={[{ id: 'system', label: 'Match my device' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
        <Select label="Open the app on" value={p.startPage} onChange={(v) => v && set({ startPage: v })} items={[{ id: 'home', label: 'Home' }, { id: 'inbox', label: 'Inbox' }, { id: 'bookings', label: kind === 'restaurant' ? 'Reservations' : 'Meetings' }, { id: 'records:people', label: 'People' }]} />
      </div></SettingsSection>
      <SettingsSection title="In the sidebar" description="Hide what you don’t use. Nothing is deleted.">
        {[['tasks', 'Tasks'], ['notes', 'Notes'], ['lists', 'Lists'], ['forms', 'Forms'], ['insights', 'Insights']].map(([id, label]) => sw(label ?? '', !p.sidebarHidden.includes(id ?? ''), (on) => set({ sidebarHidden: on ? p.sidebarHidden.filter((x) => x !== id) : [...p.sidebarHidden, id ?? ''] })))}
      </SettingsSection>
      <SettingsSection title="On Home">
        {HOME_SECTIONS.map((h) => sw(h.label, !(p.homeHidden ?? []).includes(h.id), (on) => set({ homeHidden: on ? (p.homeHidden ?? []).filter((x) => x !== h.id) : [...(p.homeHidden ?? []), h.id] })))}
        {sw('Show the setup checklist on Home', !state.setupHidden, (on) => { dispatch({ type: 'setup/hide', hidden: !on }); toast({ message: on ? 'The checklist is back on Home' : 'Checklist hidden', tone: 'success' }); })}
      </SettingsSection></>; break;
    case 'notifications': body = <SettingsSection title="Email me when" description="The Inbox always gets everything; these are emails.">
      {([['mention', 'Someone mentions me'], ['task', 'Someone gives me a task'], ['booking', 'A guest books, moves or cancels'], ['form', 'A form gets a response'], ['digest', 'A daily summary at 8 AM', 'Your meetings and tasks for the day']] as const)
        .map(([k, label, hint]) => sw(label, p.notify[k] ?? false, (on) => set({ notify: { ...p.notify, [k]: on } }), hint))}</SettingsSection>; break;
    case 'security': body = <>
      <SettingsSection title="Two factor" status={<Tag size="sm" hue={p.twoFactor ? 'green' : 'gray'}>{p.twoFactor ? 'On' : 'Off'}</Tag>} description={p.rules.require2fa && !p.twoFactor ? 'Your workspace asks everyone to use two factor. Set it up to keep access.' : 'A code from an authenticator app each time you sign in on a new device.'}
        action={p.twoFactor ? <Button variant="secondary" isDisabled={p.rules.require2fa} onPress={() => setAsk({ kind: '2fa-off' })}>Turn off</Button> : <Button variant="primary" onPress={() => { setCode(''); setTwofa('setup'); }}>Set up</Button>}>
        {p.twoFactor && p.rules.require2fa ? <p className="tf-rec__muted">Your workspace requires two factor, so it can't be turned off.</p> : <span />}</SettingsSection>
      <SettingsSection title="Where you're signed in" action={p.devices.length > 1 ? <Button variant="secondary" onPress={() => setAsk({ kind: 'devices' })}>Sign out of other devices</Button> : undefined}>
        <ul className="tf-set__list">{p.devices.map((d) => <li key={d.id}><span><strong>{d.what}</strong> <span className="tf-rec__muted">{d.current ? `${d.where} · this device` : d.where}</span></span>
          {d.current ? <Tag size="sm" hue="green">This device</Tag> : <Button size="sm" variant="ghost" onPress={() => setAsk({ kind: 'device', id: d.id })}>Sign out</Button>}</li>)}</ul>
      </SettingsSection>
      <SettingsSection title="Sign out" description="Of this device only." action={<Button variant="secondary" onPress={() => setAsk({ kind: 'signout' })}>Sign out</Button>}><span /></SettingsSection>
    </>; break;
    case 'calendars': body = <SettingsSection title="Connected calendars" description="These are the calendars Bookings checks and writes to.">
      <div className="tf-set__links"><Button variant="secondary" onPress={() => onBookings('availability')}>Open calendars in Availability</Button></div></SettingsSection>; break;
    case 'general': body = <>
      <SettingsSection title="Workspace"><div className="tf-rec__form tf-set__narrow">
        <CommitField label="Name" value={ws.name} onCommit={(v) => set({ workspace: { ...ws, name: v } }, `${state.me} renamed the workspace to ${v}`, 'Name saved')} />
        <CommitField label="Address" value={ws.slug} prefix="timefix.com/" clean={(v) => v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}
          description="Your pages live here. Old links keep working for 30 days." onCommit={(v) => set({ workspace: { ...ws, slug: v } }, `${state.me} changed the address to timefix.com/${v}`, `Pages now at timefix.com/${v}`)} />
        <div className="tf-bkf__pair"><Select label="Currency" value={ws.currency} onChange={(v) => v && set({ workspace: { ...ws, currency: v } })} items={[{ id: 'inr', label: 'Indian rupee (₹)' }, { id: 'usd', label: 'US dollar ($)' }, { id: 'eur', label: 'Euro (€)' }]} />
          <Select label="Country" value={ws.country} onChange={(v) => v && set({ workspace: { ...ws, country: v } })} items={[{ id: 'in', label: 'India' }, { id: 'gb', label: 'United Kingdom' }, { id: 'us', label: 'United States' }]} /></div>
      </div></SettingsSection>
      <SettingsSection title="Brand" description="Your logo and colour on booking pages, forms, the link page and emails.">
        <div className="tf-set__row">{ws.logo ? <img className="tf-set__logo" src={ws.logo} alt={`${ws.name} logo`} /> : <Avatar name={ws.name} size={56} shape="square" />}
          <div className="tf-set__grow"><FileDrop variant="compact" label={ws.logo ? 'Replace logo' : 'Upload logo'} description="PNG or SVG, square, up to 2 MB" acceptedFileTypes={['image/png', 'image/svg+xml', 'image/jpeg']} allowsMultiple={false}
            onFiles={(files) => { const f = files[0]; if (!f) return; if (f.size > 2_000_000) { toast({ message: `${f.name} is over 2 MB. Pick a smaller file.`, tone: 'danger' }); return; } const before = ws.logo; set({ workspace: { ...ws, logo: URL.createObjectURL(f) } }, `${state.me} changed the logo`, 'Logo saved'); void before; }} /></div>
          {ws.logo && <Button size="sm" variant="ghost" onPress={() => { const was = ws.logo; dispatch({ type: 'prefs/update', fn: (q) => ({ workspace: { ...q.workspace, logo: undefined } }) }); toast({ message: 'Logo removed', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ workspace: { ...q.workspace, logo: was } }) }) } }); }}>Remove</Button>}
          <Select label="Colour" className="tf-you__select" value={ws.colour} onChange={(v) => v && set({ workspace: { ...ws, colour: v } })} items={[{ id: 'teal', label: 'Teal', hue: 'green' }, { id: 'blue', label: 'Blue', hue: 'blue' }, { id: 'ink', label: 'Ink', hue: 'gray' }, { id: 'violet', label: 'Violet', hue: 'purple' }]} /></div>
      </SettingsSection>
      <SettingsSection title="Delete workspace" tone="danger" description="Everyone loses access. You can restore it for 30 days." action={<Button variant="danger" onPress={() => setAsk({ kind: 'workspace' })}>Delete workspace</Button>}><span /></SettingsSection>
    </>; break;
    case 'members': body = <>
      <TeamList workspace={ws.name} now={new Date()} members={[...state.members.map((m, n) => ({ id: m.id, name: m.name, email: m.email, role: ROLE_ID(m.role), status: 'active' as const, seen: new Date(Date.now() - n * 3_600_000 * 5), isYou: m.name === state.me })),
        ...p.invites.map((iv) => ({ id: iv.id, name: iv.email, email: iv.email, role: iv.role, status: 'invited' as const, seen: iv.at }))]}
        onRoleChange={(id, role) => {
          const m = state.members.find((x) => x.id === id);
          if (m && role === 'guest' && m.role !== 'Guest') { setAsk({ kind: 'guest', id: m.id }); return; }
          if (m) { dispatch({ type: 'member/set', member: { ...m, role: ROLE_NAME(role) }, note: `${state.me} made ${m.name} ${ROLE_NAME(role).toLowerCase()}` }); toast({ message: `${m.name.split(' ')[0]} is now ${ROLE_NAME(role).toLowerCase()}`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'member/set', member: m }) } }); return; }
          set({ invites: p.invites.map((iv) => (iv.id === id ? { ...iv, role } : iv)) });
        }}
        onResend={(id) => { set({ invites: p.invites.map((iv) => (iv.id === id ? { ...iv, at: new Date() } : iv)) }, undefined, 'Invitation sent again'); }}
        onRemove={(id) => {
          const iv = p.invites.find((x) => x.id === id);
          if (iv) set({ invites: p.invites.filter((x) => x.id !== id) }, `${state.me} cancelled the invitation to ${iv.email}`, 'Invitation cancelled');
        }}
        onRemoveRequest={(id) => { setReassign(state.me); setAsk({ kind: 'remove', id }); }}
        action={<Button variant="primary" onPress={() => setInviting(true)}>Invite people</Button>} />
      {p.joinRequests.length > 0 && <SettingsSection title="Asking to join" description={`They signed up with an @${ws.slug}.com email.`}>
        <ul className="tf-set__list">{p.joinRequests.map((r) => <li key={r.id}><span><strong>{r.name}</strong> <span className="tf-rec__muted">{r.email}</span></span><span className="tf-set__row">
          <Button size="sm" variant="secondary" onPress={() => { dispatch({ type: 'member/set', member: { id: newId('u'), name: r.name, email: r.email, role: 'Member', title: '' }, note: `${state.me} let ${r.name} join` }); set({ joinRequests: p.joinRequests.filter((x) => x.id !== r.id) }, undefined, `${r.name} joined as a member`); }}>Let in</Button>
          <Button size="sm" variant="ghost" onPress={() => { dispatch({ type: 'prefs/update', fn: (q) => ({ joinRequests: q.joinRequests.filter((x) => x.id !== r.id) }) }); toast({ message: 'Request turned down', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ joinRequests: [...q.joinRequests, r] }) }) } }); }}>Turn down</Button></span></li>)}</ul></SettingsSection>}
      <SettingsSection title="Ways in" description="Besides invitations.">
        {sw('Anyone with the invite link can join as a member', p.rules.inviteLink, (on) => set({ rules: { ...p.rules, inviteLink: on } }, `${state.me} turned the invite link ${on ? 'on' : 'off'}`))}
        {p.rules.inviteLink && (() => { const o = p.inviteLinkOpts ?? { role: 'member', expires: '30', code: '7Hq2' }; const link = `timefix.com/join/${ws.slug}-${o.code}`; return <>
          <div className="tf-set__row"><TextField label="Invite link" value={link} isReadOnly className="tf-set__grow" />
            <Button size="sm" variant="secondary" onPress={() => { void copy(`https://${link}`).then((ok) => toast({ message: ok ? 'Invite link copied' : 'Copy didn’t work. Select the link and copy it.', tone: ok ? 'success' : 'danger' })); }}>Copy</Button></div>
          <div className="tf-bkf__pair">
            <Select label="Joins as" value={o.role} onChange={(v) => v && set({ inviteLinkOpts: { ...o, role: v } })} items={[{ id: 'member', label: 'Member' }, { id: 'guest', label: 'Guest' }]} />
            <Select label="Works for" value={o.expires} onChange={(v) => v && set({ inviteLinkOpts: { ...o, expires: v } })} items={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: 'never', label: 'Until I turn it off' }]} />
          </div>
          <Button size="sm" variant="ghost" onPress={() => { const old = o.code; dispatch({ type: 'prefs/update', fn: (q) => ({ inviteLinkOpts: { ...(q.inviteLinkOpts ?? o), code: Math.random().toString(36).slice(2, 6) } }) }); toast({ message: 'New link made. The old one stops working.', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ inviteLinkOpts: { ...(q.inviteLinkOpts ?? o), code: old } }) }) } }); }}>Make a new link</Button>
        </>; })()}
        {sw(`People with an @${ws.slug}.com email can ask to join`, p.rules.domainJoin, (on) => set({ rules: { ...p.rules, domainJoin: on } }), 'An owner or admin approves each request')}</SettingsSection>
      <SettingsSection title="Ownership" description={`Owners can delete ${ws.name} and change billing. There’s always at least one.`}>
        <div className="tf-set__row">
          <Button variant="secondary" isDisabled={state.members.filter((x) => x.name !== state.me && x.role !== 'Guest').length === 0} onPress={() => setAsk({ kind: 'transfer' })}>Make someone else owner</Button>
          <Button variant="ghost" onPress={() => setAsk({ kind: 'leave' })}>Leave {ws.name}</Button>
        </div>
      </SettingsSection>
      <SettingsSection title="Teams" description="Use teams in round robins and to share views." action={<Button variant="secondary" onPress={() => { setTeamName(''); setTeamMembers([]); setAsk({ kind: 'team' }); }}>New team</Button>}>
        {p.teams.length === 0 ? <p className="tf-rec__muted">No teams yet.</p> : <ul className="tf-set__list">{p.teams.map((t) => <li key={t.id}><button type="button" className="tf-set__open" onClick={() => { setTeamName(t.name); setTeamMembers(t.members); setAsk({ kind: 'team', id: t.id }); }}>
          <strong>{t.name}</strong><span className="tf-rec__muted">{t.members.length === 0 ? 'Nobody yet' : t.members.map((n) => n.split(' ')[0]).join(', ')}</span><ChevronRight size={16} strokeWidth={1.75} aria-hidden /></button></li>)}</ul>}</SettingsSection>
    </>; break;
    case 'roles': body = <>
      <RolePowers roles={[{ id: 'owner', name: 'Owner', isLocked: true }, { id: 'admin', name: 'Admin' }, { id: 'member', name: 'Member' }, { id: 'guest', name: 'Guest' }]}
        areas={[{ id: 'records', title: 'Records', powers: [{ id: 'records.edit', label: 'Add and edit records' }, { id: 'schema', label: 'Change objects and attributes' }] },
          { id: 'people', title: 'People', powers: [{ id: 'members', label: 'Invite and remove members' }] }, { id: 'bookings', title: 'Bookings', powers: [{ id: 'bookings', label: 'Make booking pages and round robins' }] }]}
        grants={p.grants} onChange={(role, power, held) => set({ grants: { ...p.grants, [role]: held ? [...(p.grants[role] ?? []), power] : (p.grants[role] ?? []).filter((x) => x !== power) } }, `${state.me} changed what ${role}s can do`)} />
      <SettingsSection title="See it as they do" description="Look around the app as a member or a guest would. Nothing changes while you preview.">
        <div className="tf-set__row"><Button variant="secondary" onPress={() => { dispatch({ type: 'preview/set', role: 'Member' }); toast({ message: 'Previewing as a member' }); }}>Preview as a member</Button>
          <Button variant="secondary" onPress={() => { dispatch({ type: 'preview/set', role: 'Guest' }); toast({ message: 'Previewing as a guest' }); }}>Preview as a guest</Button></div>
      </SettingsSection>
      <SettingsSection title="Sign in rules">
        {sw('Everyone must use two factor', p.rules.require2fa, (on) => set({ rules: { ...p.rules, require2fa: on } }, `${state.me} turned required two factor ${on ? 'on' : 'off'}`, on ? 'Members without two factor set it up at their next sign in' : 'Saved'), 'Members without it set it up at their next sign in')}
        {sw('Allow Google sign in', p.rules.google, (on) => set({ rules: { ...p.rules, google: on } }, `${state.me} turned Google sign in ${on ? 'on' : 'off'}`))}</SettingsSection>
    </>; break;
    case 'apps': body = <>
      <SettingsSection title="Business apps" description="Each adds its pages to Bookings. Turning one off hides its pages; nothing is deleted.">
        {APPS.map((a) => { const fits = (a.kinds as ReadonlyArray<string>).includes(kind); const core = fits && a.id !== 'menu'; return (
          <div key={a.id} className="tf-set__switch"><span><strong>{a.title}</strong><span className="tf-rec__muted">{!fits ? `For ${a.kinds[0] === 'salon' ? 'salons and clinics' : 'restaurants and cafés'}. Switch workspace to try it.` : core ? `${a.hint}. Your workspace runs on it, so it stays on.` : a.hint}</span></span>
            {!fits ? <Tag size="sm" hue="gray">Not for this workspace</Tag> : core ? <Tag size="sm" hue="green">On</Tag>
              : <Switch aria-label={a.title} isSelected={p.apps[a.id]} onChange={(on) => { const before = p.apps; dispatch({ type: 'prefs/set', prefs: { apps: { ...p.apps, [a.id]: on } }, note: `${state.me} turned ${a.title} ${on ? 'on' : 'off'}` });
                toast({ message: on ? `${a.title} is on. Menu is back in Bookings.` : `${a.title} is off. Menu is hidden from Bookings; nothing is deleted.`, action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/set', prefs: { apps: before } }) } }); }} />}</div>); })}
        <div className="tf-set__switch"><span><strong>Events</strong><span className="tf-rec__muted">Ticketed classes and workshops</span></span><Tag size="sm" hue="gray">Coming soon</Tag></div>
      </SettingsSection>
      <SettingsSection title="Connected apps" description="Apps that reach your workspace from outside." action={<Button variant="secondary" onPress={() => setAsk({ kind: 'partner' })}>Connect a hub</Button>}>
        {(p.partners ?? []).length === 0 ? <EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="Nothing connected" description="When a partner hub connects, it shows here with what it can reach, and you can disconnect it." />
          : <ul className="tf-set__list">{(p.partners ?? []).map((x) => <li key={x.id}><span><strong>{x.name}</strong> <span className="tf-rec__muted">Can {x.scopes.join(', ')} · connected {x.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span>
            <Button size="sm" variant="ghost" onPress={() => setAsk({ kind: 'unpartner', id: x.id })}>Disconnect</Button></li>)}</ul>}
      </SettingsSection>
    </>; break;
    case 'history': body = <SettingsSection title="Changes" description="Who changed what in the workspace, newest first.">
      <ul className="tf-set__list">{state.history.slice(0, 60).map((h) => <li key={h.id}><span>{h.text}</span><span className="tf-rec__muted tf-num">{h.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, {h.at.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}</span></li>)}</ul></SettingsSection>; break;
    case 'objects': body = <ObjectsPage state={state} dispatch={dispatch} startMaking={newObject} />; break;
    case 'lists': body = <ListsPage state={state} dispatch={dispatch} onOpenList={onOpenList} />; break;
    case 'trash': body = <TrashPage state={state} dispatch={dispatch} />; break;
    case 'bookings': body = <SettingsSection title="Bookings" description="These live in Bookings, where you use them.">
      <div className="tf-set__links">{(kind === 'team' ? [['Availability and hours', 'availability'], ['Booking pages', 'pages'], ['Round robin and routing', 'routing'], ['Team roster', 'roster']] : [['Opening hours', 'availability'], ['Your business page', 'pages'], ...(kind === 'restaurant' ? [['Menu', 'menu']] : [])])
        .map(([a, t]) => <Button key={t} variant="secondary" onPress={() => onBookings(t ?? 'meetings')}>{a}</Button>)}</div></SettingsSection>; break;
    case 'developer': body = <SettingsSection title="API keys" description="For your own scripts and tools. A key acts as the workspace, so keep it secret."
      action={<Button variant="secondary" onPress={() => { setKeyName(''); setKeyScope('read'); setNewKey(undefined); setAsk({ kind: 'key' }); }}>New key</Button>}>
      {p.apiKeys.length === 0 ? <EmptyState size="sm" icon={<Code2 size={20} strokeWidth={1.75} />} title="No keys yet" description="Make one to read or write records from outside Timefix." /> : (
        <ul className="tf-set__list">{p.apiKeys.map((k) => <li key={k.id}><span><strong>{k.name}</strong> <span className="tf-rec__muted tf-num">{k.scope === 'read' ? 'Read only' : 'Read and write'} · ends {k.last4} · made {k.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span>
          <Button size="sm" variant="ghost" onPress={() => setAsk({ kind: 'revoke', id: k.id })}>Revoke</Button></li>)}</ul>)}
    </SettingsSection>; break;
  }
  const removing = ask?.kind === 'remove' ? state.members.find((m) => m.id === ask.id) : undefined;
  const owns = removing ? { people: state.people.filter((x) => x.owner === removing.name).length, deals: state.deals.filter((x) => x.owner === removing.name).length, tasks: state.tasks.filter((t) => t.assignee === removing.name && !t.done).length } : undefined;
  const team = ask?.kind === 'team' ? p.teams.find((t) => t.id === ask.id) : undefined;
  const revoking = ask?.kind === 'revoke' ? p.apiKeys.find((k) => k.id === ask.id) : undefined;
  const otherOwners = state.members.filter((m) => m.role === 'Owner' && m.name !== state.me).length;
  return (
    <>
      {body}
      {(ask?.kind === 'account' || ask?.kind === 'workspace') && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={ask.kind === 'account' ? 'Delete your account?' : `Delete ${ws.name}?`}
          description={ask.kind === 'account' ? (otherOwners === 0 ? `You're the only owner of ${ws.name}. Make someone else an owner first, or delete the workspace.` : 'You leave every workspace. This can’t be undone.') : 'Everyone loses access now. You can restore it within 30 days.'}
          actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" isDisabled={(ask.kind === 'account' && otherOwners === 0) || typed.trim().toLowerCase() !== (ask.kind === 'account' ? (me?.email ?? '') : ws.slug)}
            onPress={() => { const k = ask.kind; close(); if (k === 'workspace') { dispatch({ type: 'history/add', text: `${state.me} deleted ${ws.name}` }); onDoor?.('deleted'); } else onDoor?.('signin'); }}>{ask.kind === 'account' ? 'Delete account' : 'Delete workspace'}</Button></>}>
          {(ask.kind === 'workspace' || otherOwners > 0) && <TextField label={ask.kind === 'account' ? `Type ${me?.email ?? 'your email'} to confirm` : `Type ${ws.slug} to confirm`} value={typed} onChange={setTyped} autoFocus />}
          {ask.kind === 'account' && otherOwners === 0 && <Button variant="secondary" onPress={() => { close(); onGoPage?.('members'); }}>Go to Members</Button>}
        </Dialog>
      )}
      {ask?.kind === 'guest' && (() => { const m = state.members.find((x) => x.id === ask.id); if (!m) return null; const n = state.people.filter((x) => x.owner === m.name).length + state.deals.filter((x) => x.owner === m.name).length + state.companies.filter((x) => x.owner === m.name).length; return (
        <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Make ${m.name} a guest?`} description={`Guests only see what’s shared with them and can’t change records. ${m.name.split(' ')[0]} owns ${n} ${n === 1 ? 'record' : 'records'}; they stay theirs, read only.`}
          actions={<><Button variant="ghost" slot="close">Keep as {m.role.toLowerCase()}</Button><Button variant="primary" onPress={() => { close(); dispatch({ type: 'member/set', member: { ...m, role: 'Guest' }, note: `${state.me} made ${m.name} a guest` }); toast({ message: `${m.name.split(' ')[0]} is now a guest`, action: { label: 'Undo', onAction: () => dispatch({ type: 'member/set', member: m }) } }); }}>Make guest</Button></>} />); })()}
      {ask?.kind === 'transfer' && <TransferDialog state={state} onClose={close} onTransfer={(to) => { const target = state.members.find((x) => x.name === to); if (!target || !me) return; close();
        dispatch({ type: 'member/set', member: { ...target, role: 'Owner' }, note: `${state.me} made ${target.name} an owner` }); dispatch({ type: 'member/set', member: { ...me, role: 'Admin' }, note: `${state.me} is now an admin` });
        toast({ message: `${target.name} is the owner now. You’re an admin.`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'member/set', member: target }); dispatch({ type: 'member/set', member: me }); } } }); }} />}
      {ask?.kind === 'leave' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Leave ${ws.name}?`}
        description={otherOwners === 0 && me?.role === 'Owner' ? `You’re the only owner. Make someone else owner first, or delete the workspace.` : 'You lose access straight away. Your records stay with the workspace; someone can invite you back.'}
        actions={<><Button variant="ghost" slot="close">Stay</Button><Button variant="danger" isDisabled={otherOwners === 0 && me?.role === 'Owner'} onPress={() => { close(); dispatch({ type: 'history/add', text: `${state.me} left ${ws.name}` }); onDoor?.('signin'); }}>Leave workspace</Button></>} />}
      {ask?.kind === 'partner' && <PartnerDialog onClose={close} onConnect={(name, scopes) => { close(); set({ partners: [...(p.partners ?? []), { id: newId('pt'), name, scopes, at: new Date() }] }, `${state.me} connected ${name}`, `${name} is connected`); }} />}
      {ask?.kind === 'unpartner' && (() => { const x = (p.partners ?? []).find((y) => y.id === ask.id); if (!x) return null; return (
        <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Disconnect ${x.name}?`} description="It stops reaching your workspace straight away. Pages it shows go blank until you connect again."
          actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" onPress={() => { close(); set({ partners: (p.partners ?? []).filter((y) => y.id !== x.id) }, `${state.me} disconnected ${x.name}`, `${x.name} disconnected`); }}>Disconnect</Button></>} />); })()}
      {ask?.kind === 'devices' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title="Sign out of other devices?" description={`${p.devices.length - 1} other ${p.devices.length - 1 === 1 ? 'device needs' : 'devices need'} to sign in again. This one stays signed in.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { const n = p.devices.length - 1; close(); set({ devices: p.devices.filter((d) => d.current) }, `${state.me} signed out of ${n} other devices`, `Signed out of ${n} ${n === 1 ? 'device' : 'devices'}`); }}>Sign out</Button></>} />}
      {ask?.kind === 'device' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Sign out of ${p.devices.find((d) => d.id === ask.id)?.what ?? 'this device'}?`} description="It needs to sign in again."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { const id = ask.id; close(); set({ devices: p.devices.filter((d) => d.id !== id) }, undefined, 'Signed out of that device'); }}>Sign out</Button></>} />}
      {ask?.kind === '2fa-off' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title="Turn off two factor?" description="Type a code from your authenticator app. Signing in then needs only the code we email you."
        actions={<><Button variant="ghost" slot="close">Keep it on</Button><Button variant="danger" isDisabled={code.replace(/\s/g, '').length !== 6} onPress={() => { close(); set({ twoFactor: false }, `${state.me} turned off two factor`, 'Two factor is off'); }}>Turn off</Button></>}>
        <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(v) => setCode(v.replace(/[^\d ]/g, '').slice(0, 7))} autoFocus description="In the prototype any six digits work." /></Dialog>}
      {ask?.kind === 'signout' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title="Sign out?" description="You can sign back in with your email."
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { close(); onDoor?.('signin'); }}>Sign out</Button></>} />}
      {removing && owns && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Remove ${removing.name}?`}
        description={`They lose access straight away. They own ${owns.people} ${owns.people === 1 ? 'person' : 'people'} and ${owns.deals} ${owns.deals === 1 ? 'deal' : 'deals'}, and have ${owns.tasks} open ${owns.tasks === 1 ? 'task' : 'tasks'}.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { dispatch({ type: 'member/remove', id: removing.id, reassignTo: reassign }); close(); toast({ message: `${removing.name} removed. Their records went to ${reassign.split(' ')[0]}.` }); }}>Remove member</Button></>}>
        <Select label="Give their records and tasks to" value={reassign} onChange={(v) => { if (v) setReassign(v); }} items={state.members.filter((m) => m.id !== removing.id && m.role !== 'Guest').map((m) => ({ id: m.name, label: m.name === state.me ? `${m.name} (you)` : m.name }))} /></Dialog>}
      {ask?.kind === 'team' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={team ? `Edit ${team.name}` : 'New team'}
        actions={<>{team && <Button variant="ghost" onPress={() => { const before = p.teams; close(); dispatch({ type: 'prefs/set', prefs: { teams: p.teams.filter((t) => t.id !== team.id) }, note: `${state.me} deleted the team ${team.name}` }); toast({ message: `${team.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ teams: [...q.teams.slice(0, before.findIndex((t) => t.id === team.id)), team, ...q.teams.slice(before.findIndex((t) => t.id === team.id))] }) }) } }); }}>Delete team</Button>}
          <Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!teamName.trim() || p.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === teamName.trim().toLowerCase())} onPress={() => {
            const next = { id: team?.id ?? newId('tm'), name: teamName.trim(), members: teamMembers }; close();
            set({ teams: team ? p.teams.map((t) => (t.id === team.id ? next : t)) : [...p.teams, next] }, team ? undefined : `${state.me} made the team ${next.name}`, team ? 'Team saved' : `${next.name} made`); }}>{team ? 'Save' : 'Create team'}</Button></>}>
        <div className="tf-rec__form"><TextField label="Name" value={teamName} onChange={setTeamName} placeholder="Sales" autoFocus errorMessage={p.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === teamName.trim().toLowerCase()) ? 'A team has this name' : undefined} isInvalid={p.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === teamName.trim().toLowerCase())} />
          <fieldset className="tf-set__check"><legend>Who's in it</legend>{state.members.map((m) => <Checkbox key={m.id} isSelected={teamMembers.includes(m.name)} onChange={(on) => setTeamMembers(on ? [...teamMembers, m.name] : teamMembers.filter((n) => n !== m.name))}>{m.name}</Checkbox>)}</fieldset></div>
      </Dialog>}
      {ask?.kind === 'key' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={newKey ? 'Copy your key now' : 'New API key'} description={newKey ? 'We won’t show it again. If you lose it, revoke it and make another.' : undefined}
        actions={newKey ? <Button variant="primary" onPress={close}>Done</Button> : <><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!keyName.trim()} onPress={() => {
          const raw = `tf_${keyScope === 'read' ? 'r' : 'w'}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`; setNewKey(raw);
          dispatch({ type: 'prefs/set', prefs: { apiKeys: [...p.apiKeys, { id: newId('key'), name: keyName.trim(), scope: keyScope, last4: raw.slice(-4), at: new Date() }] }, note: `${state.me} made the API key ${keyName.trim()}` }); }}>Make key</Button></>}>
        {newKey ? <div className="tf-set__row"><TextField label="Your key" value={newKey} isReadOnly className="tf-set__grow" /><Button size="sm" variant="secondary" onPress={() => { void copy(newKey).then((ok) => toast({ message: ok ? 'Key copied' : 'Copy didn’t work. Select the key and copy it.', tone: ok ? 'success' : 'danger' })); }}>Copy</Button></div>
          : <div className="tf-rec__form"><TextField label="Name" value={keyName} onChange={setKeyName} placeholder="Website sync" autoFocus description="So you know what uses it." />
            <Select label="It can" value={keyScope} onChange={(v) => { if (v) setKeyScope(v as 'read' | 'write'); }} items={[{ id: 'read', label: 'Read records' }, { id: 'write', label: 'Read and change records' }]} /></div>}
      </Dialog>}
      {revoking && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Revoke ${revoking.name}?`} description="Anything using it stops working straight away."
        actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" onPress={() => { close(); set({ apiKeys: p.apiKeys.filter((k) => k.id !== revoking.id) }, `${state.me} revoked the API key ${revoking.name}`, 'Key revoked'); }}>Revoke</Button></>} />}
      {twofa === 'setup' && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setTwofa(undefined); }} title="Set up two factor" description="Scan with an authenticator app, then type the six digits it shows."
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={code.replace(/\s/g, '').length !== 6} onPress={() => setTwofa('codes')}>Turn on</Button></>}>
          <div className="tf-set__row"><QrCode value={`otpauth://totp/Timefix:${me?.email ?? ''}?secret=JBSWY3DPEHPK3PXP`} label="Two factor QR code" size="sm" /><div className="tf-rec__form tf-set__grow"><span className="tf-rec__muted tf-num">Key: JBSW Y3DP EHPK 3PXP</span>
            <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code} onChange={(v) => setCode(v.replace(/[^\d ]/g, '').slice(0, 7))} autoFocus description="In the prototype any six digits work." /></div></div>
        </Dialog>
      )}
      {twofa === 'codes' && (
        <Dialog isOpen isDismissable={false} showClose={false} onOpenChange={() => undefined} title="Save your backup codes" description="Each works once if you lose your phone. We won't show them again."
          actions={<><Button variant="secondary" onPress={() => { void copy(CODES.join('\n')).then((ok) => toast({ message: ok ? 'Codes copied' : 'Copy didn’t work. Write them down.', tone: ok ? 'success' : 'danger' })); }}>Copy codes</Button>
            <Button variant="primary" onPress={() => { setTwofa(undefined); setCode(''); set({ twoFactor: true }, `${state.me} turned on two factor`, 'Two factor is on'); }}>I’ve saved these</Button></>}>
          <ul className="tf-set__codes tf-num">{CODES.map((c) => <li key={c}>{c}</li>)}</ul>
        </Dialog>
      )}
      {inviting && (
        <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setInviting(false); }} title="Invite people" description={`They get an email with a link to join ${ws.name}.`}>
          <InviteRows autoFocus onSend={(list) => new Promise<void>((resolve) => { window.setTimeout(() => {
            const known = new Set([...state.members.map((m) => m.email.toLowerCase()), ...p.invites.map((iv) => iv.email.toLowerCase())]);
            const fresh = list.filter((x) => !known.has(x.email.toLowerCase()));
            setInviting(false);
            dispatch({ type: 'prefs/set', prefs: { invites: [...p.invites, ...fresh.map((x) => ({ id: newId('iv'), email: x.email, role: x.role, at: new Date() }))] }, note: fresh.length ? `${state.me} invited ${fresh.map((x) => x.email).join(', ')}` : undefined });
            const skipped = list.length - fresh.length;
            toast(fresh.length === 0 ? { message: skipped === 1 ? 'That person is already in or invited.' : 'They’re all already in or invited.' } : { message: `${fresh.length} ${fresh.length === 1 ? 'invitation' : 'invitations'} sent${skipped ? ` · ${skipped} already in or invited` : ''}`, tone: 'success' }); resolve(); }, 500); })} />
        </Dialog>
      )}
    </>
  );
}

const CODES = ['4F7Q-29KD', 'M2XT-8LPA', 'Q9RB-3VCE', 'ZK6W-1HNY', 'T4GJ-7PUM', 'B8ED-5SXQ'];

/** Copies text; resolves false when the browser refuses, so the toast never lies. */
async function copy(text: string): Promise<boolean> { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

/** A text field that saves once, on blur or Enter, and only when the value really changed and isn't empty. */
function CommitField({ label, value, onCommit, description, prefix, clean = (v) => v.trim() }: { readonly label: string; readonly value: string; readonly onCommit: (v: string) => void; readonly description?: string; readonly prefix?: string; readonly clean?: (v: string) => string }) {
  const [v, setV] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) { setWas(value); setV(value); }
  const commit = () => { const next = clean(v); if (!next) { setV(value); return; } if (next !== value) onCommit(next); else setV(value); };
  return <TextField label={label} value={v} onChange={setV} description={description} icon={prefix ? <span className="tf-bkf__prefix">{prefix}</span> : undefined}
    onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setV(value); }} isInvalid={!clean(v)} errorMessage={!clean(v) ? `${label} can't be empty` : undefined} />;
}


/** Settings › Objects: the list, one object's attributes (add, edit, reorder, archive), and New object. */
function ObjectsPage({ state, dispatch, startMaking = false }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly startMaking?: boolean }) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string>();
  const [making, setMaking] = useState(startMaking);
  const [one, setOne] = useState('');
  const [many, setMany] = useState('');
  const counts: Readonly<Record<string, number>> = { people: state.people.length, companies: state.companies.length, deals: state.deals.length };
  const o = state.objects.find((x) => x.id === openId);
  if (o) {
    return (
      <div className="tf-set__obj">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={() => setOpenId(undefined)}>Objects</Button>
        <AttributeSettings objectName={o.one} objectPlural={o.many} attributes={o.attributes} valueCounts={Object.fromEntries(o.attributes.map((a) => [a.id, counts[o.id] ?? 0]))}
          onChange={(attributes) => dispatch({ type: 'object/set', object: { ...o, attributes } })} />
      </div>
    );
  }
  return (
    <SettingsSection title="Objects" description="What your workspace keeps records of. Open one to add or change its attributes." action={<Button variant="secondary" onPress={() => { setOne(''); setMany(''); setMaking(true); }}>New object</Button>}>
      <ul className="tf-set__list">
        {state.objects.map((x) => (
          <li key={x.id}><button type="button" className="tf-set__open" onClick={() => setOpenId(x.id)}>
            <strong>{x.many}</strong><span className="tf-rec__muted tf-num">{counts[x.id] ?? 0} records · {x.attributes.length} attributes{x.custom ? ' · yours' : ''}</span><ChevronRight size={16} strokeWidth={1.75} aria-hidden />
          </button></li>
        ))}
      </ul>
      {making && (
        <Dialog isOpen onOpenChange={(v) => { if (!v) setMaking(false); }} title="New object" description="Like Projects, Vendors or Properties. It shows under Records in the sidebar."
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!one.trim() || !many.trim()} onPress={() => {
            const obj: ObjectSchema = { id: newId('obj'), one: one.trim(), many: many.trim(), custom: true, attributes: [{ id: 'name', name: 'Name', type: 'text', isSystem: true, isRequired: true }, { id: 'created', name: 'Created at', type: 'timestamp', isSystem: true, readOnlyReason: 'Set by the system' }] };
            dispatch({ type: 'object/set', object: obj }); setMaking(false); setOpenId(obj.id); toast({ message: `${obj.many} made. Add its attributes next.`, tone: 'success' });
          }}>Create object</Button></>}>
          <div className="tf-bkf__pair">
            <TextField label="One" value={one} onChange={(v) => { setOne(v); if (!many || many === `${one}s`) setMany(v ? `${v}s` : ''); }} placeholder="Project" autoFocus />
            <TextField label="Many" value={many} onChange={setMany} placeholder="Projects" />
          </div>
        </Dialog>
      )}
    </SettingsSection>
  );
}

/** Settings › Trash: deleted records for 30 days. Restore is one click; deleting for good asks first. */
function TrashPage({ state, dispatch }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void }) {
  const { toast } = useToast();
  const [purge, setPurge] = useState<ReadonlyArray<string>>();
  const days = (d: Date) => Math.max(0, 30 - Math.floor((Date.now() - d.getTime()) / 86_400_000));
  const kind = { people: 'Person', companies: 'Company', deals: 'Deal' } as const;
  return (
    <SettingsSection title="Trash" description="Deleted records wait here for 30 days, then they're gone for good."
      action={state.trash.length > 0 ? <Button variant="ghost" onPress={() => setPurge(state.trash.map((t) => t.id))}>Empty trash</Button> : undefined}>
      {state.trash.length === 0 ? <EmptyState size="sm" icon={<Trash2 size={20} strokeWidth={1.75} />} title="Trash is empty" description="Records you delete land here, and you can restore them." /> : (
        <ul className="tf-set__list">
          {state.trash.map((t) => (
            <li key={t.id}><span><strong>{t.record.name}</strong> <span className="tf-rec__muted">{kind[t.object]} · deleted by {t.by} · {days(t.at) === 0 ? 'goes today' : `${days(t.at)} ${days(t.at) === 1 ? 'day' : 'days'} left`}</span></span>
              <span className="tf-set__row">
                <Button size="sm" variant="secondary" onPress={() => { dispatch({ type: 'trash/restore', id: t.id }); toast({ message: `${t.record.name} restored`, tone: 'success' }); }}>Restore</Button>
                <Button size="sm" variant="ghost" onPress={() => setPurge([t.id])}>Delete for good</Button>
              </span></li>
          ))}
        </ul>
      )}
      {purge && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setPurge(undefined); }} title={purge.length === 1 ? 'Delete for good?' : `Delete ${purge.length} records for good?`} description="They can't be restored after this."
          actions={<><Button variant="ghost" slot="close">Keep them</Button><Button variant="danger" onPress={() => { dispatch({ type: 'trash/purge', ids: purge }); setPurge(undefined); toast({ message: 'Deleted for good' }); }}>Delete for good</Button></>} />
      )}
    </SettingsSection>
  );
}

/** Settings › Lists: every list, archived ones too. Open, rename, archive or restore, delete (with Undo). */
function ListsPage({ state, dispatch, onOpenList }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onOpenList?: (id: string) => void }) {
  const { toast } = useToast();
  const [renaming, setRenaming] = useState<string>();
  const word = (o: string) => (o === 'people' ? 'People' : o === 'companies' ? 'Companies' : 'Deals');
  const row = (l: AppState['lists'][number]) => (
    <li key={l.id}><span><strong>{l.name}</strong> <span className="tf-rec__muted tf-num">{word(l.object)} · {l.entries.length} {l.entries.length === 1 ? 'entry' : 'entries'} · {l.stages.length} {l.stages.length === 1 ? 'stage' : 'stages'}</span></span>
      <span className="tf-set__row">
        {!l.archived && <Button size="sm" variant="secondary" onPress={() => onOpenList?.(l.id)}>Open</Button>}
        <Button size="sm" variant="ghost" onPress={() => setRenaming(l.id)}>Rename</Button>
        <Button size="sm" variant="ghost" onPress={() => { dispatch({ type: 'list/set', list: { ...l, archived: !l.archived } }); toast({ message: l.archived ? `${l.name} is back in the sidebar` : `${l.name} archived`, action: { label: 'Undo', onAction: () => dispatch({ type: 'list/set', list: l }) } }); }}>{l.archived ? 'Restore' : 'Archive'}</Button>
        <Button size="sm" variant="ghost" onPress={() => { const at = state.lists.findIndex((x) => x.id === l.id); dispatch({ type: 'list/remove', id: l.id }); toast({ message: `${l.name} deleted. The records stay.`, action: { label: 'Undo', onAction: () => dispatch({ type: 'list/insert', list: l, at }) } }); }}>Delete</Button>
      </span></li>
  );
  const live = state.lists.filter((l) => !l.archived); const archived = state.lists.filter((l) => l.archived);
  const renamingList = state.lists.find((l) => l.id === renaming);
  return (
    <>
      <SettingsSection title="Lists" description="Make a list from the sidebar’s Lists, then add records from any table or record.">
        {live.length === 0 ? <p className="tf-rec__muted">No lists yet.</p> : <ul className="tf-set__list">{live.map(row)}</ul>}
      </SettingsSection>
      {archived.length > 0 && <SettingsSection title="Archived" description="Out of the sidebar, with their entries kept."><ul className="tf-set__list">{archived.map(row)}</ul></SettingsSection>}
      {renamingList && <RenameDialog title="Rename list" label="Name" value={renamingList.name} onClose={() => setRenaming(undefined)} onSave={(name) => { dispatch({ type: 'list/set', list: { ...renamingList, name } }); setRenaming(undefined); toast({ message: 'List renamed', tone: 'success' }); }} />}
    </>
  );
}

/** Hand the workspace to another member: they become owner, you become admin. */
function TransferDialog({ state, onClose, onTransfer }: { readonly state: AppState; readonly onClose: () => void; readonly onTransfer: (name: string) => void }) {
  const others = state.members.filter((m) => m.name !== state.me && m.role !== 'Guest');
  const [to, setTo] = useState(others[0]?.name ?? '');
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Make someone else owner" description="They can delete the workspace and change billing. You stay as an admin."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!to} onPress={() => onTransfer(to)}>Make owner</Button></>}>
      <Select label="New owner" value={to} onChange={(v) => setTo(v ?? '')} items={others.map((m) => ({ id: m.name, label: m.name, description: m.role }))} />
    </Dialog>
  );
}

/** Connect a partner hub: its name, what it may reach, and the one-time code it gives you. */
function PartnerDialog({ onClose, onConnect }: { readonly onClose: () => void; readonly onConnect: (name: string, scopes: ReadonlyArray<string>) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [scopes, setScopes] = useState<ReadonlyArray<string>>(['show booking pages']);
  const ALL = ['show booking pages', 'show forms', 'read people', 'add people'];
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title="Connect a partner hub" description="The hub gives you a code. It can only reach what you tick, and you can disconnect it any time."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || code.replace(/\W/g, '').length < 6 || scopes.length === 0} onPress={() => onConnect(name.trim(), scopes)}>Connect</Button></>}>
      <div className="tf-rec__form">
        <TextField label="Hub name" value={name} onChange={setName} placeholder="Acme marketing hub" autoFocus />
        <TextField label="Connection code" value={code} onChange={setCode} placeholder="ABC-123" description="Prototype: any six letters or digits" />
        <fieldset className="tf-set__check"><legend>It can</legend>{ALL.map((x) => <Checkbox key={x} isSelected={scopes.includes(x)} onChange={(on) => setScopes(on ? [...scopes, x] : scopes.filter((y) => y !== x))}>{x[0]?.toUpperCase() + x.slice(1)}</Checkbox>)}</fieldset>
      </div>
    </Dialog>
  );
}
