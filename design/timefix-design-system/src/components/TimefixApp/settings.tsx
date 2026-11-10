// Settings, one tree (app-ia.md): Account, Workspace, Data, Bookings, Developer, with "Find a setting". Everyday Bookings pages stay in
// Bookings; their settings here link there. Ending actions (delete account, delete workspace, remove member) ask first in a dialog.
import { useState, type ReactNode } from 'react';
import { AppWindow, Bell, Building2, CalendarDays, Code2, Database, History, KeyRound, ListChecks, Shield, SlidersHorizontal, Trash2, User, Users, Workflow } from 'lucide-react';
import { SettingsLayout, SettingsNav, SettingsSection, type SettingsNavGroup } from '../SettingsLayout/SettingsLayout.tsx';
import { TeamList } from '../TeamList/TeamList.tsx';
import { InviteRows } from '../InviteRows/InviteRows.tsx';
import { RolePowers } from '../RolePowers/RolePowers.tsx';
import { CalendarConnections, type CalendarAccount } from '../CalendarConnections/CalendarConnections.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { TextField } from '../Field/Field.tsx';
import { Select } from '../Select/Select.tsx';
import { Switch } from '../Checkbox/Checkbox.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { Avatar } from '../Avatar/Avatar.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { QrCode } from '../QrCode/QrCode.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { useToast } from '../Toast/Toast.tsx';
import { AttributeSettings } from '../AttributeSettings/AttributeSettings.tsx';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { newId, type AppAction, type AppState, type ObjectSchema } from './data.ts';

const i16 = { size: 16, strokeWidth: 1.75 } as const;
type Page = 'profile' | 'preferences' | 'notifications' | 'security' | 'calendars' | 'general' | 'members' | 'roles' | 'apps' | 'history' | 'objects' | 'lists' | 'trash' | 'bookings' | 'developer';
const GROUPS: ReadonlyArray<SettingsNavGroup & { readonly items: ReadonlyArray<{ readonly id: Page; readonly label: string; readonly icon: ReactNode; readonly words?: string }> }> = [
  { title: 'Account', items: [{ id: 'profile', label: 'Profile', icon: <User {...i16} />, words: 'name photo delete account' }, { id: 'preferences', label: 'Preferences', icon: <SlidersHorizontal {...i16} />, words: 'theme dark time zone date week start page home' },
    { id: 'notifications', label: 'Notifications', icon: <Bell {...i16} />, words: 'email digest mentions' }, { id: 'security', label: 'Sign in and security', icon: <Shield {...i16} />, words: 'two factor 2fa devices sessions' }, { id: 'calendars', label: 'Calendars', icon: <CalendarDays {...i16} />, words: 'google outlook icloud connect' }] },
  { title: 'Workspace', items: [{ id: 'general', label: 'General', icon: <Building2 {...i16} />, words: 'name address brand logo colour currency delete workspace' }, { id: 'members', label: 'Members and teams', icon: <Users {...i16} />, words: 'invite people roles teams domain' },
    { id: 'roles', label: 'Roles and access', icon: <KeyRound {...i16} />, words: 'permissions sign in rules require two factor' }, { id: 'apps', label: 'Apps and connections', icon: <AppWindow {...i16} />, words: 'menu table seating appointments connected' }, { id: 'history', label: 'History', icon: <History {...i16} />, words: 'audit changes sign-ins' }] },
  { title: 'Data', items: [{ id: 'objects', label: 'Objects', icon: <Database {...i16} />, words: 'attributes fields people companies deals custom' }, { id: 'lists', label: 'Lists', icon: <ListChecks {...i16} /> }, { id: 'trash', label: 'Trash', icon: <Trash2 {...i16} />, words: 'deleted restore' }] },
  { title: 'More', items: [{ id: 'bookings', label: 'Bookings', icon: <CalendarDays {...i16} />, words: 'round robin scheduling access business places services staff' }, { id: 'developer', label: 'Developer', icon: <Code2 {...i16} />, words: 'api keys webhooks automations' }] },
];

/** Props for SettingsScreen. */
export interface SettingsScreenProps { readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onBookings: (tab: string) => void; /** The page it opens on. */ readonly start?: string }

