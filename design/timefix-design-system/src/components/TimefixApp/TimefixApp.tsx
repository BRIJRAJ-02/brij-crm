// The whole Timefix app as one prototype: the sidebar from app-ia.md (You, Records, Lists, Bookings, Forms, Link page, Insights),
// ⌘K over everything, Home, and each module as it's rebuilt. Bookings is the module already built: it stays mounted inside, so its state is kept.
import { useMemo, useReducer, useState, type ReactNode } from 'react';
import { BarChart3, Building2, CalendarDays, CheckSquare, CircleDollarSign, FileText, Home, IdCard, Inbox, ListChecks, NotebookPen, Plus, Search, Settings, UserPlus, Users } from 'lucide-react';
import { NavItem, NavSection } from '../Sidebar/Sidebar.tsx';
import { TabBar, TopBar } from '../AppShell/AppShell.tsx';
import { Button } from '../Button/Button.tsx';
import { EmptyState } from '../EmptyState/EmptyState.tsx';
import { CommandPalette, useCommandK, type CommandItem } from '../CommandPalette/CommandPalette.tsx';
import { ToastProvider } from '../Toast/Toast.tsx';
import { BookingsFlow, type BookingsState } from '../BookingsFlow/BookingsFlow.tsx';
import { appReducer, northwindCrm, type AppState, type ObjectId } from './data.ts';
import { HomeScreen } from './home.tsx';
import './TimefixApp.css';

const i16 = { size: 16, strokeWidth: 1.75 } as const;

/** Where the app is: a module, and for Records which object. */
export type AppPage = 'home' | 'inbox' | 'tasks' | 'notes' | `records:${ObjectId}` | 'lists' | 'forms' | 'link' | 'insights' | 'settings' | 'bookings';

