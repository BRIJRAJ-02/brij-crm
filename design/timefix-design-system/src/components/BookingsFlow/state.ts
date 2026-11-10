// The Bookings flow's model: types, the one reducer, and the pure rules (open times, summaries, routing).
import type { Menu, MenuAddOn, MenuDish } from '../MenuPage/MenuPage.tsx';
import type { DayHours, WeekHours } from '../HoursEditor/HoursEditor.tsx';
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
  { id: 'Asia/Dubai', label: 'Dubai' }, { id: 'Asia/Riyadh', label: 'Riyadh' }, { id: 'Asia/Karachi', label: 'Karachi' }, { id: 'Asia/Dhaka', label: 'Dhaka' },
  { id: 'Asia/Singapore', label: 'Singapore' }, { id: 'Asia/Hong_Kong', label: 'Hong Kong' }, { id: 'Asia/Jakarta', label: 'Jakarta' }, { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Australia/Sydney', label: 'Sydney' }, { id: 'Pacific/Auckland', label: 'Auckland' },
  { id: 'Europe/London', label: 'London (GMT)' }, { id: 'Europe/Berlin', label: 'Berlin, Paris (CET)' }, { id: 'Africa/Johannesburg', label: 'Johannesburg' }, { id: 'Africa/Nairobi', label: 'Nairobi' },
  { id: 'America/New_York', label: 'Eastern Time (US)' }, { id: 'America/Chicago', label: 'Central Time (US)' }, { id: 'America/Denver', label: 'Mountain Time (US)' }, { id: 'America/Los_Angeles', label: 'Pacific Time (US)' },
  { id: 'America/Toronto', label: 'Toronto' }, { id: 'America/Sao_Paulo', label: 'São Paulo' },
];
/** Minutes from UTC for any zone, today (so summer time is right): worked out from the browser's own clock. */
export function offsetOf(tz: string, at = new Date()): number {
  try { const local = new Date(at.toLocaleString('en-US', { timeZone: tz })); const utc = new Date(at.toLocaleString('en-US', { timeZone: 'UTC' })); return Math.round((local.getTime() - utc.getTime()) / 60_000); } catch { return 330; }
}
/** The guest's own zone from their browser, offered first; falls back to India when the browser won't say. */
export function guestZone(): string { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'; } catch { return 'Asia/Kolkata'; } }
/** The zone list with the guest's own zone in it, even when it isn't one of ours. */
export const zonesWithGuest = () => { const g = guestZone(); return ZONES.some((z) => z.id === g) ? ZONES : [{ id: g, label: g.split('/').pop()?.replace(/_/g, ' ') ?? g }, ...ZONES]; };
export const ZONE_OFFSET: Readonly<Record<string, number>> = { 'Asia/Kolkata': 330, 'Europe/London': 0, 'America/New_York': -300, 'America/Los_Angeles': -480, 'Asia/Singapore': 480 };
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
export type ShareOut = 'equal' | 'even' | 'weighted' | 'priority';
/** Parts of a managed page members can't change on their copy. */
export type LockedPart = 'length' | 'where' | 'questions' | 'look';

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
  /** Round robin counts meetings from the last this many days (0: this month). */
  readonly countDays?: number;
  /** Even: a host waits when they are this many meetings ahead of the least busy. */
  readonly evenGap?: number;
  /** Round robin caps: most meetings a day from this page, per host (0 none). */
  readonly caps?: Readonly<Record<string, number>>;
  /** Managed: what members can't change on their copy, and what each copy has changed. */
  readonly locked?: ReadonlyArray<LockedPart>;
  readonly drift?: Readonly<Record<string, ReadonlyArray<LockedPart>>>;
  /** Which emails go out (guest: confirm, change, cancel, after; host: booked, cancelled). Undefined is all of them. */
  readonly emails?: ReadonlyArray<string>;
  /** Which view the guest page opens in. */
  readonly defaultView?: 'month' | 'list' | 'chat';
  /** Who besides admins may edit this page. */
  readonly editors?: ReadonlyArray<string>;
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
  /** Start times every this many minutes; 0 or unset is every 15 (under 30 min) or 30. */
  readonly slotStep?: number;
  /** 'public' shows on your profile page; 'link' is reached only by its link. */
  readonly visibility?: 'public' | 'link';
  /** Link-only: guests book inside your held time, and minimum notice is skipped. */
  readonly inHeldTime?: boolean;
  /** Guests can't cancel or move online this many hours before the start (0 is up to the start). */
  readonly cancelCutoff?: number;
  readonly moveCutoff?: number;
  /** What a guest sees when it's too late to change online. */
  readonly tooLateMessage?: string;
  /** Round robin, when a meeting moves: keep the same host if free, or ask the rotation again. */
  readonly rrReschedule?: 'same' | 'rotate';
  /** Where answers are filed in the CRM: matched by email. */
  readonly fileTo?: 'people' | 'companies' | 'deals' | 'none';
  /** Published versions, newest first. */
  readonly versions?: ReadonlyArray<PageVersion>;
  /** What the page books: a meeting (the default), a service with a price, or a table. */
  readonly kind?: 'meeting' | 'service' | 'table';
  /** A service's price and how it reads ("₹1,200", "from ₹2,500", "Free"). */
  readonly price?: number;
  /** A service with several lengths: the price of each (45 min ₹1,200, 60 min ₹1,500); the rest use `price`. */
  readonly prices?: Readonly<Record<string, number>>;
  readonly priceType?: 'fixed' | 'from' | 'free';
  /** The menu category a service sits in. */
  readonly categoryId?: string;
  /** A table page: the smallest and largest party booked online. */
  readonly party?: { readonly min: number; readonly max: number };
  /** A table page: most guests whose tables start at one time, so the kitchen isn't hit at once; 0 or unset is no cap. */
  readonly pacing?: number;
  /** A table page: how long a late table is held before it's given away (minutes). */
  readonly holdLate?: number;
  /** A table page: guests can ask for an area (Terrace, Main room). */
  readonly pickArea?: boolean;
  /** A table page: bigger parties stay longer; the turn time for parties of this size or more. */
  readonly bigTurn?: { readonly from: number; readonly minutes: number };
  /** A table page: how long a table is held by party size, smallest band first (the last band covers everyone larger). */
  readonly turns?: ReadonlyArray<{ readonly upTo: number; readonly minutes: number }>;
}

