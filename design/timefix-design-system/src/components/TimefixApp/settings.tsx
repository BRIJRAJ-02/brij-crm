// Settings, one tree (app-ia.md): Account, Workspace, Scheduling, Business (salons and restaurants), Data, Developer, with "Find a setting".
// Every setting the app has is listed here. Scheduling and Business pages sum up what's set and open the full page in Bookings, where it's used.
// Ending actions (delete account, delete workspace, remove member, disconnect) ask first in a dialog.
import { useEffect, useState, type ReactNode } from 'react';
import { AppWindow, ArrowRightLeft, Bell, Building2, CalendarClock, CalendarDays, Clock, Code2, Database, Eye, FileDown, History, KeyRound, LayoutGrid, ListChecks, Palette, Repeat, Scissors, Shield, SlidersHorizontal, Split, Store, Trash2, User, UserCog, Users, UtensilsCrossed, Workflow } from 'lucide-react';
import { SettingsLayout, SettingsNav, SettingsSection, type SettingsNavGroup } from '../SettingsLayout/SettingsLayout.tsx';
import { BusinessScreen } from './business.tsx';
import { ServicesScreen, StaffScreen } from './services.tsx';
import { TeamList } from '../TeamList/TeamList.tsx';
import { InviteRows } from '../InviteRows/InviteRows.tsx';
import { RolePowers } from '../RolePowers/RolePowers.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Checkbox, Switch } from '../Checkbox/Checkbox.tsx';
import { FileDrop } from '../FileDrop/FileDrop.tsx';
import { Button } from '../Button/Button.tsx';
import { ConfirmDialog, Dialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { QrCode } from '../QrCode/QrCode.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { AttributeSettings } from '../AttributeSettings/AttributeSettings.tsx';
import { CalendarConnections, type CalendarProvider } from '../CalendarConnections/CalendarConnections.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { Tabs, TabPanel } from '../Tabs/Tabs.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { saveFile } from '../../lib/saveFile.ts';
import type { BookingsAction, BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { ListSettings } from './lists.tsx';
import { STARTER, handleFor } from './grow.tsx';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../lib/cx.ts';
import { newId, type AppAction, type AppState, type Member, type ObjectId, type ObjectSchema, type Prefs, LISTS_ON } from './data.ts';
import { JobsPage, ObjectAttributes, ObjectsList, StageRules, TrashPage } from './datasettings.tsx';
import { AutomationsPage } from './automations.tsx';
import { AccessGrants, RoundRobinPage, RoutingOverview } from './scheduling.tsx';
import type { Door } from './auth.tsx';
import { RenameDialog } from './records.tsx';
import { HOME_SECTIONS } from './home.tsx';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
type Page = 'profile' | 'preferences' | 'notifications' | 'security' | 'calendars' | 'general' | 'brand' | 'members' | 'roles' | 'apps' | 'history' | 'jobs'
  | 'availability' | 'roundrobin' | 'routing' | 'schedaccess' | 'business' | 'services' | 'staff' | 'tables' | 'menu' | 'objects' | 'lists' | 'trash' | 'developer' | 'automations';
type NavItem = { readonly id: Page; readonly label: string; readonly icon: ReactNode; readonly words?: string };
/** The settings tree for this workspace: Business shows only for a salon or a restaurant. The app's sidebar draws it while Settings is open. */
export const groupsFor = (kind: 'team' | 'salon' | 'restaurant'): ReadonlyArray<Omit<SettingsNavGroup, 'items'> & { readonly items: ReadonlyArray<NavItem> }> => [
  { title: 'Account', items: [{ id: 'profile', label: 'Profile', icon: <User {...i16} />, words: 'name photo handle bio social links public delete account' }, { id: 'preferences', label: 'Preferences', icon: <SlidersHorizontal {...i16} />, words: 'theme dark time zone date format week start page home sidebar' },
    { id: 'notifications', label: 'Notifications', icon: <Bell {...i16} />, words: 'email digest mentions replies' }, { id: 'security', label: 'Sign in and security', icon: <Shield {...i16} />, words: 'two factor 2fa backup codes devices sessions activity' }, { id: 'calendars', label: 'Calendars', icon: <CalendarDays {...i16} />, words: 'google outlook icloud connect conflicts sync colour' }] },
  { title: 'Workspace', items: [{ id: 'general', label: 'General', icon: <Building2 {...i16} />, words: 'name address web currency country time zone retention delete workspace' }, { id: 'brand', label: 'Brand', icon: <Palette {...i16} />, words: 'logo colour dark template look preview' },
    { id: 'members', label: 'Members and teams', icon: <Users {...i16} />, words: 'invite people roles teams domain link access' }, { id: 'roles', label: 'Roles and access', icon: <KeyRound {...i16} />, words: 'permissions custom roles sign in rules require two factor session' },
    { id: 'apps', label: 'Apps and connections', icon: <AppWindow {...i16} />, words: 'menu table seating appointments connected partner' }, { id: 'history', label: 'History', icon: <History {...i16} />, words: 'audit changes sign-ins' }, { id: 'jobs', label: 'Imports and exports', icon: <FileDown {...i16} />, words: 'csv download background jobs' }] },
  { title: 'Scheduling', items: [{ id: 'availability', label: kind === 'team' ? 'Availability' : 'Opening hours', icon: <Clock {...i16} />, words: 'hours schedules time off limits' }, ...(kind === 'team' ? [{ id: 'roundrobin' as const, label: 'Round robin', icon: <Repeat {...i16} />, words: 'groups rotation fair' }, { id: 'routing' as const, label: 'Routing', icon: <Split {...i16} />, words: 'rules form questions' }] : []),
    { id: 'schedaccess', label: 'Scheduling access', icon: <Eye {...i16} />, words: 'who can see manage hours calendar' }] },
  ...(kind === 'team' ? [] : [{ title: 'Business', items: [{ id: 'business' as const, label: 'Business', icon: <Store {...i16} />, words: 'business page places hours special days photos address switch' }, { id: 'services' as const, label: kind === 'restaurant' ? 'Table bookings' : 'Services', icon: <Scissors {...i16} />, words: 'prices categories' },
    { id: 'staff' as const, label: 'Staff and shifts', icon: <UserCog {...i16} />, words: 'roster shifts' }, ...(kind === 'restaurant' ? [{ id: 'tables' as const, label: 'Places and tables', icon: <LayoutGrid {...i16} />, words: 'areas seats floor' }, { id: 'menu' as const, label: 'Menu', icon: <UtensilsCrossed {...i16} />, words: 'dishes qr codes' }] : [])] }]),
  { title: 'Data', items: [{ id: 'objects', label: 'Objects', icon: <Database {...i16} />, words: 'attributes fields people companies deals custom configuration access' }, ...(LISTS_ON ? [{ id: 'lists' as const, label: 'Lists', icon: <ListChecks {...i16} />, words: 'stages each record once' }] : []), { id: 'automations', label: 'Automations', icon: <Workflow {...i16} />, words: 'workflow rules trigger when if then runs' }, { id: 'trash', label: 'Trash', icon: <Trash2 {...i16} />, words: 'deleted restore' }] },
  { title: 'Developer', items: [{ id: 'developer', label: 'API keys', icon: <Code2 {...i16} />, words: 'api keys tokens' }] },
];

/** Props for SettingsScreen. */
export interface SettingsScreenProps {
  readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onBookings: (tab: string) => void;
  /** The page it opens on. */ readonly start?: string;
  /** Sign out, delete account or workspace: leaves for that screen. */ readonly onDoor?: (d: Door) => void;
  /** The workspace's kind, from Bookings: decides which apps and Bookings links fit. */ readonly kind?: 'team' | 'salon' | 'restaurant';
  /** Opens a list from Settings › Lists. */ readonly onOpenList?: (id: string) => void;
  /** Bookings' connected calendars, shown in Settings › Calendars. */ readonly calendars?: ReadonlyArray<{ readonly id: string; readonly provider: string; readonly email: string; readonly calendars: number; readonly status: string }>;
  /** Opens a restored record. */ readonly onOpenRecord?: (object: ObjectId, id: string) => void;
  /** Opens a record still in Trash, read only. */ readonly onOpenTrashed?: (object: ObjectId, id: string) => void;
  /** Bookings as it stands, for the Scheduling and Business pages and Calendars. */ readonly bookings?: BookingsState;
  /** A change to Bookings made here (calendars, who changes whose hours). */ readonly onBookingsAction?: (a: BookingsAction) => void;
  /** Opens the CSV import. */ readonly onImport?: () => void;
  /** Opens the link page editor (bio, social links). */ readonly onLinkPage?: () => void;
  /** The page showing, when the app's sidebar holds the settings nav. */ readonly page?: string;
  /** Called when a page inside Settings opens another (Objects from Lists, and so on). */ readonly onPage?: (page: string) => void;
}

/** Settings. */
export function SettingsScreen({ state, dispatch, onBookings, start, onDoor, kind = 'team', onOpenList, calendars = [], onOpenRecord, onOpenTrashed, bookings, onBookingsAction, onImport, onLinkPage, page: shownPage, onPage }: SettingsScreenProps) {
  const GROUPS = groupsFor(kind);
  const [ownPage, setOwnPage] = useState<Page>(((start ?? '').split(':')[0] as Page | '') || 'profile');
  const page = (shownPage as Page | undefined) ?? ownPage;
  const setPage = (p: Page) => { setOwnPage(p); onPage?.(p); };
  const [find, setFind] = useState('');
  /** Phone: the list of settings first, then one page with a way back (a start page opens straight on it). */
  const [picked, setPicked] = useState(start !== undefined);
  /** "+ New object" opens its dialog once; coming back to Objects later doesn't reopen it. */
  const [freshObject, setFreshObject] = useState(start === 'objects:new');
  /** "objects:people" opens People's attributes straight away (a table's "+ Add a field"). */
  const openObject = start?.startsWith('objects:') && start !== 'objects:new' ? start.slice('objects:'.length) : undefined;
  useEffect(() => { if (page !== 'objects') setFreshObject(false); }, [page]);
  const q = find.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((x) => !q || `${x.label} ${x.words ?? ''}`.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0);
  const item = GROUPS.flatMap((g) => g.items).find((x) => x.id === page);
  return (
    <div className={cx('tf-set', picked && 'tf-set--page', shownPage !== undefined && 'tf-set--sidenav')}>
      <SettingsLayout title={item?.label ?? 'Settings'} nav={<div className="tf-set__nav"><SearchField label="Find a setting" placeholder="Find a setting" size="sm" value={find} onChange={setFind} />
        {groups.length === 0 ? <p className="tf-rec__muted">No setting matches “{find}”.</p> : <SettingsNav groups={groups} current={page} onNavigate={(id) => { setPage(id as Page); setPicked(true); }} />}</div>}>
        <Button size="sm" variant="ghost" className="tf-set__back" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={() => setPicked(false)}>All settings</Button>
        <Body page={page} state={state} dispatch={dispatch} onBookings={onBookings} onDoor={onDoor} kind={kind} onOpenList={onOpenList} newObject={freshObject && page === 'objects'} openObject={page === 'objects' ? openObject : undefined} onGoPage={(x) => { setPage(x); setPicked(true); }} calendars={calendars} onOpenRecord={onOpenRecord} onOpenTrashed={onOpenTrashed} sub={(start ?? '').split(':')[0] === page ? (start ?? '').split(':').slice(1).join(':') : undefined} bookings={bookings} onBookingsAction={onBookingsAction} onImport={onImport} onLinkPage={onLinkPage} />
      </SettingsLayout>
    </div>
  );
}

type Dispatch = (a: AppAction) => void;
type Ask =
  | { readonly kind: 'account' | 'workspace' }
  | { readonly kind: 'app-off'; readonly id: 'menu' | 'seating' | 'appointments' }
  | { readonly kind: 'devices' } | { readonly kind: 'device'; readonly id: string } | { readonly kind: '2fa-off' } | { readonly kind: 'signout' }
  | { readonly kind: 'team'; readonly id?: string } | { readonly kind: 'remove'; readonly id: string } | { readonly kind: 'key' } | { readonly kind: 'revoke'; readonly id: string }
  | { readonly kind: 'guest'; readonly id: string } | { readonly kind: 'transfer' } | { readonly kind: 'leave' } | { readonly kind: 'partner'; readonly id?: string } | { readonly kind: 'unpartner'; readonly id: string }
  | { readonly kind: 'address'; readonly to: string } | { readonly kind: 'codes' } | { readonly kind: 'signout-all' } | { readonly kind: 'role'; readonly from?: string } | { readonly kind: 'cal-off'; readonly id: string };

const ROLE_ID = (r: Member['role']) => r.toLowerCase();
const TAKEN = ['acme', 'timefix', 'admin', 'help', 'northwind-team'];
const ZONES = [{ id: 'ist', label: 'India (IST)' }, { id: 'gmt', label: 'London (GMT)' }, { id: 'cet', label: 'Berlin (CET)' }, { id: 'gst', label: 'Dubai (GST)' }, { id: 'sgt', label: 'Singapore (SGT)' }, { id: 'est', label: 'New York (ET)' }, { id: 'pst', label: 'Los Angeles (PT)' }];
const ROLE_NAME = (id: string): Member['role'] => (id === 'owner' ? 'Owner' : id === 'admin' ? 'Admin' : id === 'guest' ? 'Guest' : 'Member');
const APPS = [
  { id: 'menu', title: 'Menu and QR codes', hint: 'A menu at your link, a code on every table', kinds: ['restaurant'], uses: ['The Menu page leaves Bookings', 'Table QR codes open “The menu isn’t up right now”', 'Your business page drops its menu'] },
  { id: 'seating', title: 'Table seating', hint: 'Reservations, tables and a waitlist', kinds: ['restaurant'], uses: ['Guests leaves Bookings', 'Your page stops taking table bookings', 'The waitlist and the floor view are hidden'] },
  { id: 'appointments', title: 'Appointments', hint: 'Services with prices, booked with your staff', kinds: ['salon'], uses: ['Clients and Roster leave Bookings', 'Your page stops taking appointments', 'Services, staff and shifts stay in Settings, unused'] },
] as const;

function Body({ page, state, dispatch, onBookings, onDoor, kind, newObject = false, openObject, onOpenList, onGoPage, calendars = [], onOpenRecord, onOpenTrashed, sub, bookings, onBookingsAction, onImport, onLinkPage }: { readonly onOpenTrashed?: SettingsScreenProps['onOpenTrashed']; readonly sub?: string; readonly bookings?: BookingsState; readonly onBookingsAction?: (a: BookingsAction) => void; readonly onImport?: () => void; readonly onLinkPage?: () => void; readonly calendars?: SettingsScreenProps['calendars']; readonly onOpenRecord?: SettingsScreenProps['onOpenRecord']; readonly onGoPage?: (p: Page) => void; readonly onOpenList?: (id: string) => void; readonly newObject?: boolean; readonly openObject?: string; readonly page: Page; readonly state: AppState; readonly dispatch: Dispatch; readonly onBookings: (tab: string) => void; readonly onDoor?: (d: Door) => void; readonly kind: 'team' | 'salon' | 'restaurant' }) {
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
  const [teamAccess, setTeamAccess] = useState<Readonly<Record<string, 'all' | 'own' | 'team'>>>({});
  const [histTab, setHistTab] = useState<'changes' | 'signins'>('changes');
  const [roleName, setRoleName] = useState('');
  const [freshCodes, setFreshCodes] = useState<ReadonlyArray<string>>([]);
  const act = (a: BookingsAction) => onBookingsAction?.(a);
  const cals = bookings?.calendars ?? [];
  const when = (d: Date) => `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })}`;
  /** A Scheduling or Business page: what's set now, then the page in Bookings where it's changed. */
  const summary = (_title: string, description: string, facts: ReadonlyArray<readonly [string, string]>, tab: string, label: string) => (
    <SettingsSection title="What’s set now" description={description} action={<Button variant="secondary" icon={<ArrowRightLeft size={14} strokeWidth={1.75} />} onPress={() => onBookings(tab)}>{label}</Button>}>
      {!bookings ? <p className="tf-rec__muted">Open Bookings once to load these.</p> : <dl className="tf-set__facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="tf-num">{v}</dd></div>)}</dl>}
    </SettingsSection>
  );
  const me = state.members.find((m) => m.name === state.me);
  const sw = (label: string, on: boolean, change: (on: boolean) => void, hint?: string) => (
    <div key={label} className="tf-set__switch"><span><strong>{label}</strong>{hint && <span className="tf-rec__muted">{hint}</span>}</span><Switch aria-label={label} isSelected={on} onChange={change} /></div>
  );
  const close = () => { setAsk(undefined); setTyped(''); setCode(''); };
  let body: ReactNode;
  /** Pages only owners and admins open; a preview as a member or guest shows why they can't. */
  const ADMIN_ONLY: ReadonlyArray<Page> = ['general', 'brand', 'members', 'roles', 'apps', 'objects', 'trash', 'developer', 'history', 'jobs', 'roundrobin', 'routing', 'business', 'services', 'staff', 'tables', 'menu'];
  if (state.previewRole && ADMIN_ONLY.includes(page)) return <SettingsSection title="Only owners and admins open this" description={`A ${state.previewRole.toLowerCase()} sees their own settings: profile, preferences, notifications, sign in and calendars.`}><Button variant="secondary" onPress={() => dispatch({ type: 'preview/set', role: undefined })}>Stop previewing</Button></SettingsSection>;
  switch (page) {
    case 'profile': body = <>
      <SettingsSection title="You"><div className="tf-set__row">{p.photo ? <img className="tf-set__logo tf-set__photo" src={p.photo} alt="Your photo" /> : <Avatar name={state.me} size={56} />}
        <div className="tf-set__grow"><FileDrop variant="compact" label={p.photo ? 'Replace photo' : 'Add a photo'} description="Square works best, up to 2 MB" acceptedFileTypes={['image/png', 'image/jpeg', 'image/webp']} allowsMultiple={false}
          onFiles={(files) => { const f = files[0]; if (!f) return; if (f.size > 2_000_000) { toast({ message: `${f.name} is over 2 MB. Pick a smaller file.`, tone: 'danger' }); return; } const was = p.photo; dispatch({ type: 'prefs/update', fn: () => ({ photo: URL.createObjectURL(f) }) }); toast({ message: 'Photo saved', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: () => ({ photo: was }) }) } }); }} /></div>
        <div className="tf-rec__form tf-set__grow">
        <CommitField label="Name" value={state.me} onCommit={(v) => { dispatch({ type: 'me/rename', name: v }); toast({ message: 'Name saved', tone: 'success' }); }} />
        <TextField label="Email" value={me?.email ?? ''} isReadOnly description="You sign in with this." /></div></div>
        {sw('Show my photo on my booking and link pages', p.showPhoto, (on) => set({ showPhoto: on }))}</SettingsSection>
      {(() => { const handle = handleFor(state, bookings); const lp = state.linkPage ?? STARTER; const url = `timefix.com/${handle}`; return (
        <SettingsSection title="Public profile" description="What people see on your link page and booking pages.">
          <div className="tf-set__row"><TextField label="Your page" value={url} isReadOnly className="tf-set__grow" description="Your handle comes from the workspace address." />
            <Button size="sm" variant="secondary" onPress={() => { void copy(`https://${url}`).then((ok) => toast({ message: ok ? 'Link copied' : `Copy didn’t work. Your link is ${url}`, tone: ok ? 'success' : 'danger' })); }}>Copy</Button></div>
          <CommitField label="Bio" value={lp.profile.bio ?? ''} clean={(v) => v.trim() || ' '} description="One or two lines under your name."
            onCommit={(v) => { const was = state.linkPage; const bio = v.trim(); if (state.linkDraft) dispatch({ type: 'link/draft', page: { ...state.linkDraft, profile: { ...state.linkDraft.profile, bio: bio || undefined } } }); dispatch({ type: 'link/publish', page: { ...lp, profile: { ...lp.profile, bio: bio || undefined } } }); toast({ message: 'Bio saved', tone: 'success', action: { label: 'Undo', onAction: () => { if (was) dispatch({ type: 'link/publish', page: was }); } } }); }} />
          <div className="tf-set__switch"><span><strong>Social links</strong><span className="tf-rec__muted">{lp.socials.length === 0 ? 'None yet' : lp.socials.map((x) => x.network).join(', ')}</span></span>
            {onLinkPage && <Button size="sm" variant="secondary" onPress={onLinkPage}>Edit on your link page</Button>}</div>
        </SettingsSection>); })()}
      <SettingsSection title="Delete account" tone="danger" description="You leave every workspace. Workspaces where you're the only owner need a new owner first." action={<Button variant="danger" onPress={() => setAsk({ kind: 'account' })}>Delete account</Button>}><span /></SettingsSection>
    </>; break;
    case 'preferences': body = <><SettingsSection title="Look and start">
      <div className="tf-rec__form tf-set__narrow">
        <Select label="Theme" value={p.theme} onChange={(v) => v && set({ theme: v as Prefs['theme'] })} items={[{ id: 'system', label: 'Match my device' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
        <Select label="Time zone" value={p.timeZone} onChange={(v) => v && set({ timeZone: v })} description="Your times in Bookings, Tasks and the daily summary." items={ZONES} />
        <div className="tf-bkf__pair"><Select label="Dates read" value={p.dateFormat} onChange={(v) => v && set({ dateFormat: v })} items={[{ id: 'dmy', label: '10 Nov 2026' }, { id: 'mdy', label: 'Nov 10, 2026' }, { id: 'iso', label: '2026-11-10' }]} />
          <Select label="Weeks start on" value={p.weekStart} onChange={(v) => v && set({ weekStart: v as Prefs['weekStart'] })} items={[{ id: 'mon', label: 'Monday' }, { id: 'sun', label: 'Sunday' }, { id: 'sat', label: 'Saturday' }]} /></div>
        <Select label="Open the app on" value={p.startPage} onChange={(v) => v && set({ startPage: v })} items={[{ id: 'home', label: 'Home' }, { id: 'inbox', label: 'Inbox' }, { id: 'bookings', label: kind === 'restaurant' ? 'Reservations' : 'Meetings' }, { id: 'records:people', label: 'People' }]} />
      </div></SettingsSection>
      <SettingsSection title="In the sidebar" description="Hide what you don’t use. Nothing is deleted.">
        {[['tasks', 'Tasks'], ['notes', 'Notes'], ...(LISTS_ON ? [['lists', 'Lists']] : []), ['forms', 'Forms'], ['insights', 'Insights']].map(([id, label]) => sw(label ?? '', !p.sidebarHidden.includes(id ?? ''), (on) => set({ sidebarHidden: on ? p.sidebarHidden.filter((x) => x !== id) : [...p.sidebarHidden, id ?? ''] })))}
      </SettingsSection>
      <SettingsSection title="On Home">
        {HOME_SECTIONS.map((h) => sw(h.label, !(p.homeHidden ?? []).includes(h.id), (on) => set({ homeHidden: on ? (p.homeHidden ?? []).filter((x) => x !== h.id) : [...(p.homeHidden ?? []), h.id] })))}
        {sw('Show the setup checklist on Home', !state.setupHidden, (on) => { dispatch({ type: 'setup/hide', hidden: !on }); toast({ message: on ? 'The checklist is back on Home' : 'Checklist hidden', tone: 'success' }); })}
      </SettingsSection></>; break;
    case 'notifications': body = <SettingsSection title="Email me when" description="The Inbox always gets everything; these are emails.">
      {([['mention', 'Someone mentions me'], ['reply', 'Someone replies to my comment'], ['task', 'Someone gives me a task'], ['booking', 'A guest books, moves or cancels'], ['form', 'A form gets a response'], ['digest', 'A daily summary at 8 AM', 'Your meetings and tasks for the day']] as const)
        .map(([k, label, hint]) => sw(label, p.notify[k] ?? false, (on) => set({ notify: { ...p.notify, [k]: on } }), hint))}</SettingsSection>; break;
    case 'security': body = <>
      <SettingsSection title="Two factor" status={<Tag size="sm" hue={p.twoFactor ? 'green' : 'gray'}>{p.twoFactor ? 'On' : 'Off'}</Tag>} description={p.rules.require2fa && !p.twoFactor ? 'Your workspace asks everyone to use two factor. Set it up to keep access.' : 'A code from an authenticator app each time you sign in on a new device.'}
        action={p.twoFactor ? <Button variant="secondary" isDisabled={p.rules.require2fa} onPress={() => setAsk({ kind: '2fa-off' })}>Turn off</Button> : <Button variant="primary" onPress={() => { setCode(''); setTwofa('setup'); }}>Set up</Button>}>
        {p.twoFactor && p.rules.require2fa ? <p className="tf-rec__muted">Your workspace requires two factor, so it can't be turned off.</p> : <span />}</SettingsSection>
      {p.twoFactor && <SettingsSection title="Backup codes" status={<Tag size="sm" hue={(p.backupLeft ?? 6) <= 2 ? 'orange' : 'gray'}>{p.backupLeft ?? 6} of 6 left</Tag>} description="Each works once if you lose your phone."
        action={<Button variant="secondary" onPress={() => { setFreshCodes(Array.from({ length: 6 }, () => `${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase())); setAsk({ kind: 'codes' }); }}>Make new codes</Button>}><span /></SettingsSection>}
      <SettingsSection title="Where you're signed in" action={p.devices.length > 1 ? <Button variant="secondary" onPress={() => setAsk({ kind: 'devices' })}>Sign out of other devices</Button> : undefined}>
        <ul className="tf-set__list">{p.devices.map((d) => <li key={d.id}><span><strong>{d.what}</strong> <span className="tf-rec__muted">{d.current ? `${d.where} · this device` : d.where}</span></span>
          {d.current ? <Tag size="sm" hue="green">This device</Tag> : <Button size="sm" variant="ghost" onPress={() => setAsk({ kind: 'device', id: d.id })}>Sign out</Button>}</li>)}</ul>
      </SettingsSection>
      <SettingsSection title="Recent sign-ins" description="Your last 90 days. A sign-in you don't know? Sign out everywhere and change your password.">
        <ul className="tf-set__list">{(p.signIns ?? []).filter((x) => x.who === state.me).map((x) => <li key={x.id}><span><strong>{x.what}</strong> <span className="tf-rec__muted">{x.where} · {when(x.at)}</span></span><Tag size="sm" hue={x.ok ? 'gray' : 'red'}>{x.ok ? 'Signed in' : 'Wrong code'}</Tag></li>)}</ul>
      </SettingsSection>
      <SettingsSection title="Sign out" description="Of this device only." action={<Button variant="secondary" onPress={() => setAsk({ kind: 'signout' })}>Sign out</Button>}><span /></SettingsSection>
    </>; break;
    case 'calendars': { const targets = cals.filter((c) => c.status === 'connected').flatMap((c) => (bookings?.subCalendars?.[c.id]?.filter((x) => x.conflicts) ?? [{ id: c.provider === 'Google' ? 'work' : c.id, name: c.provider === 'Google' ? 'Work' : 'Calendar' }]).map((x) => ({ id: x.id, label: x.name, description: `${c.provider} · ${c.email}` })));
      const isAdmin = me?.role === 'Owner' || me?.role === 'Admin';
      const syncedAt = bookings?.lastSync ?? p.lastSync;
      body = <>
      {bookings?.fellBack && <Callout tone="warning" onDismiss={() => act({ type: 'calendar/fellback', fellBack: undefined })}>New bookings now go to {bookings.fellBack.now}. {bookings.fellBack.was} stopped taking them.</Callout>}
      <SettingsSection title="Connected calendars" description="Busy times there are never offered to guests. Open an account to pick which of its calendars count, show on your week and log meetings.">
        {!bookings ? <p className="tf-rec__muted">Open Bookings once to load your calendars.</p> : <CalendarConnections accounts={cals}
          calendarsOf={(id) => bookings.subCalendars?.[id]}
          onCalendarChange={(acc, id, patch) => act({ type: 'subcal/set', account: acc, calendars: (bookings.subCalendars?.[acc] ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) })}
          onDisconnect={(id) => setAsk({ kind: 'cal-off', id })}
          onSync={() => new Promise<void>((r) => { window.setTimeout(() => { const at = new Date(); act({ type: 'calendar/sync', at }); dispatch({ type: 'prefs/set', prefs: { lastSync: at } }); toast({ message: 'Calendars synced', tone: 'success' }); r(); }, 800); })}
          syncedText={syncedAt ? `Synced ${when(syncedAt)}` : undefined}
          onCheckConflicts={(id, on) => act({ type: 'calendar/set', calendars: cals.map((c) => (c.id === id ? { ...c, checkConflicts: on } : c)) })}
          onReconnect={(id) => new Promise<void>((r) => { window.setTimeout(() => { act({ type: 'calendar/set', calendars: cals.map((c) => (c.id === id ? { ...c, status: 'connected' } : c)) }); r(); }, 800); })}
          onConnect={(provider: CalendarProvider) => new Promise<void>((r) => { window.setTimeout(() => { const id = newId('cal'); act({ type: 'calendar/set', calendars: [...cals, { id, provider, email: me?.email ?? 'you@example.com', calendars: 2, status: 'connected', checkConflicts: true }] }); act({ type: 'subcal/set', account: id, calendars: [{ id: `${id}-main`, name: 'Calendar', conflicts: true, week: true, log: true, colour: 'blue' }, { id: `${id}-family`, name: 'Family', conflicts: true, week: false, log: false, colour: 'green' }] }); toast({ message: `${provider} connected`, tone: 'success' }); r(); }, 900); })} />}
      </SettingsSection>
      <SettingsSection title="Bookings and sharing" action={cals.length > 0 ? <Button variant="secondary" onPress={() => { const at = new Date(); act({ type: 'calendar/sync', at }); set({ lastSync: at }, undefined, 'Calendars synced'); }}>Sync now</Button> : undefined}
        description={syncedAt ? `Last synced ${when(syncedAt)}.` : 'Calendars sync every few minutes.'}>
        <div className="tf-rec__form tf-set__narrow">
          {targets.length > 0 && bookings && <Select label="Add new bookings to" items={targets} value={targets.some((t) => t.id === bookings.health.bookingCalendar) ? bookings.health.bookingCalendar : targets[0]?.id ?? null}
            onChange={(v) => { if (v) { act({ type: 'calendar/set', calendars: cals, health: { ...bookings.health, bookingCalendar: v } }); act({ type: 'calendar/fellback', fellBack: undefined }); toast({ message: 'Saved', tone: 'success' }); } }} description="Each booking page can pick another." />}
          <Select label="Teammates see" value={p.teammatesSee ?? 'busy'} onChange={(v) => v && set({ teammatesSee: v === 'full' ? 'full' : 'busy' })} items={[{ id: 'busy', label: 'Busy or free only', description: 'Your events show as Busy, with no title' }, { id: 'full', label: 'Full details', description: 'Titles, guests and places' }]} />
        </div>
      </SettingsSection>
      <SettingsSection title="Workspace" description={isAdmin ? 'For everyone in the workspace.' : 'Only owners and admins change this.'}>
        <div className="tf-set__switch"><span><strong>Add people from meetings</strong><span className="tf-rec__muted">Guests you meet who aren’t in People yet are added, for everyone</span></span>
          <Switch aria-label="Add people from meetings" isSelected={p.addFromMeetings ?? true} isDisabled={!isAdmin} onChange={(on) => set({ addFromMeetings: on }, `${state.me} turned ${on ? 'on' : 'off'} adding people from meetings`)} /></div>
      </SettingsSection>
    </>; break; }
    case 'general': body = <>
      <SettingsSection title="Workspace"><div className="tf-rec__form tf-set__narrow">
        <CommitField label="Name" value={ws.name} onCommit={(v) => set({ workspace: { ...ws, name: v } }, `${state.me} renamed the workspace to ${v}`, 'Name saved')} />
        <CommitField key={`addr-${ws.slug}-${ask?.kind === 'address' ? 'asking' : 'idle'}`} label="Web address" value={ws.slug} prefix="timefix.com/" clean={(v) => v.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}
          check={(v) => (TAKEN.includes(v) ? `timefix.com/${v} is taken. Try another.` : v.length < 3 ? 'At least 3 letters' : undefined)}
          description="Your pages live here. Old links keep working for 30 days." onCommit={(v) => setAsk({ kind: 'address', to: v })} />
        <div className="tf-bkf__pair"><Select label="Currency" value={ws.currency} onChange={(v) => v && set({ workspace: { ...ws, currency: v } })} items={[{ id: 'inr', label: 'Indian rupee (₹)' }, { id: 'usd', label: 'US dollar ($)' }, { id: 'eur', label: 'Euro (€)' }, { id: 'gbp', label: 'Pound (£)' }]} />
          <Select label="Country" value={ws.country} onChange={(v) => v && set({ workspace: { ...ws, country: v } })} items={[{ id: 'in', label: 'India' }, { id: 'gb', label: 'United Kingdom' }, { id: 'us', label: 'United States' }, { id: 'ae', label: 'United Arab Emirates' }]} /></div>
        <Select label="Time zone" value={ws.zone ?? 'ist'} onChange={(v) => v && set({ workspace: { ...ws, zone: v } }, `${state.me} set the workspace time zone`)} items={ZONES} description="For opening hours and anyone who hasn’t set their own." />
      </div></SettingsSection>
      <SettingsSection title="Form answers" description="Older answers are deleted for good, on every form."><div className="tf-rec__form tf-set__narrow">
        <Select label="Keep answers" value={ws.retention ?? 'forever'} onChange={(v) => v && set({ workspace: { ...ws, retention: v } }, `${state.me} set form answers to keep ${v === 'forever' ? 'forever' : `${v} months`}`)} items={[{ id: 'forever', label: 'Forever' }, { id: '24', label: '24 months' }, { id: '12', label: '12 months' }]} />
      </div></SettingsSection>
      <SettingsSection title="Delete workspace" tone="danger" description="Everyone loses access. You can restore it for 30 days." action={<Button variant="danger" onPress={() => setAsk({ kind: 'workspace' })}>Delete workspace</Button>}><span /></SettingsSection>
    </>; break;
    case 'brand': { const hueOf = (c: string | undefined) => (c === 'blue' ? 'blue' : c === 'ink' ? 'gray' : c === 'violet' ? 'purple' : 'green');
      const COLOURS = [{ id: 'teal', label: 'Teal', hue: 'green' as const }, { id: 'blue', label: 'Blue', hue: 'blue' as const }, { id: 'ink', label: 'Ink', hue: 'gray' as const }, { id: 'violet', label: 'Violet', hue: 'purple' as const }];
      const tpl = ws.template ?? 'classic';
      body = <>
      <SettingsSection title="Logo and colours" description="On booking pages, forms, the link page and emails.">
        <div className="tf-set__row">{ws.logo ? <img className="tf-set__logo" src={ws.logo} alt={`${ws.name} logo`} /> : <Avatar name={ws.name} size={56} shape="square" />}
          <div className="tf-set__grow"><FileDrop variant="compact" label={ws.logo ? 'Replace logo' : 'Upload logo'} description="PNG or SVG, square, up to 2 MB" acceptedFileTypes={['image/png', 'image/svg+xml', 'image/jpeg']} allowsMultiple={false}
            onFiles={(files) => { const f = files[0]; if (!f) return; if (f.size > 2_000_000) { toast({ message: `${f.name} is over 2 MB. Pick a smaller file.`, tone: 'danger' }); return; } const was = ws.logo; dispatch({ type: 'prefs/set', prefs: { workspace: { ...ws, logo: URL.createObjectURL(f) } }, note: `${state.me} changed the logo` }); toast({ message: 'Logo saved', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ workspace: { ...q.workspace, logo: was } }) }) } }); }} /></div>
          {ws.logo && <Button size="sm" variant="ghost" onPress={() => { const was = ws.logo; dispatch({ type: 'prefs/update', fn: (q) => ({ workspace: { ...q.workspace, logo: undefined } }) }); toast({ message: 'Logo removed', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ workspace: { ...q.workspace, logo: was } }) }) } }); }}>Remove</Button>}</div>
        <div className="tf-bkf__pair">
          <Select label="Colour" value={ws.colour} onChange={(v) => v && set({ workspace: { ...ws, colour: v } }, `${state.me} changed the brand colour`)} items={COLOURS} />
          <Select label="On dark pages" value={ws.colourDark ?? ws.colour} onChange={(v) => v && set({ workspace: { ...ws, colourDark: v } })} items={COLOURS} description="Night look, and guests in dark mode." />
        </div>
      </SettingsSection>
      <SettingsSection title="Look" description="How your public pages are laid out.">
        <SegmentedControl aria-label="Look" selectedKey={tpl} onSelectionChange={(k) => set({ workspace: { ...ws, template: String(k) } }, `${state.me} changed the page look`)}
          items={[{ id: 'classic', label: 'Classic' }, { id: 'studio', label: 'Studio' }, { id: 'night', label: 'Night' }, { id: 'split', label: 'Split' }]} />
        <div className="tf-set__brand" data-template={tpl} data-hue={hueOf(tpl === 'night' ? ws.colourDark ?? ws.colour : ws.colour)} aria-label="Preview">
          <div className="tf-set__brandcard">
            <div className="tf-set__brandside">{ws.logo ? <img className="tf-set__logo" src={ws.logo} alt="" /> : <Avatar name={ws.name} size={44} shape="square" />}<strong>{ws.name}</strong><span>30 min · Google Meet</span></div>
            <div className="tf-set__brandmain"><span className="tf-set__brandlabel">Thursday 12 November</span>
              <span className="tf-set__brandslots"><span>10:00</span><span data-on>10:30</span><span>11:00</span></span>
              <span className="tf-set__brandbtn">Book</span></div>
          </div>
        </div>
      </SettingsSection>
    </>; break; }
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
            <Select label="Most people" value={o.uses ?? 'any'} onChange={(v) => v && set({ inviteLinkOpts: { ...o, uses: v } })} items={[{ id: '1', label: '1 person' }, { id: '10', label: '10 people' }, { id: '50', label: '50 people' }, { id: 'any', label: 'No limit' }]} />
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
      <SettingsSection title="Teams" description="Use teams in round robins and to share views." action={<Button variant="secondary" onPress={() => { setTeamName(''); setTeamMembers([]); setTeamAccess({}); setAsk({ kind: 'team' }); }}>New team</Button>}>
        {p.teams.length === 0 ? <EmptyState size="sm" icon={<Users size={20} strokeWidth={1.75} />} title="No teams yet" description="Teams share round robins and views." /> : <ul className="tf-set__list">{p.teams.map((t) => <li key={t.id}><button type="button" className="tf-set__open" onClick={() => { setTeamName(t.name); setTeamMembers(t.members); setTeamAccess(t.access ?? {}); setAsk({ kind: 'team', id: t.id }); }}>
          <strong>{t.name}</strong><span className="tf-rec__muted">{t.members.length === 0 ? 'Nobody yet' : t.members.map((n) => n.split(' ')[0]).join(', ')}</span><ChevronRight size={16} strokeWidth={1.75} aria-hidden /></button></li>)}</ul>}</SettingsSection>
    </>; break;
    case 'roles': { const custom = p.roles ?? []; const all = [{ id: 'owner', name: 'Owner', isLocked: true }, { id: 'admin', name: 'Admin' }, { id: 'member', name: 'Member' }, { id: 'guest', name: 'Guest' }, ...custom];
      const count = (id: string) => state.members.filter((m) => ROLE_ID(m.role) === id).length;
      body = <>
      <SettingsSection title="Roles" description={`What each role can do. Up to 20 roles; ${all.length} so far.`} action={<Button variant="secondary" isDisabled={all.length >= 20} onPress={() => { setRoleName(''); setAsk({ kind: 'role' }); }}>New role</Button>}>
        <ul className="tf-set__list">{all.map((r) => <li key={r.id}><span><strong>{r.name}</strong> <span className="tf-rec__muted tf-num">{count(r.id)} {count(r.id) === 1 ? 'person' : 'people'}{(p.defaultRole ?? 'member') === r.id ? ' · new people get this' : ''}</span></span>
          <span className="tf-set__row">{r.id !== 'owner' && <Button size="sm" variant="ghost" isDisabled={all.length >= 20} onPress={() => { setRoleName(`${r.name} copy`); setAsk({ kind: 'role', from: r.id }); }}>Duplicate</Button>}
            {custom.some((c) => c.id === r.id) && <Button size="sm" variant="ghost" onPress={() => { const was = { roles: p.roles, grants: p.grants, defaultRole: p.defaultRole }; dispatch({ type: 'prefs/set', prefs: { roles: custom.filter((c) => c.id !== r.id), defaultRole: p.defaultRole === r.id ? 'member' : p.defaultRole }, note: `${state.me} deleted the role ${r.name}` }); toast({ message: `${r.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/set', prefs: was }) } }); }}>Delete</Button>}</span></li>)}</ul>
        <div className="tf-rec__form tf-set__narrow"><Select label="New people join as" value={p.defaultRole ?? 'member'} onChange={(v) => v && set({ defaultRole: v }, `${state.me} changed the default role`)} items={all.filter((r) => r.id !== 'owner').map((r) => ({ id: r.id, label: r.name }))} description="For invitations, the invite link and people let in from your domain." /></div>
      </SettingsSection>
      <RolePowers roles={all}
        areas={[{ id: 'records', title: 'Records', powers: [{ id: 'records.edit', label: 'Add and edit records (without it: read only)' }, { id: 'records.delete', label: 'Delete records' }, { id: 'records.export', label: 'Export records' }, { id: 'schema', label: 'Change objects and attributes' }] },
          { id: 'people', title: 'People', powers: [{ id: 'members', label: 'Invite and remove members' }] },
          { id: 'bookings', title: 'Scheduling', powers: [{ id: 'bookings', label: 'Make booking pages and round robins' }, { id: 'sched.see', label: 'See teammates’ calendars and hours' }, { id: 'sched.manage', label: 'Change teammates’ hours and time off' }] }]}
        grants={p.grants} onChange={(role, power, held) => set({ grants: { ...p.grants, [role]: held ? [...(p.grants[role] ?? []), power] : (p.grants[role] ?? []).filter((x) => x !== power) } }, `${state.me} changed what ${all.find((r) => r.id === role)?.name ?? role} can do`)} />
      <SettingsSection title="See it as they do" description="Look around the app as a member or a guest would. Nothing changes while you preview.">
        <div className="tf-set__row"><Button variant="secondary" onPress={() => { dispatch({ type: 'preview/set', role: 'Member' }); toast({ message: 'Previewing as a member' }); }}>Preview as a member</Button>
          <Button variant="secondary" onPress={() => { dispatch({ type: 'preview/set', role: 'Guest' }); toast({ message: 'Previewing as a guest' }); }}>Preview as a guest</Button></div>
      </SettingsSection>
      <SettingsSection title="Sign in rules" action={<Button variant="secondary" onPress={() => setAsk({ kind: 'signout-all' })}>Sign out everyone</Button>}>
        {sw('Everyone must use two factor', p.rules.require2fa, (on) => set({ rules: { ...p.rules, require2fa: on } }, `${state.me} turned required two factor ${on ? 'on' : 'off'}`, on ? 'Members without two factor set it up at their next sign in' : 'Saved'), 'Members without it set it up at their next sign in')}
        {sw('Allow Google sign in', p.rules.google, (on) => set({ rules: { ...p.rules, google: on } }, `${state.me} turned Google sign in ${on ? 'on' : 'off'}`))}
        <div className="tf-rec__form tf-set__narrow"><Select label="Stay signed in for" value={p.sessionDays ?? '30'} onChange={(v) => v && set({ sessionDays: v }, `${state.me} set sign-ins to last ${v} days`)} items={[{ id: '1', label: '1 day' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} description="Then everyone signs in again." /></div>
      </SettingsSection>
    </>; break; }
    case 'apps': body = <>
      <SettingsSection title="Business apps" description="Each adds its pages to Bookings. Turning one off hides its pages; nothing is deleted.">
        {APPS.map((a) => { const fits = (a.kinds as ReadonlyArray<string>).includes(kind); const on = p.apps[a.id]; return (
          <div key={a.id} className="tf-set__switch"><span><strong>{a.title}</strong><span className="tf-rec__muted">{!fits ? `For ${a.kinds[0] === 'salon' ? 'salons and clinics' : 'restaurants and cafés'}. Switch workspace to try it.` : on ? a.hint : `Off. ${a.uses[0]}; nothing is deleted.`}</span></span>
            {!fits ? <Tag size="sm" hue="gray">Not for this workspace</Tag>
              : <Switch aria-label={a.title} isSelected={on} onChange={(next) => { if (!next) { setAsk({ kind: 'app-off', id: a.id }); return; } const before = p.apps; dispatch({ type: 'prefs/set', prefs: { apps: { ...p.apps, [a.id]: true } }, note: `${state.me} turned ${a.title} on` });
                toast({ message: `${a.title} is on. Its pages are back in Bookings.`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/set', prefs: { apps: before } }) } }); }} />}</div>); })}
        <p className="tf-rec__muted">Only owners and admins turn apps on or off.</p>
        <div className="tf-set__switch"><span><strong>Events</strong><span className="tf-rec__muted">Ticketed classes and workshops</span></span><Tag size="sm" hue="gray">Coming soon</Tag></div>
      </SettingsSection>
      <SettingsSection title="Connected apps" description="Apps that reach your workspace from outside." action={<Button variant="secondary" onPress={() => setAsk({ kind: 'partner' })}>Connect a hub</Button>}>
        {(p.partners ?? []).length === 0 ? <EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="Nothing connected" description="When a partner hub connects, it shows here with what it can reach, and you can disconnect it." />
          : <ul className="tf-set__list">{(p.partners ?? []).map((x) => <li key={x.id}><span><strong>{x.name}</strong> <span className="tf-rec__muted">Can {x.scopes.join(', ')} · connected {x.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {x.lastCall ? `last reached ${when(x.lastCall)}` : 'not used yet'}</span></span>
            <span className="tf-set__row"><Button size="sm" variant="secondary" onPress={() => setAsk({ kind: 'partner', id: x.id })}>Change access</Button><Button size="sm" variant="ghost" onPress={() => setAsk({ kind: 'unpartner', id: x.id })}>Disconnect</Button></span></li>)}</ul>}
      </SettingsSection>
    </>; break;
    case 'history': body = <>
      <SegmentedControl aria-label="History" selectedKey={histTab} onSelectionChange={(k) => setHistTab(k === 'signins' ? 'signins' : 'changes')} items={[{ id: 'changes', label: 'Changes' }, { id: 'signins', label: 'Sign-ins' }]} />
      {histTab === 'changes' ? <SettingsSection title="Changes" description="Who changed what in the workspace, newest first.">
        <ul className="tf-set__list">{state.history.slice(0, 60).map((h) => <li key={h.id}><span>{h.text}</span><span className="tf-rec__muted tf-num">{when(h.at)}</span></li>)}</ul></SettingsSection>
        : <SettingsSection title="Sign-ins" description="Everyone in the workspace, last 90 days. Failed ones are marked.">
          <ul className="tf-set__list">{(p.signIns ?? []).map((x) => <li key={x.id}><span><strong>{x.who}</strong> <span className="tf-rec__muted">{x.what} · {x.where} · {when(x.at)}</span></span><Tag size="sm" hue={x.ok ? 'gray' : 'red'}>{x.ok ? 'Signed in' : 'Wrong code'}</Tag></li>)}</ul></SettingsSection>}
    </>; break;
    case 'jobs': body = <JobsPage state={state} dispatch={dispatch} onImport={onImport} startJob={sub || undefined} />; break;
    case 'objects': body = <ObjectsPage key={openObject ?? 'all'} state={state} dispatch={dispatch} startMaking={newObject} startOpen={openObject} />; break;
    case 'lists': body = <ListsPage state={state} dispatch={dispatch} onOpenList={onOpenList} />; break;
    case 'trash': body = <TrashPage state={state} dispatch={dispatch} onOpenRecord={onOpenRecord} onOpenTrashed={onOpenTrashed} startObject={sub || undefined} />; break;
    case 'automations': body = <AutomationsPage state={state} dispatch={dispatch} onOpenRecord={onOpenRecord} />; break;
    case 'availability': { const def = bookings?.savedHours.find((h) => h.id === bookings.defaultHoursId) ?? bookings?.savedHours[0]; const today = new Date().toISOString().slice(0, 10);
      body = summary(kind === 'team' ? 'Availability' : 'Opening hours', kind === 'team' ? 'Your weekly hours, other schedules, time off and meeting limits.' : 'When you’re open, other schedules and days off.', bookings ? [
        ['Default schedule', def ? `${def.name} · ${Object.values(def.hours).filter((d) => d.on).length} days a week` : 'None'],
        ['Other schedules', String(Math.max(0, bookings.savedHours.length - 1))],
        ['Time off ahead', String(bookings.timeOff.filter((t) => t.to >= today).length)],
        ...(kind === 'team' ? [['People with meeting limits', String(Object.values(bookings.limits ?? {}).filter((l) => l.perDay > 0 || l.perWeek > 0).length)] as const] : []),
      ] : [], 'availability', kind === 'team' ? 'Open Availability' : 'Open hours'); break; }
    case 'roundrobin': body = !bookings ? summary('Round robin', 'Groups share pages in turn.', [], 'roster', 'Open Roster')
      : <RoundRobinPage bookings={bookings} act={act} me={state.me} isAdmin={me?.role === 'Owner' || me?.role === 'Admin'} people={state.members} />; break;
    case 'routing': body = !bookings ? summary('Routing', 'A form’s answers decide which page, message or link someone gets.', [], 'routing', 'Open Routing')
      : <RoutingOverview bookings={bookings} act={act} me={state.me} isAdmin={me?.role === 'Owner' || me?.role === 'Admin'} people={state.members} onOpen={() => onBookings('routing')} />; break;
    case 'schedaccess': { const mine = bookings?.access?.[state.me] ?? 'self'; const isAdmin = me?.role === 'Owner' || me?.role === 'Admin';
      body = <>
      <SettingsSection title="Your scheduling" description="Your calendar, hours, time off and meetings.">
        <div className="tf-rec__form tf-set__narrow">
          <Select label="Who sees it" value={p.schedSee ?? 'teams'} onChange={(v) => v && set({ schedSee: v === 'everyone' ? 'everyone' : v === 'admins' ? 'admins' : 'teams' })} items={[{ id: 'everyone', label: 'Everyone in the workspace' }, { id: 'teams', label: 'People in my teams' }, { id: 'admins', label: 'Owners and admins only' }]} />
          <Select label="Who changes my hours and time off" value={mine} isDisabled={!bookings} onChange={(v) => { if (v && bookings) { act({ type: 'access/set', name: state.me, access: v === 'admins' ? 'admins' : 'self' }); toast({ message: 'Saved', tone: 'success' }); } }} items={[{ id: 'self', label: 'Me and admins' }, { id: 'admins', label: 'Admins only' }]} />
        </div>
      </SettingsSection>
      {bookings && <AccessGrants bookings={bookings} act={act} me={state.me} isAdmin={isAdmin} people={state.members} />}
      {isAdmin && bookings && <SettingsSection title="Everyone’s hours" description="Who may change each person’s hours and time off.">
        <ul className="tf-set__list">{state.members.filter((m) => m.name !== state.me && m.role !== 'Guest').map((m) => <li key={m.id}><span><strong>{m.name}</strong> <span className="tf-rec__muted">{m.role}</span></span>
          <Select label={`Who changes ${m.name}'s hours`} isLabelHidden className="tf-you__select" value={bookings.access?.[m.name] ?? 'self'} onChange={(v) => { if (v) { act({ type: 'access/set', name: m.name, access: v === 'admins' ? 'admins' : 'self' }); toast({ message: 'Saved', tone: 'success' }); } }} items={[{ id: 'self', label: 'They and admins' }, { id: 'admins', label: 'Admins only' }]} /></li>)}</ul>
      </SettingsSection>}
    </>; break; }
    case 'business': body = <BusinessScreen bookings={bookings} act={act} />; break;
    case 'services': { const list = (bookings?.pages ?? []).filter((x) => x.kind !== 'table'); const tables = (bookings?.pages ?? []).filter((x) => x.kind === 'table');
      body = kind === 'restaurant' ? summary('Table bookings', 'How guests book a table: party sizes, turn times, pacing and the late hold.', bookings ? [
        ['Booking pages', tables.map((x) => x.name).join(', ') || 'None'], ['Pacing', tables[0]?.pacing ? `${tables[0].pacing} guests per start time` : 'No cap'], ['Late hold', `${tables[0]?.holdLate ?? 15} minutes`],
      ] : [], 'pages', 'Open booking pages')
        : <ServicesScreen bookings={bookings} act={act} onGo={(to) => onGoPage?.(to)} />; void list; break; }
    case 'staff': body = <StaffScreen key={sub ?? 'staff'} bookings={bookings} act={act} startOn={sub === 'shifts' ? 'shifts' : 'staff'} onGo={(to) => onGoPage?.(to)} />; break;
    case 'tables': { const t = bookings?.tables ?? []; body = summary('Places and tables', 'Your areas and tables, and which can be booked online.', bookings ? [
        ['Areas', [...new Set(t.map((x) => x.area))].join(', ') || 'None'], ['Tables', `${t.length} · ${t.reduce((n, x) => n + x.seats, 0)} seats`], ['Online', `${t.filter((x) => x.online).length} of ${t.length}`],
      ] : [], 'availability', 'Open tables'); break; }
    case 'menu': body = summary('Menu', 'Your dishes, menus and table QR codes.', bookings?.menu ? [
        ['Menus', bookings.menu.menus.length.toString()], ['Dishes', bookings.menu.dishes.length.toString()], ['Published', bookings.menuLive ? 'Yes' : 'Not yet'],
      ] : [], 'menu', 'Open menu'); break;
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
          {ask.kind === 'account' && otherOwners === 0 && <Button variant="secondary" onPress={() => setAsk({ kind: 'transfer' })}>Make someone else owner</Button>}
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
        actions={<><Button variant="ghost" slot="close">Stay</Button>{otherOwners === 0 && me?.role === 'Owner' && <Button variant="secondary" onPress={() => setAsk({ kind: 'transfer' })}>Make someone else owner</Button>}<Button variant="danger" isDisabled={otherOwners === 0 && me?.role === 'Owner'} onPress={() => { close(); dispatch({ type: 'history/add', text: `${state.me} left ${ws.name}` }); onDoor?.('signin'); }}>Leave workspace</Button></>} />}
      {ask?.kind === 'app-off' && (() => { const a = APPS.find((x) => x.id === ask.id); if (!a) return null; return (
        <ConfirmDialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Turn off ${a.title}?`} tone="danger" confirmLabel="Turn off"
          consequence={<><span>Nothing is deleted, and turning it back on brings everything back. While it’s off:</span><ul className="tf-set__uses">{a.uses.map((u) => <li key={u}>{u}</li>)}</ul></>}
          onConfirm={() => { const before = p.apps; dispatch({ type: 'prefs/set', prefs: { apps: { ...p.apps, [a.id]: false } }, note: `${state.me} turned ${a.title} off` }); close();
            toast({ message: `${a.title} is off`, action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/set', prefs: { apps: before } }) } }); }} />); })()}
      {ask?.kind === 'partner' && (() => { const was = ask.id ? (p.partners ?? []).find((x) => x.id === ask.id) : undefined; return <PartnerDialog initial={was} onClose={close} onConnect={(name, scopes) => { close();
        if (was) { const before = p.partners; dispatch({ type: 'prefs/set', prefs: { partners: (p.partners ?? []).map((x) => (x.id === was.id ? { ...x, scopes } : x)) }, note: `${state.me} changed what ${was.name} can reach` }); toast({ message: `${was.name} updated`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/set', prefs: { partners: before } }) } }); }
        else set({ partners: [...(p.partners ?? []), { id: newId('pt'), name, scopes, at: new Date() }] }, `${state.me} connected ${name}`, `${name} is connected`); }} />; })()}
      {ask?.kind === 'address' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Move to timefix.com/${ask.to}?`}
        description={`Your link page, booking pages, forms and menu move there. Links to timefix.com/${ws.slug} keep working for 30 days, then stop.`}
        actions={<><Button variant="ghost" slot="close">Keep timefix.com/{ws.slug}</Button><Button variant="primary" onPress={() => { const to = ask.to; const from = ws.slug; close(); dispatch({ type: 'prefs/set', prefs: { workspace: { ...ws, slug: to } }, note: `${state.me} changed the address to timefix.com/${to}` }); toast({ message: `Pages now at timefix.com/${to}`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ workspace: { ...q.workspace, slug: from } }) }) } }); }}>Change address</Button></>} />}
      {ask?.kind === 'codes' && (() => { const fresh = freshCodes.length ? freshCodes : CODES; return <Dialog isOpen isDismissable={false} showClose={false} onOpenChange={() => undefined} title="New backup codes" description="Your old codes stop working now. Save these somewhere safe; each works once."
        actions={<><Button variant="secondary" onPress={() => { void saveFile('timefix-backup-codes.txt', new Blob([fresh.join('\n')], { type: 'text/plain' })).then((o) => { if (o === 'saved') toast({ message: 'Codes downloaded', tone: 'success' }); }); }}>Download</Button>
          <Button variant="secondary" onPress={() => { void copy(fresh.join('\n')).then((ok) => toast({ message: ok ? 'Codes copied' : 'Copy didn’t work. Download them instead.', tone: ok ? 'success' : 'danger' })); }}>Copy</Button>
          <Button variant="primary" onPress={() => { setFreshCodes([]); close(); set({ backupLeft: 6 }, `${state.me} made new backup codes`, 'New codes are on'); }}>I’ve saved these</Button></>}>
        <ul className="tf-set__codes tf-num">{fresh.map((c) => <li key={c}>{c}</li>)}</ul></Dialog>; })()}
      {ask?.kind === 'signout-all' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title="Sign out everyone?" description={`Everyone in ${ws.name}, you included on other devices, signs in again. Use it if a laptop goes missing.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { close(); set({ devices: p.devices.filter((d) => d.current) }, `${state.me} signed everyone out`, 'Everyone else is signed out'); }}>Sign out everyone</Button></>} />}
      {ask?.kind === 'role' && (() => { const roles = [{ id: 'admin', name: 'Admin' }, { id: 'member', name: 'Member' }, { id: 'guest', name: 'Guest' }, ...(p.roles ?? [])]; const from = ask.from ?? 'member'; const clash = [...roles, { id: 'owner', name: 'Owner' }].some((r) => r.name.toLowerCase() === roleName.trim().toLowerCase()); return (
        <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={ask.from ? 'Duplicate role' : 'New role'} description="It starts with the same powers; change them in the table below."
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!roleName.trim() || clash} onPress={() => { const id = newId('role'); const name = roleName.trim(); close();
            dispatch({ type: 'prefs/set', prefs: { roles: [...(p.roles ?? []), { id, name }], grants: { ...p.grants, [id]: p.grants[from] ?? [] } }, note: `${state.me} made the role ${name}` }); toast({ message: `${name} made`, tone: 'success' }); }}>Create role</Button></>}>
          <div className="tf-rec__form"><TextField label="Name" value={roleName} onChange={setRoleName} autoFocus placeholder="Sales lead" isInvalid={clash} errorMessage={clash ? 'A role has this name' : undefined} />
            {!ask.from && <Select label="Start from" value={from} onChange={(v) => v && setAsk({ kind: 'role', from: v })} items={roles.map((r) => ({ id: r.id, label: r.name }))} />}</div>
        </Dialog>); })()}
      {ask?.kind === 'cal-off' && (() => { const c = cals.find((x) => x.id === ask.id); if (!c) return null; return (
        <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Disconnect ${c.email}?`} description="Busy times there stop counting, so guests could book over them. Meetings already booked stay."
          actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" onPress={() => { close(); act({ type: 'calendar/set', calendars: cals.filter((x) => x.id !== c.id) }); toast({ message: `${c.provider} disconnected` }); }}>Disconnect</Button></>} />); })()}
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
      {ask?.kind === 'signout' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title="Sign out?" description={`You can sign back in to ${ws.name} with your email.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { close(); onDoor?.('signin'); }}>Sign out</Button></>} />}
      {removing && owns && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={`Remove ${removing.name}?`}
        description={`They lose access straight away. They own ${owns.people} ${owns.people === 1 ? 'person' : 'people'} and ${owns.deals} ${owns.deals === 1 ? 'deal' : 'deals'}, and have ${owns.tasks} open ${owns.tasks === 1 ? 'task' : 'tasks'}.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="danger" onPress={() => { dispatch({ type: 'member/remove', id: removing.id, reassignTo: reassign }); close(); toast({ message: `${removing.name} removed. Their records went to ${reassign.split(' ')[0]}.` }); }}>Remove member</Button></>}>
        <Select label="Give their records and tasks to" value={reassign} onChange={(v) => { if (v) setReassign(v); }} items={state.members.filter((m) => m.id !== removing.id && m.role !== 'Guest').map((m) => ({ id: m.name, label: m.name === state.me ? `${m.name} (you)` : m.name }))} /></Dialog>}
      {ask?.kind === 'team' && <Dialog isOpen onOpenChange={(o) => { if (!o) close(); }} title={team ? `Edit ${team.name}` : 'New team'}
        actions={<>{team && <Button variant="ghost" onPress={() => { const before = p.teams; close(); dispatch({ type: 'prefs/set', prefs: { teams: p.teams.filter((t) => t.id !== team.id) }, note: `${state.me} deleted the team ${team.name}` }); toast({ message: `${team.name} deleted`, action: { label: 'Undo', onAction: () => dispatch({ type: 'prefs/update', fn: (q) => ({ teams: [...q.teams.slice(0, before.findIndex((t) => t.id === team.id)), team, ...q.teams.slice(before.findIndex((t) => t.id === team.id))] }) }) } }); }}>Delete team</Button>}
          <Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!teamName.trim() || p.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === teamName.trim().toLowerCase())} onPress={() => {
            const next = { id: team?.id ?? newId('tm'), name: teamName.trim(), members: teamMembers, access: teamAccess }; close();
            set({ teams: team ? p.teams.map((t) => (t.id === team.id ? next : t)) : [...p.teams, next] }, team ? undefined : `${state.me} made the team ${next.name}`, team ? 'Team saved' : `${next.name} made`); }}>{team ? 'Save' : 'Create team'}</Button></>}>
        <div className="tf-rec__form"><TextField label="Name" value={teamName} onChange={setTeamName} placeholder="Sales" autoFocus errorMessage={p.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === teamName.trim().toLowerCase()) ? 'A team has this name' : undefined} isInvalid={p.teams.some((t) => t.id !== team?.id && t.name.toLowerCase() === teamName.trim().toLowerCase())} />
          <fieldset className="tf-set__check"><legend>Who's in it</legend>{state.members.map((m) => <Checkbox key={m.id} isSelected={teamMembers.includes(m.name)} onChange={(on) => setTeamMembers(on ? [...teamMembers, m.name] : teamMembers.filter((n) => n !== m.name))}>{m.name}</Checkbox>)}</fieldset>
          <fieldset className="tf-set__check"><legend>Records they see</legend>{state.objects.filter((o) => !o.archived).map((o) => <Select key={o.id} label={o.many} value={teamAccess[o.id] ?? 'all'} onChange={(v) => v && setTeamAccess({ ...teamAccess, [o.id]: v === 'own' ? 'own' : v === 'team' ? 'team' : 'all' })} items={[{ id: 'all', label: 'All of them' }, { id: 'team', label: 'The team’s' }, { id: 'own', label: 'Their own' }]} />)}</fieldset></div>
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

/** A text field that saves once, when you leave the field or press Enter, and only when the value really changed and isn't empty. */
function CommitField({ label, value, onCommit, description, prefix, clean = (v) => v.trim(), check }: { readonly label: string; readonly value: string; readonly onCommit: (v: string) => void; readonly description?: string; readonly prefix?: string; readonly clean?: (v: string) => string; /** Why a value can't be used, or undefined. */ readonly check?: (v: string) => string | undefined }) {
  const [v, setV] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) { setWas(value); setV(value); }
  const problem = !clean(v) ? `${label} can't be empty` : clean(v) !== value ? check?.(clean(v)) : undefined;
  const commit = () => { const next = clean(v); if (!next) { setV(value); return; } if (next !== value && check?.(next)) return; if (next !== value) onCommit(next); else setV(value); };
  return <TextField label={label} value={v} onChange={setV} description={description} icon={prefix ? <span className="tf-bkf__prefix">{prefix}</span> : undefined}
    onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setV(value); }} isInvalid={Boolean(problem)} errorMessage={problem} />;
}


/** New object: its name, one and many. The same dialog from Settings › Objects and the sidebar's Records +. */
export function NewObjectDialog({ onClose, onCreate }: { readonly onClose: () => void; readonly onCreate: (object: ObjectSchema) => void }) {
  const [one, setOne] = useState('');
  const [many, setMany] = useState('');
  return (
    <Dialog isOpen onOpenChange={(v) => { if (!v) onClose(); }} title="New object" description="Like Projects or Vendors."
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!one.trim() || !many.trim()} onPress={() => {
        onCreate({ id: newId('obj'), one: one.trim(), many: many.trim(), custom: true, attributes: [{ id: 'name', name: 'Name', type: 'text', isSystem: true, isRequired: true }, { id: 'created', name: 'Created at', type: 'timestamp', isSystem: true, readOnlyReason: 'Set by the system' }] });
      }}>Create object</Button></>}>
      <div className="tf-bkf__pair">
        <TextField label="One" value={one} onChange={(v) => { setOne(v); if (!many || many === `${one}s`) setMany(v ? `${v}s` : ''); }} placeholder="Project" autoFocus />
        <TextField label="Many" value={many} onChange={setMany} placeholder="Projects" />
      </div>
    </Dialog>
  );
}

/** Settings › Objects: the list, one object's attributes (add, edit, reorder, archive), and New object. */
function ObjectsPage({ state, dispatch, startMaking = false, startOpen }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly startMaking?: boolean; readonly startOpen?: string }) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | undefined>(startOpen);
  const [making, setMaking] = useState(startMaking);
  const counts: Readonly<Record<string, number>> = { people: state.people.length, companies: state.companies.length, deals: state.deals.length };
  const o = state.objects.find((x) => x.id === openId);
  /** One change to this object, with Undo. */
  const save = (patch: Partial<ObjectSchema>, message = 'Saved') => { if (!o) return; dispatch({ type: 'object/set', object: { ...o, ...patch } }); toast({ message, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'object/set', object: o }) } }); };
  if (o) {
    return (
      <div className="tf-set__obj">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={14} strokeWidth={1.75} />} onPress={() => setOpenId(undefined)}>Objects</Button>
        <Tabs aria-label={o.many} items={[{ id: 'attributes', label: 'Attributes', count: o.attributes.filter((a) => !a.archived).length }, { id: 'config', label: 'Configuration' }, { id: 'access', label: 'Access' }]}>
          <TabPanel id="attributes"><ObjectAttributes state={state} dispatch={dispatch} o={o} /></TabPanel>
          <TabPanel id="config"><ObjectConfig o={o} save={save} /><StageRules o={o} save={save} /></TabPanel>
          <TabPanel id="access"><SettingsSection title="Who can do what" description={`For ${o.many.toLowerCase()} only. Owners can always edit.`}>
            <ul className="tf-set__list">{[['admin', 'Admin'], ['member', 'Member'], ['guest', 'Guest'], ...(state.prefs.roles ?? []).map((r) => [r.id, r.name])].map(([id, name]) => <li key={id}><strong>{name}</strong>
              <Select label={`${name} on ${o.many}`} isLabelHidden className="tf-you__select" value={o.access?.[id ?? ''] ?? (id === 'guest' ? 'view' : 'edit')} onChange={(v) => v && save({ access: { ...(o.access ?? {}), [id ?? '']: v === 'none' ? 'none' : v === 'view' ? 'view' : 'edit' } }, `${name} access saved`)}
                items={[{ id: 'edit', label: 'See and edit' }, { id: 'view', label: 'See only' }, { id: 'none', label: 'No access' }]} /></li>)}</ul>
          </SettingsSection></TabPanel>
        </Tabs>
      </div>
    );
  }
  return (
    <>
      <ObjectsList state={state} dispatch={dispatch} onOpen={setOpenId} onNew={() => setMaking(true)} />
      {making && <NewObjectDialog onClose={() => setMaking(false)} onCreate={(obj) => { dispatch({ type: 'object/set', object: obj }); setMaking(false); setOpenId(obj.id); toast({ message: `${obj.many} made. Add its attributes next.`, tone: 'success' }); }} />}
    </>
  );
}

/** An object's names, the name the API uses, its colour, what names a record, and (for your own objects) archive. */
function ObjectConfig({ o, save }: { readonly o: ObjectSchema; readonly save: (patch: Partial<ObjectSchema>, message?: string) => void }) {
  const api = o.apiName ?? o.many.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const texts = o.attributes.filter((a) => a.id === 'name' || ['text', 'email', 'url', 'phone'].includes(a.type));
  return (
    <>
      <SettingsSection title="Names"><div className="tf-rec__form tf-set__narrow">
        <div className="tf-bkf__pair"><CommitField label="One" value={o.one} onCommit={(v) => save({ one: v }, 'Name saved')} /><CommitField label="Many" value={o.many} onCommit={(v) => save({ many: v }, 'Name saved')} /></div>
        <CommitField label="API name" value={api} clean={(v) => v.toLowerCase().replace(/[^a-z0-9_]/g, '_')} description={o.custom ? 'Scripts use this. Changing it breaks scripts that use the old one.' : 'Built in, so it stays.'} onCommit={(v) => { if (o.custom) save({ apiName: v }, 'API name saved'); }} />
        <div className="tf-bkf__pair">
          <Select label="Colour" value={o.colour ?? 'blue'} onChange={(v) => v && save({ colour: v })} items={[{ id: 'blue', label: 'Blue', hue: 'blue' }, { id: 'green', label: 'Green', hue: 'green' }, { id: 'purple', label: 'Purple', hue: 'purple' }, { id: 'orange', label: 'Orange', hue: 'orange' }, { id: 'gray', label: 'Gray', hue: 'gray' }]} />
          <Select label="A record is named by" value={o.recordName ?? 'name'} onChange={(v) => v && save({ recordName: v })} items={texts.map((a) => ({ id: a.id, label: a.name }))} />
        </div>
      </div></SettingsSection>
      {o.custom && <SettingsSection title={o.archived ? 'Archived' : 'Archive'} description={o.archived ? `${o.many} are out of the sidebar. Their records are kept.` : `Takes ${o.many} out of the sidebar. Records are kept and it can come back.`}
        action={<Button variant="secondary" onPress={() => save({ archived: !o.archived }, o.archived ? `${o.many} are back` : `${o.many} archived`)}>{o.archived ? 'Bring back' : 'Archive'}</Button>}><span /></SettingsSection>}
    </>
  );
}

/** Settings › Lists: every list, archived ones too. Open, rename, archive or restore, delete (with Undo). */
function ListsPage({ state, dispatch, onOpenList }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onOpenList?: (id: string) => void }) {
  const { toast } = useToast();
  const [renaming, setRenaming] = useState<string>();
  const [tuning, setTuning] = useState<string>();
  const word = (o: string) => (o === 'people' ? 'People' : o === 'companies' ? 'Companies' : 'Deals');
  const row = (l: AppState['lists'][number]) => (
    <li key={l.id}><span><strong>{l.name}</strong> <span className="tf-rec__muted tf-num">{word(l.object)} · {l.entries.length} {l.entries.length === 1 ? 'entry' : 'entries'} · {l.stages.length} {l.stages.length === 1 ? 'stage' : 'stages'}{l.oncePerRecord ? ' · each record once' : ''}</span></span>
      <span className="tf-set__row">
        {!l.archived && <Button size="sm" variant="secondary" onPress={() => onOpenList?.(l.id)}>Open</Button>}
        <Button size="sm" variant="ghost" onPress={() => setTuning(l.id)}>Settings</Button>
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
      {(() => { const l = state.lists.find((x) => x.id === tuning); return l ? <ListSettings list={l} onClose={() => setTuning(undefined)} onSave={(next) => { dispatch({ type: 'list/set', list: next }); setTuning(undefined); toast({ message: 'List saved', tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'list/set', list: l }) } }); }} /> : null; })()}
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
function PartnerDialog({ onClose, onConnect, initial }: { readonly onClose: () => void; readonly onConnect: (name: string, scopes: ReadonlyArray<string>) => void; /** Changing an app already connected: only what it can reach. */ readonly initial?: { readonly name: string; readonly scopes: ReadonlyArray<string> } }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial ? 'CONNECTED' : '');
  const [scopes, setScopes] = useState<ReadonlyArray<string>>(initial?.scopes ?? ['show booking pages']);
  const ALL = ['show booking pages', 'show forms', 'read people', 'add people'];
  return (
    <Dialog isOpen onOpenChange={(o) => { if (!o) onClose(); }} title={initial ? `What ${initial.name} can reach` : 'Connect a partner hub'} description={initial ? 'It loses anything you untick straight away.' : 'The hub gives you a code. It can only reach what you tick, and you can disconnect it any time.'}
      actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!name.trim() || code.replace(/\W/g, '').length < 6 || scopes.length === 0} onPress={() => onConnect(name.trim(), scopes)}>{initial ? 'Save' : 'Connect'}</Button></>}>
      <div className="tf-rec__form">
        {!initial && <TextField label="Hub name" value={name} onChange={setName} placeholder="Acme marketing hub" autoFocus />}
        {!initial && <TextField label="Connection code" value={code} onChange={setCode} placeholder="ABC-123" description="Prototype: any six letters or digits" />}
        <fieldset className="tf-set__check"><legend>It can</legend>{ALL.map((x) => <Checkbox key={x} isSelected={scopes.includes(x)} onChange={(on) => setScopes(on ? [...scopes, x] : scopes.filter((y) => y !== x))}>{x[0]?.toUpperCase() + x.slice(1)}</Checkbox>)}</fieldset>
      </div>
    </Dialog>
  );
}
