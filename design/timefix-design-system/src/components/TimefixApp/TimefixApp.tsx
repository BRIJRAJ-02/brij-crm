// The whole Timefix app as one prototype: the sidebar from app-ia.md (You, Records, Lists, Bookings, Forms, Link page, Insights),
// ⌘K over everything, Home, and each module as it's rebuilt. Bookings is the module already built: it stays mounted inside, so its state is kept.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { Boxes, BarChart3, Building2, CalendarDays, CalendarRange, CheckSquare, ChevronRight, CircleDollarSign, Clock, FileText, Home, IdCard, Inbox, Link2, ListChecks, LogOut, Menu, NotebookPen, Plus, Route, Search, Settings, UserPlus, UserRound, Users, UtensilsCrossed } from 'lucide-react';
import { NavItem, NavSection } from '../Sidebar/Sidebar.tsx';
import { TabBar, TopBar } from '../AppShell/AppShell.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { CommandPalette, ShortcutHelp, useCommandK, type CommandItem } from '../CommandPalette/CommandPalette.tsx';
import { ToastProvider, useToast } from '../Toast/Toast.tsx';
import { Dialog } from '../Dialog/Dialog.tsx';
import { BookingsFlow, type BookingsAction, type BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { appReducer, liveEntries, newId, northwindCrm, type AppAction, type AppState, type ObjectId } from './data.ts';
import { HomeScreen } from './home.tsx';
import { RecordsScreen } from './records.tsx';
import { RecordPage } from './record.tsx';
import { InboxScreen, NotesScreen, TasksScreen } from './you.tsx';
import { ListScreen, NewListDialog } from './lists.tsx';
import { FormsScreen } from './forms.tsx';
import { InsightsScreen, LinkPageScreen, LinksScreen, STARTER, handleFor } from './grow.tsx';
import { SettingsScreen } from './settings.tsx';
import { DOORS, DoorScreen, type Door } from './auth.tsx';
import { ImportScreen } from './importer.tsx';
import { DuplicatesScreen } from './duplicates.tsx';
import { CustomRecordsScreen } from './custom.tsx';
import './TimefixApp.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Where the app is: a module, and for Records which object. */
export type AppPage = `object:${string}` | 'home' | 'more' | 'links' | 'inbox' | 'tasks' | 'notes' | `records:${ObjectId}` | `list:${string}` | 'forms' | 'link' | 'insights' | 'settings' | 'bookings';

const OBJECTS: ReadonlyArray<{ readonly id: ObjectId; readonly label: string; readonly icon: ReactNode }> = [
  { id: 'people', label: 'People', icon: <Users {...i16} /> }, { id: 'companies', label: 'Companies', icon: <Building2 {...i16} /> }, { id: 'deals', label: 'Deals', icon: <CircleDollarSign {...i16} /> },
];
const TITLES: Readonly<Record<string, { readonly label: string; readonly icon: ReactNode }>> = {
  home: { label: 'Home', icon: <Home {...i16} /> }, inbox: { label: 'Inbox', icon: <Inbox {...i16} /> }, tasks: { label: 'Tasks', icon: <CheckSquare {...i16} /> }, notes: { label: 'Notes', icon: <NotebookPen {...i16} /> },
forms: { label: 'Forms', icon: <FileText {...i16} /> }, link: { label: 'Link page', icon: <IdCard {...i16} /> }, links: { label: 'Links', icon: <Link2 {...i16} /> },
  insights: { label: 'Insights', icon: <BarChart3 {...i16} /> }, settings: { label: 'Settings', icon: <Settings {...i16} /> },
  ...Object.fromEntries(OBJECTS.map((o) => [`records:${o.id}`, { label: o.label, icon: o.icon }])),
};

/** Props for TimefixApp. */
export interface TimefixAppProps {
  /** The CRM data; Northwind by default. */
  readonly initial?: AppState;
  /** Where it opens. */
  readonly start?: AppPage;
}

/** The whole Timefix app. */
export function TimefixApp(props: TimefixAppProps) {
  return <ToastProvider><App {...props} /></ToastProvider>;
}

type Rec = { readonly object: ObjectId; readonly id: string; readonly tab?: string };

function App({ initial, start = 'home' }: TimefixAppProps) {
  const { toast } = useToast();
  const toastRef = useRef(toast); toastRef.current = toast;
  const [state, rawDispatch] = useReducer(appReducer, initial ?? northwindCrm());
  const previewing = useRef(state.previewRole); previewing.current = state.previewRole;
  /** While previewing as another role nothing changes: every change is refused with one plain line, except stopping the preview. */
  const dispatch = useCallback((a: AppAction) => {
    if (previewing.current && a.type !== 'preview/set' && a.type !== 'inbox/set' && a.type !== 'inbox/all-read') { toastRef.current?.({ message: `You’re previewing as a ${previewing.current.toLowerCase()}. Nothing changes until you stop previewing.` }); return; }
    rawDispatch(a);
  }, []);
  const [page, setPage] = useState<AppPage>(start);
  const [bookings, setBookings] = useState<BookingsState>();
  /** Bookings changes made from Settings, applied inside Bookings in order. */
  const [bookingsCmds, setBookingsCmds] = useState<ReadonlyArray<{ readonly seq: number; readonly action: BookingsAction }>>([]);
  const toBookings = (action: BookingsAction) => setBookingsCmds((q) => [...q, { seq: (q[q.length - 1]?.seq ?? 0) + 1, action }]);
  const [openTab, setOpenTab] = useState<{ readonly tab: string; readonly n: number; readonly meetingId?: string }>();
  const [search, setSearch] = useState(false);
  const searchButton = <Button size="sm" variant="ghost" icon={<Search size={14} strokeWidth={1.75} />} onPress={() => setSearch(true)}>Search</Button>;
  const [help, setHelp] = useState(false);
  const [newList, setNewList] = useState(false);
  const [door, setDoor] = useState<Door>();
  const [signingOut, setSigningOut] = useState(false);
  const [settingsStart, setSettingsStart] = useState<{ readonly page?: string; readonly n: number }>({ n: 0 });
  const [sub, setSub] = useState<'import' | 'dupes'>();
  const [record, setRecord] = useState<Rec>();
  /** Records opened from other records: Back walks this, then shows the page underneath, untouched. */
  const [trail, setTrail] = useState<ReadonlyArray<Rec>>([]);
  /** A screen opened straight into an action from ⌘K: New person, New task, a note or a task. */
  const [launch, setLaunch] = useState<{ readonly kind: 'person' | 'company' | 'task' | 'note' | 'form' | 'visit' | 'report'; readonly value?: string; readonly n: number }>();
  const [recent, setRecent] = useState<ReadonlyArray<string>>([]);
  /** The record that was open when ⌘K "New task" ran, so the task starts on it. */
  const [taskFor, setTaskFor] = useState<{ readonly object: ObjectId; readonly id: string }>();
  const [switchWs, setSwitchWs] = useState<{ readonly id: 'northwind' | 'lumen' | 'olive'; readonly n: number }>();
  const [bookGuest, setBookGuest] = useState<{ readonly prefill?: { readonly name: string; readonly email: string }; readonly pageId?: string; readonly scenario?: 'book' | 'profile' | 'menu'; readonly n: number }>();
  const kind = bookings?.business?.kind ?? 'team';
  const me = state.members.find((m) => m.name === state.me);

  // Theme: the app's own choice wins; "Match my device" hands back to whatever the page had.
  const pageTheme = useRef<string | null>(typeof document === 'undefined' ? null : document.documentElement.getAttribute('data-theme'));
  useEffect(() => {
    const root = document.documentElement; const t = state.prefs.theme;
    if (t !== 'system') { root.setAttribute('data-theme', t); return; }
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    if (pageTheme.current) root.setAttribute('data-theme', pageTheme.current); else root.setAttribute('data-theme', m.matches ? 'dark' : 'light');
  }, [state.prefs.theme]);
  // Switching workspace in Bookings switches the workspace everywhere: its name and address reach Settings, doors and links.
  const lastWs = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!bookings) return;
    if (lastWs.current === undefined) { lastWs.current = bookings.workspace; return; }
    if (lastWs.current === bookings.workspace) return;
    lastWs.current = bookings.workspace;
    dispatch({ type: 'prefs/set', prefs: { workspace: { ...state.prefs.workspace, name: bookings.workspace, slug: bookings.business?.handle ?? 'northwind', logo: undefined } } });
  }, [bookings?.workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  const remember = (id: string) => setRecent((r) => [id, ...r.filter((x) => x !== id)].slice(0, 5));
  const go = (p: AppPage) => { setPage(p); setRecord(undefined); setTrail([]); setSub(undefined); setLaunch(undefined); setTaskFor(undefined); };
  const openRecord = (object: ObjectId, id: string, tab?: string) => { setSub(undefined); if (page === 'bookings') setPage(`records:${object}`); if (record) setTrail((t) => [...t, record]); setRecord({ object, id, tab }); remember(`${object}:${id}`); };
  const back = () => { const prev = trail[trail.length - 1]; setTrail(trail.slice(0, -1)); setRecord(prev); };
  /** Opens a Bookings page; with a guest's name, their next meeting's drawer opens too. */
  const openBookings = (tab: string, who?: string) => {
    const m = who ? [...(bookings?.meetings ?? [])].filter((x) => x.invitee.name === who).sort((a, b) => Math.abs(a.start.getTime() - Date.now()) - Math.abs(b.start.getTime() - Date.now()))[0] : undefined;
    setOpenTab((o) => ({ tab, n: (o?.n ?? 0) + 1, meetingId: m?.id })); setPage('bookings'); setRecord(undefined); setTrail([]); setSub(undefined);
  };
  const openSettings = (at?: string) => { setSettingsStart((s) => ({ page: at, n: s.n + 1 })); go('settings'); };
  const goStart = () => { const s = state.prefs.startPage; if (s === 'bookings') openBookings('meetings'); else go(s as AppPage); };
  const launchAt = (kindOf: 'person' | 'company' | 'task' | 'note' | 'form' | 'visit' | 'report', target: AppPage, value?: string) => { go(target); setLaunch((l) => ({ kind: kindOf, value, n: (l?.n ?? 0) + 1 })); };
  const unread = state.inbox.filter((x) => !x.read && !x.done).length;
  // The tab title says how many unread there are, the way mail apps do.
  useEffect(() => { document.title = unread ? `(${unread}) Timefix` : 'Timefix'; }, [unread]);
    /** Sidebar items someone turned off in Settings › Preferences. */
  const hiddenNav = new Set(state.prefs.sidebarHidden);
  const myOpen = state.tasks.filter((t) => !t.done && t.assignee === state.me).length;

  useCommandK(() => { if (!door) setSearch(true); });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (door) return;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
      else if (e.key === '?' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); setHelp(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ⌘K: records, notes and tasks first, then every page and action. Typing narrows across all of them; what's typed can become a new record.
  const pagesToGo: ReadonlyArray<{ readonly id: string; readonly label: string; readonly icon: ReactNode; readonly keywords?: string }> = [
    ...(['home', 'inbox', 'tasks', 'notes'] as const).map((id) => ({ id, label: TITLES[id]?.label ?? id, icon: TITLES[id]?.icon })),
    ...OBJECTS.map((o) => ({ id: `records:${o.id}`, label: o.label, icon: o.icon })),
    ...state.objects.filter((o) => o.custom && !o.archived).map((o) => ({ id: `object:${o.id}`, label: o.many, icon: <Boxes {...i16} /> })),
    ...state.lists.filter((l) => !l.archived).map((l) => ({ id: `list:${l.id}`, label: l.name, icon: <ListChecks {...i16} />, keywords: 'list' })),
    ...(['links', 'link', 'forms', 'insights', 'settings'] as const).map((id) => ({ id, label: TITLES[id]?.label ?? id, icon: TITLES[id]?.icon, keywords: id === 'links' ? 'share qr copy' : undefined })),
  ];
  const commands = useMemo<ReadonlyArray<CommandItem>>(() => [
    ...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, group: 'People', kind: 'person' as const, sub: [p.title, state.companies.find((c) => c.id === p.companyId)?.name].filter(Boolean).join(' · '), keywords: p.email })),
    ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, group: 'Companies', kind: 'record' as const, sub: c.domain })),
    ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, group: 'Deals', kind: 'record' as const, sub: d.stage })),
    ...state.notes.map((n) => ({ id: `note:${n.id}`, label: n.title || 'Untitled note', group: 'Notes', kind: 'action' as const, icon: <NotebookPen {...i16} />, keywords: n.body.slice(0, 120) })),
    ...state.tasks.filter((t) => !t.done).map((t) => ({ id: `task:${t.id}`, label: t.title, group: 'Tasks', kind: 'action' as const, icon: <CheckSquare {...i16} />, keywords: t.assignee })),
    ...pagesToGo.map((x) => ({ id: `go:${x.id}`, label: `Go to ${x.label}`, group: 'Go to', kind: 'action' as const, icon: x.icon, keywords: x.keywords })),
    { id: 'go:bookings', label: kind === 'restaurant' ? 'Go to Reservations' : 'Go to Meetings', group: 'Go to', kind: 'action' as const, icon: <CalendarDays {...i16} />, keywords: 'bookings calendar meetings reservations' },
    { id: 'bk:pages', label: kind === 'team' ? 'Go to Booking pages' : 'Go to Your business page', group: 'Go to', kind: 'action' as const, icon: <CalendarDays {...i16} />, keywords: 'bookings links' },
    { id: 'bk:availability', label: kind === 'team' ? 'Go to Availability' : 'Go to Opening hours', group: 'Go to', kind: 'action' as const, icon: <CalendarDays {...i16} />, keywords: 'hours time off' },
    ...state.reports.map((r) => ({ id: `report:${r.id}`, label: r.name, group: 'Reports', kind: 'action' as const, icon: <BarChart3 {...i16} />, keywords: 'report chart insights' })),
    { id: 'set:members', label: 'Settings › Members and teams', group: 'Go to', kind: 'action' as const, icon: <Settings {...i16} />, keywords: 'invite people' },
    { id: 'set:objects', label: 'Settings › Objects', group: 'Go to', kind: 'action' as const, icon: <Settings {...i16} />, keywords: 'attributes fields' },
    { id: 'set:trash', label: 'Settings › Trash', group: 'Go to', kind: 'action' as const, icon: <Settings {...i16} />, keywords: 'deleted restore' },
    { id: 'new:person', label: 'New person', group: 'Actions', kind: 'action' as const, icon: <UserPlus {...i16} />, keywords: 'create contact add' },
    { id: 'new:task', label: 'New task', group: 'Actions', kind: 'action' as const, icon: <CheckSquare {...i16} />, keywords: 'create todo add' },
    { id: 'new:list', label: 'New list', group: 'Actions', kind: 'action' as const, icon: <ListChecks {...i16} />, keywords: 'create pipeline' },
    { id: 'new:booking', label: kind === 'team' ? 'New booking page' : 'Add a service', group: 'Actions', kind: 'action' as const, icon: <Plus {...i16} />, keywords: 'create link meeting' },
    { id: 'imp:people', label: 'Import people from a CSV', group: 'Actions', kind: 'action' as const, icon: <UserPlus {...i16} />, keywords: 'upload spreadsheet' },
    ...DOORS.map((d) => ({ id: `door:${d.id}`, label: d.label, group: 'Screens', kind: 'action' as const, icon: <IdCard {...i16} />, keywords: 'auth login onboarding public' })),
  ], [state.people, state.companies, state.deals, state.notes, state.tasks, state.lists, state.objects, state.reports, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentItems = recent.map((id) => commands.find((c) => c.id === id)).filter((c): c is CommandItem => c !== undefined);
  const fromQuery = (q: string): ReadonlyArray<CommandItem> => [
    { id: `create:person:${q}`, label: `Create person “${q}”`, group: 'Create', kind: 'action', icon: <UserPlus {...i16} />, keywords: q },
    { id: `create:company:${q}`, label: `Create company “${q}”`, group: 'Create', kind: 'action', icon: <Building2 {...i16} />, keywords: q },
  ];
  const onCommand = (id: string) => {
    setSearch(false);
    if (!id.startsWith('create:')) remember(id);
    const [k, ...restParts] = id.split(':'); const rest = restParts.join(':');
    if (k === 'door') { setDoor(rest as Door); return; }
    if (k === 'go') { if (rest === 'bookings') openBookings('meetings'); else if (rest === 'settings') openSettings(); else go(rest as AppPage); return; }
    if (k === 'bk') { openBookings(rest); return; }
    if (k === 'set') { openSettings(rest); return; }
    if (k === 'people' || k === 'companies' || k === 'deals') { openRecord(k, rest); return; }
    if (k === 'note') { launchAt('note', 'notes', rest); return; }
    if (k === 'task') { launchAt('task', 'tasks', rest); return; }
    if (k === 'report') { launchAt('report', 'insights', rest); return; }
    if (k === 'create') { const [what, ...name] = restParts; if (what === 'company') launchAt('company', 'records:companies', name.join(':')); else launchAt('person', 'records:people', name.join(':')); return; }
    if (id === 'new:booking') openBookings('pages');
    else if (id === 'new:person') launchAt('person', 'records:people', '');
    else if (id === 'new:task') { const r = record; launchAt('task', 'tasks'); if (r) setTaskFor(r); }
    else if (id === 'new:list') setNewList(true);
    else if (id === 'imp:people') { go('records:people'); setSub('import'); }
  };

  const nav = (bookingsSection: ReactNode) => (
    <>
      <NavItem label="Search" icon={<Search {...i16} />} shortcut="⌘K" onPress={() => setSearch(true)} />
      <NavItem label="Home" icon={<Home {...i16} />} isCurrent={page === 'home'} onPress={() => go('home')} />
      <NavItem label="Inbox" icon={<Inbox {...i16} />} badge={unread || undefined} isCurrent={page === 'inbox'} onPress={() => go('inbox')} />
      {!hiddenNav.has('tasks') && <NavItem label="Tasks" icon={<CheckSquare {...i16} />} count={myOpen || undefined} isCurrent={page === 'tasks'} onPress={() => go('tasks')} />}
      {!hiddenNav.has('notes') && <NavItem label="Notes" icon={<NotebookPen {...i16} />} isCurrent={page === 'notes'} onPress={() => go('notes')} />}
      <NavSection title="Records" addLabel="New object" onAdd={() => openSettings('objects:new')}>
        {OBJECTS.map((o) => <NavItem key={o.id} label={o.label} icon={o.icon} isCurrent={page === `records:${o.id}`} onPress={() => go(`records:${o.id}`)} />)}
        {state.objects.filter((o) => o.custom && !o.archived).map((o) => <NavItem key={o.id} label={o.many} icon={<Boxes {...i16} />} isCurrent={page === `object:${o.id}`} onPress={() => go(`object:${o.id}`)} />)}
      </NavSection>
      {!hiddenNav.has('lists') && <NavSection title="Lists" addLabel="New list" onAdd={() => setNewList(true)}>
        {state.lists.filter((l) => !l.archived).map((l) => <NavItem key={l.id} label={l.name} icon={<ListChecks {...i16} />} count={liveEntries(state, l).length || undefined} isCurrent={page === `list:${l.id}`} onPress={() => go(`list:${l.id}`)} />)}
      </NavSection>}
      {bookingsSection}
      <NavSection title="Grow">
        <NavItem label="Links" icon={<Link2 {...i16} />} isCurrent={page === 'links' || page === 'link'} onPress={() => go('links')} />
        {!hiddenNav.has('forms') && <NavItem label="Forms" icon={<FileText {...i16} />} isCurrent={page === 'forms'} onPress={() => go('forms')} />}
        {!hiddenNav.has('insights') && <NavItem label="Insights" icon={<BarChart3 {...i16} />} isCurrent={page === 'insights'} onPress={() => go('insights')} />}
      </NavSection>
      <NavItem label="Settings" icon={<Settings {...i16} />} shortcut="⌘," isCurrent={page === 'settings'} onPress={() => openSettings()} />
    </>
  );

  const listOpen = page.startsWith('list:') ? state.lists.find((l) => `list:${l.id}` === page) : undefined;
  const custom = page.startsWith('object:') ? state.objects.find((o) => `object:${o.id}` === page) : undefined;
  const head = page === 'more' ? { label: 'More', icon: <Menu {...i16} /> } : custom ? { label: custom.many, icon: <Boxes {...i16} /> } : listOpen ? { label: listOpen.name, icon: <ListChecks {...i16} /> } : TITLES[page];
  const lk = launch ? `${launch.kind}-${launch.n}` : 'plain';
  const main: ReactNode = page === 'home' ? <HomeScreen state={state} dispatch={dispatch} bookings={bookings} onGo={go} onBookings={openBookings} onImport={() => { go('records:people'); setSub('import'); }} onSettings={(at) => openSettings(at)} onNewTask={() => launchAt('task', 'tasks')} onReports={(rid) => launchAt('report', 'insights', rid)} />
    : page === 'more' ? <MoreScreen state={state} bookings={bookings} kind={kind} unread={unread} onGo={go} onBookings={openBookings} onSettings={openSettings} onSignOut={() => setSigningOut(true)} onNewList={() => setNewList(true)} />
    : page === 'inbox' ? <InboxScreen state={state} dispatch={dispatch} onOpenRecord={openRecord} onBookings={openBookings} />
    : page === 'tasks' ? <TasksScreen key={lk} state={state} dispatch={dispatch} onOpenRecord={openRecord} onBookings={openBookings} startNew={launch?.kind === 'task' && !launch.value} openTask={launch?.kind === 'task' ? launch.value : undefined} newFor={taskFor} />
    : page === 'notes' ? <NotesScreen key={lk} state={state} dispatch={dispatch} onOpenRecord={openRecord} onBookings={openBookings} openNote={launch?.kind === 'note' ? launch.value : undefined} />
    : page === 'settings' ? <SettingsScreen key={settingsStart.n} state={state} dispatch={dispatch} onBookings={openBookings} calendars={bookings?.calendars} bookings={bookings} onBookingsAction={toBookings} onImport={() => { go('records:people'); setSub('import'); }} onLinkPage={() => go('link')} onOpenRecord={(o, rid) => openRecord(o, rid)} onOpenList={(lid) => go(`list:${lid}`)} start={settingsStart.page} kind={kind} onDoor={(d) => { if (d === 'signin') setDoor('signin'); else setDoor(d); }} />
    : page === 'link' ? <LinkPageScreen state={state} dispatch={dispatch} handle={handleFor(state, bookings)} onBack={() => go('links')} />
    : page === 'links' ? <LinksScreen state={state} bookings={bookings} appsMenu={state.prefs.apps.menu} onLinkPage={() => go('link')} onBookings={openBookings}
        onBookingPage={(pageId, scenario) => setBookGuest((g) => ({ pageId, scenario, n: (g?.n ?? 0) + 1 }))} onForm={(id, visit) => launchAt(visit ? 'visit' : 'form', 'forms', id)} />
    : page === 'insights' ? <InsightsScreen key={lk} state={state} dispatch={dispatch} bookings={bookings} startTab={launch?.kind === 'report' ? 'reports' : undefined} startReport={launch?.kind === 'report' ? launch.value : undefined} />
    : page === 'forms' ? <FormsScreen key={lk} start={launch && (launch.kind === 'form' || launch.kind === 'visit') && launch.value ? { id: launch.value, visit: launch.kind === 'visit' } : undefined} state={state} dispatch={dispatch} onOpenPerson={(id) => openRecord('people', id)} onBookings={openBookings} onBookGuest={(w) => setBookGuest((g) => ({ prefill: w.name || w.email ? { name: w.name || w.email, email: w.email } : undefined, n: (g?.n ?? 0) + 1 }))} />
    : custom ? <CustomRecordsScreen key={custom.id} state={state} dispatch={dispatch} schema={custom} onAttributes={() => openSettings('objects')} />
    : listOpen ? <ListScreen key={listOpen.id} state={state} dispatch={dispatch} listId={listOpen.id} onOpenRecord={openRecord} onDeleted={() => go('home')} onRestored={(lid) => go(`list:${lid}`)} />
    : page.startsWith('records:') ? <RecordsScreen key={`${page}-${lk}`} state={state} dispatch={dispatch} object={page.slice(8) as ObjectId} onOpen={openRecord}
      startNew={(launch?.kind === 'person' && page === 'records:people') || (launch?.kind === 'company' && page === 'records:companies') ? launch.value ?? '' : undefined}
      onImport={page !== 'records:deals' ? () => setSub('import') : undefined} onDuplicates={page !== 'records:deals' ? () => setSub('dupes') : undefined} onAttributes={() => openSettings('objects')} />
    : <Rebuilding page={page} onHome={() => go('home')} />;
  const content: ReactNode = page === 'bookings' ? undefined : (
    <>
      <TopBar title={<span className="tf-app__title">{head?.icon}{head?.label}</span>}
        actions={searchButton} />
      <div className="tf-app__body">
        {sub === 'import' ? <ImportScreen key={page} state={state} dispatch={dispatch} object={page === 'records:companies' ? 'companies' : 'people'} onDone={() => setSub(undefined)} />
          : sub === 'dupes' ? <DuplicatesScreen state={state} dispatch={dispatch} object={page === 'records:companies' ? 'companies' : 'people'} onDone={() => setSub(undefined)} />
          : <>
            {record && <RecordPage key={`${record.object}-${record.id}`} state={state} dispatch={dispatch} object={record.object} id={record.id} onBack={back} onOpen={openRecord}
              backLabel={trail.length ? undefined : head?.label} initialTab={record.tab} />}
            <div className="tf-app__keep" hidden={record !== undefined}>{main}</div>
          </>}
      </div>
    </>
  );
  const moreIds = ['more', 'tasks', 'notes', 'forms', 'link', 'links', 'insights', 'settings'];
  const tabCurrent = page.startsWith('records') || page.startsWith('object:') ? 'records' : moreIds.includes(page) || page.startsWith('list:') ? 'more' : page;

  return (
    <>
      {state.previewRole && <div className="tf-app__preview tf-app__preview--fixed" role="status"><span>Previewing as a {state.previewRole.toLowerCase()}: you see what they see and can only do what they can.</span><Button size="sm" variant="secondary" onPress={() => dispatch({ type: 'preview/set', role: undefined })}>Stop previewing</Button></div>}
      <div className="tf-app__keep" inert={door !== undefined || undefined}>
      <BookingsFlow showDemoMenu appActions={searchButton} commands={bookingsCmds} isReadOnly={state.previewRole !== undefined} appNav={nav} appContent={content} onBookingsNav={() => { setPage('bookings'); setRecord(undefined); setTrail([]); }} onState={setBookings} openTab={openTab} openGuest={bookGuest} switchWorkspace={switchWs}
        onAddToLinkPage={(b) => {
          const was = state.linkPage ?? STARTER;
          if (was.blocks.some((x) => x.kind === 'booking' && x.title === b.name)) return undefined;
          dispatch({ type: 'link/publish', page: { ...was, blocks: [...was.blocks, { kind: 'booking', id: newId('lb'), title: b.name, durationMinutes: b.minutes, location: { kind: 'video', label: b.place } }] } });
          return () => dispatch({ type: 'link/publish', page: was });
        }}
        hiddenSections={state.prefs.apps.menu ? [] : ['menu']} person={{ name: state.me, email: me?.email ?? '', src: state.prefs.photo }} workspaceName={state.prefs.workspace.name}
        onMenu={(id) => { if (id === 'signout') setSigningOut(true); else if (id === 'create') setDoor('welcome'); else openSettings(id === 'profile' ? 'profile' : 'general'); }}
        appMobileNav={<TabBar aria-label="Timefix" current={tabCurrent}
          items={[{ id: 'home', label: 'Home', icon: <Home {...i16} /> }, { id: 'inbox', label: 'Inbox', icon: <Inbox {...i16} />, badge: unread }, { id: 'records', label: 'Records', icon: <Users {...i16} /> },
            { id: 'bookings', label: kind === 'restaurant' ? 'Tables' : 'Bookings', icon: <CalendarDays {...i16} />, badge: (bookings?.meetings ?? []).filter((m) => m.status === 'pending' && m.end > new Date()).length }, { id: 'more', label: 'More', icon: <Menu {...i16} /> }]}
          onChange={(id) => (id === 'records' ? go('records:people') : id === 'bookings' ? openBookings('meetings') : go(id as AppPage))} />} />
      </div>
      {newList && <NewListDialog onClose={() => setNewList(false)} onCreate={(l) => { dispatch({ type: 'list/set', list: l }); setNewList(false); go(`list:${l.id}`); }} />}
      {signingOut && <Dialog isOpen onOpenChange={(o) => { if (!o) setSigningOut(false); }} title="Sign out?" description={`You can sign back in to ${state.prefs.workspace.name} with your email.`}
        actions={<><Button variant="ghost" slot="close">Cancel</Button><Button variant="primary" onPress={() => { setSigningOut(false); setDoor('signin'); }}>Sign out</Button></>} />}
      {door && <DoorScreen door={door} onDoor={setDoor}
        ctx={{ workspace: state.prefs.workspace.name, slug: state.prefs.workspace.slug, name: state.me, email: me?.email ?? '', twoFactor: state.prefs.twoFactor, memberEmails: state.members.map((m) => m.email.toLowerCase()), require2fa: state.prefs.rules.require2fa }}
        onTwoFactorOn={() => dispatch({ type: 'prefs/set', prefs: { twoFactor: true }, note: `${state.me} turned on two factor` })}
        onDone={() => { const signed = door === 'signin' || door === 'twofactor'; setDoor(undefined); if (signed) goStart(); }}
        onFormat={(k) => { setSwitchWs((w) => ({ id: k === 'salon' ? 'lumen' : k === 'restaurant' ? 'olive' : 'northwind', n: (w?.n ?? 0) + 1 }));
          if (k !== 'team') { openBookings('meetings'); toast({ message: k === 'salon' ? 'Here’s a salon set up with services, staff and a booking page. Change anything.' : 'Here’s a restaurant set up with tables, services and a menu. Change anything.', tone: 'success' }); } }}
        onRestore={() => { dispatch({ type: 'history/add', text: `${state.me} restored ${state.prefs.workspace.name}` }); toast({ message: `${state.prefs.workspace.name} is back. Everyone has access again.`, tone: 'success' }); }}
        onJoin={() => { const iv = state.prefs.invites[0]; if (!iv) return; rawDispatch({ type: 'member/set', member: { id: newId('u'), name: iv.email.split('@')[0]?.replace(/^./, (c) => c.toUpperCase()) ?? iv.email, email: iv.email, role: iv.role === 'guest' ? 'Guest' : 'Member', title: '' }, note: `${iv.email} accepted the invitation` }); rawDispatch({ type: 'prefs/update', fn: (q) => ({ invites: q.invites.filter((x) => x.id !== iv.id) }) }); toast({ message: `${iv.email} joined ${state.prefs.workspace.name}`, tone: 'success' }); }}
        onAskJoin={() => { rawDispatch({ type: 'prefs/update', fn: (q) => ({ joinRequests: [...q.joinRequests, { id: newId('jr'), name: 'Arjun Nair', email: `arjun@${q.workspace.slug}.com` }] }) }); }}
        onFinish={(v) => { dispatch({ type: 'prefs/set', prefs: { workspace: { ...state.prefs.workspace, name: v.workspace, slug: v.slug }, invites: [...state.prefs.invites, ...v.invites.map((x) => ({ id: newId('iv'), email: x.email, role: x.role, at: new Date() }))] }, note: `${state.me} set up ${v.workspace}` });
          toast({ message: `Welcome to ${v.workspace}`, tone: 'success' }); go('home'); }} />}
      <CommandPalette isOpen={search} onOpenChange={setSearch} items={commands} recent={recentItems} fromQuery={fromQuery} onAction={onCommand} onShowShortcuts={() => { setSearch(false); setHelp(true); }}
        placeholder="Search people, companies, deals, notes, or type a command…" />
      <ShortcutHelp isOpen={help} onOpenChange={setHelp} />
    </>
  );
}

