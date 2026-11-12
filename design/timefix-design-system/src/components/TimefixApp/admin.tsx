// Super admin: the operators' area, apart from any workspace. A gate first (two factor on, and a code from the app every 12 hours),
// then Overview, Users (and one user), Booking pages, Website and Partners, each over a 7, 30 or 90 day period. Read only, except Partners.
import { useMemo, useState } from 'react';
import { ArrowLeft, BarChart3, Globe2, Handshake, LayoutGrid, ShieldAlert, Users } from 'lucide-react';
import { NavItem, NavSection } from '../Sidebar/Sidebar.tsx';
import { Button } from '../Button/Button.tsx';
import { Dialog, FullScreenDialog } from '../Dialog/Dialog.tsx';
import { DataGrid, type GridColumn, type GridRecord } from '../DataGrid/DataGrid.tsx';
import { BarChart, BarList, ChartCard, Stat } from '../Chart/Chart.tsx';
import { SegmentedControl } from '../SegmentedControl/SegmentedControl.tsx';
import { SearchField } from '../SearchField/SearchField.tsx';
import { SettingsSection } from '../SettingsLayout/SettingsLayout.tsx';
import { TextField } from '../Field/Field.tsx';
import { Tag } from '../Tag/Tag.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { CodeBlock } from '../Code/Code.tsx';
import { useToast } from '../Toast/Toast.tsx';
import type { AppAction, AppState } from './data.ts';
import { StepUp } from './people.tsx';

type Dispatch = (a: AppAction) => void;
type Section = 'overview' | 'users' | 'pages' | 'site' | 'partners';
const DAY = 86_400_000;
/** A stable number from a string: the prototype's platform figures are derived, not random, so they hold still between visits. */
const seed = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return Math.abs(h); };
const n = (s: string, max: number) => seed(s) % max;

/** Everyone on the platform: this workspace's people plus the salon's and the restaurant's, with their activity. */
function platformUsers(state: AppState) {
  const now = Date.now();
  const extra = [['Maya Rao', 'maya@lumen.studio', 'Lumen Hair Studio'], ['Leo Park', 'leo@lumen.studio', 'Lumen Hair Studio'], ['Nina Shah', 'nina@olivekitchen.in', 'Olive Kitchen'], ['Omar Faruq', 'omar@olivekitchen.in', 'Olive Kitchen'], ['Rina Das', 'rina@gmail.com', ''], ['Arjun Nair', 'arjun@globex.com', 'Globex']] as const;
  return [...state.members.map((m) => [m.name, m.email, state.prefs.workspace.name] as const), ...extra].map(([name, email, ws], k) => ({
    id: `pu${k}`, name, email, ws, signedUp: new Date(now - (20 + n(email, 300)) * DAY), lastActive: new Date(now - n(`${email}a`, 9) * DAY - n(email, 20) * 3_600_000),
    activeDays: 3 + n(`${email}d`, 27), workspaces: ws ? 1 + (k === 0 ? 1 : 0) : 0, records: n(`${email}r`, 400), bookings: n(`${email}b`, 60), pages: n(`${email}p`, 5), twoFactor: n(`${email}2`, 3) === 0, google: n(`${email}g`, 2) === 0,
  }));
}

