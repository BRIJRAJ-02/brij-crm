import { useEffect, useReducer, useRef, useState } from 'react';
import { I18nProvider, type Key } from 'react-aria-components';
import { AlertTriangle, BarChart3, CalendarDays, CalendarRange, Clock, FileText, FlaskConical, Home, Inbox, Link2, LogOut, PauseCircle, Play, RotateCcw, Route, Settings, User, Users } from 'lucide-react';
import { AppShell, TabBar, TopBar } from '../AppShell/AppShell.tsx';
import { Sidebar, WorkspaceSwitcher, NavItem, NavSection, PersonRow } from '../Sidebar/Sidebar.tsx';
import { ConfirmDialog } from '../Dialog/Dialog.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { useToast, ACTION_TOAST_TIMEOUT_MS } from '../Toast/Toast.tsx';
import { NotificationBell, NotificationList } from '../NotificationList/NotificationList.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { Button } from '../Button/Button.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import type { Meeting } from '../MeetingList/MeetingList.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay } from '../../lib/format.ts';
import { i14, i16, type ShareHow } from './parts.tsx';
import { CreateSheet } from './create.tsx';
import { ShareDialogs, type ShareDialogKind } from './share.tsx';
import { MeetingsTab, NewMeetingDialog, DeclineDialog, HoldDialog, meetingFrom, type PickedTime, type Whose } from './meetings.tsx';
import { MeetingDrawer, RescheduleDialog, ReassignDialog } from './drawer.tsx';
import { PagesTab } from './pages.tsx';
import { PageEditor, type EditorSection } from './editor.tsx';
import { AvailabilityTab } from './availability.tsx';
import { RosterTab } from './roster.tsx';
import { InsightsTab } from './insights.tsx';
import { RoutingTab, GroupsDialog } from './routing.tsx';
import { GuestMode, GUEST_SCENARIOS, type GuestScenario } from './guest.tsx';
import { FIRST_VISIT, NORTHWIND, northwind, uniqueSlug } from './seed.ts';
import {
  HOST, PLACES, TEAM, at, bookingsReducer, first, hostFor, isOff, isoDay, mondayOf, nextId, pageUrl, parseDay, placeLabel, plural,
  type BookedMeeting, type BookingPage, type BookingsAction, type BookingsState,
} from './state.ts';
import './BookingsFlow.css';

export { bookingsReducer, FIRST_VISIT, NORTHWIND, northwind };
export type { BookingsState, BookingsAction, BookingPage, BookedMeeting };

/** Props for BookingsFlow. */
export interface BookingsFlowProps {
  /** Where the flow starts: the Northwind dummy workspace by default; `FIRST_VISIT` for an empty one. */
  readonly initialState?: BookingsState;
  /** Shows the Demo menu in the top bar: start fresh, edge cases and the guest's side. */
  readonly showDemoMenu?: boolean;
}

const readWhose = (workspace: string): Whose => { try { return window.localStorage.getItem(`tf-bkf-whose:${workspace}`) ?? 'mine'; } catch { return 'mine'; } };
const saveWhose = (workspace: string, w: Whose) => { try { window.localStorage.setItem(`tf-bkf-whose:${workspace}`, w); } catch { /* storage may be off */ } };

/** The whole Bookings module as one live flow over a dummy workspace: Meetings, Pages, Availability and Routing, plus the guest's side. Built only from the system's components. */
/** Bookings' own pages in the sidebar: one job each, no tabs. */
const SECTIONS = [
  { id: 'meetings', label: 'Meetings', icon: <CalendarDays {...i16} /> },
  { id: 'pages', label: 'Booking pages', icon: <Link2 {...i16} /> },
  { id: 'availability', label: 'Availability', icon: <Clock {...i16} /> },
  { id: 'roster', label: 'Roster', icon: <CalendarRange {...i16} /> },
  { id: 'routing', label: 'Routing', icon: <Route {...i16} /> },
  { id: 'insights', label: 'Insights', icon: <BarChart3 {...i16} /> },
] as const;
/** One word each under the phone tab bar's icons. */
const SHORT: Record<string, string> = { meetings: 'Meetings', pages: 'Pages', availability: 'Hours', roster: 'Roster', routing: 'Routing', insights: 'Insights' };