/** One published version of a page, kept so it can be restored. */
export interface PageVersion { readonly id: string; readonly at: Date; readonly by: string; readonly changes: ReadonlyArray<string>; readonly page: BookingPage }

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
  /** A table booking: how many guests and which tables. */
  readonly party?: number;
  readonly tables?: ReadonlyArray<string>;
  /** A table booking at the host stand: seated (when), then left. Unset is still to come. */
  readonly seating?: 'seated' | 'left';
  readonly seatedAt?: Date;
  /** A service visit at the front desk: when they arrived and when the service started. */
  readonly arrivedAt?: Date; readonly startedAt?: Date;
  /** A table booking: the guest's phone, the occasion, the area asked for, and tags the floor staff see (VIP, Allergy). */
  readonly phone?: string;
  readonly occasion?: string;
  readonly area?: string;
  readonly tags?: ReadonlyArray<string>;
  /** Seated without a booking. */
  readonly walkIn?: boolean;
  /** Cancelled: who did it and why, kept on the meeting. */
  readonly cancelledBy?: 'host' | 'guest'; readonly cancelReason?: string;
  /** Where a table booking came from: online, phone, walk-in or the waitlist. */
  readonly source?: 'online' | 'phone' | 'walk-in' | 'waitlist';
}
/** A party waiting for a table: walked in tonight, or asked online to be told if one frees up. */
export interface WaitParty { readonly id: string; readonly name: string; readonly phone: string; readonly party: number; readonly added: Date; readonly day: string;
  /** Minutes quoted at the door; online it's the time they hoped for. */ readonly quote?: number; readonly wanted?: number; readonly online?: boolean; readonly notified?: boolean;
  /** Kept after they're seated or leave, for wait times: when it ended and how. */ readonly endedAt?: Date; readonly outcome?: 'seated' | 'left' }
/** Time a member blocked or held by hand. */
export interface TimeBlock { readonly id: string; readonly member: string; readonly day: string; readonly start: number; readonly end: number; readonly kind: 'block' | 'hold'; readonly label: string }
/** Time off: a day or a range, all day or some hours, with a note. */
/** Why someone is away. */
export type TimeOffReason = 'vacation' | 'sick' | 'travel' | 'holiday' | 'other';
/** The reasons, as people say them. */
export const TIME_OFF_REASONS: ReadonlyArray<{ readonly id: TimeOffReason; readonly label: string }> = [
  { id: 'vacation', label: 'Vacation' }, { id: 'sick', label: 'Sick leave' }, { id: 'travel', label: 'Travel' }, { id: 'holiday', label: 'Public holiday' }, { id: 'other', label: 'Other' },
];
export interface TimeOff { readonly id: string; readonly member: string; readonly from: string; readonly to: string; readonly allDay: boolean; readonly start: number; readonly end: number; readonly note: string;
  readonly reason?: TimeOffReason; /** Who takes their meetings while they're away; offered first when meetings are handed on. */ readonly cover?: string }
/** Most meetings one person takes, across every page; 0 is no limit. */
export interface MeetingLimits { readonly perDay: number; readonly perWeek: number }
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
/** What a matched rule does: book a page, show a message, or send to a link. */
export type RouteOutcome = 'page' | 'message' | 'redirect';
/** How a rule tags the person it routes, for reports. */
export type RouteTag = 'qualified' | 'not';
export interface RoutingRule { readonly id: string; readonly conditions: ReadonlyArray<Condition>; readonly conjunction: Conjunction; readonly pageId: string; readonly team: string;
  readonly outcome?: RouteOutcome; readonly message?: string; readonly url?: string; readonly tag?: RouteTag }
/** One answer the routing form got, and where it went. */
export interface RouteDecision { readonly id: string; readonly at: Date; readonly name: string; readonly company: string; readonly answers: RoutingAnswers;
  /** The rule that matched; undefined is Otherwise. */ readonly ruleId?: string; readonly booked: boolean; readonly noShow?: boolean; readonly won?: boolean }
/** The routing form: its rules, the fallback, member skills and what "won" means. */
export interface Routing {
  readonly formName: string;
  readonly rules: ReadonlyArray<RoutingRule>;
  readonly fallbackPageId: string;
  readonly fallbackOutcome?: RouteOutcome;
  readonly fallbackMessage?: string;
  readonly fallbackUrl?: string;
  /** Recent answers and where each went, newest first. */
  readonly log?: ReadonlyArray<RouteDecision>;
  readonly skills: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly wonMeans: string;
}

