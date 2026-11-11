import { copyText } from '../../lib/copy.ts';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useReducer, useRef, useState, useMemo } from 'react';
import { I18nProvider, type Key } from 'react-aria-components';
import { AlertTriangle, BarChart3, Plus, CalendarDays, CalendarRange, Clock, FileText, FlaskConical, Home, UtensilsCrossed, Inbox, Link2, LogOut, PauseCircle, Play, RotateCcw, Route, Settings, User, Users, Contact } from 'lucide-react';
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
import { MeetingsTab, NewMeetingDialog, DeclineDialog, HoldDialog, meetingFrom, type NewMeetingInput, type PickedTime, type Whose } from './meetings.tsx';
import { MeetingDrawer, RescheduleDialog, ReassignDialog } from './drawer.tsx';
import { PagesTab } from './pages.tsx';
import { PageEditor, type EditorSection } from './editor.tsx';
import { AvailabilityTab } from './availability.tsx';
import { RosterTab } from './roster.tsx';
import { InsightsTab } from './insights.tsx';
import { RoutingTab, GroupsDialog } from './routing.tsx';
import { GuestsTab, GuestDrawer } from './guests.tsx';
import { GuestMode, GUEST_SCENARIOS, type BookedChange, type GuestScenario } from './guest.tsx';
import { FIRST_VISIT, NORTHWIND, newPage, northwind, uniqueSlug } from './seed.ts';
import { lumen, olive } from './seed-business.ts';
import { Onboarding, slugify, type OnboardingValues } from '../Onboarding/Onboarding.tsx';
import { HOURS_DAYS } from '../HoursEditor/HoursEditor.tsx';
import {
  HOST, PLACES, TEAM, at, handleOf, placeOf, lengthOf, heldTables, memberFree, bookingsReducer, dayFrom, fitTables, pageChanges, first, hostFor, isOff, isoDay, mondayOf, nextId, pageUrl, parseDay, placeLabel, plural, guestKey,
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
  /** Inside the whole Timefix app: the app's own sidebar items around the Bookings section, its content when another module is open,
   *  its phone tab bar, and a call when a Bookings item is picked. Bookings stays mounted, so its state is kept. */
  readonly appNav?: (bookings: ReactNode) => ReactNode;
  readonly appContent?: ReactNode;
  /** Inside the app: the top bar's own actions (Search), in place of Bookings' bell; the app's Inbox already carries bookings. */
  readonly appActions?: ReactNode;
  /** Inside the app: changes made elsewhere (Settings › Calendars, Scheduling access), in order. Each `seq` is applied once. */
  readonly commands?: ReadonlyArray<{ readonly seq: number; readonly action: BookingsAction }>;
  readonly appMobileNav?: ReactNode;
  readonly onBookingsNav?: () => void;
  /** Hears every change to Bookings' state, for the app around it (Home's agenda, search). */
  readonly onState?: (state: BookingsState) => void;
  /** Opens a Bookings page from outside (the app's Home or search); bump `n` to open it again. */
  readonly openTab?: { readonly tab: string; readonly n: number; /** Opens this meeting's drawer too (a booking notice in the Inbox). */ readonly meetingId?: string };
  /** Bookings pages the app has turned off (Settings › Apps), hidden from the sidebar. */
  readonly hiddenSections?: ReadonlyArray<string>;
  /** Who is signed in, for the sidebar's person row. */
  readonly person?: { readonly name: string; readonly email: string; readonly src?: string };
  /** The workspace and person menus' own items: Workspace settings, Profile, Sign out. */
  readonly onMenu?: (id: 'settings' | 'profile' | 'signout' | 'create') => void;
  /** Workspace name and logo from the app's settings, when it has its own. */
  readonly workspaceName?: string;
  /** Opens the guest's booking page from outside (a form's "Book a meeting"), their name and email filled in; bump `n` to open it again. */
  /** Adds a booking page to the app's link page; returns its Undo, or undefined when it's already there. */
  readonly onAddToLinkPage?: (p: { readonly name: string; readonly minutes: number; readonly place: string }) => (() => void) | undefined;
  /** Switches the workspace from outside (the first run's answer); bump `n` to switch again. */
  readonly switchWorkspace?: { readonly id: WorkspaceId; readonly n: number };
  /** Look but don't change: the app is previewing another role. */
  readonly isReadOnly?: boolean;
  readonly openGuest?: { readonly prefill?: { readonly name: string; readonly email: string }; readonly pageId?: string; readonly scenario?: 'book' | 'profile' | 'menu'; readonly n: number };
}

