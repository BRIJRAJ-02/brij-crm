// The Bookings flow's model: types, the one reducer, and the pure rules (open times, summaries, routing).
import type { WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { HOURS_DAYS, summarizeHours } from '../HoursEditor/HoursEditor.tsx';
import type { Meeting, MeetingPlace } from '../MeetingList/MeetingList.tsx';
import type { Notification } from '../NotificationList/NotificationList.tsx';
import type { CalendarAccount } from '../CalendarConnections/CalendarConnections.tsx';
import type { Hue } from '../Tag/Tag.tsx';
import type { FormQuestion } from '../HostedForm/answers.ts';
import type { GuestLookValue } from '../GuestLook/GuestLook.tsx';
import type { SocialLink } from '../SocialLinks/SocialLinks.tsx';
import type { RecordRef } from '../ComboBox/ComboBox.tsx';
import type { Condition, Conjunction } from '../Sentence/Sentence.tsx';
import type { Attribute } from '../AttributeField/AttributeField.tsx';
import { formatClockRange, minutesOf } from '../WeekCalendar/clock.ts';
import { formatDay } from '../../lib/format.ts';

/* ------------------------------------------------------------------ People and places */

/** The signed-in host. */
export const HOST = 'Priya Raman';
/** Everyone in the Northwind workspace. */
export const TEAM: ReadonlyArray<string> = ['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen'];
/** The host's own time zone. */
export const HOST_ZONE = 'Asia/Kolkata';
/** Zones a guest can pick. */
export const ZONES = [
  { id: 'Asia/Kolkata', label: 'India Standard Time' },
  { id: 'Europe/London', label: 'London (GMT)' },
  { id: 'America/New_York', label: 'Eastern Time (US)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { id: 'Asia/Singapore', label: 'Singapore' },
];
/** First names, for short lines. */
export const first = (name: string) => name.split(' ')[0] ?? name;

/** Where a booking page's meetings happen. */
export type PlaceKind = 'meet' | 'phone' | 'in-person' | 'zoom';
/** Each place's words and how a meeting draws it. */
export const PLACES: Readonly<Record<PlaceKind, { readonly label: string; readonly guest: 'video' | 'phone' | 'place'; readonly meeting: MeetingPlace }>> = {
  meet: { label: 'Google Meet', guest: 'video', meeting: 'video' },
  zoom: { label: 'Zoom', guest: 'video', meeting: 'video' },
  phone: { label: 'Phone', guest: 'phone', meeting: 'phone' },
  'in-person': { label: 'Northwind office', guest: 'place', meeting: 'in-person' },
};
/** The order places are offered in. */
export const PLACE_ORDER: ReadonlyArray<PlaceKind> = ['meet', 'zoom', 'phone', 'in-person'];

/* ------------------------------------------------------------------ Pages */

/** A one-time link: for one guest, a few bookings, until a date. */
export interface OneTimeLink { readonly id: string; readonly label: string; readonly uses: number; readonly used: number; readonly expires: string; readonly revoked: boolean }
/** A link that offers only a few picked times. */
export interface OfferedTimes { readonly id: string; readonly slots: ReadonlyArray<{ readonly day: string; readonly start: number }>; readonly created: string }
/** Who takes a page's meetings. */
export type HostMode = 'one' | 'collective' | 'roundrobin' | 'managed';
/** How round robin shares meetings out. */
export type ShareOut = 'equal' | 'weighted' | 'priority';

/** One booking page. Every page is born bookable: the host's hours, 30 minutes, Google Meet. */
export interface BookingPage {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  /** One or several lengths the guest chooses from; the first is the default. */
  readonly durations: ReadonlyArray<number>;
  /** One or several places the guest chooses from. */
  readonly places: ReadonlyArray<PlaceKind>;
  /** In person: where to meet. */
  readonly address: string;
  /** Phone: who rings whom. */
  readonly phoneWho: 'host' | 'guest';
  readonly description: string;
  readonly isOn: boolean;
  /** Whose page it is (Mine / Team). */
  readonly owner: string;
  /** 'working', a saved hours id, or 'custom'. */
  readonly hoursFrom: string;
  readonly customHours?: WeekHours;
  readonly bufferBefore: number;
  readonly bufferAfter: number;
  readonly noticeHours: number;
  readonly daysAhead: number;
  /** 0 means no limit. */
  readonly perDay: number;
  readonly perWeek: number;
  readonly hostMode: HostMode;
  readonly hosts: ReadonlyArray<string>;
  readonly shareOut: ShareOut;
  /** Weights (weighted) or order (priority) per host. */
  readonly weights: Readonly<Record<string, number>>;
  readonly groupId?: string;
  readonly whoCanBook: 'anyone' | 'form';
  readonly formName: string;
  readonly questions: ReadonlyArray<FormQuestion>;
  readonly confirmFirst: boolean;
  readonly calendarId: string;
  readonly addToPeople: boolean;
  readonly after: 'message' | 'redirect';
  readonly redirectUrl: string;
  /** 'day' (a day before), 'hour' (an hour before). */
  readonly reminders: ReadonlyArray<string>;
  readonly look: GuestLookValue;
  readonly showPhoto: boolean;
  readonly socials: ReadonlyArray<SocialLink>;
  readonly accent: Hue;
  readonly stats: { readonly views: number; readonly bookings: number; readonly showRate: number };
  readonly links: ReadonlyArray<OneTimeLink>;
  readonly offers: ReadonlyArray<OfferedTimes>;
}

/* ------------------------------------------------------------------ Meetings and time */

/** One line of a meeting's activity. */
export interface ActivityLine { readonly id: string; readonly text: string; readonly at: Date }
/** A meeting booked through a page (or by hand), with what the guest answered. */
export interface BookedMeeting extends Meeting {
  readonly host: string;
  readonly pageId?: string;
  readonly answers: ReadonlyArray<{ readonly question: string; readonly answer: string }>;
  /** The host's own notes. */
  readonly notes: string;
  readonly guestZone: string;
  readonly record?: RecordRef;
  readonly activity: ReadonlyArray<ActivityLine>;
}
/** Time a member blocked or held by hand. */
export interface TimeBlock { readonly id: string; readonly member: string; readonly day: string; readonly start: number; readonly end: number; readonly kind: 'block' | 'hold'; readonly label: string }
/** Time off: a day or a range, all day or some hours, with a note. */
export interface TimeOff { readonly id: string; readonly member: string; readonly from: string; readonly to: string; readonly allDay: boolean; readonly start: number; readonly end: number; readonly note: string }
/** A named set of weekly hours. */
export interface SavedHours { readonly id: string; readonly name: string; readonly hours: WeekHours }
/** Time another calendar holds on one day. */
export interface BusyBlock { readonly id: string; readonly member: string; readonly day: string; readonly start: number; readonly end: number; readonly source: string }
/** A connected calendar's extra facts the card shows. */
export interface CalendarHealth { readonly skipped: Readonly<Record<string, number>>; readonly bookingCalendar: string }

/* ------------------------------------------------------------------ Teams */

/** A round robin group: its members and who is paused. */
export interface RoundRobinGroup { readonly id: string; readonly name: string; readonly members: ReadonlyArray<{ readonly name: string; readonly paused: boolean }> }
/** One routing rule: when the answers match, book this page with this team. */
export interface RoutingRule { readonly id: string; readonly conditions: ReadonlyArray<Condition>; readonly conjunction: Conjunction; readonly pageId: string; readonly team: string }
/** The routing form: its rules, the fallback, member skills and what "won" means. */
export interface Routing {
  readonly formName: string;
  readonly rules: ReadonlyArray<RoutingRule>;
  readonly fallbackPageId: string;
  readonly skills: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly wonMeans: string;
}

/** Everything the flow holds. */
export interface BookingsState {
  readonly workspace: string;
  readonly pages: ReadonlyArray<BookingPage>;
  readonly meetings: ReadonlyArray<BookedMeeting>;
  readonly notifications: ReadonlyArray<Notification>;
  /** The default weekly hours ("Working hours"), then any saved sets. */
  readonly savedHours: ReadonlyArray<SavedHours>;
  readonly defaultHoursId: string;
  /** Each teammate's hours, when they differ from the default. */
  readonly memberHours: Readonly<Record<string, WeekHours>>;
  readonly timeOff: ReadonlyArray<TimeOff>;
  readonly calendars: ReadonlyArray<CalendarAccount>;
  readonly health: CalendarHealth;
  readonly busy: ReadonlyArray<BusyBlock>;
  readonly blocks: ReadonlyArray<TimeBlock>;
  readonly groups: ReadonlyArray<RoundRobinGroup>;
  readonly routing: Routing;
}

/** Every change the flow can make. */
export type BookingsAction =
  | { readonly type: 'page/upsert'; readonly page: BookingPage }
  | { readonly type: 'page/delete'; readonly id: string }
  | { readonly type: 'page/restore'; readonly page: BookingPage; readonly index: number }
  | { readonly type: 'meeting/add'; readonly meeting: BookedMeeting; readonly notification?: Notification }
  | { readonly type: 'meeting/update'; readonly meeting: BookedMeeting }
  | { readonly type: 'note/read'; readonly id: string; readonly read: boolean }
  | { readonly type: 'note/read-all' }
  | { readonly type: 'note/archive'; readonly id: string }
  | { readonly type: 'hours/set'; readonly id: string; readonly hours: WeekHours }
  | { readonly type: 'hours/saved'; readonly savedHours: ReadonlyArray<SavedHours>; readonly defaultHoursId: string }
  | { readonly type: 'timeoff/set'; readonly timeOff: ReadonlyArray<TimeOff> }
  | { readonly type: 'member/hours'; readonly name: string; readonly hours: WeekHours }
  | { readonly type: 'calendar/set'; readonly calendars: ReadonlyArray<CalendarAccount>; readonly health?: CalendarHealth }
  | { readonly type: 'busy/add'; readonly block: BusyBlock }
  | { readonly type: 'block/add'; readonly block: TimeBlock }
  | { readonly type: 'block/remove'; readonly id: string }
  | { readonly type: 'groups/set'; readonly groups: ReadonlyArray<RoundRobinGroup> }
  | { readonly type: 'routing/set'; readonly routing: Routing }
  | { readonly type: 'reset'; readonly state: BookingsState };

const byStart = (a: Meeting, b: Meeting) => a.start.getTime() - b.start.getTime();

/** The pure reducer behind the flow: new objects only, nothing mutated. */
export function bookingsReducer(state: BookingsState, action: BookingsAction): BookingsState {
  switch (action.type) {
    case 'page/upsert': return state.pages.some((p) => p.id === action.page.id)
      ? { ...state, pages: state.pages.map((p) => (p.id === action.page.id ? action.page : p)) }
      : { ...state, pages: [action.page, ...state.pages] };
    case 'page/delete': return { ...state, pages: state.pages.filter((p) => p.id !== action.id) };
    case 'page/restore': return { ...state, pages: [...state.pages.slice(0, action.index), action.page, ...state.pages.slice(action.index)] };
    case 'meeting/add': return {
      ...state,
      meetings: [...state.meetings, action.meeting].sort(byStart),
      notifications: action.notification ? [action.notification, ...state.notifications] : state.notifications,
    };
    case 'meeting/update': return { ...state, meetings: state.meetings.map((m) => (m.id === action.meeting.id ? action.meeting : m)).sort(byStart) };
    case 'note/read': return { ...state, notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, read: action.read } : n)) };
    case 'note/read-all': return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };
    case 'note/archive': return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };
    case 'hours/set': return { ...state, savedHours: state.savedHours.map((h) => (h.id === action.id ? { ...h, hours: action.hours } : h)) };
    case 'hours/saved': return { ...state, savedHours: action.savedHours, defaultHoursId: action.defaultHoursId };
    case 'timeoff/set': return { ...state, timeOff: action.timeOff };
    case 'member/hours': return { ...state, memberHours: { ...state.memberHours, [action.name]: action.hours } };
    case 'calendar/set': return { ...state, calendars: action.calendars, health: action.health ?? state.health };
    case 'busy/add': return { ...state, busy: [...state.busy, action.block] };
    case 'block/add': return { ...state, blocks: [...state.blocks, action.block] };
    case 'block/remove': return { ...state, blocks: state.blocks.filter((b) => b.id !== action.id) };
    case 'groups/set': return { ...state, groups: action.groups };
    case 'routing/set': return { ...state, routing: action.routing };
    case 'reset': return action.state;
  }
}