/** A business's public page: timefix.com/<handle>, with its services or table booking. */
export interface BusinessProfile {
  readonly kind: 'salon' | 'restaurant';
  /** What guests read under the name ("Hair salon"). */
  readonly kindLabel: string;
  readonly handle: string;
  readonly address: string;
  readonly area: string;
  readonly phone: string;
  readonly about: string;
  readonly rating: number;
  readonly reviews: number;
  readonly amenities: ReadonlyArray<string>;
  readonly published: boolean;
  /** Drawn photo scenes for the page's gallery (the prototype has no uploads). */
  readonly photos: ReadonlyArray<string>;
  /** What each person does, shown on the page's Team ("Colour specialist"). */
  readonly titles?: Readonly<Record<string, string>>;
  /** A restaurant's dishes, to read on the page. */
  readonly menu?: ReadonlyArray<{ readonly name: string; readonly description?: string; readonly price: string; readonly tag?: string }>;
}
/** A table: seats, area, bookable online, joins its neighbour for bigger parties. */
export interface Table { readonly id: string; readonly name: string; readonly seats: number; readonly area: string; readonly online: boolean; readonly joinable: boolean;
  /** Fewest guests it takes, so a couple doesn't fill the 8-top (1 when unset). */ readonly minParty?: number;
  /** The code in the table's QR (timefix.com/<handle>/menu?t=<code>). A new code stops old prints working. */ readonly code?: string }
/** A restaurant's menus as you edit them; `live` is what guests see until you publish. */
export interface MenuBook { readonly menus: ReadonlyArray<Menu>; readonly dishes: ReadonlyArray<MenuDish>; readonly addOns: ReadonlyArray<MenuAddOn> }

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
  /** One person's hours on one date only ("Name|YYYY-MM-DD"); the usual week applies everywhere else. */
  readonly overrides?: Readonly<Record<string, DayHours>>;
  /** Where someone works when it isn't your time zone ("London"). */
  readonly memberZones?: Readonly<Record<string, string>>;
  /** Who may change a person's schedule: themselves and admins, or admins only. */
  readonly access?: Readonly<Record<string, 'self' | 'admins'>>;
  /** Per person meeting limits across all pages. */
  readonly limits?: Readonly<Record<string, MeetingLimits>>;
  readonly timeOff: ReadonlyArray<TimeOff>;
  readonly calendars: ReadonlyArray<CalendarAccount>;
  readonly health: CalendarHealth;
  readonly busy: ReadonlyArray<BusyBlock>;
  readonly blocks: ReadonlyArray<TimeBlock>;
  readonly groups: ReadonlyArray<RoundRobinGroup>;
  readonly routing: Routing;
  /** Unpublished changes per page: guests still see the live version. */
  readonly drafts?: Readonly<Record<string, BookingPage>>;
  /** A business (salon, clinic, restaurant): its public page and, for a restaurant, its tables. A team taking meetings has none. */
  readonly business?: BusinessProfile;
  readonly categories?: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly tables?: ReadonlyArray<Table>;
  /** A restaurant's menus: the draft you edit and the published one guests read. Sold out and Hide apply to both at once. */
  readonly menu?: MenuBook;
  readonly menuLive?: MenuBook;
  /** A restaurant's waitlist, every day. */
  readonly waitlist?: ReadonlyArray<WaitParty>;
  /** Each teammate's calendar: connected, some calendars skipped, needs reconnecting, or none. */
  readonly memberCalendars?: Readonly<Record<string, MemberCalendar>>;
  /** Insights shared by a read-only link. */
  readonly insightsShared?: boolean;
}

/** A teammate's calendar health, as their colleagues see it. */
export type MemberCalendar = 'ok' | 'skipped' | 'reconnect' | 'none';