/** Settings. */
export function SettingsScreen({ state, dispatch, onBookings, start }: SettingsScreenProps) {
  const [page, setPage] = useState<Page>((start as Page | undefined) ?? 'profile');
  const [find, setFind] = useState('');
  const q = find.trim().toLowerCase();
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((x) => !q || `${x.label} ${x.words ?? ''}`.toLowerCase().includes(q)) })).filter((g) => g.items.length > 0);
  const item = GROUPS.flatMap((g) => g.items).find((x) => x.id === page);
  return (
    <div className="tf-set">
      <SettingsLayout title={item?.label ?? 'Settings'} nav={<div className="tf-set__nav"><SearchField label="Find a setting" placeholder="Find a setting" size="sm" value={find} onChange={setFind} />
        {groups.length === 0 ? <p className="tf-rec__muted">No setting matches “{find}”.</p> : <SettingsNav groups={groups} current={page} onNavigate={(id) => setPage(id as Page)} />}</div>}>
        <Body page={page} state={state} dispatch={dispatch} onBookings={onBookings} />
      </SettingsLayout>
    </div>
  );
}

function Body({ page, state, dispatch, onBookings }: { readonly page: Page; readonly state: AppState; readonly dispatch: (a: AppAction) => void; readonly onBookings: (tab: string) => void }) {
  const { toast } = useToast();
  const saved = () => toast({ message: 'Saved', tone: 'success' });
  const [confirm, setConfirm] = useState<'account' | 'workspace'>();
  const [typed, setTyped] = useState('');
  const [twofa, setTwofa] = useState<'off' | 'setup' | 'codes' | 'on'>('off');
  const [inviting, setInviting] = useState(false);
  const [apps, setApps] = useState({ menu: true, seating: true, appointments: true });
  const [cals, setCals] = useState<ReadonlyArray<CalendarAccount>>([{ id: 'g', provider: 'Google', email: 'priya@northwind.com', calendars: 3, status: 'connected', checkConflicts: true }]);
  const [grants, setGrants] = useState<Readonly<Record<string, ReadonlyArray<string>>>>({ owner: ['records.edit', 'schema', 'members', 'billing', 'bookings'], admin: ['records.edit', 'schema', 'members', 'bookings'], member: ['records.edit', 'bookings'], guest: [] });
  const me = state.members.find((m) => m.name === state.me);
  const sw = (label: string, on = true, hint?: string) => <SwitchRow key={label} label={label} hint={hint} on={on} onSave={saved} />;
  let body: ReactNode;
  switch (page) {
    case 'profile': body = <>
      <SettingsSection title="You"><div className="tf-set__row"><Avatar name={state.me} size={56} /><div className="tf-rec__form tf-set__grow"><TextField label="Name" defaultValue={state.me} onBlur={saved} /><TextField label="Email" value={me?.email ?? ''} isReadOnly description="You sign in with this." /></div></div>
        {sw('Show my photo on my booking and link pages')}</SettingsSection>
      <SettingsSection title="Delete account" tone="danger" description="Your workspaces stay with their other owners. You can't undo this." action={<Button variant="danger" onPress={() => { setTyped(''); setConfirm('account'); }}>Delete account</Button>}><span /></SettingsSection>
    </>; break;
    case 'preferences': body = <SettingsSection title="How the app looks and opens">
      <div className="tf-rec__form tf-set__narrow">
        <Select label="Theme" defaultValue="system" onChange={saved} items={[{ id: 'system', label: 'Match my device' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />
        <Select label="Time zone" defaultValue="ist" onChange={saved} items={[{ id: 'ist', label: 'India Standard Time (GMT+5:30)' }, { id: 'gmt', label: 'London (GMT+0)' }, { id: 'pst', label: 'Pacific Time (GMT−8)' }]} />
        <Select label="Date format" defaultValue="dmy" onChange={saved} items={[{ id: 'dmy', label: '10 Nov 2026' }, { id: 'mdy', label: 'Nov 10, 2026' }, { id: 'iso', label: '2026-11-10' }]} />
        <Select label="Week starts on" defaultValue="mon" onChange={saved} items={[{ id: 'mon', label: 'Monday' }, { id: 'sun', label: 'Sunday' }]} />
        <Select label="Open the app on" defaultValue="home" onChange={saved} items={[{ id: 'home', label: 'Home' }, { id: 'inbox', label: 'Inbox' }, { id: 'meetings', label: 'Meetings' }, { id: 'people', label: 'People' }]} />
        {sw('Show the setup checklist on Home', !state.setupHidden)}
      </div></SettingsSection>; break;
    case 'notifications': body = <SettingsSection title="Email me when" description="The Inbox always gets everything; these are emails.">
      {sw('Someone mentions me')}{sw('Someone gives me a task')}{sw('A guest books, moves or cancels')}{sw('A form gets a response', false)}{sw('A daily summary at 8 AM', true, 'Your meetings and tasks for the day')}</SettingsSection>; break;
    case 'security': body = <>
      <SettingsSection title="Two factor" status={<Tag size="sm" hue={twofa === 'on' ? 'green' : 'gray'}>{twofa === 'on' ? 'On' : 'Off'}</Tag>} description="A code from an authenticator app each time you sign in on a new device."
        action={twofa === 'on' ? <Button variant="secondary" onPress={() => { setTwofa('off'); toast({ message: 'Two factor is off' }); }}>Turn off</Button> : <Button variant="primary" onPress={() => setTwofa('setup')}>Set up</Button>}><span /></SettingsSection>
      <SettingsSection title="Where you're signed in" action={<Button variant="secondary" onPress={() => toast({ message: 'Signed out of 2 other devices', tone: 'success' })}>Sign out of other devices</Button>}>
        <ul className="tf-set__list">{[['MacBook Pro · Chrome', 'Mumbai · this device'], ['iPhone · Safari', 'Mumbai · 2h ago'], ['Windows · Edge', 'Pune · 3d ago']].map(([a, b]) => <li key={a}><strong>{a}</strong><span className="tf-rec__muted">{b}</span></li>)}</ul>
      </SettingsSection>
    </>; break;
    case 'calendars': body = <SettingsSection title="Connected calendars" description="We check them so nobody books over busy time, and add bookings to the one you choose.">
      <CalendarConnections accounts={cals} onCheckConflicts={(id, on) => setCals(cals.map((c) => (c.id === id ? { ...c, checkConflicts: on } : c)))}
        onReconnect={() => Promise.resolve()} onConnect={(provider) => new Promise<void>((resolve) => { window.setTimeout(() => { setCals([...cals, { id: provider, provider, email: `priya@${provider === 'Outlook' ? 'outlook.com' : 'icloud.com'}`, calendars: 1, status: 'connected', checkConflicts: true }]); toast({ message: `${provider} connected`, tone: 'success' }); resolve(); }, 800); })} />
    </SettingsSection>; break;
    case 'general': body = <>
      <SettingsSection title="Workspace"><div className="tf-rec__form tf-set__narrow">
        <TextField label="Name" defaultValue="Northwind" onBlur={saved} />
        <TextField label="Address" defaultValue="northwind" icon={<span className="tf-bkf__prefix">timefix.com/w/</span>} onBlur={saved} description="Old links redirect for 30 days." />
        <div className="tf-bkf__pair"><Select label="Currency" defaultValue="inr" onChange={saved} items={[{ id: 'inr', label: 'Indian rupee (₹)' }, { id: 'usd', label: 'US dollar ($)' }, { id: 'eur', label: 'Euro (€)' }]} />
          <Select label="Country" defaultValue="in" onChange={saved} items={[{ id: 'in', label: 'India' }, { id: 'gb', label: 'United Kingdom' }, { id: 'us', label: 'United States' }]} /></div>
      </div></SettingsSection>
      <SettingsSection title="Brand" description="Your logo and colour on booking pages, forms, the link page and emails.">
        <div className="tf-set__row"><Avatar name="Northwind" size={56} shape="square" /><Button variant="secondary" onPress={() => toast({ message: 'Pick a logo file (PNG or SVG, square)' })}>Upload logo</Button>
          <Select label="Colour" isLabelHidden className="tf-you__select" defaultValue="teal" onChange={saved} items={[{ id: 'teal', label: 'Teal' }, { id: 'blue', label: 'Blue' }, { id: 'ink', label: 'Ink' }, { id: 'violet', label: 'Violet' }]} /></div>
      </SettingsSection>
      <SettingsSection title="Delete workspace" tone="danger" description="Everyone loses access. You can restore it for 30 days." action={<Button variant="danger" onPress={() => { setTyped(''); setConfirm('workspace'); }}>Delete workspace</Button>}><span /></SettingsSection>
    </>; break;
    case 'members': body = <>
      <TeamList workspace="Northwind" now={new Date()} members={[...state.members.map((m, n) => ({ id: m.id, name: m.name, email: m.email, role: m.role.toLowerCase(), status: 'active' as const, seen: new Date(Date.now() - n * 3_600_000 * 5), isYou: m.name === state.me })),
        { id: 'inv', name: 'Rahul Verma', email: 'rahul@northwind.com', role: 'member', status: 'invited' as const, seen: new Date(Date.now() - 86_400_000) }]}
        onRoleChange={() => saved()} onResend={() => toast({ message: 'Invitation sent again', tone: 'success' })} onRemove={(id) => toast({ message: `${state.members.find((m) => m.id === id)?.name ?? 'Member'} removed. Their pages pause until someone takes them.` })}
        action={<Button variant="primary" onPress={() => setInviting(true)}>Invite people</Button>} />
      <SettingsSection title="Ways in" description="Besides invitations.">{sw('Anyone with the invite link can join as a member', false)}{sw('People with an @northwind.com email can ask to join', true, 'An owner or admin approves each request')}</SettingsSection>
      <SettingsSection title="Teams" action={<Button variant="secondary" onPress={() => toast({ message: 'New team' })}>New team</Button>}>
        <ul className="tf-set__list">{[['Sales', 'Priya, Sam, Jo'], ['Customer success', 'Ava']].map(([a, b]) => <li key={a}><strong>{a}</strong><span className="tf-rec__muted">{b}</span></li>)}</ul></SettingsSection>
    </>; break;
    case 'roles': body = <>
      <RolePowers roles={[{ id: 'owner', name: 'Owner', isLocked: true }, { id: 'admin', name: 'Admin' }, { id: 'member', name: 'Member' }, { id: 'guest', name: 'Guest' }]}
        areas={[{ id: 'records', title: 'Records', powers: [{ id: 'records.edit', label: 'Add and edit records' }, { id: 'schema', label: 'Change objects and attributes' }] },
          { id: 'people', title: 'People', powers: [{ id: 'members', label: 'Invite and remove members' }, { id: 'billing', label: 'Plans and billing' }] }, { id: 'bookings', title: 'Bookings', powers: [{ id: 'bookings', label: 'Make booking pages and round robins' }] }]}
        grants={grants} onChange={(role, power, held) => { setGrants({ ...grants, [role]: held ? [...(grants[role] ?? []), power] : (grants[role] ?? []).filter((x) => x !== power) }); saved(); }} />
      <SettingsSection title="Sign in rules">{sw('Everyone must use two factor', false, 'Members without it are asked to set it up first')}{sw('Allow Google sign in')}</SettingsSection>
    </>; break;
    case 'apps': body = <>
      <SettingsSection title="Business apps" description="Turn on what your business uses; each adds its pages to Bookings.">
        {(['menu', 'seating', 'appointments'] as const).map((k) => <div key={k} className="tf-set__switch"><span><strong>{k === 'menu' ? 'Menu and QR codes' : k === 'seating' ? 'Table seating' : 'Appointments'}</strong><span className="tf-rec__muted">{k === 'menu' ? 'A menu at your link, a code on every table' : k === 'seating' ? 'Reservations, tables and a waitlist' : 'Services with prices, booked with your staff'}</span></span>
          <Switch aria-label={k} isSelected={apps[k]} onChange={(on) => { const before = apps; setApps({ ...apps, [k]: on }); toast({ message: on ? 'Turned on' : 'Turned off. Its pages are hidden, nothing is deleted.', action: { label: 'Undo', onAction: () => setApps(before) } }); }} /></div>)}
        <div className="tf-set__switch"><span><strong>Events</strong><span className="tf-rec__muted">Ticketed classes and workshops</span></span><Tag size="sm" hue="gray">Coming soon</Tag></div>
      </SettingsSection>
      <SettingsSection title="Connected apps" description="Apps that reach your workspace from outside."><EmptyState size="sm" icon={<Workflow size={20} strokeWidth={1.75} />} title="Nothing connected" description="When a partner hub connects, it shows here with what it can reach." /></SettingsSection>
    </>; break;
    case 'history': body = <SettingsSection title="Changes" description="Who changed what in the workspace, newest first.">
      <ul className="tf-set__list">{[['Sam Kim changed Jo Mendes to Admin', '2h ago'], ['Priya Raman turned on Table seating', 'Yesterday'], ['Ava Chen added the attribute Lead source to People', '3 Nov'], ['Priya Raman invited Rahul Verma', '1 Nov']].map(([a, b]) => <li key={a}><span>{a}</span><span className="tf-rec__muted">{b}</span></li>)}</ul></SettingsSection>; break;
    case 'objects': body = <ObjectsPage state={state} dispatch={dispatch} />; break;
    case 'lists': body = <SettingsSection title="Lists"><ul className="tf-set__list">{state.lists.map((l) => <li key={l.id}><strong>{l.name}</strong><span className="tf-rec__muted tf-num">{l.entries.length} entries · {l.stages.length} stages</span></li>)}</ul></SettingsSection>; break;
    case 'trash': body = <SettingsSection title="Trash" description="Deleted records wait here for 30 days."><EmptyState size="sm" icon={<Trash2 size={20} strokeWidth={1.75} />} title="Trash is empty" description="Records you delete land here, and you can restore them." /></SettingsSection>; break;
    case 'bookings': body = <SettingsSection title="Bookings" description="These live in Bookings, where you use them.">
      <div className="tf-set__links">{[['Availability and hours', 'availability'], ['Booking pages', 'pages'], ['Round robin and routing', 'routing'], ['Team roster', 'roster']].map(([a, t]) => <Button key={t} variant="secondary" onPress={() => onBookings(t ?? 'meetings')}>{a}</Button>)}</div></SettingsSection>; break;
    case 'developer': body = <SettingsSection title="Developer" status={<Tag size="sm" hue="gray">Coming soon</Tag>} description="API keys, webhooks and automations open here when they ship."><span /></SettingsSection>; break;
  }
  return (
    <>
      {body}
      {confirm && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setConfirm(undefined); }} title={confirm === 'account' ? 'Delete your account?' : 'Delete Northwind?'}
          description={confirm === 'account' ? 'You leave every workspace. This can’t be undone.' : 'Everyone loses access now. You can restore it within 30 days.'}
          actions={<><Button variant="ghost" slot="close">Keep it</Button><Button variant="danger" isDisabled={typed !== (confirm === 'account' ? me?.email : 'northwind')} onPress={() => { setConfirm(undefined); toast({ message: 'In the real app this signs you out. The prototype keeps you here.' }); }}>{confirm === 'account' ? 'Delete account' : 'Delete workspace'}</Button></>}>
          <TextField label={confirm === 'account' ? `Type ${me?.email ?? 'your email'} to confirm` : 'Type northwind to confirm'} value={typed} onChange={setTyped} autoFocus />
        </Dialog>
      )}
      {twofa === 'setup' && (
        <Dialog isOpen onOpenChange={(o) => { if (!o) setTwofa('off'); }} title="Set up two factor" description="Scan with an authenticator app, then type the six digits it shows."
          actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => setTwofa('codes')}>Turn on</Button></>}>
          <div className="tf-set__row"><QrCode value="otpauth://totp/Timefix:priya@northwind.com?secret=JBSWY3DPEHPK3PXP" label="Two factor QR code" size="sm" /><div className="tf-rec__form tf-set__grow"><span className="tf-rec__muted tf-num">Key: JBSW Y3DP EHPK 3PXP</span><TextField label="Code" inputMode="numeric" placeholder="123 456" /></div></div>
        </Dialog>
      )}
      {twofa === 'codes' && (
        <Dialog isOpen isDismissable={false} onOpenChange={() => undefined} title="Save your backup codes" description="Each works once if you lose your phone. We won't show them again."
          actions={<Button variant="primary" onPress={() => { setTwofa('on'); toast({ message: 'Two factor is on', tone: 'success' }); }}>I’ve saved these</Button>}>
          <ul className="tf-set__codes tf-num">{['4F7Q-29KD', 'M2XT-8LPA', 'Q9RB-3VCE', 'ZK6W-1HNY', 'T4GJ-7PUM', 'B8ED-5SXQ'].map((c) => <li key={c}>{c}</li>)}</ul>
        </Dialog>
      )}
      {inviting && (
        <Dialog isOpen size="wide" onOpenChange={(o) => { if (!o) setInviting(false); }} title="Invite people" description="They get an email with a link to join Northwind.">
          <InviteRows autoFocus onSend={(list) => new Promise<void>((resolve) => { window.setTimeout(() => { setInviting(false); toast({ message: `${list.length} ${list.length === 1 ? 'invitation' : 'invitations'} sent`, tone: 'success' }); resolve(); }, 600); })} />
        </Dialog>
      )}
    </>
  );
}

function SwitchRow({ label, hint, on, onSave }: { readonly label: string; readonly hint?: string; readonly on: boolean; readonly onSave: () => void }) {
  const [v, setV] = useState(on);
  return <div className="tf-set__switch"><span><strong>{label}</strong>{hint && <span className="tf-rec__muted">{hint}</span>}</span><Switch aria-label={label} isSelected={v} onChange={(x) => { setV(x); onSave(); }} /></div>;
}


/** Settings › Objects: the list, one object's attributes (add, edit, reorder, archive), and New object. */
function ObjectsPage({ state, dispatch }: { readonly state: AppState; readonly dispatch: (a: AppAction) => void }) {
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string>();
  const [making, setMaking] = useState(false);
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