/** Phone: every place the tab bar can't hold, in the sidebar's order, Bookings pages included. */
function MoreScreen({ state, bookings, kind, unread, onGo, onBookings, onSettings, onSignOut, onNewList }: { readonly state: AppState; readonly bookings?: BookingsState; readonly kind: string; readonly unread: number;
  readonly onGo: (p: AppPage) => void; readonly onBookings: (tab: string) => void; readonly onSettings: (at?: string) => void; readonly onSignOut: () => void; readonly onNewList: () => void }) {
  void unread;
  const team = kind === 'team';
  const row = (key: string, label: string, icon: ReactNode, onPress: () => void, count?: number) => (
    <li key={key}><button type="button" className="tf-more__item" onClick={onPress}>{icon}<span>{label}</span>{count ? <span className="tf-more__count">{count}</span> : <span />}<ChevronRight size={16} strokeWidth={1.75} aria-hidden /></button></li>
  );
  const group = (title: string, rows: ReadonlyArray<ReactNode>) => <section className="tf-more__group" aria-label={title}><h2>{title}</h2><ul>{rows}</ul></section>;
  const myOpen = state.tasks.filter((t) => !t.done && t.assignee === state.me).length;
  const hide = new Set(state.prefs.sidebarHidden);
  return (
    <div className="tf-more">
      {group('You', [...(hide.has('tasks') ? [] : [row('tasks', 'Tasks', <CheckSquare {...i16} />, () => onGo('tasks'), myOpen)]), ...(hide.has('notes') ? [] : [row('notes', 'Notes', <NotebookPen {...i16} />, () => onGo('notes'))])])}
      {group('Records', [...OBJECTS.map((o) => row(o.id, o.label, o.icon, () => onGo(`records:${o.id}`))), ...state.objects.filter((o) => o.custom && !o.archived).map((o) => row(o.id, o.many, <Boxes {...i16} />, () => onGo(`object:${o.id}`)))])}
      {!hide.has('lists') && group('Lists', [...state.lists.filter((l) => !l.archived).map((l) => row(l.id, l.name, <ListChecks {...i16} />, () => onGo(`list:${l.id}`), liveEntries(state, l).length)), row('new-list', 'New list', <Plus {...i16} />, onNewList)])}
      {group('Bookings', [
        row('meetings', kind === 'restaurant' ? 'Reservations' : 'Meetings', <CalendarDays {...i16} />, () => onBookings('meetings')),
        row('pages', team ? 'Booking pages' : 'Your business page', <Link2 {...i16} />, () => onBookings('pages')),
        ...(bookings?.menu && state.prefs.apps.menu ? [row('menu', 'Menu', <UtensilsCrossed {...i16} />, () => onBookings('menu'))] : []),
        row('availability', team ? 'Availability' : 'Opening hours', <Clock {...i16} />, () => onBookings('availability')),
        ...(team ? [row('roster', 'Roster', <CalendarRange {...i16} />, () => onBookings('roster')), row('routing', 'Routing', <Route {...i16} />, () => onBookings('routing'))] : []),
      ])}
      {group('Grow', [row('links', 'Links', <Link2 {...i16} />, () => onGo('links')), ...(hide.has('forms') ? [] : [row('forms', 'Forms', <FileText {...i16} />, () => onGo('forms'))]), ...(hide.has('insights') ? [] : [row('insights', 'Insights', <BarChart3 {...i16} />, () => onGo('insights'))])])}
      {group(state.prefs.workspace.name, [row('settings', 'Settings', <Settings {...i16} />, () => onSettings()), row('profile', 'Your profile', <UserRound {...i16} />, () => onSettings('profile')), row('signout', 'Sign out', <LogOut {...i16} />, onSignOut)])}
    </div>
  );
}

/** A module not rebuilt yet in the new language: says so plainly and leads home. */
function Rebuilding({ page, onHome }: { readonly page: AppPage; readonly onHome: () => void }) {
  const head = TITLES[page];
  return (
    <div className="tf-app__empty">
      <EmptyState icon={head?.icon} title={`${head?.label ?? 'This page'} is being rebuilt`} description="It joins the new design in the next pass, with everything main has."
        action={<Button size="sm" variant="secondary" onPress={onHome}>Back to Home</Button>} />
    </div>
  );
}