/** Every change the flow can make. */
export type BookingsAction =
  | { readonly type: 'page/upsert'; readonly page: BookingPage }
  | { readonly type: 'draft/set'; readonly id: string; readonly draft: BookingPage | undefined }
  | { readonly type: 'member/calendar'; readonly name: string; readonly calendar: MemberCalendar }
  | { readonly type: 'insights/share'; readonly on: boolean }
  | { readonly type: 'business/set'; readonly business: BusinessProfile }
  | { readonly type: 'tables/set'; readonly tables: ReadonlyArray<Table> }
  | { readonly type: 'waitlist/set'; readonly waitlist: ReadonlyArray<WaitParty> }
  | { readonly type: 'menu/draft'; readonly menu: MenuBook }
  | { readonly type: 'menu/publish' }
  | { readonly type: 'menu/discard' }
  | { readonly type: 'dish/soldout'; readonly id: string; readonly soldOut: boolean }
  | { readonly type: 'menu/show'; readonly id: string; readonly isLive: boolean }
  | { readonly type: 'page/delete'; readonly id: string }
  | { readonly type: 'page/restore'; readonly page: BookingPage; readonly index: number }
  | { readonly type: 'meeting/add'; readonly meeting: BookedMeeting; readonly notification?: Notification }
  | { readonly type: 'meeting/update'; readonly meeting: BookedMeeting }
  /** Changes only these fields on the meeting as it is now, so an Undo never wipes a later note or move. */
  | { readonly type: 'meeting/patch'; readonly id: string; readonly patch: Partial<BookedMeeting>; readonly note?: string }
  | { readonly type: 'note/read'; readonly id: string; readonly read: boolean }
  | { readonly type: 'note/read-all' }
  | { readonly type: 'note/archive'; readonly id: string }
  | { readonly type: 'hours/set'; readonly id: string; readonly hours: WeekHours }
  | { readonly type: 'hours/saved'; readonly savedHours: ReadonlyArray<SavedHours>; readonly defaultHoursId: string }
  | { readonly type: 'timeoff/set'; readonly timeOff: ReadonlyArray<TimeOff> }
  | { readonly type: 'member/hours'; readonly name: string; readonly hours: WeekHours }
  /** Sets (or, with null, clears) date-only hours; keys are "Name|YYYY-MM-DD". */
  | { readonly type: 'access/set'; readonly name: string; readonly access: 'self' | 'admins' }
  | { readonly type: 'limits/set'; readonly name: string; readonly limits: MeetingLimits }
  | { readonly type: 'overrides/merge'; readonly patch: Readonly<Record<string, DayHours | null>> }
  | { readonly type: 'calendar/set'; readonly calendars: ReadonlyArray<CalendarAccount>; readonly health?: CalendarHealth }
  | { readonly type: 'busy/add'; readonly block: BusyBlock }
  | { readonly type: 'block/add'; readonly block: TimeBlock }
  | { readonly type: 'block/remove'; readonly id: string }
  | { readonly type: 'groups/set'; readonly groups: ReadonlyArray<RoundRobinGroup> }
  | { readonly type: 'routing/patch'; readonly ids: ReadonlyArray<string>; readonly pageId: string; readonly fallback: boolean }
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
    case 'meeting/patch': return { ...state, meetings: state.meetings.map((m) => (m.id === action.id ? { ...m, ...action.patch, activity: action.note ? [...m.activity, { id: nextId('a'), text: action.note, at: new Date() }] : m.activity } : m)).sort(byStart) };
    case 'meeting/update': return { ...state, meetings: state.meetings.map((m) => (m.id === action.meeting.id ? action.meeting : m)).sort(byStart) };
    case 'note/read': return { ...state, notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, read: action.read } : n)) };
    case 'note/read-all': return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) };
    case 'note/archive': return { ...state, notifications: state.notifications.filter((n) => n.id !== action.id) };
    case 'hours/set': return { ...state, savedHours: state.savedHours.map((h) => (h.id === action.id ? { ...h, hours: action.hours } : h)) };
    case 'hours/saved': return { ...state, savedHours: action.savedHours, defaultHoursId: action.defaultHoursId };
    case 'timeoff/set': return { ...state, timeOff: action.timeOff };
    case 'member/hours': return { ...state, memberHours: { ...state.memberHours, [action.name]: action.hours } };
    case 'access/set': return { ...state, access: { ...(state.access ?? {}), [action.name]: action.access } };
    case 'limits/set': return { ...state, limits: { ...(state.limits ?? {}), [action.name]: action.limits } };
    case 'overrides/merge': {
      const next: Record<string, DayHours> = { ...(state.overrides ?? {}) };
      Object.entries(action.patch).forEach(([k, v]) => { if (v) next[k] = v; else delete next[k]; });
      return { ...state, overrides: next };
    }
    case 'draft/set': {
      const drafts = { ...(state.drafts ?? {}) };
      if (action.draft) drafts[action.id] = action.draft; else delete drafts[action.id];
      return { ...state, drafts };
    }
    case 'member/calendar': return { ...state, memberCalendars: { ...(state.memberCalendars ?? {}), [action.name]: action.calendar } };
    case 'insights/share': return { ...state, insightsShared: action.on };
    case 'business/set': return { ...state, business: action.business };
    case 'tables/set': return { ...state, tables: action.tables };
    case 'waitlist/set': return { ...state, waitlist: action.waitlist };
    case 'menu/draft': return { ...state, menu: action.menu };
    case 'menu/publish': return state.menu ? { ...state, menuLive: state.menu } : state;
    case 'menu/discard': return state.menuLive ? { ...state, menu: state.menuLive } : state;
    case 'dish/soldout': {
      const flip = (b: MenuBook | undefined) => b && { ...b, dishes: b.dishes.map((d) => (d.id === action.id ? { ...d, soldOut: action.soldOut } : d)) };
      return { ...state, menu: flip(state.menu), menuLive: flip(state.menuLive) };
    }
    case 'menu/show': {
      const show = (b: MenuBook | undefined) => b && { ...b, menus: b.menus.map((m) => (m.id === action.id ? { ...m, isLive: action.isLive } : m)) };
      return { ...state, menu: show(state.menu), menuLive: show(state.menuLive) };
    }
    case 'calendar/set': return { ...state, calendars: action.calendars, health: action.health ?? state.health };
    case 'busy/add': return { ...state, busy: [...state.busy, action.block] };
    case 'block/add': return { ...state, blocks: [...state.blocks, action.block] };
    case 'block/remove': return { ...state, blocks: state.blocks.filter((b) => b.id !== action.id) };
    case 'groups/set': return { ...state, groups: action.groups };
    case 'routing/set': return { ...state, routing: action.routing };
    case 'routing/patch': return { ...state, routing: { ...state.routing, rules: state.routing.rules.map((r) => (action.ids.includes(r.id) ? { ...r, pageId: action.pageId } : r)), fallbackPageId: action.fallback ? action.pageId : state.routing.fallbackPageId } };
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
/** A page's link: under the business's handle, or the host's name for a team. */
export const pageUrl = (slug: string, handle = 'priya') => `timefix.com/${handle}/${slug}`;
/** The workspace's own link: the business page, or the host's profile. */
export const homeUrl = (state: BookingsState) => `timefix.com/${handleOf(state)}`;
/** Whose address the workspace's links live under: the business's handle, or the host's name for a team. */
export const handleOf = (state: BookingsState) => state.business?.handle || 'priya';
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
/** The business's hours on one date: a date-only change (a holiday, a late night) wins over the usual week. */
export function venueDay(state: BookingsState, date: Date): DayHours | undefined {
  const host = state.pages.find((p) => p.kind === 'table')?.hosts[0] ?? state.pages[0]?.hosts[0] ?? HOST;
  const week = state.savedHours.find((h) => h.id === state.defaultHoursId)?.hours ?? state.savedHours[0]?.hours;
  return state.overrides?.[overrideKey(host, date)] ?? week?.[dayKey(date)];
}
const overlap = (a: number, b: number, c: number, d: number) => a < d && c < b;