/* ------------------------------------------------------------------ Helpers */

let seq = 0;
/** A fresh id with a prefix. */
export const nextId = (prefix: string) => { seq += 1; return `${prefix}-${Date.now().toString(36)}-${seq}`; };
/** "Discovery call" → "discovery-call". */
export const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'meeting';
/** The page's public address, without the scheme. */
export const pageUrl = (slug: string) => `timefix.com/priya/${slug}`;
/** `YYYY-MM-DD` for a local date. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** A local date from `YYYY-MM-DD`. */
export const parseDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1); };
/** A local date plus minutes from midnight. */
export const at = (day: Date, minutes: number) => { const d = new Date(day.getFullYear(), day.getMonth(), day.getDate()); d.setMinutes(minutes); return d; };
/** Midnight today, plus n days. */
export const dayFrom = (now: Date, n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
/** The Monday of a date's week. */
export const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
/** "3 meetings", "1 meeting". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A page's default length. */
export const lengthOf = (p: BookingPage) => p.durations[0] ?? 30;
/** A page's first place. */
export const placeOf = (p: BookingPage): PlaceKind => p.places[0] ?? 'meet';
/** "30 min" or "30 or 60 min". */
export const lengthsText = (p: BookingPage) => (p.durations.length > 1 ? `${p.durations.slice(0, -1).join(', ')} or ${p.durations[p.durations.length - 1]} min` : `${lengthOf(p)} min`);
/** A place as the guest reads it: the address for in person. */
export const placeLabel = (p: BookingPage, k: PlaceKind) => (k === 'in-person' && p.address.trim() ? p.address.trim() : PLACES[k].label);
/** "Google Meet" or "Google Meet or Phone". */
export const placesText = (p: BookingPage) => p.places.map((k) => placeLabel(p, k)).join(' or ');
const dayKey = (d: Date) => HOURS_DAYS[(d.getDay() + 6) % 7] ?? 'mon';
const overlap = (a: number, b: number, c: number, d: number) => a < d && c < b;

/** The hours a page offers. */
export function hoursFor(page: BookingPage, state: BookingsState): WeekHours {
  if (page.hoursFrom === 'custom' && page.customHours) return page.customHours;
  const id = page.hoursFrom === 'working' ? state.defaultHoursId : page.hoursFrom;
  return (state.savedHours.find((h) => h.id === id) ?? state.savedHours[0])?.hours ?? EMPTY_WEEK;
}
const EMPTY_WEEK: WeekHours = { mon: { on: false, ranges: [] }, tue: { on: false, ranges: [] }, wed: { on: false, ranges: [] }, thu: { on: false, ranges: [] }, fri: { on: false, ranges: [] }, sat: { on: false, ranges: [] }, sun: { on: false, ranges: [] } };
/** A member's weekly hours. */
export const memberHours = (state: BookingsState, name: string): WeekHours => state.memberHours[name] ?? (state.savedHours.find((h) => h.id === state.defaultHoursId)?.hours ?? EMPTY_WEEK);

/** Whether a member is off at a time on a day (all day, or within the hours of a partial day off). */
export function isOff(state: BookingsState, member: string, date: Date, start = 0, end = 24 * 60): TimeOff | undefined {
  const d = isoDay(date);
  return state.timeOff.find((t) => t.member === member && t.from <= d && d <= t.to && (t.allDay || overlap(start, end, t.start, t.end)));
}
/** A round robin member who is paused in the page's group. */
export function isPaused(state: BookingsState, page: BookingPage, member: string): boolean {
  const g = state.groups.find((x) => x.id === page.groupId);
  return g?.members.some((m) => m.name === member && m.paused) ?? false;
}

/** What other calendars hold for a member on a day: the connected calendar's busy time, and blocks or holds made by hand. */
export function busyOn(state: BookingsState, member: string, date: Date): ReadonlyArray<{ readonly id: string; readonly start: number; readonly end: number; readonly source: string; readonly kind: 'calendar' | 'block' | 'hold' }> {
  const d = isoDay(date);
  const checks = state.calendars.some((c) => c.checkConflicts && c.status === 'connected');
  return [
    ...(checks ? state.busy.filter((b) => b.member === member && b.day === d).map((b) => ({ ...b, kind: 'calendar' as const })) : []),
    ...state.blocks.filter((b) => b.member === member && b.day === d).map((b) => ({ id: b.id, start: b.start, end: b.end, source: b.label, kind: b.kind })),
  ];
}

/** Hosts who could take a page's meetings at all (not paused). */
export const activeHosts = (state: BookingsState, p: BookingPage) => p.hosts.filter((h) => !(p.hostMode === 'roundrobin' && isPaused(state, p, h)));
/** Whether nobody on a page can take a booking in the next week (everyone paused or off). */
export function noHostsFree(state: BookingsState, p: BookingPage, now: Date): boolean {
  const hosts = activeHosts(state, p);
  if (hosts.length === 0) return true;
  const week = Array.from({ length: 7 }, (_, n) => dayFrom(now, n));
  const freeOn = (h: string) => week.some((d) => !isOff(state, h, d));
  return p.hostMode === 'collective' ? !hosts.every(freeOn) : !hosts.some(freeOn);
}

/** Whether one member is free for a span on a day: hours, time off, meetings (with the page's buffers) and busy time. */
function memberFree(state: BookingsState, page: BookingPage | undefined, member: string, date: Date, start: number, end: number): boolean {
  if (isOff(state, member, date, start, end)) return false;
  const before = page?.bufferBefore ?? 0;
  const after = page?.bufferAfter ?? 0;
  const clash = state.meetings.some((m) => m.host === member && m.status !== 'cancelled' && m.start.toDateString() === date.toDateString()
    && overlap(start - before, end + after, minutesOf(m.start), minutesOf(m.end)));
  return !clash && !busyOn(state, member, date).some((b) => overlap(start, end, b.start, b.end));
}
/** Who would take a slot: for round robin, the free host with the fewest meetings this month (or by weight or priority). */
export function hostFor(state: BookingsState, page: BookingPage, date: Date, start: number, end: number): string | undefined {
  const free = activeHosts(state, page).filter((h) => memberFree(state, page, h, date, start, end));
  if (page.hostMode === 'collective') return free.length === activeHosts(state, page).length ? page.hosts[0] : undefined;
  if (page.hostMode !== 'roundrobin') return free[0];
  const spread = monthSpread(state, page, date);
  const score = (h: string) => (page.shareOut === 'priority' ? (page.weights[h] ?? 9) * 1000 + (spread[h] ?? 0)
    : page.shareOut === 'weighted' ? (spread[h] ?? 0) / Math.max(1, page.weights[h] ?? 1) : spread[h] ?? 0);
  return [...free].sort((a, b) => score(a) - score(b))[0];
}
/** Meetings each host took on a page this month. */
export function monthSpread(state: BookingsState, page: BookingPage, now: Date): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  page.hosts.forEach((h) => { out[h] = 0; });
  state.meetings.forEach((m) => {
    if (m.pageId === page.id && m.status !== 'cancelled' && m.start.getMonth() === now.getMonth() && m.start.getFullYear() === now.getFullYear()) out[m.host] = (out[m.host] ?? 0) + 1;
  });
  return out;
}