const readWhose = (workspace: string): Whose => { try { return window.localStorage.getItem(`tf-bkf-whose:${workspace}`) ?? 'mine'; } catch { return 'mine'; } };
const saveWhose = (workspace: string, w: Whose) => { try { window.localStorage.setItem(`tf-bkf-whose:${workspace}`, w); } catch { /* storage may be off */ } };

/** The whole Bookings module as one live flow over a dummy workspace: Meetings, Pages, Availability and Routing, plus the guest's side. Built only from the system's components. */
/** Bookings' own pages in the sidebar: one job each, no tabs. */
const SECTIONS = [
  { id: 'meetings', label: 'Meetings', icon: <CalendarDays {...i16} /> },
  { id: 'guests', label: 'Clients', icon: <Contact {...i16} /> },
  { id: 'pages', label: 'Booking pages', icon: <Link2 {...i16} /> },
  { id: 'menu', label: 'Menu', icon: <UtensilsCrossed {...i16} /> },
  { id: 'availability', label: 'Availability', icon: <Clock {...i16} /> },
  { id: 'roster', label: 'Roster', icon: <CalendarRange {...i16} /> },
  { id: 'routing', label: 'Routing', icon: <Route {...i16} /> },
  { id: 'insights', label: 'Insights', icon: <BarChart3 {...i16} /> },
] as const;
/** One word each under the phone tab bar's icons. */
const SHORT: Record<string, string> = { meetings: 'Meetings', guests: 'Clients', pages: 'Pages', availability: 'Hours', roster: 'Roster', routing: 'Routing', insights: 'Insights', menu: 'Menu' };