const OBJECTS: ReadonlyArray<{ readonly id: ObjectId; readonly label: string; readonly icon: ReactNode }> = [
  { id: 'people', label: 'People', icon: <Users {...i16} /> }, { id: 'companies', label: 'Companies', icon: <Building2 {...i16} /> }, { id: 'deals', label: 'Deals', icon: <CircleDollarSign {...i16} /> },
];
const TITLES: Readonly<Record<string, { readonly label: string; readonly icon: ReactNode }>> = {
  home: { label: 'Home', icon: <Home {...i16} /> }, inbox: { label: 'Inbox', icon: <Inbox {...i16} /> }, tasks: { label: 'Tasks', icon: <CheckSquare {...i16} /> }, notes: { label: 'Notes', icon: <NotebookPen {...i16} /> },
  lists: { label: 'Lists', icon: <ListChecks {...i16} /> }, forms: { label: 'Forms', icon: <FileText {...i16} /> }, link: { label: 'Link page', icon: <IdCard {...i16} /> },
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

function App({ initial, start = 'home' }: TimefixAppProps) {
  const [state, dispatch] = useReducer(appReducer, initial ?? northwindCrm());
  const [page, setPage] = useState<AppPage>(start);
  const [bookings, setBookings] = useState<BookingsState>();
  const [openTab, setOpenTab] = useState<{ readonly tab: string; readonly n: number }>();
  const [search, setSearch] = useState(false);
  useCommandK(() => setSearch(true));
  const go = (p: AppPage) => setPage(p);
  const openBookings = (tab: string) => { setOpenTab((o) => ({ tab, n: (o?.n ?? 0) + 1 })); setPage('bookings'); };
  const unread = state.inbox.filter((x) => !x.read && !x.done).length;
  const myOpen = state.tasks.filter((t) => !t.done && t.assignee === state.me).length;

  // ⌘K: records first, then pages and actions. Typing narrows across all of them.
  const commands = useMemo<ReadonlyArray<CommandItem>>(() => [
    ...state.people.map((p) => ({ id: `people:${p.id}`, label: p.name, group: 'People', kind: 'person' as const, sub: [p.title, state.companies.find((c) => c.id === p.companyId)?.name].filter(Boolean).join(' · '), keywords: p.email })),
    ...state.companies.map((c) => ({ id: `companies:${c.id}`, label: c.name, group: 'Companies', kind: 'record' as const, sub: c.domain })),
    ...state.deals.map((d) => ({ id: `deals:${d.id}`, label: d.name, group: 'Deals', kind: 'record' as const, sub: d.stage })),
    ...(['home', 'inbox', 'tasks', 'notes', 'forms', 'link', 'insights', 'settings'] as const).map((id) => ({ id: `go:${id}`, label: `Go to ${TITLES[id]?.label ?? id}`, group: 'Go to', kind: 'action' as const, icon: TITLES[id]?.icon })),
    { id: 'go:bookings', label: 'Go to Meetings', group: 'Go to', kind: 'action' as const, icon: <CalendarDays {...i16} />, keywords: 'bookings calendar' },
    { id: 'new:person', label: 'New person', group: 'Actions', kind: 'action' as const, icon: <UserPlus {...i16} />, keywords: 'create contact' },
    { id: 'new:task', label: 'New task', group: 'Actions', kind: 'action' as const, icon: <CheckSquare {...i16} />, keywords: 'create todo' },
    { id: 'new:booking', label: 'New booking page', group: 'Actions', kind: 'action' as const, icon: <Plus {...i16} />, keywords: 'create link meeting' },
  ], [state.people, state.companies, state.deals]);
  const onCommand = (id: string) => {
    setSearch(false);
    const [kind, rest] = id.split(':') as [string, string];
    if (kind === 'go') { if (rest === 'bookings') openBookings('meetings'); else go(rest as AppPage); }
    else if (kind === 'people' || kind === 'companies' || kind === 'deals') go(`records:${kind}`);
    else if (id === 'new:booking') openBookings('pages');
    else if (id === 'new:person') go('records:people');
    else if (id === 'new:task') go('tasks');
  };

  const nav = (bookingsSection: ReactNode) => (
    <>
      <NavItem label="Search" icon={<Search {...i16} />} shortcut="⌘K" onPress={() => setSearch(true)} />
      <NavItem label="Home" icon={<Home {...i16} />} isCurrent={page === 'home'} onPress={() => go('home')} />
      <NavItem label="Inbox" icon={<Inbox {...i16} />} badge={unread || undefined} isCurrent={page === 'inbox'} onPress={() => go('inbox')} />
      <NavItem label="Tasks" icon={<CheckSquare {...i16} />} count={myOpen || undefined} isCurrent={page === 'tasks'} onPress={() => go('tasks')} />
      <NavItem label="Notes" icon={<NotebookPen {...i16} />} isCurrent={page === 'notes'} onPress={() => go('notes')} />
      <NavSection title="Records" addLabel="New object" onAdd={() => go('settings')}>
        {OBJECTS.map((o) => <NavItem key={o.id} label={o.label} icon={o.icon} isCurrent={page === `records:${o.id}`} onPress={() => go(`records:${o.id}`)} />)}
      </NavSection>
      <NavSection title="Lists" addLabel="New list" onAdd={() => go('lists')}>
        <NavItem label="Q4 pipeline" icon={<ListChecks {...i16} />} isCurrent={page === 'lists'} onPress={() => go('lists')} />
      </NavSection>
      {bookingsSection}
      <NavSection title="Grow">
        <NavItem label="Forms" icon={<FileText {...i16} />} isCurrent={page === 'forms'} onPress={() => go('forms')} />
        <NavItem label="Link page" icon={<IdCard {...i16} />} isCurrent={page === 'link'} onPress={() => go('link')} />
        <NavItem label="Insights" icon={<BarChart3 {...i16} />} isCurrent={page === 'insights'} onPress={() => go('insights')} />
      </NavSection>
      <NavItem label="Settings" icon={<Settings {...i16} />} shortcut="⌘," isCurrent={page === 'settings'} onPress={() => go('settings')} />
    </>
  );

  const head = TITLES[page];
  const content: ReactNode = page === 'bookings' ? undefined : (
    <>
      <TopBar title={<span className="tf-app__title">{head?.icon}{head?.label}</span>}
        actions={<Button size="sm" variant="ghost" icon={<Search size={14} strokeWidth={1.75} />} onPress={() => setSearch(true)}>Search</Button>} />
      <div className="tf-app__body">
        {page === 'home' ? <HomeScreen state={state} dispatch={dispatch} bookings={bookings} onGo={go} onBookings={openBookings} />
          : <Rebuilding page={page} onHome={() => go('home')} />}
      </div>
    </>
  );

  return (
    <>
      <BookingsFlow showDemoMenu appNav={nav} appContent={content} onBookingsNav={() => setPage('bookings')} onState={setBookings} openTab={openTab}
        appMobileNav={<TabBar aria-label="Timefix" current={page.startsWith('records') ? 'records' : page}
          items={[{ id: 'home', label: 'Home', icon: <Home {...i16} /> }, { id: 'inbox', label: 'Inbox', icon: <Inbox {...i16} />, badge: unread }, { id: 'records', label: 'Records', icon: <Users {...i16} /> },
            { id: 'bookings', label: 'Bookings', icon: <CalendarDays {...i16} /> }, { id: 'settings', label: 'More', icon: <Settings {...i16} /> }]}
          onChange={(id) => (id === 'records' ? go('records:people') : id === 'bookings' ? openBookings('meetings') : go(id as AppPage))} />} />
      <CommandPalette isOpen={search} onOpenChange={setSearch} items={commands} onAction={onCommand} placeholder="Search people, companies, deals, or type a command…" />
    </>
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