/** The hours a page offers. */
export function hoursFor(page: BookingPage, state: BookingsState): WeekHours {
  if (page.hoursFrom === 'custom' && page.customHours) return page.customHours;
  const id = page.hoursFrom === 'working' ? state.defaultHoursId : page.hoursFrom;
  return (state.savedHours.find((h) => h.id === id) ?? state.savedHours[0])?.hours ?? EMPTY_WEEK;
}
const EMPTY_WEEK: WeekHours = { mon: { on: false, ranges: [] }, tue: { on: false, ranges: [] }, wed: { on: false, ranges: [] }, thu: { on: false, ranges: [] }, fri: { on: false, ranges: [] }, sat: { on: false, ranges: [] }, sun: { on: false, ranges: [] } };
/** A member's weekly hours. */
/** The key a date-only override is stored under. */
export const overrideKey = (name: string, date: Date) => `${name}|${isoDay(date)}`;
/** One person's hours on a date: a date-only override when there is one, else their usual week. */
export function hoursOn(state: BookingsState, name: string, date: Date): { readonly hours: DayHours; readonly isOverride: boolean } {
  const o = state.overrides?.[overrideKey(name, date)];
  return o ? { hours: o, isOverride: true } : { hours: memberHours(state, name)[dayKey(date)], isOverride: false };
}
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
/** Whether someone has hit their own meeting limit (across every page) on that day or in that week. */
export function atLimit(state: BookingsState, member: string, date: Date): 'day' | 'week' | undefined {
  const l = state.limits?.[member];
  if (!l) return undefined;
  const theirs = state.meetings.filter((m) => m.host === member && m.status !== 'cancelled');
  if (l.perDay > 0 && theirs.filter((m) => m.start.toDateString() === date.toDateString()).length >= l.perDay) return 'day';
  const monday = mondayOf(date).getTime();
  if (l.perWeek > 0 && theirs.filter((m) => mondayOf(m.start).getTime() === monday).length >= l.perWeek) return 'week';
  return undefined;
}
/** Whether someone can take a meeting then: not off, not at their limit, no clash (with buffers) and not busy in a calendar. */
export function memberFree(state: BookingsState, page: BookingPage | undefined, member: string, date: Date, start: number, end: number): boolean {
  if (isOff(state, member, date, start, end)) return false;
  // They work then: their own hours that day (a date-only change wins) cover the whole meeting.
  const h = hoursOn(state, member, date).hours;
  if (!h.on || !h.ranges.some((r) => r.start <= start && end <= r.end)) return false;
  if (atLimit(state, member, date)) return false;
  const before = page?.bufferBefore ?? 0;
  const after = page?.bufferAfter ?? 0;
  const clash = state.meetings.some((m) => m.host === member && m.status !== 'cancelled' && m.start.toDateString() === date.toDateString()
    && overlap(start - before, end + after, minutesOf(m.start), minutesOf(m.end)));
  return !clash && !busyOn(state, member, date).some((b) => overlap(start, end, b.start, b.end));
}
/** Who would take a slot: for round robin, the free host with the fewest meetings this month (or by weight or priority). */
export function hostFor(state: BookingsState, page: BookingPage, date: Date, start: number, end: number): string | undefined {
  // A host at their daily cap on this page sits the day out.
  const capped = (h: string) => { const cap = page.caps?.[h] ?? 0; return cap > 0 && state.meetings.filter((m) => m.pageId === page.id && m.host === h && m.status !== 'cancelled' && m.start.toDateString() === date.toDateString()).length >= cap; };
  const free = activeHosts(state, page).filter((h) => memberFree(state, page, h, date, start, end) && !(page.hostMode === 'roundrobin' && capped(h)));
  if (page.hostMode === 'collective') return free.length === activeHosts(state, page).length ? page.hosts[0] : undefined;
  if (page.hostMode !== 'roundrobin') return free[0];
  const spread = monthSpread(state, page, date);
  if (page.shareOut === 'even') {
    // Even: whoever is ahead by the gap waits, so turns stay level.
    const least = Math.min(...activeHosts(state, page).map((h) => spread[h] ?? 0));
    const ok = free.filter((h) => (spread[h] ?? 0) - least < Math.max(1, page.evenGap ?? 1));
    return [...(ok.length ? ok : free)].sort((a, b) => (spread[a] ?? 0) - (spread[b] ?? 0))[0];
  }
  const score = (h: string) => (page.shareOut === 'priority' ? (page.weights[h] ?? 9) * 1000 + (spread[h] ?? 0)
    : page.shareOut === 'weighted' ? (spread[h] ?? 0) / Math.max(1, page.weights[h] ?? 1) : spread[h] ?? 0);
  return [...free].sort((a, b) => score(a) - score(b))[0];
}
/** Meetings each host took on a page this month. */
export function monthSpread(state: BookingsState, page: BookingPage, now: Date): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  page.hosts.forEach((h) => { out[h] = 0; });
  // The count window: this month, or the last N days (and anything already booked ahead).
  const since = page.countDays ? now.getTime() - page.countDays * 86_400_000 : undefined;
  state.meetings.forEach((m) => {
    if (m.pageId !== page.id || m.status === 'cancelled') return;
    const inside = since !== undefined ? m.start.getTime() >= since : m.start.getMonth() === now.getMonth() && m.start.getFullYear() === now.getFullYear();
    if (inside) out[m.host] = (out[m.host] ?? 0) + 1;
  });
  return out;
}