export function BookingsFlow({ initialState = NORTHWIND, showDemoMenu = false, onWorkspace, appNav, appContent, appActions, commands, appMobileNav, onBookingsNav, onState, openTab, hiddenSections = [], person, onMenu, workspaceName, openGuest, onAddToLinkPage, switchWorkspace, isReadOnly = false }: BookingsFlowProps) {
  const [state, rawDispatch] = useReducer(bookingsReducer, initialState);
  const { toast } = useToast();
  const readOnlyRef = useRef(isReadOnly); readOnlyRef.current = isReadOnly;
  /** While the app previews another role, Bookings looks but never changes (reading a notice still marks it read). */
  const dispatch = useCallback((a: BookingsAction) => { if (readOnlyRef.current && a.type !== 'note/read') { toast({ message: 'You’re previewing as another role. Nothing changes until you stop previewing.' }); return; } rawDispatch(a); }, [toast]);
  // A change sent from the app (Settings): applied once per seq, through the same guard as everything else.
  const lastCmd = useRef(0);
  useEffect(() => { (commands ?? []).forEach((c) => { if (c.seq > lastCmd.current) { lastCmd.current = c.seq; dispatch(c.action); } }); }, [commands, dispatch]);
  const [tab, setTab] = useState('meetings');
  /** The guest or client whose profile is open (by guestKey). */
  const [profileKey, setProfileKey] = useState<string>();
  useEffect(() => { onState?.(state); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (openTab) { setTab(openTab.tab); if (openTab.meetingId) setMeetingId(openTab.meetingId); } }, [openTab?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!openGuest) return; const p = state.pages.find((x) => x.id === openGuest.pageId) ?? state.pages.find((x) => x.isOn && x.kind !== 'table') ?? state.pages[0]; if (p) setGuest({ scenario: openGuest.scenario ?? 'book', pageId: p.id, prefill: openGuest.prefill }); }, [openGuest?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (hiddenSections.includes(tab)) setTab('meetings'); }, [hiddenSections.join(','), tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState(initialState.business?.kind === 'salon' ? 'team' : 'list');
  const [whose, setWhoseState] = useState<Whose>(() => readWhose(initialState.workspace));
  const [week, setWeek] = useState(0);
  const [focusHour, setFocusHour] = useState<number>();
  const [creating, setCreating] = useState(false);
  /** A business's New service makes a service; everything else a meeting page. */
  const [createKind, setCreateKind] = useState<BookingPage['kind']>();
  const [editor, setEditor] = useState<{ readonly id: string; readonly draft: BookingPage; readonly section?: EditorSection }>();
  const [guest, setGuest] = useState<{ readonly scenario: GuestScenario; readonly pageId: string; readonly meetingId?: string; readonly table?: string; readonly prefill?: { readonly name: string; readonly email: string } }>();
  const [meetingId, setMeetingId] = useState<string>();
  const [bellOpen, setBellOpen] = useState(false);
  const [share, setShare] = useState<{ readonly kind: ShareDialogKind; readonly id: string }>();
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const [freshPage, setFreshPage] = useState<string>();
  const [freshMeeting, setFreshMeeting] = useState<string>();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
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
  /** Bumps when the guest books, so the guest's own view counts what they just booked as taken. */
  const [booked, setBooked] = useState(0);
  /** The workspace as the guest sees it: their bookings this visit already hold their times and tables. */
  const guestState = useMemo(() => ({ ...state, meetings: [...state.meetings, ...pending.current.map((e) => e.meeting)] }), [state, booked]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Each cancelled meeting as it was, so Undo puts back its own status (a request stays a request). */
  const before = useRef(new Map<string, BookedMeeting>());
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
  useEffect(() => { if (switchWorkspace) switchTo(switchWorkspace.id); }, [switchWorkspace?.n]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const remove = (p: BookingPage, undoMore?: () => void) => {
    const index = state.pages.findIndex((x) => x.id === p.id);
    if (editor?.id === p.id) { setEditor(undefined); setTab('pages'); }
    setLeaving((s) => new Set(s).add(p.id));
    window.setTimeout(() => {
      setLeaving((s) => { const n = new Set(s); n.delete(p.id); return n; });
      dispatch({ type: 'page/delete', id: p.id });
      toast({ message: `${p.name} deleted`, action: { label: 'Undo', onAction: () => { dispatch({ type: 'page/restore', page: p, index }); undoMore?.(); flash(setFreshPage, p.id); } } });
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
    const url = `https://${pageUrl(p.slug, handleOf(state))}`;
    if (how === 'copy') {
      void copyText(url).then((ok) => toast(ok ? { message: p.isOn ? 'Link copied' : "Link copied. The page is hidden, so guests see it isn't taking bookings.", tone: 'success' } : { message: `Copy didn’t work. Select the link and copy it: ${url}`, tone: 'danger' }));
    } else if (how === 'email' || how === 'whatsapp') {
      // Opens the guest's own mail or WhatsApp with the link written in; nothing is sent from here.
      const text = `Pick a time that suits you: ${url}`;
      window.open(how === 'email' ? `mailto:?subject=${encodeURIComponent(p.name)}&body=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else if (how === 'more') {
      if (typeof navigator.share === 'function') void navigator.share({ title: p.name, url }).catch(() => undefined);
      else { void copyText(url).then((ok) => toast(ok ? { message: 'Link copied', tone: 'success' } : { message: `Copy didn’t work. Select the link and copy it: ${url}`, tone: 'danger' })); }
    } else if (how === 'linkpage') {
      const undo = onAddToLinkPage?.({ name: p.name, minutes: lengthOf(p), place: placeLabel(p, placeOf(p)) });
      if (!onAddToLinkPage) toast({ message: 'Your link page lives in the Timefix app, under Links.' });
      else if (!undo) toast({ message: `${p.name} is already on your link page` });
      else toast({ message: `${p.name} added to your link page`, tone: 'success', action: { label: 'Undo', onAction: undo } });
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
    // Count what this guest already booked on this visit, so a second booking never lands on the same table or host.
    const now = guestState;
    // A table booking takes the best-fitting tables then; a service or meeting takes a free host.
    const tables = p.kind === 'table' ? (fitTables(now, r.party ?? 2, day, r.minutes, r.length, true, r.area) ?? fitTables(now, r.party ?? 2, day, r.minutes, r.length))?.map((t) => t.id) : undefined;
    const tableText = tables ? tables.map((tid) => state.tables?.find((t) => t.id === tid)?.name ?? '').join(' + ') : '';
    const start = at(day, r.minutes);
    const id = nextId('m');
    const name = r.name.trim() || 'Guest';
    // A returning guest on a shared page goes to whoever they met last time, when that person is free then.
    const lastHost = p.hostMode !== 'one' && r.email ? now.meetings.filter((m) => m.invitee.email.toLowerCase() === r.email.toLowerCase() && p.hosts.includes(m.host) && m.status !== 'cancelled').sort((a, b) => b.start.getTime() - a.start.getTime())[0]?.host : undefined;
    const host = p.kind === 'table' ? (p.hosts[0] ?? HOST) : lastHost && memberFree(now, p, lastHost, day, r.minutes, r.minutes + r.length) ? lastHost : hostFor(now, p, day, r.minutes, r.minutes + r.length);
    // Nobody free then (someone else took it a moment ago): the guest's page shows "Someone just booked that time".
    if (!host || (p.kind === 'table' && !tables)) return false;
    pending.current.push({
      type: 'meeting/add',
      meeting: {
        id, pageId: p.id, host, start, end: new Date(start.getTime() + r.length * 60_000), title: p.kind === 'table' ? `Table for ${r.party ?? 2}` : p.name, invitee: { name, email: r.email }, guests: r.guests && r.guests.length ? r.guests : undefined, place: PLACES[r.place].meeting, placeLabel: tables ? tableText : placeLabel(p, r.place),
        party: p.kind === 'table' ? r.party ?? 2 : undefined, tables, phone: r.phone, occasion: r.occasion, area: r.area, source: p.kind === 'table' ? 'online' : undefined,
        status: p.confirmFirst ? 'pending' : 'confirmed', notes: p.kind === 'table' ? r.notes : '', answers: r.notes && p.kind !== 'table' ? [{ question: 'Anything to share before the call?', answer: r.notes }] : [], guestZone: r.timeZone,
        record: p.addToPeople ? { id: nextId('r'), name, kind: 'person', sub: r.email } : undefined, activity: [{ id: nextId('a'), text: `Booked by ${name}`, at: new Date() }],
      },
      notification: { id, actor: name, action: p.confirmFirst ? 'asked to book' : 'booked', object: p.kind === 'table' ? `a table for ${r.party ?? 2}` : `${p.name} · ${r.length} min`, excerpt: `${formatDay(start)}, ${formatClockRange(r.minutes, r.minutes + r.length)}`, time: 'Just now', group: 'Today', read: false },
    });
    setBooked((n) => n + 1);
    return true;
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
    setBooked((n) => n + 1);
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

  /** Join: the meeting's own link, copied so it opens in any browser; the toast shows it too in case copying is blocked. */
  const join = (m: BookedMeeting) => {
    const url = m.place === 'phone' ? `tel:${m.phone ?? ''}` : `https://meet.google.com/${m.id.replace(/[^a-z0-9]/gi, '').slice(-3)}-tfx-${m.id.replace(/[^a-z0-9]/gi, '').slice(0, 4)}`;
    void navigator.clipboard.writeText(url).then(() => toast({ message: `${m.placeLabel} link copied. Paste it in your browser to join.`, tone: 'success' }), () => toast({ message: `Join at ${url}` }));
  };
  /* Meetings */
  const cancelNow = (m: Meeting) => { const x = meetingById(m.id); if (x) cancelFromDrawer(x); };
  /** A meeting booked by hand (the New meeting dialog or a week's quick create): added, flashed, and the guest invited. */
  const bookNew = (input: NewMeetingInput) => {
    const m = meetingFrom(input, state);
    setNewMeeting(undefined);
    dispatch({ type: 'meeting/add', meeting: m });
    setTab('meetings');
    flash(setFreshMeeting, m.id);
    toast({ message: `Booked · ${first(input.with.name)} gets an invitation`, tone: 'success', action: { label: 'Open', onAction: () => setMeetingId(m.id) } });
  };
  const cancelFromDrawer = (m: BookedMeeting, reason?: string, note?: string, inline = false) => {
    setMeetingId(undefined);
    update({ ...m, status: 'cancelled', cancelledBy: 'host', cancelReason: reason }, `Cancelled by ${HOST}${reason ? `: ${reason}` : ''}${note ? ` · told them “${note}”` : ''}`);
    undone.current.delete(m.id); before.current.set(m.id, m);
    toast(inline ? { message: 'Cancelled' } : { message: 'Cancelled', action: { label: 'Undo', onAction: () => { undone.current.add(m.id); const now = meetingById(m.id); update(now ? { ...now, status: m.status } : m); } } });
    window.setTimeout(() => { if (!undone.current.has(m.id)) toast({ message: 'Cancelled · Guest emailed' }); }, ACTION_TOAST_TIMEOUT_MS);
  };
  /** Who can take a meeting at a new time: its host if they're free, else (round robin) whoever the rotation picks; undefined when nobody can. */
  const hostAt = (m: BookedMeeting, start: Date, end: Date, rotate: boolean): string | undefined => {
    const others = { ...state, meetings: state.meetings.filter((x) => x.id !== m.id) };
    const p = m.pageId ? pageById(m.pageId) : undefined;
    const s = minutesOf(start); const e = minutesOf(end);
    const clash = (h: string) => others.meetings.some((x) => x.host === h && x.status !== 'cancelled' && x.start < end && x.end > start) || isOff(state, h, start, s, e) !== undefined;
    const free = (h: string) => (p ? memberFree(others, p, h, start, s, e) : true) && !clash(h);
    if (p?.hostMode === 'roundrobin' && (rotate || !free(m.host))) return hostFor(others, p, start, s, e) ?? (free(m.host) ? m.host : undefined);
    return free(m.host) ? m.host : undefined;
  };
  const move = (m: BookedMeeting, start: Date, how: string) => {
    const end = new Date(start.getTime() + (m.end.getTime() - m.start.getTime()));
    if (start < new Date()) { toast({ message: 'That time has passed. Pick a time ahead.', tone: 'danger' }); return; }
    // A round robin set to ask the rotation again picks the host afresh for the new time; anyone else must be free then.
    const p = m.pageId ? pageById(m.pageId) : undefined;
    const host = hostAt(m, start, end, p?.hostMode === 'roundrobin' && p.rrReschedule === 'rotate');
    if (!host) { toast({ message: `${first(m.host)} isn’t free then (another meeting, time off or outside hours). Pick another time.`, tone: 'danger' }); return; }
    update({ ...m, start, end, host }, `Moved to ${formatDay(start)}, ${formatClockRange(minutesOf(start), minutesOf(end))}${host !== m.host ? `; ${host} takes it` : ''}`);
    toast({ message: `Moved to ${formatDay(start)}, ${formatClockRange(minutesOf(start), minutesOf(end))}. ${first(m.invitee.name)} ${how}.`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/patch', id: m.id, patch: { start: m.start, end: m.end, host: m.host }, note: 'Move undone' }) } });
  };
  const freeTeammate = (m: BookedMeeting, pool: ReadonlyArray<string> = TEAM, given: ReadonlyArray<BookedMeeting> = []) => pool.find((n) => n !== m.host && !isOff(state, n, m.start, minutesOf(m.start), minutesOf(m.end))
    && ![...state.meetings, ...given].some((x) => x.id !== m.id && x.host === n && x.status !== 'cancelled' && x.start < m.end && m.start < x.end));
  /** Hands several meetings on; each one counts the ones already handed on in this batch, so no one is double-booked. */
  const reassignMany = (list: ReadonlyArray<BookedMeeting>, pool?: ReadonlyArray<string>) => {
    const given: BookedMeeting[] = [];
    list.forEach((m) => { const to = freeTeammate(m, pool, given); if (to) { given.push({ ...m, host: to }); update({ ...m, host: to }, `Reassigned from ${m.host} to ${to}`); } });
    return given.length;
  };
  const confirm = (id: string) => { const m = meetingById(id); if (!m) return;
    // Confirming checks again: the tables or the host may have been taken since they asked.
    if (m.tables?.length) { const held = heldTables(state, m.start, minutesOf(m.start), minutesOf(m.end) - minutesOf(m.start), m.id); const taken = m.tables.filter((t) => held.has(t)); if (taken.length) { toast({ message: `${taken.map((t) => state.tables?.find((x) => x.id === t)?.name ?? t).join(' + ')} is taken then. Edit the booking to give ${first(m.invitee.name)} another table first.`, tone: 'danger' }); return; } }
    else if (!m.tables && hostAt(m, m.start, m.end, false) === undefined) { toast({ message: `${first(m.host)} isn’t free then any more. Move it or decline.`, tone: 'danger' }); return; }
    update({ ...m, status: 'confirmed' }, `Confirmed by ${HOST}`); dispatch({ type: 'note/read', id, read: true }); toast({ message: `Confirmed · ${first(m.invitee.name)} gets an invitation`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/patch', id: m.id, patch: { status: m.status }, note: 'Confirm undone' }) } }); };
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
  const labelOf = (x: { readonly id: string; readonly label: string }) => (restaurant && x.id === 'meetings' ? 'Reservations' : restaurant && x.id === 'guests' ? 'Guests' : x.label);
  /** Guests and Clients are a business's: a team's people are records in the app. */
  const shows = (id: string) => ((id !== 'routing' && id !== 'roster') || isTeam) && !(id === 'routing' && hideRouting) && (id !== 'menu' || state.menu !== undefined) && (id !== 'guests' || state.business !== undefined);

  const bookingsNav = (
      <NavSection title="Bookings">
        {SECTIONS.filter((x) => shows(x.id) && !(appNav && x.id === 'insights') && !hiddenSections.includes(x.id)).map((x) => (
          <NavItem key={x.id} label={labelOf(x)} icon={x.icon} badge={x.id === 'meetings' && waiting > 0 ? waiting : undefined} isCurrent={tab === x.id && appContent === undefined} onPress={() => { leaveEditor(); setTab(x.id); onBookingsNav?.(); }} />
        ))}
      </NavSection>
  );
  const sidebar = (
    <Sidebar isCollapsed={collapsed} onCollapsedChange={setCollapsed}
      header={<WorkspaceSwitcher name={workspaceName ?? state.workspace} plan={state.business ? state.business.kindLabel : 'Team plan · 4 members'} mark={<LogoMark size={28} />} onAction={(k) => { const id = String(k); if (id.startsWith('ws:')) switchTo(id.slice(3) as WorkspaceId); else if (id === 'settings' || id === 'create') onMenu?.(id); }}>
        {showDemoMenu ? <WorkspaceItems current={currentWs} /> : null}
        {showDemoMenu ? <MenuSeparator /> : null}
        {onMenu ? <MenuItem id="settings" icon={<Settings {...i16} />}>Workspace settings</MenuItem> : null}
        {onMenu ? <MenuItem id="create" icon={<Plus {...i16} />}>Create a workspace</MenuItem> : null}
      </WorkspaceSwitcher>}
      footer={<PersonRow name={person?.name ?? HOST} email={person?.email ?? 'priya@northwind.com'} src={person?.src} onAction={(k) => { const id = String(k); if (id === 'profile' || id === 'signout') onMenu?.(id); }}>
        {onMenu ? <MenuItem id="profile" icon={<User {...i16} />}>Profile</MenuItem> : <MenuItem id="none" isDisabled>Your profile is in the Timefix app</MenuItem>}
        {onMenu ? <MenuSeparator /> : null}
        {onMenu ? <MenuItem id="signout" icon={<LogOut {...i16} />}>Sign out</MenuItem> : null}
      </PersonRow>}>
      {/* On its own, Bookings shows only its own pages; the rest of the app lives in the Timefix app around it. */}
      {appNav ? appNav(bookingsNav) : bookingsNav}
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
    const hours = Object.fromEntries(HOURS_DAYS.map((d) => [d, v.hours.days.includes(d) ? { on: true, ranges: [{ id: nextId('r'), start: v.hours.start, end: v.hours.end }] } : { on: false, ranges: [] }])) as unknown as BookingsState['savedHours'][number]['hours'];
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
      <GuestMode play={guest} state={guestState} onClose={closeGuest} onBooked={book} onBookedChange={changeLastBooked}
        onWaitlist={(w) => dispatch({ type: 'waitlist/set', waitlist: [...(state.waitlist ?? []), { id: nextId('w'), name: w.name, phone: w.phone, party: w.party, day: w.day, wanted: w.wanted, added: new Date(), online: true }] })}
        onGuestCancel={(m, reason) => update({ ...m, status: 'cancelled', cancelledBy: 'guest', cancelReason: reason || undefined }, `Cancelled by ${m.invitee.name}${reason ? `: “${reason}”` : ''}`)}
        onGuestMove={(m, start) => {
          const end = new Date(start.getTime() + (m.end.getTime() - m.start.getTime()));
          // A table booking needs a table that fits then; a meeting needs someone free. Neither is forced through.
          if (m.tables?.length) {
            const len = Math.round((m.end.getTime() - m.start.getTime()) / 60_000);
            const fit = fitTables(state, m.party ?? 2, start, minutesOf(start), len, false, m.area, m.id);
            if (!fit) return false;
            update({ ...m, start, end, tables: fit.map((t) => t.id), placeLabel: fit.map((t) => t.name).join(' + ') }, `Moved by ${m.invitee.name} to ${formatDay(start)}`); return true;
          }
          const host = hostAt(m, start, end, false); if (!host) return false;
          update({ ...m, start, end, host }, `Moved by ${m.invitee.name} to ${formatDay(start)}${host !== m.host ? `; ${host} takes it` : ''}`); return true;
        }} />
    ) : (
    <AppShell sidebar={sidebar} className="tf-bkf"
      mobileNav={appMobileNav ?? <TabBar aria-label="Bookings" current={tab}
        items={SECTIONS.filter((x) => shows(x.id)).map((x) => ({ id: x.id, label: restaurant && x.id === 'meetings' ? 'Bookings' : restaurant && x.id === 'guests' ? 'Guests' : SHORT[x.id] ?? x.label, icon: x.icon, badge: x.id === 'meetings' ? waiting : undefined }))}
        onChange={(id) => { leaveEditor(); setTab(id); }} />}>
      {appContent !== undefined ? appContent : (editor && editing ? (
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
            actions={<>{demoMenu}{appActions ?? bell}</>} />
          {brokenCal && (
            <div className="tf-bkf__topalert">
              <Callout tone="warning" action={{ label: 'Reconnect', onPress: () => { dispatch({ type: 'calendar/set', calendars: state.calendars.map((c) => (c.id === brokenCal.id ? { ...c, status: 'connected' } : c)) }); toast({ message: `${brokenCal.provider} calendar reconnected`, tone: 'success' }); } }}>
                Your {brokenCal.provider} calendar stopped syncing. Busy times on it aren’t checked, so guests could book over them.
              </Callout>
            </div>
          )}
          <div className="tf-bkf__body">
              {tab === 'meetings' && restaurant && (<div className="tf-bkf__panel">
                <ReservationsTab state={state} dispatch={dispatch} onProfile={setProfileKey} fresh={freshMeeting} openId={meetingId} onOpened={() => setMeetingId(undefined)} onCancel={(m) => cancelNow(m)} onConfirm={confirm} onDecline={setDeclineId} />
              </div>)}
              {tab === 'meetings' && !restaurant && (<div className="tf-bkf__panel">
                <MeetingsTab state={state} view={view} onView={(v) => { setView(v); if (v === 'list') setFocusHour(undefined); }} whose={whose} onWhose={setWhose}
                  week={week} onWeek={(w) => { setWeek(w); setFocusHour(undefined); }} focusHour={focusHour} fresh={freshMeeting}
                  onOpen={setMeetingId} onCancel={cancelNow} onUndoCancel={(m) => { const x = meetingById(m.id); if (!x) return; undone.current.add(x.id); update({ ...x, status: before.current.get(x.id)?.status ?? 'confirmed' }, 'Cancel undone'); }}
                  onReschedule={setRescheduleId} onNoShow={(id) => { const m = meetingById(id); if (m) { update({ ...m, status: 'no-show' }, 'Marked as no-show'); toast({ message: `${first(m.invitee.name)} marked as no-show`, action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/patch', id: m.id, patch: { status: m.status }, note: 'No-show undone' }) } }); } }}
                  onConfirm={confirm} onDecline={setDeclineId}
                  onCreatePage={() => setCreating(true)} onCopyFirstLink={() => { const p = state.pages.find((x) => x.isOn) ?? state.pages[0]; if (p) onShare(p, 'copy'); }}
                  onNewMeeting={(initial) => setNewMeeting({ initial })} onQuickMeeting={bookNew}
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
                  onSeeConflict={seeConflict} onJoin={(id) => { const m = meetingById(id); if (m) join(m); }} />
              </div>)}
              {tab === 'pages' && (<div className="tf-bkf__panel">
                <PagesTab state={state} fresh={freshPage} leaving={leaving} onOpen={(id) => { const p = pageById(id); if (p) setEditor({ id, draft: draftOf(p) }); }}
                  onFix={(id, section) => { const p = pageById(id); if (p) setEditor({ id, draft: draftOf(p), section: section ?? 'who' }); }}
                  onToggle={toggle} onShare={onShare} onMore={onMore} onCreate={(k) => { setCreateKind(k === 'service' ? 'service' : undefined); setCreating(true); }} dispatch={dispatch} onSeePage={() => { const p = state.pages[0]; if (p) setGuest({ scenario: 'profile', pageId: p.id }); }}
                  onSeeMenu={() => { const p = state.pages[0]; if (p) setGuest({ scenario: 'menu', pageId: p.id }); }} onEditMenu={() => setTab('menu')} />
              </div>)}
              {tab === 'menu' && state.menu && (<div className="tf-bkf__panel">
                <MenuTab state={state} dispatch={dispatch} onTables={() => setTab('availability')}
                  onGuest={(table) => { const p = state.pages[0]; if (p) setGuest({ scenario: 'menu', pageId: p.id, table }); }} />
              </div>)}
              {tab === 'availability' && (<div className="tf-bkf__panel">
                <AvailabilityTab state={state} dispatch={dispatch} onReassignMany={(list: ReadonlyArray<BookedMeeting>, pool?: ReadonlyArray<string>) => reassignMany(list, pool)} />
              </div>)}
              {tab === 'roster' && isTeam && (<div className="tf-bkf__panel"><RosterTab state={state} dispatch={tellOthers} onReassignMany={(list) => reassignMany(list)} onManageGroups={() => setGroupsOpen(true)} /></div>)}
              {tab === 'guests' && state.business && (<div className="tf-bkf__panel"><GuestsTab state={state} onOpen={setProfileKey} /></div>)}
              {tab === 'insights' && (<div className="tf-bkf__panel"><InsightsTab state={state} dispatch={dispatch} /></div>)}
              {tab === 'routing' && isTeam && (<div className="tf-bkf__panel"><RoutingTab state={state} dispatch={dispatch} /></div>)}
          </div>
        </>
      ))}

      <CreateSheet isOpen={creating} state={state} kind={createKind}
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
        onNoShow={(m) => { update({ ...m, status: 'no-show' }, 'Marked as no-show'); toast({ message: `${first(m.invitee.name)} marked as no-show`, action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/patch', id: m.id, patch: { status: m.status }, note: 'No-show undone' }) } }); }}
        onJoin={(m) => { const x = meetingById(m.id); if (x) join(x); }} onConfirm={(m) => confirm(m.id)} onDecline={(m) => setDeclineId(m.id)}
        onProfile={state.business ? (m) => { const k = guestKey(m); if (k) { setMeetingId(undefined); setProfileKey(k); } } : undefined} />
      <GuestDrawer state={state} dispatch={dispatch} guestKey={profileKey} onClose={() => setProfileKey(undefined)} isReadOnly={isReadOnly}
        onBooking={(m) => { setProfileKey(undefined); leaveEditor(); setTab('meetings'); setMeetingId(m.id); }} />
      <RescheduleDialog meeting={meetingById(rescheduleId)} state={state} onClose={() => setRescheduleId(undefined)}
        onMove={(m, start) => { setRescheduleId(undefined); move(m, start, 'gets an email with the new time'); }} />
      <ReassignDialog meeting={meetingById(reassignId)} state={state} onClose={() => setReassignId(undefined)}
        onReassign={(m, host) => { setReassignId(undefined); update({ ...m, host }, `Reassigned from ${m.host} to ${host}`); toast({ message: `${m.title} is ${first(host)}'s now`, tone: 'success', action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/patch', id: m.id, patch: { host: m.host }, note: 'Reassign undone' }) } }); }} />
      <NewMeetingDialog isOpen={newMeeting !== undefined} state={state} initial={newMeeting?.initial} onClose={() => setNewMeeting(undefined)} onBook={bookNew} />
      <DeclineDialog meeting={meetingById(declineId)} onClose={() => setDeclineId(undefined)}
        onDecline={(m, reason) => { setDeclineId(undefined); setMeetingId(undefined); update({ ...m, status: 'cancelled' }, `Declined by ${HOST}${reason ? `: “${reason}”` : ''}`); dispatch({ type: 'note/read', id: m.id, read: true }); toast({ message: `Declined · ${first(m.invitee.name)} is told`, action: { label: 'Undo', onAction: () => dispatch({ type: 'meeting/patch', id: m.id, patch: { status: m.status }, note: 'Decline undone' }) } }); }} />
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
          const gone = toDelete.id; const moved = state.routing.rules.filter((r) => r.pageId === gone).map((r) => r.id); const fallback = state.routing.fallbackPageId === gone;
          if (routedTo(gone)) dispatch({ type: 'routing/set', routing: { ...state.routing, rules: state.routing.rules.map((r) => (r.pageId === gone ? { ...r, pageId: to } : r)), fallbackPageId: fallback ? to : state.routing.fallbackPageId } });
          // Undo puts the routing back too: only the rules this delete re-pointed.
          remove(toDelete, moved.length || fallback ? () => dispatch({ type: 'routing/patch', ids: moved, pageId: gone, fallback }) : undefined);
        }} />
    </AppShell>
    )}
    </I18nProvider>
  );
}