/** The admin area, full screen. */
export function AdminArea({ state, dispatch, onClose, onSecurity }: { readonly state: AppState; readonly dispatch: Dispatch; readonly onClose: () => void; readonly onSecurity: () => void }) {
  const [section, setSection] = useState<Section>('overview');
  const [period, setPeriod] = useState('30');
  const [user, setUser] = useState<string>();
  const [asking, setAsking] = useState(false);
  const fresh = (state.prefs.adminAt ?? 0) > Date.now() - 12 * 3_600_000;
  const days = Number(period);
  const nav = (id: Section, label: string, icon: React.ReactNode) => <NavItem label={label} icon={icon} isCurrent={section === id && !user} onPress={() => { setSection(id); setUser(undefined); }} />;
  const gate = !state.prefs.twoFactor ? (
    <EmptyState icon={<ShieldAlert size={20} strokeWidth={1.75} />} title="Turn on two factor to open these pages" description="These pages show every account."
      action={<Button variant="primary" onPress={onSecurity}>Open sign in and devices</Button>} />
  ) : !fresh ? (
    <EmptyState icon={<ShieldAlert size={20} strokeWidth={1.75} />} title="Confirm it’s you" description="These pages ask for a code every 12 hours." action={<Button variant="primary" onPress={() => setAsking(true)}>Enter code</Button>} />
  ) : undefined;
  return (
    <FullScreenDialog aria-label="Super admin" onOpenChange={(o) => { if (!o) onClose(); }}>
      <div className="tf-adm">
        <nav className="tf-adm__nav" aria-label="Super admin">
          <NavItem label="Back to app" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onPress={onClose} />
          <NavSection title="Super admin">
            {nav('overview', 'Overview', <BarChart3 size={16} strokeWidth={1.75} />)}{nav('users', 'Users', <Users size={16} strokeWidth={1.75} />)}{nav('pages', 'Booking pages', <LayoutGrid size={16} strokeWidth={1.75} />)}
            {nav('site', 'Website', <Globe2 size={16} strokeWidth={1.75} />)}{nav('partners', 'Partners', <Handshake size={16} strokeWidth={1.75} />)}
          </NavSection>
        </nav>
        <main className="tf-adm__main" key={`${section}-${user ?? ''}`}>
          {gate ?? <>
            <header className="tf-adm__head"><h1 className="tf-adm__title">{user ? 'User' : { overview: 'Overview', users: 'Users', pages: 'Booking pages', site: 'Website', partners: 'Partners' }[section]}</h1>
              {section !== 'partners' && <SegmentedControl size="sm" aria-label="Period" selectedKey={period} onSelectionChange={setPeriod} items={[{ id: '7', label: '7 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} />}</header>
            {user ? <UserPage state={state} id={user} days={days} onBack={() => setUser(undefined)} />
              : section === 'overview' ? <Overview state={state} days={days} />
              : section === 'users' ? <UsersPage state={state} onOpen={setUser} />
              : section === 'pages' ? <PagesPage state={state} days={days} />
              : section === 'site' ? <SitePage days={days} />
              : <PartnersPage state={state} dispatch={dispatch} />}
          </>}
        </main>
      </div>
      {asking && <Dialog isOpen onOpenChange={setAsking} title="Confirm it’s you" actions={<Button variant="ghost" slot="close">Cancel</Button>}>
        <StepUp twoFactor onVerified={() => { dispatch({ type: 'prefs/update', fn: () => ({ adminAt: Date.now() }) }); setAsking(false); }} />
      </Dialog>}
    </FullScreenDialog>
  );
}

/** Daily counts for a chart, derived from a name and the period. */
const daily = (key: string, days: number, max: number) => Array.from({ length: days }, (_, k) => { const d = new Date(Date.now() - (days - 1 - k) * DAY); return { id: `${key}${k}`, label: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), value: n(`${key}${d.toDateString()}`, max) }; });
const sum = (xs: ReadonlyArray<{ readonly value: number }>) => xs.reduce((t, x) => t + x.value, 0);
/** "12 in the 30 days before": the same figure for the period before, derived like the rest. */
const before = (key: string, value: number, days: number) => { const prev = Math.max(0, Math.round(value * (0.7 + (n(`${key}${days}`, 60) / 100)))); return { delta: `${prev.toLocaleString('en-IN')} in the ${days} days before`, trend: value >= prev ? 'up' as const : 'down' as const }; };
const busiest = (xs: ReadonlyArray<{ readonly label: string; readonly value: number }>) => { const b = [...xs].sort((a, c) => c.value - a.value)[0]; return b && b.value > 0 ? `${sum(xs).toLocaleString('en-IN')} in all. Busiest day: ${b.label}, with ${b.value}.` : 'Nothing in this period.'; };

function Overview({ state, days }: { readonly state: AppState; readonly days: number }) {
  const users = platformUsers(state); const since = Date.now() - days * DAY;
  const fresh = users.filter((u) => u.signedUp.getTime() > since).length; const before0 = users.filter((u) => u.signedUp.getTime() > since - days * DAY && u.signedUp.getTime() <= since).length;
  const active = (d: number) => users.filter((u) => u.lastActive.getTime() > Date.now() - d * DAY).length;
  const charts = [['Sign ups', 'su', 4], ['Active users', 'au', 12], ['Records made', 'rm', 90], ['Bookings made', 'bm', 30]] as const;
  return (
    <div className="tf-adm__body">
      <SettingsSection title="Growth"><div className="tf-adm__stats">
        <Stat label="Users" value={String(users.length)} {...before('u', users.length, days)} /><Stat label="New users" value={String(fresh)} delta={`${before0} in the ${days} days before`} trend={fresh >= before0 ? 'up' : 'down'} />
        <Stat label="Active users" value={String(active(days))} {...before('a', active(days), days)} /><Stat label="Workspaces" value="4" {...before('w', 4, days)} /><Stat label="New workspaces" value={String(Math.max(1, Math.round(fresh / 2)))} {...before('nw', 1, days)} />
      </div></SettingsSection>
      <SettingsSection title="Recently active"><div className="tf-adm__stats">{([['Active today', 1], ['Active in the last 7 days', 7], ['Active in the last 30 days', 30]] as const).map(([label, d]) => <Stat key={label} label={label} value={String(active(d))} delta={`of ${users.length} users`} />)}</div></SettingsSection>
      <SettingsSection title="Usage"><div className="tf-adm__stats">{([['Records made', sum(daily('rm', days, 90))], ['Bookings made', sum(daily('bm', days, 30))], ['Form submissions', state.forms.reduce((t, f) => t + f.responses.length, 0)]] as const).map(([label, v]) => <Stat key={label} label={label} value={v.toLocaleString('en-IN')} {...before(label, v, days)} />)}</div></SettingsSection>
      <div className="tf-adm__charts">{charts.map(([title, key, max]) => { const pts = daily(key, days, max); return <ChartCard key={key} title={title}><BarChart label={title} points={pts} height={140} /><p className="tf-rec__muted tf-num">{busiest(pts)}</p></ChartCard>; })}</div>
    </div>
  );
}

function UsersPage({ state, onOpen }: { readonly state: AppState; readonly onOpen: (id: string) => void }) {
  const [q, setQ] = useState(''); const [shown, setShown] = useState(25);
  const all = platformUsers(state); const k = q.trim().toLowerCase();
  const users = all.filter((u) => !k || u.name.toLowerCase().includes(k) || u.email.toLowerCase().includes(k));
  const ago = (d: Date) => { const days = Math.floor((Date.now() - d.getTime()) / DAY); return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days}d ago`; };
  const columns: ReadonlyArray<GridColumn> = [{ id: 'name', name: 'Name', type: 'name', width: 170 }, { id: 'email', name: 'Email', type: 'text', width: 200 }, { id: 'signed', name: 'Signed up', type: 'text', width: 115 }, { id: 'last', name: 'Last active', type: 'text', width: 115 },
    { id: 'days', name: 'Active days', type: 'number', width: 125 }, { id: 'ws', name: 'Workspaces', type: 'number', width: 130 }, { id: 'rec', name: 'Records made', type: 'number', width: 140 }, { id: 'bk', name: 'Bookings hosted', type: 'number', width: 160 }, { id: 'pg', name: 'Booking pages', type: 'number', width: 150 }];
  const rows: ReadonlyArray<GridRecord> = users.slice(0, shown).map((u) => ({ id: u.id, kind: 'person', values: { name: u.name, email: u.email, signed: u.signedUp.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), last: ago(u.lastActive), days: u.activeDays, ws: u.workspaces, rec: u.records, bk: u.bookings, pg: u.pages } }));
  return (
    <div className="tf-adm__body">
      <SearchField label="Search users" placeholder="Search by name or email" value={q} onChange={setQ} size="sm" className="tf-adm__search" />
      {users.length === 0 ? <EmptyState size="sm" icon={<Users size={20} strokeWidth={1.75} />} title="Nobody matches" /> : <>
        <DataGrid label="Users" isSelectable={false} columns={columns} rows={rows} onRowAction={onOpen} summary={users.length > shown ? `Showing ${shown} of ${users.length}` : `All ${users.length} users shown.`} />
        {users.length > shown && <Button size="sm" variant="ghost" onPress={() => setShown(shown + 25)}>Show more</Button>}
      </>}
    </div>
  );
}

function UserPage({ state, id, days, onBack }: { readonly state: AppState; readonly id: string; readonly days: number; readonly onBack: () => void }) {
  const u = platformUsers(state).find((x) => x.id === id);
  if (!u) return <EmptyState icon={<Users size={20} strokeWidth={1.75} />} title="No user here" action={<Button variant="secondary" onPress={onBack}>Back to users</Button>} />;
  const strip = Array.from({ length: days }, (_, k) => n(`${u.email}${k}`, 3) === 0);
  return (
    <div className="tf-adm__body">
      <Breadcrumbs items={[{ id: 'users', label: 'Users' }, { id: 'me', label: u.name }]} onAction={(k) => { if (k === 'users') onBack(); }} />
      <SettingsSection title="Account"><dl className="tf-set__facts">
        {([['Email', u.email], ['Signed up', u.signedUp.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })], ['Last active', u.lastActive.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })],
          ['Signs in with', u.google ? 'Email code · Google' : 'Email code'], ['Two factor', u.twoFactor ? 'On' : 'Off'], ['Devices signed in', String(1 + n(u.email, 3))]] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl></SettingsSection>
      <SettingsSection title="Activity"><div className="tf-adm__stats">{([['Active days', u.activeDays, 'since signing up'], ['Records made', u.records, 'in every workspace'], ['Bookings hosted', u.bookings, 'as host'], ['Booking pages', u.pages, 'live or paused']] as const).map(([label, v, line]) => <Stat key={label} label={label} value={String(v)} delta={line} />)}</div>
        <div className="tf-adm__strip" role="img" aria-label={`Active on ${strip.filter(Boolean).length} of ${days} days.`}>{strip.map((on, k) => <span key={k} data-on={on || undefined} />)}</div>
        <p className="tf-rec__muted tf-num">Active on {strip.filter(Boolean).length} of {days} days.</p></SettingsSection>
      <SettingsSection title="Workspaces">{u.ws ? <dl className="tf-set__facts"><div><dt>{u.ws}</dt><dd>{u.name === state.me ? 'Owner' : 'Member'} · {u.records} records made · {u.bookings} bookings hosted</dd></div></dl> : <p className="tf-rec__muted">In no workspace</p>}</SettingsSection>
    </div>
  );
}

function PagesPage({ state, days }: { readonly state: AppState; readonly days: number }) {
  const pages = useMemo(() => ['Discovery call', 'Demo', 'Intro call', 'Haircut', 'Colour and cut', 'Book a table', 'Sales round robin'].map((name, k) => {
    const views = n(`${name}v${days}`, 900) + 40; const visitors = Math.round(views * 0.7); const bookings = Math.round(visitors * (0.08 + n(name, 10) / 100));
    return { id: `bp${k}`, name, ws: k < 3 || k === 6 ? state.prefs.workspace.name : k < 5 ? 'Lumen Hair Studio' : 'Olive Kitchen', owner: k === 6 ? 'No owner' : state.members[k % state.members.length]?.name ?? 'Priya Raman', kind: k === 6 ? 'Round robin' : k === 1 ? 'Team' : 'Personal', live: k === 4 ? 'Paused' : 'Live', views, visitors, bookings, cancelled: Math.round(bookings * 0.06) };
  }), [state, days]);
  const t = (k: 'views' | 'visitors' | 'bookings' | 'cancelled') => pages.reduce((s, p) => s + p[k], 0);
  const rate = (b: number, v: number) => `${v ? Math.round((b / v) * 1000) / 10 : 0}%`;
  const columns: ReadonlyArray<GridColumn> = [{ id: 'name', name: 'Page', type: 'name', width: 180 }, { id: 'ws', name: 'Workspace', type: 'text', width: 160 }, { id: 'owner', name: 'Owner', type: 'text', width: 130 }, { id: 'kind', name: 'Kind', type: 'text', width: 110 },
    { id: 'state', name: 'State', type: 'status', width: 100, options: [{ id: 'Live', label: 'Live', status: 'done' }, { id: 'Paused', label: 'Paused', status: 'waiting' }] }, { id: 'views', name: 'Views', type: 'number', width: 90 }, { id: 'visitors', name: 'Visitors', type: 'number', width: 90 }, { id: 'bookings', name: 'Bookings', type: 'number', width: 100 }, { id: 'rate', name: 'Booking rate', type: 'text', width: 120 }];
  return (
    <div className="tf-adm__body">
      <SettingsSection title="All pages" description="Views leave out the host. Visitors count once a day. Rate: bookings ÷ visitors."><div className="tf-adm__stats">
        <Stat label="Views" value={t('views').toLocaleString('en-IN')} {...before('v', t('views'), days)} /><Stat label="Visitors" value={t('visitors').toLocaleString('en-IN')} {...before('vi', t('visitors'), days)} /><Stat label="Bookings" value={String(t('bookings'))} {...before('b', t('bookings'), days)} /><Stat label="Booking rate" value={rate(t('bookings'), t('visitors'))} delta="bookings ÷ visitors" /><Stat label="Cancelled" value={String(t('cancelled'))} {...before('c', t('cancelled'), days)} /></div></SettingsSection>
      <SettingsSection title="Each page" description="The 500 most viewed pages.">
        <DataGrid label="Booking pages" isSelectable={false} columns={columns} rows={pages.map((p) => ({ id: p.id, values: { name: p.name, ws: p.ws, owner: p.owner, kind: p.kind, state: p.live, views: p.views, visitors: p.visitors, bookings: p.bookings, rate: rate(p.bookings, p.visitors) } }))} />
      </SettingsSection>
    </div>
  );
}

function SitePage({ days }: { readonly days: number }) {
  const visits = daily('vis', days, 140); const views = visits.map((v) => ({ ...v, id: `pv${v.id}`, value: Math.round(v.value * 1.6) }));
  const rank = (key: string, names: ReadonlyArray<string>) => names.map((x) => ({ id: x, label: x, value: n(`${key}${x}${days}`, 400) + 10 })).sort((a, b) => b.value - a.value);
  return (
    <div className="tf-adm__body">
      <SettingsSection title="Visits" description="No cookies. A visitor counts once a day."><div className="tf-adm__stats"><Stat label="Visitors" value={sum(visits).toLocaleString('en-IN')} {...before('sv', sum(visits), days)} /><Stat label="Page views" value={sum(views).toLocaleString('en-IN')} {...before('pv', sum(views), days)} /><Stat label="Views per visitor" value={(sum(views) / Math.max(1, sum(visits))).toFixed(1)} delta="page views ÷ visitors" /></div></SettingsSection>
      <div className="tf-adm__charts"><ChartCard title="Visitors"><BarChart label="Visitors" points={visits} height={140} /></ChartCard><ChartCard title="Page views"><BarChart label="Page views" points={views} height={140} /></ChartCard></div>
      <div className="tf-adm__charts">
        <ChartCard title="Pages"><BarList label="Pages" items={rank('pg', ['/', '/pricing', '/scheduling', '/forms', '/link-page'])} /></ChartCard>
        <ChartCard title="Referrers"><BarList label="Referrers" items={rank('rf', ['google.com', 'linkedin.com', 'x.com', 'producthunt.com'])} /></ChartCard>
        <ChartCard title="Countries"><BarList label="Countries" items={rank('ct', ['India', 'United States', 'United Kingdom', 'UAE'])} /></ChartCard>
        <ChartCard title="Devices"><BarList label="Devices" items={rank('dv', ['Phone', 'Computer', 'Tablet'])} /></ChartCard>
      </div>
    </div>
  );
}

function PartnersPage({ state, dispatch }: { readonly state: AppState; readonly dispatch: Dispatch }) {
  const { toast } = useToast();
  const partners = state.prefs.adminPartners ?? [{ id: 'ap1', name: 'Acme marketing hub', client: 'tfp_acme_7Q2', hint: '9xK2', at: new Date(Date.now() - 40 * DAY) }];
  const [editing, setEditing] = useState<{ readonly id?: string; readonly name: string }>();
  const [secret, setSecret] = useState<string>();
  const save = (next: typeof partners) => dispatch({ type: 'prefs/update', fn: () => ({ adminPartners: next }) });
  const fresh = () => `tfs_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  return (
    <div className="tf-adm__body">
      <SettingsSection title="Partners" description="Outside products that connect workspaces to Timefix." action={<Button variant="primary" onPress={() => setEditing({ name: '' })}>Register partner</Button>}>
        {partners.length === 0 ? <EmptyState size="sm" icon={<Handshake size={20} strokeWidth={1.75} />} title="No partners yet" description="A partner is an outside product that connects workspaces to Timefix. Register one to get its keys." />
          : <ul className="tf-set__list tf-set__list--center">{partners.map((x) => <li key={x.id}><span className="tf-set__stack"><strong>{x.name}</strong><span className="tf-rec__muted tf-num">Client id {x.client} · secret …{x.hint} · registered {x.at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
            <span className="tf-set__row"><Button size="sm" variant="ghost" onPress={() => setEditing({ id: x.id, name: x.name })}>Edit</Button>
              <Button size="sm" variant="secondary" onPress={() => { const s = fresh(); save(partners.map((y) => (y.id === x.id ? { ...y, hint: s.slice(-4) } : y))); setSecret(s); }}>Replace secret</Button></span></li>)}</ul>}
      </SettingsSection>
      {editing && <Dialog isOpen onOpenChange={(o) => { if (!o) setEditing(undefined); }} title={editing.id ? 'Edit partner' : 'Register partner'}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" isDisabled={!editing.name.trim()} onPress={() => {
          if (editing.id) { save(partners.map((y) => (y.id === editing.id ? { ...y, name: editing.name.trim() } : y))); toast({ message: 'Partner saved', tone: 'success' }); }
          else { const s = fresh(); save([...partners, { id: `ap${Date.now()}`, name: editing.name.trim(), client: `tfp_${editing.name.trim().toLowerCase().replace(/\W+/g, '_').slice(0, 10)}`, hint: s.slice(-4), at: new Date() }]); setSecret(s); }
          setEditing(undefined); }}>{editing.id ? 'Save' : 'Register'}</Button></>}>
        <TextField label="Name" value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} autoFocus placeholder="Acme marketing hub" />
      </Dialog>}
      {secret && <Dialog isOpen isDismissable={false} showClose={false} onOpenChange={() => undefined} title="Copy the client secret" description="It shows only now. The partner keeps it on their server."
        actions={<Button variant="primary" onPress={() => setSecret(undefined)}>Done</Button>}><CodeBlock code={secret} copyLabel="Copy the client secret" /><Tag size="sm" hue="orange">The old secret stops working now</Tag></Dialog>}
    </div>
  );
}