export function BookingsFlow({ initialState = NORTHWIND, showDemoMenu = false }: BookingsFlowProps) {
  const [state, dispatch] = useReducer(bookingsReducer, initialState);
  const { toast } = useToast();
  const [tab, setTab] = useState('meetings');
  const [view, setView] = useState('list');
  const [whose, setWhoseState] = useState<Whose>(() => readWhose(initialState.workspace));
  const [week, setWeek] = useState(0);
  const [focusHour, setFocusHour] = useState<number>();
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<{ readonly id: string; readonly draft: BookingPage; readonly section?: EditorSection }>();
  const [guest, setGuest] = useState<{ readonly scenario: GuestScenario; readonly pageId: string; readonly meetingId?: string }>();
  const [meetingId, setMeetingId] = useState<string>();
  const [bellOpen, setBellOpen] = useState(false);
  const [share, setShare] = useState<{ readonly kind: ShareDialogKind; readonly id: string }>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [freshPage, setFreshPage] = useState<string>();
  const [freshMeeting, setFreshMeeting] = useState<string>();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1200);
  const [newMeeting, setNewMeeting] = useState<{ readonly initial?: PickedTime }>();
  const [declineId, setDeclineId] = useState<string>();
  const [holdAt, setHoldAt] = useState<PickedTime>();
  const [rescheduleId, setRescheduleId] = useState<string>();
  const [reassignId, setReassignId] = useState<string>();
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [resetTo, setResetTo] = useState<'fresh' | 'northwind'>();
  /** Bookings made in the guest view; the host side plays them when it closes, so the badge, the row and the count move in view. */
  const pending = useRef<Array<Extract<BookingsAction, { type: 'meeting/add' }>>>([]);
  /** Meetings whose cancel was undone, so "Guest emailed" is skipped. */
  const undone = useRef(new Set<string>());

  const now = new Date();
  const pageById = (id: string | undefined) => state.pages.find((p) => p.id === id);
  const meetingById = (id: string | undefined) => state.meetings.find((m) => m.id === id);
  const upcoming = state.meetings.filter((m) => m.status !== 'cancelled' && m.end > now && m.host === HOST).length;
  const waiting = state.meetings.filter((m) => m.status === 'pending' && m.end > now).length;
  const unread = state.notifications.filter((n) => !n.read).length;
  const flash = (setter: (v: string | undefined) => void, id: string) => { setter(id); window.setTimeout(() => setter(undefined), 1600); };
  const setWhose = (w: Whose) => { setWhoseState(w); saveWhose(state.workspace, w); };
  const update = (m: BookedMeeting, text?: string) => dispatch({ type: 'meeting/update', meeting: text ? { ...m, activity: [...m.activity, { id: nextId('a'), text, at: new Date() }] } : m });
  useEffect(() => { setWhoseState(readWhose(state.workspace)); }, [state.workspace]);

  /* Pages */
  const remove = (p: BookingPage) => {
    const index = state.pages.findIndex((x) => x.id === p.id);
    if (editor?.id === p.id) { setEditor(undefined); setTab('pages'); }
    setLeaving((s) => new Set(s).add(p.id));
    window.setTimeout(() => {
      setLeaving((s) => { const n = new Set(s); n.delete(p.id); return n; });
      dispatch({ type: 'page/delete', id: p.id });
      toast({ message: `${p.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'page/restore', page: p, index }); flash(setFreshPage, p.id); } } });
    }, 250);
  };
  const upcomingOn = (id: string) => state.meetings.filter((m) => m.pageId === id && m.status !== 'cancelled' && m.end > now).length;
  const onMore = (p: BookingPage, key: 'edit' | 'duplicate' | 'delete') => {
    if (key === 'edit') setEditor({ id: p.id, draft: p });
    else if (key === 'duplicate') {
      const copy = { ...p, id: nextId('page'), name: `${p.name} (copy)`, slug: uniqueSlug(`${p.slug}-copy`, state.pages), links: [], offers: [], stats: { views: 0, bookings: 0, showRate: 0 } };
      dispatch({ type: 'page/upsert', page: copy });
      setEditor(undefined); setTab('pages'); flash(setFreshPage, copy.id);
      toast({ message: `${copy.name} made`, tone: 'success' });
    } else if (upcomingOn(p.id) > 0) setConfirmDelete(p.id);
    else remove(p);
  };
  const onShare = (p: BookingPage, how: ShareHow) => {
    const url = `https://${pageUrl(p.slug)}`;
    if (how === 'copy') {
      void navigator.clipboard?.writeText(url).catch(() => undefined);
      toast({ message: p.isOn ? 'Link copied' : "Link copied. The page is hidden, so guests see it isn't taking bookings.", tone: 'success' });
    } else if (how === 'linkpage') {
      toast({ message: `${p.name} added to your link page`, tone: 'success', action: { label: 'Undo', onAction: () => toast({ message: `${p.name} taken off your link page` }) } });
    } else setShare({ kind: how === 'once' ? 'once' : how, id: p.id });
  };
  const toggle = (id: string, isOn: boolean) => {
    const p = pageById(id);
    if (!p) return;
    dispatch({ type: 'page/upsert', page: { ...p, isOn } });
    toast({ message: isOn ? `${p.name} is taking bookings` : `${p.name} is hidden. Guests see it isn't taking bookings.`, action: { label: 'Undo', onAction: () => dispatch({ type: 'page/upsert', page: { ...p, isOn: !isOn } }) } });
  };

  /* Guest bookings */
  const book = (p: BookingPage, r: { readonly name: string; readonly email: string; readonly notes: string; readonly guests?: ReadonlyArray<string>; readonly date: { readonly year: number; readonly month: number; readonly day: number }; readonly minutes: number; readonly timeZone: string; readonly length: number; readonly place: keyof typeof PLACES }) => {
    const day = new Date(r.date.year, r.date.month - 1, r.date.day);
    const start = at(day, r.minutes);
    const id = nextId('m');
    const name = r.name.trim() || 'Guest';
    const host = hostFor(state, p, day, r.minutes, r.minutes + r.length) ?? p.hosts[0] ?? HOST;
    pending.current.push({
      type: 'meeting/add',
      meeting: {
        id, pageId: p.id, host, start, end: new Date(start.getTime() + r.length * 60_000), title: p.name, invitee: { name, email: r.email }, guests: r.guests && r.guests.length ? r.guests : undefined, place: PLACES[r.place].meeting, placeLabel: placeLabel(p, r.place),
        status: p.confirmFirst ? 'pending' : 'confirmed', notes: '', answers: r.notes ? [{ question: 'Anything to share before the call?', answer: r.notes }] : [], guestZone: r.timeZone,
        record: p.addToPeople ? { id: nextId('r'), name, kind: 'person', sub: r.email } : undefined, activity: [{ id: nextId('a'), text: `Booked by ${name}`, at: new Date() }],
      },
      notification: { id, actor: name, action: p.confirmFirst ? 'asked to book' : 'booked', object: `${p.name} · ${r.length} min`, excerpt: `${formatDay(start)}, ${formatClockRange(r.minutes, r.minutes + r.length)}`, time: 'Just now', group: 'Today', read: false },
    });
  };
  const closeGuest = () => {
    setGuest(undefined);
    const booked = pending.current;
    pending.current = [];
    const last = booked[booked.length - 1];
    if (!last) return;
    setEditor(undefined); setTab('meetings'); setView('list');
    if (!(whose === 'everyone' || whose === last.meeting.host || (whose === 'mine' && last.meeting.host === HOST))) setWhose('everyone');
    window.setTimeout(() => {
      booked.forEach((b) => dispatch(b));
      const { id } = last.meeting;
      flash(setFreshMeeting, id);
      toast({ message: `${last.notification?.actor ?? 'A guest'} ${last.notification?.action ?? 'booked'} ${last.notification?.object ?? ''}`, tone: 'info', action: { label: 'Open', onAction: () => { dispatch({ type: 'note/read', id, read: true }); setMeetingId(id); } } });
    }, 300);
  };

  /* Meetings */
  const cancelNow = (m: Meeting) => { const x = meetingById(m.id); if (x) update({ ...x, status: 'cancelled' }, `Cancelled by ${HOST}`); };
  const cancelFromDrawer = (m: BookedMeeting) => {
    setMeetingId(undefined);
    update({ ...m, status: 'cancelled' }, `Cancelled by ${HOST}`);
    undone.current.delete(m.id);
    toast({ message: 'Cancelled', action: { label: 'Undo', onAction: () => { undone.current.add(m.id); update(m); } } });
    window.setTimeout(() => { if (!undone.current.has(m.id)) toast({ message: 'Cancelled · Guest emailed' }); }, ACTION_TOAST_TIMEOUT_MS);
  };
  const move = (m: BookedMeeting, start: Date, how: string) => {
    const end = new Date(start.getTime() + (m.end.getTime() - m.start.getTime()));
    update({ ...m, start, end }, `Moved to ${formatDay(start)}, ${formatClockRange(minutesOf(start), minutesOf(end))}`);
    toast({ message: `Moved to ${formatDay(start)}, ${formatClockRange(minutesOf(start), minutesOf(end))}. ${first(m.invitee.name)} ${how}.`, tone: 'success', action: { label: 'Undo', onAction: () => update(m) } });
  };
  const freeTeammate = (m: BookedMeeting, pool: ReadonlyArray<string> = TEAM) => pool.find((n) => n !== m.host && !isOff(state, n, m.start, minutesOf(m.start), minutesOf(m.end))
    && !state.meetings.some((x) => x.id !== m.id && x.host === n && x.status !== 'cancelled' && x.start < m.end && m.start < x.end));
  const reassignMany = (list: ReadonlyArray<BookedMeeting>, pool?: ReadonlyArray<string>) => {
    let n = 0;
    list.forEach((m) => { const to = freeTeammate(m, pool); if (to) { n += 1; update({ ...m, host: to }, `Reassigned from ${m.host} to ${to}`); } });
    return n;
  };
  const confirm = (id: string) => { const m = meetingById(id); if (!m) return; update({ ...m, status: 'confirmed' }, `Confirmed by ${HOST}`); dispatch({ type: 'note/read', id, read: true }); toast({ message: `Confirmed · ${first(m.invitee.name)} gets an invitation`, tone: 'success', action: { label: 'Undo', onAction: () => update(m) } }); };
  const seeConflict = (m: Meeting) => {
    setView('week');
    setWeek(Math.round((mondayOf(m.start).getTime() - mondayOf(now).getTime()) / (7 * 86_400_000)));
    setFocusHour(m.start.getHours());
  };

  /* Demo menu */
  const demo = (k: Key) => {
    const key = String(k);
    const pick = (pred: (p: BookingPage) => boolean) => state.pages.find(pred) ?? state.pages[0];
    // Only these two replace the workspace, and each asks first.
    if (key === 'fresh' || key === 'northwind') { setResetTo(key); return; }
    if (key === 'team') {
      const group = state.groups[0];
      if (!group) { toast({ message: 'Start from Northwind first: it has a round robin team.' }); return; }
      dispatch({ type: 'groups/set', groups: state.groups.map((g) => (g.id === group.id ? { ...g, members: g.members.map((m) => ({ ...m, paused: true })) } : g)) });
      setEditor(undefined); setTab('pages');
      toast({ message: `Everyone in ${group.name} is paused` });
      return;
    }
    if (key === 'clash') {
      const mine = state.meetings.filter((m) => m.host === HOST && m.status === 'confirmed' && m.start > now).slice(0, 2);
      if (mine.length === 0) { toast({ message: 'Book a meeting first, then try the clash.' }); return; }
      mine.forEach((m) => dispatch({ type: 'busy/add', block: { id: nextId('busy'), member: HOST, day: isoDay(m.start), start: minutesOf(m.start) - 15, end: minutesOf(m.end) + 15, source: 'Team offsite · Google Calendar' } }));
      if (!state.calendars.some((c) => c.checkConflicts && c.status === 'connected')) dispatch({ type: 'calendar/set', calendars: [...state.calendars, { id: nextId('cal'), provider: 'Google', email: 'priya@northwind.com', calendars: 3, status: 'connected', checkConflicts: true }] });
      setEditor(undefined); setTab('meetings'); setView('list'); setFocusHour(undefined);
      return;
    }
    const scenario = GUEST_SCENARIOS.find((s) => s.id === key)?.id;
    if (!scenario) return;
    if (state.pages.length === 0) { toast({ message: 'Make a booking page first.' }); return; }
    const page = scenario === 'pending' || scenario === 'offered' ? pick((p) => p.confirmFirst || p.offers.length > 0)
      : scenario === 'hidden' ? pick((p) => !p.isOn) : pick((p) => p.isOn && p.whoCanBook === 'anyone' && p.durations.length === 1 && p.hostMode === 'one');
    if (page) setGuest({ scenario, pageId: page.id });
  };

  const editing = editor ? pageById(editor.id) : undefined;
  const openMeeting = meetingById(meetingId);
  const toDelete = pageById(confirmDelete);
  const deleteCount = toDelete ? upcomingOn(toDelete.id) : 0;
  const isTeam = state.pages.some((p) => p.hosts.length > 1) || state.routing.rules.length > 0;

  const sidebar = (
    <Sidebar isCollapsed={collapsed} onCollapsedChange={setCollapsed}
      header={<WorkspaceSwitcher name={state.workspace} plan="Team plan · 4 members" mark={<LogoMark size={28} />}>
        <MenuItem id="settings" icon={<Settings {...i16} />}>Workspace settings</MenuItem>
      </WorkspaceSwitcher>}
      footer={<PersonRow name={HOST} email="priya@northwind.com">
        <MenuItem id="profile" icon={<User {...i16} />}>Profile</MenuItem>
        <MenuSeparator />
        <MenuItem id="signout" icon={<LogOut {...i16} />}>Sign out</MenuItem>
      </PersonRow>}>
      <NavItem label="Home" icon={<Home {...i16} />} onPress={() => undefined} />
      <NavItem label="Inbox" icon={<Inbox {...i16} />} badge={unread} onPress={() => undefined} />
      <NavItem label="People" icon={<Users {...i16} />} onPress={() => undefined} />
      <NavItem label="Forms" icon={<FileText {...i16} />} onPress={() => undefined} />
      <NavSection title="Bookings">
        {SECTIONS.filter((x) => (x.id !== 'routing' && x.id !== 'roster') || isTeam).map((x) => (
          <NavItem key={x.id} label={x.label} icon={x.icon} count={x.id === 'meetings' ? upcoming : undefined} isCurrent={tab === x.id} onPress={() => { setEditor(undefined); setTab(x.id); }} />
        ))}
      </NavSection>
    </Sidebar>
  );

  const bell = (
    <NotificationBell count={unread} isOpen={bellOpen} onOpenChange={setBellOpen}>
      <NotificationList items={state.notifications} onOpen={(id) => {
        /* Picking a notification closes the inbox first; the meeting opens as the popover leaves, so the two never stack. */
        dispatch({ type: 'note/read', id, read: true });
        setBellOpen(false);
        window.setTimeout(() => setMeetingId(id), 150);
      }}
        onReadChange={(id, read) => dispatch({ type: 'note/read', id, read })} onReadAll={() => dispatch({ type: 'note/read-all' })} onArchive={(id) => dispatch({ type: 'note/archive', id })} />
    </NotificationBell>
  );

  const demoMenu = showDemoMenu && (
    <MenuTrigger>
      <Button size="sm" variant="ghost" icon={<FlaskConical {...i14} />}>Demo</Button>
      <Menu aria-label="Demo" placement="bottom end" onAction={demo}>
        <MenuSection title="As a guest">
          {GUEST_SCENARIOS.map((s) => <MenuItem key={s.id} id={s.id} icon={<Play {...i16} />}>{s.label}</MenuItem>)}
        </MenuSection>
        <MenuSection title="Edge cases">
          <MenuItem id="team" icon={<PauseCircle {...i16} />} description="Everyone on a round robin is paused">A team page no one can take</MenuItem>
          <MenuItem id="clash" icon={<AlertTriangle {...i16} />} description="Busy time lands on two meetings">A clash with booked meetings</MenuItem>
        </MenuSection>
        <MenuSection title="Workspace">
          <MenuItem id="northwind" icon={<Users {...i16} />} description="The dummy team, with meetings">Reload Northwind</MenuItem>
          <MenuItem id="fresh" icon={<RotateCcw {...i16} />} description="No pages, no meetings">Start fresh (first visit)</MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );

  // Day-month order in date fields, matching how the app writes dates ("13 Nov"); times stay 12-hour through formatClock.
  return (
    <I18nProvider locale="en-GB">
    {guest ? (
      <GuestMode play={guest} state={state} onClose={closeGuest} onBooked={book}
        onGuestCancel={(m, reason) => update({ ...m, status: 'cancelled' }, `Cancelled by ${m.invitee.name}${reason ? `: “${reason}”` : ''}`)}
        onGuestMove={(m, start) => update({ ...m, start, end: new Date(start.getTime() + (m.end.getTime() - m.start.getTime())) }, `Moved by ${m.invitee.name} to ${formatDay(start)}`)} />
    ) : (
    <AppShell sidebar={sidebar} className="tf-bkf"
      mobileNav={<TabBar aria-label="Bookings" current={tab}
        items={SECTIONS.filter((x) => (x.id !== 'routing' && x.id !== 'roster') || isTeam).map((x) => ({ id: x.id, label: SHORT[x.id] ?? x.label, icon: x.icon, badge: x.id === 'meetings' ? waiting : undefined }))}
        onChange={(id) => { setEditor(undefined); setTab(id); }} />}>
      {editor && editing ? (
        <PageEditor key={editing.id} page={editing} draft={editor.draft} state={state} section={editor.section} onDraft={(draft) => setEditor({ id: editing.id, draft, section: editor.section })}
          onBack={() => {
            const kept = editor;
            setEditor(undefined); setTab('pages');
            if (JSON.stringify({ ...kept.draft, isOn: editing.isOn }) !== JSON.stringify(editing)) toast({ message: 'Changes not saved', action: { label: 'Go back', onAction: () => setEditor(kept) } });
          }}
          onSave={(d) => new Promise<void>((resolve) => { window.setTimeout(() => { dispatch({ type: 'page/upsert', page: d }); setEditor({ id: d.id, draft: d }); toast({ message: 'Changes saved', tone: 'success' }); resolve(); }, 700); })}
          onToggle={(on) => toggle(editing.id, on)} onShare={onShare} onMore={onMore} onGuest={() => setGuest({ scenario: 'book', pageId: editing.id })}
          onMeetings={() => { setEditor(undefined); setTab('meetings'); setView('list'); setWhose('everyone'); }} onManageGroups={() => setGroupsOpen(true)} />
      ) : (
        <>
          <TopBar title={<Breadcrumbs size="title" items={[{ id: tab, label: SECTIONS.find((x) => x.id === tab)?.label ?? 'Bookings', icon: SECTIONS.find((x) => x.id === tab)?.icon }]} />}
            actions={<>{demoMenu}{bell}</>} />
          <div className="tf-bkf__body">
              {tab === 'meetings' && (<div className="tf-bkf__panel">
                <MeetingsTab state={state} view={view} onView={(v) => { setView(v); if (v === 'list') setFocusHour(undefined); }} whose={whose} onWhose={setWhose}
                  week={week} onWeek={(w) => { setWeek(w); setFocusHour(undefined); }} focusHour={focusHour} fresh={freshMeeting}
                  onOpen={setMeetingId} onCancel={cancelNow} onUndoCancel={(m) => { const x = meetingById(m.id); if (x) update({ ...x, status: 'confirmed' }, 'Cancel undone'); }}
                  onReschedule={setRescheduleId} onNoShow={(id) => { const m = meetingById(id); if (m) { update({ ...m, status: 'no-show' }, 'Marked as no-show'); toast({ message: `${first(m.invitee.name)} marked as no-show`, action: { label: 'Undo', onAction: () => update(m) } }); } }}
                  onConfirm={confirm} onDecline={setDeclineId}
                  onCreatePage={() => setCreating(true)} onCopyFirstLink={() => { const p = state.pages.find((x) => x.isOn); if (p) onShare(p, 'copy'); }}
                  onNewMeeting={(initial) => setNewMeeting({ initial })}
                  onBlock={(block) => { dispatch({ type: 'block/add', block }); toast({ message: `${formatDay(parseDay(block.day))}, ${formatClockRange(block.start, block.end)} is blocked`, action: { label: 'Undo', onAction: () => dispatch({ type: 'block/remove', id: block.id }) } }); }}
                  onHold={setHoldAt}
                  onTimeOff={(p) => {
                    const day = isoDay(p.day);
                    const entry = { id: nextId('off'), member: p.member, from: day, to: day, allDay: false, start: p.start, end: p.end, note: '' };
                    const before = state.timeOff;
                    dispatch({ type: 'timeoff/set', timeOff: [...before, entry] });
                    toast({ message: `Time off ${formatDay(p.day)}, ${formatClockRange(p.start, p.end)}`, action: { label: 'Undo', onAction: () => dispatch({ type: 'timeoff/set', timeOff: before }) } });
                  }}
                  onMoveBlock={(block) => { dispatch({ type: 'block/remove', id: block.id }); dispatch({ type: 'block/add', block }); }}
                  onMove={(id, day, startMin) => { const m = meetingById(id); if (m) move(m, at(day, startMin), 'is emailed the new time'); }}
                  onReassignMany={(list) => {
                    // Each meeting goes to whoever covers its host's time off first, then whoever is free.
                    const n = list.reduce((sum, m) => { const off = state.timeOff.find((t) => t.member === m.host && t.from <= isoDay(m.start) && isoDay(m.start) <= t.to); return sum + reassignMany([m], off?.cover ? [off.cover, ...TEAM] : undefined); }, 0); toast({ message: n === list.length ? `${plural(n, 'meeting')} handed on` : `${n} of ${list.length} handed on; no one was free for the rest`, tone: n ? 'success' : undefined }); return n; }}
                  onSeeConflict={seeConflict} onJoin={(id) => toast({ message: `Opening ${meetingById(id)?.placeLabel ?? 'the meeting'}…` })} />
              </div>)}
              {tab === 'pages' && (<div className="tf-bkf__panel">
                <PagesTab state={state} fresh={freshPage} leaving={leaving} onOpen={(id) => { const p = pageById(id); if (p) setEditor({ id, draft: p }); }}
                  onFix={(id) => { const p = pageById(id); if (p) setEditor({ id, draft: p, section: 'who' }); }}
                  onToggle={toggle} onShare={onShare} onMore={onMore} onCreate={() => setCreating(true)} />
              </div>)}
              {tab === 'availability' && (<div className="tf-bkf__panel">
                <AvailabilityTab state={state} dispatch={dispatch} onReassignMany={(list, pool) => reassignMany(list, pool)} />
              </div>)}
              {tab === 'roster' && isTeam && (<div className="tf-bkf__panel"><RosterTab state={state} dispatch={dispatch} onReassignMany={(list, pool) => reassignMany(list, pool)} onManageGroups={() => setGroupsOpen(true)} /></div>)}
              {tab === 'insights' && (<div className="tf-bkf__panel"><InsightsTab state={state} /></div>)}
              {tab === 'routing' && isTeam && (<div className="tf-bkf__panel"><RoutingTab state={state} dispatch={dispatch} /></div>)}
          </div>
        </>
      )}

      <CreateSheet isOpen={creating} state={state}
        onCreate={(page) => dispatch({ type: 'page/upsert', page })}
        onConnect={() => new Promise<void>((resolve) => { window.setTimeout(() => { dispatch({ type: 'calendar/set', calendars: [...state.calendars, { id: nextId('cal'), provider: 'Google', email: 'priya@northwind.com', calendars: 2, status: 'connected', checkConflicts: true }] }); toast({ message: 'Google Calendar connected', tone: 'success' }); resolve(); }, 900); })}
        onClose={(created) => { setCreating(false); if (created) { setEditor(undefined); setTab('pages'); flash(setFreshPage, created); } }}
        onAfter={(page, what) => {
          if (what === 'email') { toast({ message: 'Email draft opened with your link', tone: 'success' }); return; }
          if (what === 'linkpage') { onShare(page, 'linkpage'); return; }
          setCreating(false); setTab('pages'); flash(setFreshPage, page.id);
          if (what === 'guest') setGuest({ scenario: 'book', pageId: page.id });
          else setShare({ kind: 'embed', id: page.id });
        }} />
      <ShareDialogs kind={share?.kind} page={pageById(share?.id)} state={state} onClose={() => setShare(undefined)}
        onUpdate={(p) => { dispatch({ type: 'page/upsert', page: p }); if (editor?.id === p.id) setEditor({ ...editor, draft: { ...editor.draft, links: p.links, offers: p.offers } }); }} />
      <ConfirmDialog isOpen={resetTo !== undefined} onOpenChange={(o) => { if (!o) setResetTo(undefined); }} tone="primary"
        title={resetTo === 'fresh' ? 'Start fresh?' : 'Reload Northwind?'} consequence={resetTo === 'fresh' ? 'This demo clears every page and meeting, as on a first visit.' : 'This demo puts back the Northwind pages and meetings; your changes here go.'}
        confirmLabel={resetTo === 'fresh' ? 'Start fresh' : 'Reload Northwind'}
        onConfirm={() => { dispatch({ type: 'reset', state: resetTo === 'fresh' ? FIRST_VISIT : northwind() }); setEditor(undefined); setTab('meetings'); setResetTo(undefined); }} />
      <MeetingDrawer meeting={openMeeting} page={pageById(openMeeting?.pageId)} onClose={() => setMeetingId(undefined)}
        onUpdate={(m) => update(m)} onCancel={cancelFromDrawer} onReschedule={(m) => setRescheduleId(m.id)} onReassign={(m) => setReassignId(m.id)}
        onNoShow={(m) => { update({ ...m, status: 'no-show' }, 'Marked as no-show'); toast({ message: `${first(m.invitee.name)} marked as no-show`, action: { label: 'Undo', onAction: () => update(m) } }); }}
        onJoin={(m) => toast({ message: `Opening ${m.placeLabel}…` })} onConfirm={(m) => confirm(m.id)} onDecline={(m) => setDeclineId(m.id)} />
      <RescheduleDialog meeting={meetingById(rescheduleId)} state={state} onClose={() => setRescheduleId(undefined)}
        onMove={(m, start) => { setRescheduleId(undefined); move(m, start, 'gets an email with the new time'); }} />
      <ReassignDialog meeting={meetingById(reassignId)} state={state} onClose={() => setReassignId(undefined)}
        onReassign={(m, host) => { setReassignId(undefined); update({ ...m, host }, `Reassigned from ${m.host} to ${host}`); toast({ message: `${m.title} is ${first(host)}'s now`, tone: 'success', action: { label: 'Undo', onAction: () => update(m) } }); }} />
      <NewMeetingDialog isOpen={newMeeting !== undefined} state={state} initial={newMeeting?.initial} onClose={() => setNewMeeting(undefined)}
        onBook={(input) => {
          const m = meetingFrom(input, state);
          setNewMeeting(undefined);
          dispatch({ type: 'meeting/add', meeting: m });
          setTab('meetings');
          flash(setFreshMeeting, m.id);
          toast({ message: `Booked · ${first(input.with.name)} gets an invitation`, tone: 'success', action: { label: 'Open', onAction: () => setMeetingId(m.id) } });
        }} />
      <DeclineDialog meeting={meetingById(declineId)} onClose={() => setDeclineId(undefined)}
        onDecline={(m, reason) => { setDeclineId(undefined); setMeetingId(undefined); update({ ...m, status: 'cancelled' }, `Declined by ${HOST}${reason ? `: “${reason}”` : ''}`); dispatch({ type: 'note/read', id: m.id, read: true }); toast({ message: `Declined · ${first(m.invitee.name)} is told`, action: { label: 'Undo', onAction: () => update(m) } }); }} />
      <HoldDialog picked={holdAt} onClose={() => setHoldAt(undefined)}
        onHold={(label) => { if (!holdAt) return; const block = { id: nextId('hold'), member: holdAt.member, day: isoDay(holdAt.day), start: holdAt.start, end: holdAt.end, kind: 'hold' as const, label: label ? `Held for ${label}` : 'Held' }; dispatch({ type: 'block/add', block }); setHoldAt(undefined); toast({ message: 'Time held', action: { label: 'Undo', onAction: () => dispatch({ type: 'block/remove', id: block.id }) } }); }} />
      <GroupsDialog isOpen={groupsOpen} state={state} onClose={() => setGroupsOpen(false)} dispatch={dispatch}
        onHandOn={(list) => {
          const page = pageById(list[0]?.pageId);
          const group = state.groups.find((g) => g.id === page?.groupId);
          const pool = group?.members.filter((m) => !m.paused).map((m) => m.name);
          const n = reassignMany(list, pool);
          toast({ message: n ? `${plural(n, 'meeting')} handed on` : 'No one in the group is free then', tone: n ? 'success' : 'neutral' });
          return n;
        }} />
      <ConfirmDialog isOpen={toDelete !== undefined} onOpenChange={(o) => { if (!o) setConfirmDelete(undefined); }}
        title={`Delete ${toDelete?.name ?? 'this page'}?`} consequence={`Its ${plural(deleteCount, 'upcoming meeting')} ${deleteCount === 1 ? 'stays' : 'stay'} booked.`}
        confirmLabel="Delete page" onConfirm={() => { if (toDelete) remove(toDelete); }} />
    </AppShell>
    )}
    </I18nProvider>
  );
}