/** The open start times of a page on a day: its hours, minus notice, limits, time off, busy time and meetings with buffers. */
/** The best tables for a party then: the smallest free one that seats them, else two joinable ones in one area. */
export function fitTables(state: BookingsState, party: number, date: Date, start: number, length: number, onlineOnly = true, area?: string, skip?: string): ReadonlyArray<Table> | undefined {
  const held = heldTables(state, date, start, length, skip);
  const free = (state.tables ?? []).filter((t) => !held.has(t.id) && (!onlineOnly || t.online) && (!area || t.area === area));
  const one = [...free].filter((t) => t.seats >= party && (t.minParty ?? 1) <= party).sort((a, b) => a.seats - b.seats)[0];
  if (one) return [one];
  const pairs = free.flatMap((a, i) => free.slice(i + 1).filter((b) => a.joinable && b.joinable && a.area === b.area && a.seats + b.seats >= party).map((b) => [a, b]));
  return pairs.sort((x, y) => x.reduce((t, z) => t + z.seats, 0) - y.reduce((t, z) => t + z.seats, 0))[0];
}
/** Tables taken then: booked and not cancelled, no-show or left (a seated table that's run over stays taken). */
export function heldTables(state: BookingsState, date: Date, start: number, length: number, skip?: string): ReadonlySet<string> {
  const held = new Set<string>();
  state.meetings.forEach((m) => {
    if (m.id === skip || !m.tables || m.status === 'cancelled' || m.status === 'no-show' || m.seating === 'left' || m.start.toDateString() !== date.toDateString()) return;
    // A party still seated past its end keeps the table until they leave (counted as at least 15 more minutes).
    const today = new Date(); const isToday = date.toDateString() === today.toDateString(); const overrun = m.seating === 'seated' && isToday;
    // A late party keeps its table until the host marks a no-show (the host stand shows them as Late); nothing is given away silently.
    const a = minutesOf(m.start); const b = overrun ? Math.max(minutesOf(m.end), minutesOf(today) + 15) : minutesOf(m.end);
    if (start < b && a < start + length) m.tables.forEach((t) => held.add(t));
  });
  return held;
}
/** How long a table is held for a party: the page's turn time, longer for big parties. */
export const turnFor = (page: BookingPage, party: number) => { const band = page.turns?.find((b) => party <= b.upTo) ?? page.turns?.[page.turns.length - 1]; return band ? band.minutes : page.bigTurn && party >= page.bigTurn.from ? page.bigTurn.minutes : lengthOf(page); };
/** Guests whose tables start at this time on this day. */
export const coversAt = (state: BookingsState, pageId: string, date: Date, minutes: number) => state.meetings
  .filter((m) => m.pageId === pageId && m.status !== 'cancelled' && m.start.toDateString() === date.toDateString() && minutesOf(m.start) === minutes)
  .reduce((n, m) => n + (m.party ?? 0), 0);

