import { useEffect, useReducer, useRef, useState } from 'react';
import { I18nProvider, type Key } from 'react-aria-components';
import { AlertTriangle, BarChart3, CalendarDays, CalendarRange, Clock, FileText, FlaskConical, Home, UtensilsCrossed, Inbox, Link2, LogOut, PauseCircle, Play, RotateCcw, Route, Settings, User, Users } from 'lucide-react';
import { AppShell, TabBar, TopBar } from '../AppShell/AppShell.tsx';
import { Sidebar, WorkspaceSwitcher, NavItem, NavSection, PersonRow } from '../Sidebar/Sidebar.tsx';
import { ConfirmDialog } from '../Dialog/Dialog.tsx';
import { MenuTrigger, Menu, MenuItem, MenuSection, MenuSeparator } from '../Menu/Menu.tsx';
import { useToast, ACTION_TOAST_TIMEOUT_MS } from '../Toast/Toast.tsx';
import { NotificationBell, NotificationList } from '../NotificationList/NotificationList.tsx';
import { Breadcrumbs } from '../Breadcrumbs/Breadcrumbs.tsx';
import { Callout } from '../Callout/Callout.tsx';
import { Button } from '../Button/Button.tsx';
import { LogoMark } from '../Logo/Logo.tsx';
import type { Meeting } from '../MeetingList/MeetingList.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay } from '../../lib/format.ts';
import { WorkspaceItems, i14, i16, type ShareHow, type WorkspaceId } from './parts.tsx';
import { CreateSheet } from './create.tsx';
import { ShareDialogs, type ShareDialogKind } from './share.tsx';
import { ReservationsTab } from './reservations.tsx';
import { MenuTab } from './menu.tsx';
import { MeetingsTab, NewMeetingDialog, DeclineDialog, HoldDialog, meetingFrom, type PickedTime, type Whose } from './meetings.tsx';
import { MeetingDrawer, RescheduleDialog, ReassignDialog } from './drawer.tsx';
import { PagesTab } from './pages.tsx';
import { PageEditor, type EditorSection } from './editor.tsx';
import { AvailabilityTab } from './availability.tsx';
import { RosterTab } from './roster.tsx';
import { InsightsTab } from './insights.tsx';
import { RoutingTab, GroupsDialog } from './routing.tsx';
import { GuestMode, GUEST_SCENARIOS, type BookedChange, type GuestScenario } from './guest.tsx';
import { FIRST_VISIT, NORTHWIND, newPage, northwind, uniqueSlug } from './seed.ts';
import { lumen, olive } from './seed-business.ts';
import { Onboarding, slugify, type OnboardingValues } from '../Onboarding/Onboarding.tsx';
import { HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import {
  HOST, PLACES, TEAM, at, bookingsReducer, dayFrom, fitTables, pageChanges, first, hostFor, isOff, isoDay, mondayOf, nextId, pageUrl, parseDay, placeLabel, plural,
  type BookedMeeting, type BookingPage, type BookingsAction, type BookingsState,
} from './state.ts';
import './BookingsFlow.css';

export { bookingsReducer, FIRST_VISIT, NORTHWIND, northwind, lumen, olive };
export type { BookingsState, BookingsAction, BookingPage, BookedMeeting };

/** Props for BookingsFlow. */
export interface BookingsFlowProps {
  /** Where the flow starts: the Northwind dummy workspace by default; `FIRST_VISIT` for an empty one. */
  readonly initialState?: BookingsState;
  /** Shows the Demo menu in the top bar: start fresh, edge cases and the guest's side. */
  readonly showDemoMenu?: boolean;
  /** Switch to another workspace (the salon or the restaurant); with it the workspace menu lists them. */
  readonly onWorkspace?: (id: WorkspaceId) => void;
}

const readWhose = (workspace: string): Whose => { try { return window.localStorage.getItem(`tf-bkf-whose:${workspace}`) ?? 'mine'; } catch { return 'mine'; } };
const saveWhose = (workspace: string, w: Whose) => { try { window.localStorage.setItem(`tf-bkf-whose:${workspace}`, w); } catch { /* storage may be off */ } };

/** The whole Bookings module as one live flow over a dummy workspace: Meetings, Pages, Availability and Routing, plus the guest's side. Built only from the system's components. */
/** Bookings' own pages in the sidebar: one job each, no tabs. */
const SECTIONS = [
  { id: 'meetings', label: 'Meetings', icon: <CalendarDays {...i16} /> },
  { id: 'pages', label: 'Booking pages', icon: <Link2 {...i16} /> },
  { id: 'menu', label: 'Menu', icon: <UtensilsCrossed {...i16} /> },
  { id: 'availability', label: 'Availability', icon: <Clock {...i16} /> },
  { id: 'roster', label: 'Roster', icon: <CalendarRange {...i16} /> },
  { id: 'routing', label: 'Routing', icon: <Route {...i16} /> },
  { id: 'insights', label: 'Insights', icon: <BarChart3 {...i16} /> },
] as const;
/** One word each under the phone tab bar's icons. */
const SHORT: Record<string, string> = { meetings: 'Meetings', pages: 'Pages', availability: 'Hours', roster: 'Roster', routing: 'Routing', insights: 'Insights', menu: 'Menu' };

export function BookingsFlow({ initialState = NORTHWIND, showDemoMenu = false, onWorkspace }: BookingsFlowProps) {
  const [state, dispatch] = useReducer(bookingsReducer, initialState);
  const { toast } = useToast();
  const [tab, setTab] = useState('meetings');
  const [view, setView] = useState(initialState.business?.kind === 'salon' ? 'team' : 'list');
  const [whose, setWhoseState] = useState<Whose>(() => readWhose(initialState.workspace));
  const [week, setWeek] = useState(0);
  const [focusHour, setFocusHour] = useState<number>();
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<{ readonly id: string; readonly draft: BookingPage; readonly section?: EditorSection }>();
  const [guest, setGuest] = useState<{ readonly scenario: GuestScenario; readonly pageId: string; readonly meetingId?: string; readonly table?: string }>();
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
  const [onboarding, setOnboarding] = useState(false);
  /** Bookings made in the guest view; the host side plays them when it closes, so the badge, the row and the count move in view. */
  const pending = useRef<Array<Extract<BookingsAction, { type: 'meeting/add' }>>>([]);
  /** Meetings whose cancel was undone, so "Guest emailed" is skipped. */
  const undone = useRef(new Set<string>());

  const now = new Date();
  const pageById = (id: string | undefined) => state.pages.find((p) => p.id === id);
  const meetingById = (id: string | undefined) => state.meetings.find((m) => m.id === id);
  const upcoming = state.meetings.filter((m) => m.status !== 'cancelled' && m.end > now && m.host === HOST).length;
  /** Changes to a teammate's hours made by someone else: they get an email and an inbox notice ten minutes later (changes in those ten minutes go in one email). */
  const told = useRef<Record<string, number>>({});
  const tellOthers = (a: BookingsAction) => {
    dispatch(a);
    const who = a.type === 'member/hours' ? a.name : a.type === 'overrides/merge' ? Object.keys(a.patch).map((k) => k.split('|')[0] ?? '').find((n) => n && n !== HOST) : undefined;
    // Changes within ten minutes go in one email, so the note shows once per person in that window.
    if (who && who !== HOST && Date.now() - (told.current[who] ?? 0) > 600_000) { told.current[who] = Date.now(); toast({ message: `${first(who)} gets one email about your changes in 10 minutes` }); }
  };
  const brokenCal = state.calendars.find((c) => c.status === 'reconnect');
  /** The demo's three workspaces share this one Bookings: a team taking meetings, a salon, a restaurant. */
  const currentWs: WorkspaceId = state.business?.kind === 'salon' ? 'lumen' : state.business?.kind === 'restaurant' ? 'olive' : 'northwind';
  const switchTo = (id: WorkspaceId) => {
    if (id === currentWs) return;
    leaveEditor();
    dispatch({ type: 'reset', state: id === 'lumen' ? lumen() : id === 'olive' ? olive() : northwind() });
    setTab('meetings'); setView(id === 'lumen' ? 'team' : 'list'); setMeetingId(undefined);
    onWorkspace?.(id);
  };
  const waiting = state.meetings.filter((m) => m.status === 'pending' && m.end > now).length;
  const unread = state.notifications.filter((n) => !n.read).length;
  const flash = (setter: (v: string | undefined) => void, id: string) => { setter(id); window.setTimeout(() => setter(undefined), 1600); };
  const setWhose = (w: Whose) => { setWhoseState(w); saveWhose(state.workspace, w); };
  const update = (m: BookedMeeting, text?: string) => dispatch({ type: 'meeting/update', meeting: text ? { ...m, activity: [...m.activity, { id: nextId('a'), text, at: new Date() }] } : m });
  useEffect(() => { setWhoseState(readWhose(state.workspace)); }, [state.workspace]);

  /** A page's unpublished draft (with its live links, offers and numbers), or the page itself. */
  const draftOf = (p: BookingPage): BookingPage => { const d = state.drafts?.[p.id]; return d ? { ...d, links: p.links, offers: p.offers, stats: p.stats } : p; };
  /** Leaves the page editor from anywhere: unpublished changes are kept as a draft (guests still see the live page); none, and any old draft is cleared. */
  const leaveEditor = () => {
    const live = editor ? pageById(editor.id) : undefined;
    if (editor && live) {
      const d = { ...editor.draft, isOn: live.isOn };
      const changed = pageChanges(live, d).length > 0;
      dispatch({ type: 'draft/set', id: live.id, draft: changed ? d : undefined });
      if (changed) { const kept = editor; toast({ message: 'Unpublished changes kept. Guests still see the live page.', action: { label: 'Open', onAction: () => setEditor(kept) } }); }
    }
    setEditor(undefined);
  };

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
  /** Routing that sends people to this page: rules, or Otherwise. */
  const routedTo = (id: string) => state.routing.rules.some((r) => (r.outcome ?? 'page') === 'page' && r.pageId === id) || ((state.routing.fallbackOutcome ?? 'page') === 'page' && state.routing.fallbackPageId === id);
  const upcomingOn = (id: string) => state.meetings.filter((m) => m.pageId === id && m.status !== 'cancelled' && m.end > now).length;
  const onMore = (p: BookingPage, key: 'edit' | 'duplicate' | 'delete') => {
    if (key === 'edit') setEditor({ id: p.id, draft: draftOf(p) });
    else if (key === 'duplicate') {
      const copy = { ...p, id: nextId('page'), name: `${p.name} (copy)`, slug: uniqueSlug(`${p.slug}-copy`, state.pages), links: [], offers: [], stats: { views: 0, bookings: 0, showRate: 0 } };
      dispatch({ type: 'page/upsert', page: copy });
      leaveEditor(); setTab('pages'); flash(setFreshPage, copy.id);
      toast({ message: `${copy.name} made`, tone: 'success' });
    } else if (upcomingOn(p.id) > 0 || routedTo(p.id)) setConfirmDelete(p.id);
    else remove(p);
  };
  const onShare = (p: BookingPage, how: ShareHow) => {
    const url = `https://${pageUrl(p.slug)}`;
    if (how === 'copy') {
      void navigator.clipboard?.writeText(url).catch(() => undefined);
      toast({ message: p.isOn ? 'Link copied' : "Link copied. The page is hidden, so guests see it isn't taking bookings.", tone: 'success' });
    } else if (how === 'email' || how === 'whatsapp') {
      // Opens the guest's own mail or WhatsApp with the link written in; nothing is sent from here.
      const text = `Pick a time that suits you: ${url}`;
      window.open(how === 'email' ? `mailto:?subject=${encodeURIComponent(p.name)}&body=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else if (how === 'more') {
      if (typeof navigator.share === 'function') void navigator.share({ title: p.name, url }).catch(() => undefined);
      else { void navigator.clipboard?.writeText(url).catch(() => undefined); toast({ message: 'Link copied', tone: 'success' }); }
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
  const book = (p: BookingPage, r: { readonly name: string; readonly email: string; readonly notes: string; readonly guests?: ReadonlyArray<string>; readonly date: { readonly year: number; readonly month: number; readonly day: number }; readonly minutes: number; readonly timeZone: string; readonly length: number; readonly place: keyof typeof PLACES; readonly party?: number; readonly phone?: string; readonly occasion?: string; readonly area?: string }) => {
    const day = new Date(r.date.year, r.date.month - 1, r.date.day);
    // A table booking takes the best-fitting tables then; a service or meeting takes a free host.
    const tables = p.kind === 'table' ? (fitTables(state, r.party ?? 2, day, r.minutes, r.length, true, r.area) ?? fitTables(state, r.party ?? 2, day, r.minutes, r.length))?.map((t) => t.id) : undefined;
    const tableText = tables ? tables.map((tid) => state.tables?.find((t) => t.id === tid)?.name ?? '').join(' + ') : '';
    const start = at(day, r.minutes);
    const id = nextId('m');
    const name = r.name.trim() || 'Guest';
    const host = hostFor(state, p, day, r.minutes, r.minutes + r.length) ?? p.hosts[0] ?? HOST;
    pending.current.push({
      type: 'meeting/add',
      meeting: {
        id, pageId: p.id, host, start, end: new Date(start.getTime() + r.length * 60_000), title: p.kind === 'table' ? `Table for ${r.party ?? 2}` : p.name, invitee: { name, email: r.email }, guests: r.guests && r.guests.length ? r.guests : undefined, place: PLACES[r.place].meeting, placeLabel: tables ? tableText : placeLabel(p, r.place),
        party: p.kind === 'table' ? r.party ?? 2 : undefined, tables, phone: r.phone, occasion: r.occasion, area: r.area,
        status: p.confirmFirst ? 'pending' : 'confirmed', notes: p.kind === 'table' ? r.notes : '', answers: r.notes && p.kind !== 'table' ? [{ question: 'Anything to share before the call?', answer: r.notes }] : [], guestZone: r.timeZone,
        record: p.addToPeople ? { id: nextId('r'), name, kind: 'person', sub: r.email } : undefined, activity: [{ id: nextId('a'), text: `Booked by ${name}`, at: new Date() }],
      },
      notification: { id, actor: name, action: p.confirmFirst ? 'asked to book' : 'booked', object: p.kind === 'table' ? `a table for ${r.party ?? 2}` : `${p.name} · ${r.length} min`, excerpt: `${formatDay(start)}, ${formatClockRange(r.minutes, r.minutes + r.length)}`, time: 'Just now', group: 'Today', read: false },
    });
  };
  /** The guest changed the booking they just made: the queued booking takes the change before the host side sees it. */
  const changeLastBooked = (c: BookedChange) => {
    const i = pending.current.length - 1;
    const e = pending.current[i];
    if (!e) return;
    const m = e.meeting;
    const len = m.end.getTime() - m.start.getTime();
    const next: BookedMeeting = c.kind === 'cancel' ? { ...m, status: 'cancelled', activity: [...m.activity, { id: nextId('a'), text: `Cancelled by ${m.invitee.name}`, at: new Date() }] }
      : c.kind === 'move' ? (() => { const start = at(new Date(c.date.year, c.date.month - 1, c.date.day), c.minutes); return { ...m, start, end: new Date(start.getTime() + len), activity: [...m.activity, { id: nextId('a'), text: `Moved by ${m.invitee.name} to ${formatDay(start)}`, at: new Date() }] }; })()
      : { ...m, guests: c.guests.length ? c.guests : undefined };
    const note = e.notification && (c.kind === 'cancel' ? { ...e.notification, action: 'booked, then cancelled' } : c.kind === 'move' ? { ...e.notification, excerpt: `${formatDay(next.start)}, ${formatClockRange(minutesOf(next.start), minutesOf(next.end))}` } : e.notification);
    pending.current[i] = { ...e, meeting: next, notification: note };
  };
  const closeGuest = () => {
    setGuest(undefined);
    const booked = pending.current;
    pending.current = [];
    const last = booked[booked.length - 1];
    if (!last) return;
    leaveEditor(); setTab('meetings'); setView('list');
    if (!(whose === 'everyone' || whose === last.meeting.host || (whose === 'mine' && last.meeting.host === HOST))) setWhose('everyone');
    window.setTimeout(() => {
      booked.forEach((b) => dispatch(b));
      const { id } = last.meeting;
      flash(setFreshMeeting, id);
      toast({ message: `${last.notification?.actor ?? 'A guest'} ${last.notification?.action ?? 'booked'} ${last.notification?.object ?? ''}`, tone: 'info', action: { label: 'Open', onAction: () => { dispatch({ type: 'note/read', id, read: true }); setMeetingId(id); } } });
    }, 300);
  };

  /* Meetings */
  const cancelNow = (m: Meeting) => { const x = meetingById(m.id); if (x) cancelFromDrawer(x); };
  const cancelFromDrawer = (m: BookedMeeting) => {
    setMeetingId(undefined);
    update({ ...m, status: 'cancelled' }, `Cancelled by ${HOST}`);
    undone.current.delete(m.id);
    toast({ message: 'Cancelled', action: { label: 'Undo', onAction: () => { undone.current.add(m.id); update(m); } } });
    window.setTimeout(() => { if (!undone.current.has(m.id)) toast({ message: 'Cancelled · Guest emailed' }); }, ACTION_TOAST_TIMEOUT_MS);
  };
  const move = (m: BookedMeeting, start: Date, how: string) => {
    const end = new Date(start.getTime() + (m.end.getTime() - m.start.getTime()));
    // A round robin set to ask the rotation again picks the host afresh for the new time.
    const p = m.pageId ? pageById(m.pageId) : undefined;
    const host = p?.hostMode === 'roundrobin' && p.rrReschedule === 'rotate' ? hostFor({ ...state, meetings: state.meetings.filter((x) => x.id !== m.id) }, p, start, minutesOf(start), minutesOf(end)) ?? m.host : m.host;
    update({ ...m, start, end, host }, `Moved to ${formatDay(start)}, ${formatClockRange(minutesOf(start), minutesOf(end))}${host !== m.host ? `; ${host} takes it` : ''}`);
    toast({ message: `Moved to ${formatDay(start)}, ${formatClockRange(minutesOf(start), minutesOf(end))}. ${first(m.invitee.name)} ${how}.`, tone: 'success', action: { label: 'Undo', onAction: () => update(m) } });
  };
  const freeTeammate = (m: BookedMeeting, pool: ReadonlyArray<string> = TEAM, given: ReadonlyArray<BookedMeeting> = []) => pool.find((n) => n !== m.host && !isOff(state, n, m.start, minutesOf(m.start), minutesOf(m.end))
    && ![...state.meetings, ...given].some((x) => x.id !== m.id && x.host === n && x.status !== 'cancelled' && x.start < m.end && m.start < x.end));
  /** Hands several meetings on; each one counts the ones already handed on in this batch, so no one is double-booked. */
  const reassignMany = (list: ReadonlyArray<BookedMeeting>, pool?: ReadonlyArray<string>) => {
    const given: BookedMeeting[] = [];
    list.forEach((m) => { const to = freeTeammate(m, pool, given); if (to) { given.push({ ...m, host: to }); update({ ...m, host: to }, `Reassigned from ${m.host} to ${to}`); } });
    return given.length;
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
    if (key.startsWith('ws:')) { switchTo(key.slice(3) as WorkspaceId); return; }
    const pick = (pred: (p: BookingPage) => boolean) => state.pages.find(pred) ?? state.pages[0];
    // Only these two replace the workspace, and each asks first.
    if (key === 'fresh' || key === 'northwind') { setResetTo(key); return; }
    if (key === 'arrival') {
      // A guest books while Bookings is open: the meeting appears and a toast says so.
      const p = pick((x) => x.isOn && x.hostMode === 'one');
      const day = dayFrom(new Date(), 2);
      const start = at(day, 10 * 60);
      const id = nextId('m');
      const len = p.durations[0] ?? 30;
      dispatch({ type: 'meeting/add', meeting: {
        id, pageId: p.id, host: p.hosts[0] ?? HOST, start, end: new Date(start.getTime() + len * 60_000), title: p.name, invitee: { name: 'Ada Brooks', email: 'ada@lumen.io' }, place: PLACES[p.places[0] ?? 'meet'].meeting, placeLabel: placeLabel(p, p.places[0] ?? 'meet'),
        status: p.confirmFirst ? 'pending' : 'confirmed', notes: '', answers: [], guestZone: 'Europe/London', activity: [{ id: nextId('a'), text: 'Booked by Ada Brooks', at: new Date() }],
      }, notification: { id, actor: 'Ada Brooks', action: 'booked', object: `${p.name} · ${len} min`, excerpt: `${formatDay(start)}, ${formatClockRange(600, 600 + len)}`, time: 'Just now', group: 'Today', read: false } });
      toast({ message: `Ada booked ${p.name} for ${formatDay(start)}, ${formatClockRange(600, 600 + len)}`, action: { label: 'Open', onAction: () => setMeetingId(id) } });
      return;
    }
    if (key === 'team') {
      const group = state.groups[0];
      if (!group) { toast({ message: 'Start from Northwind first: it has a round robin team.' }); return; }
      dispatch({ type: 'groups/set', groups: state.groups.map((g) => (g.id === group.id ? { ...g, members: g.members.map((m) => ({ ...m, paused: true })) } : g)) });
      leaveEditor(); setTab('pages');
      toast({ message: `Everyone in ${group.name} is paused` });
      return;
    }
    if (key === 'clash') {
      const mine = state.meetings.filter((m) => m.host === HOST && m.status === 'confirmed' && m.start > now).slice(0, 2);
      if (mine.length === 0) { toast({ message: 'Book a meeting first, then try the clash.' }); return; }
      mine.forEach((m) => dispatch({ type: 'busy/add', block: { id: nextId('busy'), member: HOST, day: isoDay(m.start), start: minutesOf(m.start) - 15, end: minutesOf(m.end) + 15, source: 'Team offsite · Google Calendar' } }));
      if (!state.calendars.some((c) => c.checkConflicts && c.status === 'connected')) dispatch({ type: 'calendar/set', calendars: [...state.calendars, { id: nextId('cal'), provider: 'Google', email: 'priya@northwind.com', calendars: 3, status: 'connected', checkConflicts: true }] });
      leaveEditor(); setTab('meetings'); setView('list'); setFocusHour(undefined);
      return;
    }
    if (key === 'menu') { const p = state.pages[0]; const t = state.tables?.[2]; if (p) setGuest({ scenario: 'menu', pageId: p.id, table: t?.code }); return; }
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
  /** Where routing goes instead when its page is deleted: the first other live page. */
  const repointTo = (id: string) => state.pages.find((p) => p.id !== id && p.isOn);
  const deleteCount = toDelete ? upcomingOn(toDelete.id) : 0;
  const isTeam = state.pages.some((p) => p.hosts.length > 1) || state.routing.rules.length > 0;
  /** Routing answers a form before booking: a team's tool, not a salon's or a restaurant's. */
  const hideRouting = state.business !== undefined;
  // A restaurant's home is the host stand: reservations by service, not a calendar of meetings.
  const restaurant = state.business?.kind === 'restaurant';
  const labelOf = (x: { readonly id: string; readonly label: string }) => (restaurant && x.id === 'meetings' ? 'Reservations' : x.label);

  const sidebar = (
    <Sidebar isCollapsed={collapsed} onCollapsedChange={setCollapsed}
      header={<WorkspaceSwitcher name={state.workspace} plan={state.business ? state.business.kindLabel : 'Team plan · 4 members'} mark={<LogoMark size={28} />} onAction={(k) => { const id = String(k); if (id.startsWith('ws:')) switchTo(id.slice(3) as WorkspaceId); }}>
        {showDemoMenu ? <WorkspaceItems current={currentWs} /> : null}
        {showDemoMenu ? <MenuSeparator /> : null}
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
        {SECTIONS.filter((x) => ((x.id !== 'routing' && x.id !== 'roster') || isTeam) && !(x.id === 'routing' && hideRouting) && (x.id !== 'menu' || state.menu !== undefined)).map((x) => (
          <NavItem key={x.id} label={labelOf(x)} icon={x.icon} badge={x.id === 'meetings' && waiting > 0 ? waiting : undefined} isCurrent={tab === x.id} onPress={() => { leaveEditor(); setTab(x.id); }} />
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
          {state.menuLive ? <MenuItem id="menu" icon={<Play {...i16} />} description="Opens the menu with Table 3 set">Scan a table’s QR code</MenuItem> : null}
        </MenuSection>
        <MenuSection title="Edge cases">
          <MenuItem id="team" icon={<PauseCircle {...i16} />} description="Everyone on a round robin is paused">A team page no one can take</MenuItem>
          <MenuItem id="arrival" icon={<CalendarDays {...i16} />} description="As if someone books while you watch">A guest books now</MenuItem>
          <MenuItem id="clash" icon={<AlertTriangle {...i16} />} description="Busy time lands on two meetings">A clash with booked meetings</MenuItem>
        </MenuSection>
        {/* On a phone the sidebar's switcher is out of reach, so the demo menu switches too. */}
        <WorkspaceItems current={currentWs} />
        <MenuSection title="Reset">
          <MenuItem id="northwind" icon={<Users {...i16} />} description="The dummy team, with meetings">Reload Northwind</MenuItem>
          <MenuItem id="fresh" icon={<RotateCcw {...i16} />} description="No pages, no meetings">Start fresh (first visit)</MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );

  /** First run's answers become the workspace: its name, your hours, the first booking page, and a calendar if one was connected. */
  const finishSetup = (v: OnboardingValues) => {
    const hours = Object.fromEntries(HOURS_DAYS.map((d) => [d, v.hours.days.includes(d) ? { on: true, ranges: [{ id: nextId('r'), start: v.hours.start, end: v.hours.end }] } : { on: false, ranges: [] }])) as BookingsState['savedHours'][number]['hours'];
    const page = newPage([], { name: v.meeting.name || 'Intro call', slug: slugify(v.meeting.name) || 'intro-call', durations: [v.meeting.length] });
    dispatch({ type: 'reset', state: { ...FIRST_VISIT, workspace: v.workspace || 'My workspace', savedHours: [{ id: 'working', name: 'Working hours', hours }], pages: [page],
      calendars: v.calendar ? [{ id: nextId('cal'), provider: v.calendar === 'google' ? 'Google' : 'Outlook', email: 'priya@northwind.com', calendars: 2, status: 'connected', checkConflicts: true }] : [] } });
    setOnboarding(false); setTab('pages'); flash(setFreshPage, page.id);
    toast({ message: v.invites.length ? `${plural(v.invites.length, 'invite')} sent. You’re set up.` : 'You’re set up. Share your link to get your first booking.', tone: 'success' });
  };

  // Day-month order in date fields, matching how the app writes dates ("13 Nov"); times stay 12-hour through formatClock.
  return (
    <I18nProvider locale="en-GB">
    {onboarding ? (
      <Onboarding account="priya@northwind.com" owner={HOST} checkSlug={(slug) => new Promise((r) => { window.setTimeout(() => r(!['acme', 'demo', 'northwind-sales'].includes(slug)), 400); })}
        onFinish={finishSetup} onSignOut={() => { setOnboarding(false); dispatch({ type: 'reset', state: northwind() }); }} />
    ) : guest ? (
      <GuestMode play={guest} state={state} onClose={closeGuest} onBooked={book} onBookedChange={changeLastBooked}
        onWaitlist={(w) => dispatch({ type: 'waitlist/set', waitlist: [...(state.waitlist ?? []), { id: nextId('w'), name: w.name, phone: w.phone, party: w.party, day: w.day, wanted: w.wanted, added: new Date(), online: true }] })}
        onGuestCancel={(m, reason) => update({ ...m, status: 'cancelled' }, `Cancelled by ${m.invitee.name}${reason ? `: “${reason}”` : ''}`)}
        onGuestMove={(m, start) => update({ ...m, start, end: new Date(start.getTime() + (m.end.getTime() - m.start.getTime())) }, `Moved by ${m.invitee.name} to ${formatDay(start)}`)} />
    ) : (
    <AppShell sidebar={sidebar} className="tf-bkf"
      mobileNav={<TabBar aria-label="Bookings" current={tab}
        items={SECTIONS.filter((x) => ((x.id !== 'routing' && x.id !== 'roster') || isTeam) && !(x.id === 'routing' && hideRouting) && (x.id !== 'menu' || state.menu !== undefined)).map((x) => ({ id: x.id, label: restaurant && x.id === 'meetings' ? 'Bookings' : SHORT[x.id] ?? x.label, icon: x.icon, badge: x.id === 'meetings' ? waiting : undefined }))}
        onChange={(id) => { leaveEditor(); setTab(id); }} />}>
      {editor && editing ? (
        <PageEditor key={editing.id} page={editing} draft={editor.draft} state={state} section={editor.section} onDraft={(draft) => setEditor({ id: editing.id, draft, section: editor.section })}
          onBack={() => { leaveEditor(); setTab('pages'); }}
          onKeepDraft={(d) => {
            const same = pageChanges(editing, d).length === 0;
            dispatch({ type: 'draft/set', id: editing.id, draft: same ? undefined : d });
            if (!same) toast({ message: 'Unpublished changes kept. Publish when they’re ready.' });
          }}
          onSave={(d) => new Promise<void>((resolve) => { window.setTimeout(() => {
            // Publishing keeps the page before as a version, so it can be restored.
            const { versions: _old, ...before } = editing;
            const versions = [{ id: nextId('v'), at: new Date(), by: HOST, changes: pageChanges(editing, d), page: before }, ...(editing.versions ?? [])].slice(0, 10);
            // Links, offered times and numbers are live things: a draft or an old version never brings back stale ones.
            const page = { ...d, links: editing.links, offers: editing.offers, stats: editing.stats, versions };
            dispatch({ type: 'page/upsert', page }); dispatch({ type: 'draft/set', id: d.id, draft: undefined });
            setEditor({ id: d.id, draft: page }); toast({ message: 'Published. Guests see it now.', tone: 'success' }); resolve();
          }, 700); })}
          onToggle={(on) => toggle(editing.id, on)} onShare={onShare} onMore={onMore} onGuest={() => setGuest({ scenario: 'book', pageId: editing.id })}
          onMeetings={() => { leaveEditor(); setTab('meetings'); setView('list'); setWhose('everyone'); }} onManageGroups={() => setGroupsOpen(true)} />
      ) : (
        <>
          <TopBar title={<Breadcrumbs size="title" items={[{ id: tab, label: (() => { const x = SECTIONS.find((y) => y.id === tab); return x ? labelOf(x) : 'Bookings'; })(), icon: SECTIONS.find((x) => x.id === tab)?.icon }]} />}
            actions={<>{demoMenu}{bell}</>} />
          {brokenCal && (
            <div className="tf-bkf__banner">
              <Callout tone="warning" action={{ label: 'Reconnect', onPress: () => { dispatch({ type: 'calendar/set', calendars: state.calendars.map((c) => (c.id === brokenCal.id ? { ...c, status: 'connected' } : c)) }); toast({ message: `${brokenCal.provider} calendar reconnected`, tone: 'success' }); } }}>
                Your {brokenCal.provider} calendar stopped syncing. Busy times on it aren’t checked, so guests could book over them.
              </Callout>
            </div>
          )}
          <div className="tf-bkf__body">
              {tab === 'meetings' && restaurant && (<div className="tf-bkf__panel">
                <ReservationsTab state={state} dispatch={dispatch} fresh={freshMeeting} openId={meetingId} onOpened={() => setMeetingId(undefined)} onCancel={(m) => cancelNow(m)} onConfirm={confirm} onDecline={setDeclineId} />
              </div>)}
              {tab === 'meetings' && !restaurant && (<div className="tf-bkf__panel">
                <MeetingsTab state={state} view={view} onView={(v) => { setView(v); if (v === 'list') setFocusHour(undefined); }} whose={whose} onWhose={setWhose}
                  week={week} onWeek={(w) => { setWeek(w); setFocusHour(undefined); }} focusHour={focusHour} fresh={freshMeeting}
                  onOpen={setMeetingId} onCancel={cancelNow} onUndoCancel={(m) => { const x = meetingById(m.id); if (x) update({ ...x, status: 'confirmed' }, 'Cancel undone'); }}
                  onReschedule={setRescheduleId} onNoShow={(id) => { const m = meetingById(id); if (m) { update({ ...m, status: 'no-show' }, 'Marked as no-show'); toast({ message: `${first(m.invitee.name)} marked as no-show`, action: { label: 'Undo', onAction: () => update(m) } }); } }}
                  onConfirm={confirm} onDecline={setDeclineId}
                  onCreatePage={() => setCreating(true)} onCopyFirstLink={() => { const p = state.pages.find((x) => x.isOn) ?? state.pages[0]; if (p) onShare(p, 'copy'); }}
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
                <PagesTab state={state} fresh={freshPage} leaving={leaving} onOpen={(id) => { const p = pageById(id); if (p) setEditor({ id, draft: draftOf(p) }); }}
                  onFix={(id, section) => { const p = pageById(id); if (p) setEditor({ id, draft: draftOf(p), section: section ?? 'who' }); }}
                  onToggle={toggle} onShare={onShare} onMore={onMore} onCreate={() => setCreating(true)} dispatch={dispatch} onSeePage={() => { const p = state.pages[0]; if (p) setGuest({ scenario: 'profile', pageId: p.id }); }}
                  onSeeMenu={() => { const p = state.pages[0]; if (p) setGuest({ scenario: 'menu', pageId: p.id }); }} onEditMenu={() => setTab('menu')} />
              </div>)}
              {tab === 'menu' && state.menu && (<div className="tf-bkf__panel">
                <MenuTab state={state} dispatch={dispatch} onTables={() => setTab('availability')}
                  onGuest={(table) => { const p = state.pages[0]; if (p) setGuest({ scenario: 'menu', pageId: p.id, table }); }} />
              </div>)}
              {tab === 'availability' && (<div className="tf-bkf__panel">
                <AvailabilityTab state={state} dispatch={dispatch} onReassignMany={(list, pool) => reassignMany(list, pool)} />
              </div>)}
              {tab === 'roster' && isTeam && (<div className="tf-bkf__panel"><RosterTab state={state} dispatch={tellOthers} onReassignMany={(list, pool) => reassignMany(list, pool)} onManageGroups={() => setGroupsOpen(true)} /></div>)}
              {tab === 'insights' && (<div className="tf-bkf__panel"><InsightsTab state={state} dispatch={dispatch} /></div>)}
              {tab === 'routing' && isTeam && (<div className="tf-bkf__panel"><RoutingTab state={state} dispatch={dispatch} /></div>)}
          </div>
        </>
      )}

      <CreateSheet isOpen={creating} state={state}
        onCreate={(page) => dispatch({ type: 'page/upsert', page })}
        onConnect={() => new Promise<void>((resolve) => { window.setTimeout(() => { dispatch({ type: 'calendar/set', calendars: [...state.calendars, { id: nextId('cal'), provider: 'Google', email: 'priya@northwind.com', calendars: 2, status: 'connected', checkConflicts: true }] }); toast({ message: 'Google Calendar connected', tone: 'success' }); resolve(); }, 900); })}
        onClose={(created) => { setCreating(false); if (created) { leaveEditor(); setTab('pages'); flash(setFreshPage, created); } }}
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
        title={resetTo === 'fresh' ? 'Start fresh?' : 'Reload Northwind?'} consequence={resetTo === 'fresh' ? 'This demo clears every page and meeting and walks through setup, as on a first visit.' : 'This demo puts back the Northwind pages and meetings; your changes here go.'}
        confirmLabel={resetTo === 'fresh' ? 'Start fresh' : 'Reload Northwind'}
        onConfirm={() => { dispatch({ type: 'reset', state: resetTo === 'fresh' ? FIRST_VISIT : northwind() }); setEditor(undefined); setTab('meetings'); if (resetTo === 'fresh') setOnboarding(true); setResetTo(undefined); }} />
      <MeetingDrawer meeting={restaurant ? undefined : openMeeting} page={pageById(openMeeting?.pageId)} onClose={() => setMeetingId(undefined)}
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
        title={`Delete ${toDelete?.name ?? 'this page'}?`}
        consequence={[deleteCount > 0 ? `Its ${plural(deleteCount, 'upcoming meeting')} ${deleteCount === 1 ? 'stays' : 'stay'} booked.` : '', toDelete && routedTo(toDelete.id) ? `Routing sends people here; those rules will send them to ${repointTo(toDelete.id)?.name ?? 'no page'} instead.` : ''].filter(Boolean).join(' ')}
        confirmLabel="Delete page" onConfirm={() => {
          if (!toDelete) return;
          const to = repointTo(toDelete.id)?.id ?? '';
          if (routedTo(toDelete.id)) dispatch({ type: 'routing/set', routing: { ...state.routing, rules: state.routing.rules.map((r) => (r.pageId === toDelete.id ? { ...r, pageId: to } : r)), fallbackPageId: state.routing.fallbackPageId === toDelete.id ? to : state.routing.fallbackPageId } });
          remove(toDelete);
        }} />
    </AppShell>
    )}
    </I18nProvider>
  );
}