/** The open start times of a page on a day: its hours, minus notice, limits, time off, busy time and meetings with buffers. */
export function openTimes(page: BookingPage, state: BookingsState, date: Date, now: Date, length = lengthOf(page)): ReadonlyArray<number> {
  const startOfToday = dayFrom(now, 0);
  const ahead = Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);
  if (ahead < 0 || ahead > page.daysAhead) return [];
  const day = hoursFor(page, state)[dayKey(date)];
  if (!day.on) return [];
  const mine = state.meetings.filter((m) => m.pageId === page.id && m.status !== 'cancelled');
  if (page.perDay > 0 && mine.filter((m) => m.start.toDateString() === date.toDateString()).length >= page.perDay) return [];
  const monday = mondayOf(date).getTime();
  if (page.perWeek > 0 && mine.filter((m) => mondayOf(m.start).getTime() === monday).length >= page.perWeek) return [];
  const earliest = ahead === 0 ? minutesOf(now) + page.noticeHours * 60 : ahead * 1440 < page.noticeHours * 60 ? Infinity : -1;
  const step = length < 30 ? 15 : 30;
  const out: number[] = [];
  day.ranges.forEach((r) => {
    for (let m = r.start; m + length <= r.end; m += step) if (m > earliest && hostFor(state, page, date, m, m + length)) out.push(m);
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Meetings that busy time now overlaps. */
export function conflicted(state: BookingsState, now: Date): ReadonlyArray<BookedMeeting> {
  return state.meetings.filter((m) => m.status !== 'cancelled' && m.end > now
    && busyOn(state, m.host, m.start).some((b) => b.kind === 'calendar' && overlap(minutesOf(m.start), minutesOf(m.end), b.start, b.end)));
}

/* ------------------------------------------------------------------ Summaries: each closed section's one line */

/** "Mon – Fri, 9:00 AM – 5:00 PM · 10 min buffer · book up to 60 days ahead". */
export function whenSummary(p: BookingPage, state: BookingsState): string {
  const from = p.hoursFrom === 'custom' ? 'Custom hours' : p.hoursFrom === 'working' ? summarizeHours(hoursFor(p, state)) : state.savedHours.find((h) => h.id === p.hoursFrom)?.name ?? 'Working hours';
  const buffer = p.bufferBefore || p.bufferAfter ? `${Math.max(p.bufferBefore, p.bufferAfter)} min buffer` : 'no buffer';
  return `${from} · ${buffer} · book up to ${p.daysAhead} days ahead`;
}
/** "You", "Round robin · 3 hosts", "Everyone free · 2 hosts", "A copy for each of 4". */
export function whoSummary(p: BookingPage, state: BookingsState, now: Date): string {
  if (noHostsFree(state, p, now)) return 'No hosts available this week';
  const n = p.hosts.length;
  const form = p.whoCanBook === 'form' ? ` · only through ${p.formName}` : '';
  if (p.hostMode === 'roundrobin') return `Round robin · ${n} hosts${form}`;
  if (p.hostMode === 'collective') return `Everyone free · ${n} hosts${form}`;
  if (p.hostMode === 'managed') return `A copy for each of ${n}${form}`;
  return `${p.hosts[0] === HOST ? 'You' : p.hosts[0] ?? 'You'}${form}`;
}
/** "Name, email + 2". */
export const questionsSummary = (p: BookingPage) => (p.questions.length ? `Name, email + ${p.questions.length}` : 'Name and email');
/** "Confirmed at once · added to People". */
export const afterSummary = (p: BookingPage) => `${p.confirmFirst ? 'You confirm first' : 'Confirmed at once'}${p.addToPeople ? ' · added to People' : ''}${p.reminders.length ? ` · ${plural(p.reminders.length, 'reminder')}` : ''}`;
/** "Calm · photo · 2 links". */
export const lookSummary = (p: BookingPage) => [p.look.look === 'custom' ? 'Custom' : p.look.look.charAt(0).toUpperCase() + p.look.look.slice(1), p.showPhoto ? 'photo' : '', p.socials.length ? plural(p.socials.length, 'link') : ''].filter(Boolean).join(' · ');
/** "30 min · Google Meet". */
export const pageSub = (p: BookingPage) => `${lengthsText(p)} · ${placesText(p)}`;
/** A meeting's time as a short line. */
export const meetingWhen = (m: Meeting) => `${formatDay(m.start)} · ${formatClockRange(minutesOf(m.start), minutesOf(m.end))}`;

/* ------------------------------------------------------------------ Routing */

/** The routing form's questions, as attributes the Sentence pills read. */
export const ROUTING_FIELDS: ReadonlyArray<Attribute> = [
  { id: 'size', name: 'Team size', type: 'number' },
  { id: 'region', name: 'Region', type: 'select', options: [{ id: 'eu', label: 'Europe', hue: 'blue' }, { id: 'na', label: 'North America', hue: 'green' }, { id: 'apac', label: 'Asia Pacific', hue: 'orange' }] },
  { id: 'need', name: 'Looking for', type: 'select', options: [{ id: 'buy', label: 'Buying', hue: 'purple' }, { id: 'help', label: 'Help with an account', hue: 'sky' }, { id: 'partner', label: 'A partnership', hue: 'yellow' }] },
];
/** The answers a test (or a guest) gives the routing form. */
export type RoutingAnswers = Readonly<Record<string, string | number | undefined>>;
function holds(c: Condition, answers: RoutingAnswers): boolean {
  const v = answers[c.attributeId];
  switch (c.operator) {
    case 'gt': return typeof v === 'number' && typeof c.value === 'number' && v > c.value;
    case 'lt': return typeof v === 'number' && typeof c.value === 'number' && v < c.value;
    case 'is': return v !== undefined && v === c.value;
    case 'isNot': return v !== c.value;
    case 'isEmpty': return v === undefined || v === '';
    case 'isNotEmpty': return v !== undefined && v !== '';
    case 'contains': return typeof v === 'string' && typeof c.value === 'string' && v.toLowerCase().includes(c.value.toLowerCase());
    default: return false;
  }
}
/** The first rule the answers match, or undefined for the fallback. */
export function routeFor(routing: Routing, answers: RoutingAnswers): RoutingRule | undefined {
  return routing.rules.find((r) => r.conditions.length > 0 && (r.conjunction === 'and' ? r.conditions.every((c) => holds(c, answers)) : r.conditions.some((c) => holds(c, answers))));
}