export function openTimes(page: BookingPage, state: BookingsState, date: Date, now: Date, length = lengthOf(page), party = page.party?.min ?? 2, area?: string): ReadonlyArray<number> {
  const startOfToday = dayFrom(now, 0);
  const ahead = Math.round((date.getTime() - startOfToday.getTime()) / 86_400_000);
  if (ahead < 0 || ahead > page.daysAhead) return [];
  // A date-only change to the host's hours wins over the page's usual week.
  const day = state.overrides?.[overrideKey(page.hosts[0] ?? '', date)] ?? hoursFor(page, state)[dayKey(date)];
  if (!day.on) return [];
  const mine = state.meetings.filter((m) => m.pageId === page.id && m.status !== 'cancelled');
  if (page.perDay > 0 && mine.filter((m) => m.start.toDateString() === date.toDateString()).length >= page.perDay) return [];
  const monday = mondayOf(date).getTime();
  if (page.perWeek > 0 && mine.filter((m) => mondayOf(m.start).getTime() === monday).length >= page.perWeek) return [];
  const notice = page.visibility === 'link' && page.inHeldTime ? 0 : page.noticeHours;
  // Minimum notice counts in real minutes from now, across midnight: 24h notice at 3 PM opens tomorrow from 3 PM.
  const earliest = minutesOf(now) + notice * 60 - ahead * 1440;
  const step = page.slotStep && page.slotStep > 0 ? page.slotStep : length < 30 ? 15 : 30;
  const out: number[] = [];
  day.ranges.forEach((r) => {
    for (let m = r.start; m + length <= r.end; m += step) if (m > earliest && (page.kind === 'table' ? tableOpen(page, state, date, m, length, party, area) : hostFor(state, page, date, m, m + length))) out.push(m);
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** A table time is open when a table fits the party and the pacing cap has room for them. */
function tableOpen(page: BookingPage, state: BookingsState, date: Date, m: number, length: number, party: number, area?: string): boolean {
  if (page.pacing && page.pacing > 0 && coversAt(state, page.id, date, m) + party > page.pacing) return false;
  return fitTables(state, party, date, m, length, true, area) !== undefined;
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
/** "₹1,200", "from ₹2,500", "Free". */
export const priceText = (p: BookingPage, minutes?: number) => { if (p.priceType === 'free') return 'Free'; const own = minutes !== undefined ? p.prices?.[String(minutes)] : undefined; if (own !== undefined) return `₹${own.toLocaleString('en-IN')}`;
  // Several lengths, several prices: show the lowest as "from".
  const all = p.durations.map((d) => p.prices?.[String(d)] ?? p.price).filter((n): n is number => n !== undefined); if (minutes === undefined && p.prices && all.length > 1 && new Set(all).size > 1) return `from ₹${Math.min(...all).toLocaleString('en-IN')}`;
  return p.price === undefined ? '' : `${p.priceType === 'from' ? 'from ' : ''}₹${p.price.toLocaleString('en-IN')}`; };
export const pageSub = (p: BookingPage) => (p.kind === 'table' ? `Parties of ${p.party?.min ?? 1} to ${p.party?.max ?? 8} · ${lengthsText(p)} a table` : p.kind === 'service' ? `${lengthsText(p)} · ${priceText(p)}` : `${lengthsText(p)} · ${placesText(p)}`);
/** A meeting's time as a short line. */
export const meetingWhen = (m: Meeting) => `${formatDay(m.start)} · ${formatClockRange(minutesOf(m.start), minutesOf(m.end))}`;

/* ------------------------------------------------------------------ Routing */

/** The routing form's questions, as attributes the Sentence pills read. */
export const ROUTING_FIELDS: ReadonlyArray<Attribute> = [
  { id: 'size', name: 'Team size', type: 'number' },
  { id: 'region', name: 'Region', type: 'select', options: [{ id: 'eu', label: 'Europe', hue: 'blue' }, { id: 'na', label: 'North America', hue: 'green' }, { id: 'apac', label: 'Asia Pacific', hue: 'orange' }] },
  { id: 'need', name: 'Looking for', type: 'select', options: [{ id: 'buy', label: 'Buying', hue: 'purple' }, { id: 'help', label: 'Help with an account', hue: 'sky' }, { id: 'partner', label: 'A partnership', hue: 'yellow' }] },
  // Hidden fields: filled from the link or the CRM, never asked.
  { id: 'source', name: 'Came from', type: 'select', options: [{ id: 'web', label: 'Website', hue: 'gray' }, { id: 'email', label: 'Email', hue: 'blue' }, { id: 'linkedin', label: 'LinkedIn', hue: 'sky' }, { id: 'ads', label: 'Ads', hue: 'orange' }] },
  { id: 'known', name: 'Known in CRM', type: 'select', options: [{ id: 'yes', label: 'Yes', hue: 'green' }, { id: 'no', label: 'No', hue: 'gray' }] },
  // CRM record fields, read from the person, their company and their open deal (matched by email).
  { id: 'person.owner', name: 'Person · Owner', type: 'select', options: [{ id: 'Priya Raman', label: 'Priya Raman', hue: 'gray' }, { id: 'Sam Kim', label: 'Sam Kim', hue: 'gray' }, { id: 'Jo Mendes', label: 'Jo Mendes', hue: 'gray' }, { id: 'Ava Chen', label: 'Ava Chen', hue: 'gray' }] },
  { id: 'company.industry', name: 'Company · Industry', type: 'select', options: [{ id: 'saas', label: 'Software', hue: 'blue' }, { id: 'health', label: 'Health', hue: 'green' }, { id: 'retail', label: 'Retail', hue: 'orange' }, { id: 'logistics', label: 'Logistics', hue: 'purple' }] },
  { id: 'company.employees', name: 'Company · Employees', type: 'number' },
  { id: 'deal.stage', name: 'Deal · Stage', type: 'select', options: [{ id: 'lead', label: 'Lead', hue: 'gray' }, { id: 'qualified', label: 'Qualified', hue: 'blue' }, { id: 'proposal', label: 'Proposal', hue: 'purple' }, { id: 'won', label: 'Won', hue: 'green' }, { id: 'lost', label: 'Lost', hue: 'red' }] },
];
/** Fields that come from the CRM record rather than the form. */
export const isRecordField = (id: string): boolean => id.includes('.');
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

/** Days in the next two months a guest could book this page (0 means it can't be booked). */
export function openDaysAhead(page: BookingPage, state: BookingsState, now: Date, days = 60): number {
  let n = 0;
  for (let i = 0; i <= days; i += 1) if (openTimes(page, state, dayFrom(now, i), now).length > 0) n += 1;
  return n;
}
/** What changed between two versions of a page, in a few words each. */
export function pageChanges(before: BookingPage, after: BookingPage): ReadonlyArray<string> {
  const names: Readonly<Record<string, string>> = {
    name: 'Name', slug: 'Link', durations: 'Lengths', places: 'Places', description: 'Description', hoursFrom: 'Hours', customHours: 'Hours', bufferBefore: 'Gap', bufferAfter: 'Gap',
    noticeHours: 'Notice', daysAhead: 'How far ahead', perDay: 'Most a day', perWeek: 'Most a week', hostMode: 'Who hosts', hosts: 'Hosts', shareOut: 'Round robin', questions: 'Questions',
    confirmFirst: 'Confirming', reminders: 'Reminders', emails: 'Emails', look: 'Look', socials: 'Social links', slotStep: 'Start times', visibility: 'Who can find it',
    cancelCutoff: 'Cancel cut-off', moveCutoff: 'Move cut-off', fileTo: 'Filed to', after: 'After they book', whoCanBook: 'Who can book',
    price: 'Price', priceType: 'Price', categoryId: 'Category', party: 'Party size', pacing: 'Pacing', holdLate: 'Late hold', pickArea: 'Seating areas', bigTurn: 'Big party time', turns: 'Turn times',
  };
  const keys = Object.keys(names) as Array<keyof BookingPage>;
  return [...new Set(keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => names[k] ?? String(k)))];
}

/** Whether one person can take a meeting then: working, not away, no other meeting, nothing busy on their calendar. */
/** Why someone can't take a meeting then, in a few words, or undefined when they're free. Checks the same things as memberFree, in the order a person would ask. */
export function busyReason(state: BookingsState, page: BookingPage | undefined, name: string, day: Date, start: number, end: number, skipId?: string): string | undefined {
  if (isOff(state, name, day, start, end)) return 'away then';
  const h = hoursOn(state, name, day).hours;
  if (!h.on || !h.ranges.some((r) => r.start <= start && end <= r.end)) return 'not working then';
  const others = { ...state, meetings: state.meetings.filter((m) => m.id !== skipId) };
  const limit = atLimit(others, name, day);
  if (limit) return limit === 'day' ? 'at their daily limit' : 'at their weekly limit';
  const before = page?.bufferBefore ?? 0; const after = page?.bufferAfter ?? 0;
  if (others.meetings.some((m) => m.host === name && m.status !== 'cancelled' && m.start.toDateString() === day.toDateString() && overlap(start - before, end + after, minutesOf(m.start), minutesOf(m.end)))) return 'has another meeting';
  if (busyOn(state, name, day).some((b) => overlap(start, end, b.start, b.end))) return 'busy in their calendar';
  return undefined;
}
export function personFree(state: BookingsState, name: string, day: Date, start: number, end: number, skipId?: string): boolean {
  const at0 = (m: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
  const s = at0(start); const e = at0(end);
  if (isOff(state, name, day, start, end)) return false;
  if (state.meetings.some((x) => x.id !== skipId && x.host === name && x.status !== 'cancelled' && x.start < e && s < x.end)) return false;
  return !busyOn(state, name, day).some((b) => b.start < end && start < b.end);
}

/** What changed between the menu you're editing and the one guests see: "2 dishes, Dinner". */
export function menuChanges(state: BookingsState): ReadonlyArray<string> {
  const a = state.menu; const b = state.menuLive;
  if (!a || !b) return [];
  const diff = <T extends { readonly id: string }>(x: ReadonlyArray<T>, y: ReadonlyArray<T>) => x.filter((i) => JSON.stringify(i) !== JSON.stringify(y.find((j) => j.id === i.id))).length + y.filter((j) => !x.some((i) => i.id === j.id)).length;
  const dishes = diff(a.dishes, b.dishes); const addOns = diff(a.addOns, b.addOns);
  const menus = a.menus.filter((m) => JSON.stringify(m) !== JSON.stringify(b.menus.find((x) => x.id === m.id))).map((m) => m.name);
  const gone = b.menus.filter((m) => !a.menus.some((x) => x.id === m.id)).map((m) => `${m.name} removed`);
  return [...menus, ...gone, ...(dishes ? [plural(dishes, 'dish', 'dishes')] : []), ...(addOns ? [plural(addOns, 'add-on')] : [])];
}
/** A table's menu link, as its QR opens it. */
/** A table's own code for its QR: its name made safe for a link, plus a random tail so two tables with one name never share a link. */
export const tableCode = (name: string) => `${slugify(name) || 'table'}-${Math.random().toString(36).slice(2, 7)}`;
export const tableMenuUrl = (state: BookingsState, t: Table) => `timefix.com/${handleOf(state)}/menu?t=${encodeURIComponent(t.code ?? slugify(t.name))}`;
/** A guest's visits here, found by email or phone: how many, the last one, and no-shows. */
export function visitsOf(state: BookingsState, m: BookedMeeting): { readonly count: number; readonly last?: Date; readonly noShows: number } {
  const email = m.invitee.email.trim().toLowerCase(); const phone = (m.phone ?? '').replace(/\D/g, '');
  if (!email && phone.length < 6) return { count: 0, noShows: 0 };
  const theirs = state.meetings.filter((x) => x.id !== m.id && x.tables && x.start < m.start && ((email && x.invitee.email.trim().toLowerCase() === email) || (phone.length >= 6 && (x.phone ?? '').replace(/\D/g, '') === phone)));
  const been = theirs.filter((x) => x.status !== 'cancelled' && x.status !== 'no-show');
  return { count: been.length, last: been.map((x) => x.start).sort((a, b) => b.getTime() - a.getTime())[0], noShows: theirs.filter((x) => x.status === 'no-show').length };
}

