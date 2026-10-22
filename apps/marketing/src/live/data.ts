// The live demo's workspace, Lumen: a small team that books its meetings and keeps its customers in Timefix. The
// companies are well known, as Twenty's demo shows them (the owner's reference, 23 Oct 2026); every person,
// meeting and deal is made up. The week is the one around the demo's frozen "now" (time.ts): Thursday 22 October.
import type { Hue } from '@crm/ui';

/** A teammate in the workspace: a meeting's host or a record's owner. */
export interface DemoMember {
  readonly id: string;
  readonly name: string;
}

/** A company record. */
export interface DemoCompany {
  readonly id: string;
  readonly name: string;
  readonly domain: string;
  readonly industry: string;
  readonly size: string;
  readonly ownerId: string;
}

/** A person record. `isNew` marks one a booking in the demo just created. */
export interface DemoPerson {
  readonly id: string;
  readonly name: string;
  readonly companyId: string | undefined;
  readonly title: string;
  readonly ownerId: string;
  readonly tags: readonly { readonly id: string; readonly label: string; readonly hue: Hue }[];
  readonly isNew?: boolean;
}

/** A meeting in the week: a booking with a guest, or the host's own calendar event. */
export interface DemoMeeting {
  readonly id: string;
  readonly kind: 'booking' | 'event';
  readonly title: string;
  readonly personId?: string;
  readonly hostId: string;
  /** The day, as `YYYY-MM-DD`, and the minutes from midnight it runs between, in the demo's zone. */
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly where: string;
}

/** A deal record, on the board by its stage. */
export interface DemoDeal {
  readonly id: string;
  readonly name: string;
  readonly companyId: string;
  readonly stageId: string;
  readonly amount: number;
  readonly ownerId: string;
}

/** The deal stages, left to right on the board. */
export const STAGES: readonly { readonly id: string; readonly title: string; readonly hue: Hue }[] = [
  { id: 'lead', title: 'Lead', hue: 'gray' },
  { id: 'qualified', title: 'Qualified', hue: 'sky' },
  { id: 'proposal', title: 'Proposal', hue: 'yellow' },
  { id: 'negotiation', title: 'Negotiation', hue: 'orange' },
  { id: 'won', title: 'Won', hue: 'green' },
];

/** The workspace's name, at the top of its sidebar. */
export const WORKSPACE = 'Lumen';

/** The team. The first is "you", the host of the booking page. */
export const MEMBERS: readonly DemoMember[] = [
  { id: 'maya', name: 'Maya Patel' },
  { id: 'sam', name: 'Sam Okafor' },
  { id: 'aiko', name: 'Aiko Tanaka' },
  { id: 'ben', name: 'Ben Carter' },
];

export const COMPANIES: readonly DemoCompany[] = [
  { id: 'stripe', name: 'Stripe', domain: 'stripe.com', industry: 'Payments', size: '5,000+', ownerId: 'maya' },
  { id: 'linear', name: 'Linear', domain: 'linear.app', industry: 'Software', size: '51–200', ownerId: 'sam' },
  { id: 'notion', name: 'Notion', domain: 'notion.so', industry: 'Software', size: '501–1,000', ownerId: 'maya' },
  { id: 'figma', name: 'Figma', domain: 'figma.com', industry: 'Design', size: '1,001–5,000', ownerId: 'aiko' },
  {
    id: 'vercel',
    name: 'Vercel',
    domain: 'vercel.com',
    industry: 'Developer tools',
    size: '501–1,000',
    ownerId: 'ben',
  },
  { id: 'airbnb', name: 'Airbnb', domain: 'airbnb.com', industry: 'Travel', size: '5,000+', ownerId: 'sam' },
  { id: 'ramp', name: 'Ramp', domain: 'ramp.com', industry: 'Finance', size: '501–1,000', ownerId: 'aiko' },
  { id: 'slack', name: 'Slack', domain: 'slack.com', industry: 'Software', size: '1,001–5,000', ownerId: 'ben' },
  {
    id: 'github',
    name: 'GitHub',
    domain: 'github.com',
    industry: 'Developer tools',
    size: '1,001–5,000',
    ownerId: 'maya',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    domain: 'anthropic.com',
    industry: 'AI research',
    size: '1,001–5,000',
    ownerId: 'sam',
  },
];

const LEAD = { id: 'lead', label: 'Lead', hue: 'blue' } as const;
const CUSTOMER = { id: 'customer', label: 'Customer', hue: 'green' } as const;
const PARTNER = { id: 'partner', label: 'Partner', hue: 'purple' } as const;
const VIP = { id: 'vip', label: 'VIP', hue: 'orange' } as const;

export const PEOPLE: readonly DemoPerson[] = [
  {
    id: 'priya',
    name: 'Priya Shah',
    companyId: 'stripe',
    title: 'Head of Partnerships',
    ownerId: 'maya',
    tags: [CUSTOMER, VIP],
  },
  { id: 'marcus', name: 'Marcus Chen', companyId: 'linear', title: 'Product Lead', ownerId: 'sam', tags: [LEAD] },
  {
    id: 'sofia',
    name: 'Sofia Alvarez',
    companyId: 'notion',
    title: 'Head of Sales',
    ownerId: 'maya',
    tags: [CUSTOMER],
  },
  { id: 'jonas', name: 'Jonas Berg', companyId: 'figma', title: 'Design Operations', ownerId: 'aiko', tags: [LEAD] },
  { id: 'amara', name: 'Amara Okafor', companyId: 'vercel', title: 'Partner Manager', ownerId: 'ben', tags: [PARTNER] },
  { id: 'leo', name: 'Leo Martins', companyId: 'airbnb', title: 'Operations Lead', ownerId: 'sam', tags: [LEAD] },
  { id: 'daniel', name: 'Daniel Kim', companyId: 'ramp', title: 'Finance Manager', ownerId: 'aiko', tags: [LEAD] },
  { id: 'grace', name: 'Grace Liu', companyId: 'slack', title: 'Customer Success', ownerId: 'ben', tags: [CUSTOMER] },
  {
    id: 'omar',
    name: 'Omar Haddad',
    companyId: 'github',
    title: 'Developer Relations',
    ownerId: 'maya',
    tags: [PARTNER],
  },
  { id: 'hana', name: 'Hana Sato', companyId: 'anthropic', title: 'Operations', ownerId: 'sam', tags: [LEAD, VIP] },
  {
    id: 'elena',
    name: 'Elena Rossi',
    companyId: 'notion',
    title: 'Revenue Operations',
    ownerId: 'maya',
    tags: [CUSTOMER],
  },
  {
    id: 'noah',
    name: 'Noah Wright',
    companyId: 'stripe',
    title: 'Solutions Engineer',
    ownerId: 'ben',
    tags: [CUSTOMER],
  },
];

/** `hours:minutes` as minutes from midnight. */
const at = (hours: number, minutes = 0) => hours * 60 + minutes;

/** A booking with a guest. */
const booking = (
  id: string,
  title: string,
  personId: string,
  hostId: string,
  dayKey: string,
  start: number,
  length: number,
): DemoMeeting => ({
  id,
  kind: 'booking',
  title,
  personId,
  hostId,
  dayKey,
  startMinute: start,
  endMinute: start + length,
  where: 'Google Meet',
});

/** The host's own calendar event. */
const event = (id: string, title: string, dayKey: string, start: number, length: number): DemoMeeting => ({
  id,
  kind: 'event',
  title,
  hostId: 'maya',
  dayKey,
  startMinute: start,
  endMinute: start + length,
  where: 'Office',
});

export const MEETINGS: readonly DemoMeeting[] = [
  event('standup-mon', 'Team standup', '2026-10-19', at(9), 30),
  booking('m1', 'Intro call', 'priya', 'maya', '2026-10-19', at(10), 30),
  booking('m2', 'Strategy session', 'sofia', 'maya', '2026-10-19', at(14), 60),
  event('standup-tue', 'Team standup', '2026-10-20', at(9), 30),
  booking('m3', 'Intro call', 'marcus', 'sam', '2026-10-20', at(10), 30),
  booking('m4', 'Product demo', 'leo', 'sam', '2026-10-20', at(11, 30), 45),
  booking('m5', 'Follow-up', 'daniel', 'aiko', '2026-10-20', at(16), 30),
  event('standup-wed', 'Team standup', '2026-10-21', at(9), 30),
  booking('m6', 'Intro call', 'grace', 'ben', '2026-10-21', at(10, 30), 30),
  event('lunch-wed', 'Lunch with Sam', '2026-10-21', at(12), 60),
  booking('m7', 'Proposal review', 'priya', 'maya', '2026-10-21', at(13, 30), 60),
  booking('m8', 'Intro call', 'omar', 'maya', '2026-10-21', at(15, 30), 30),
  event('standup-thu', 'Team standup', '2026-10-22', at(9), 30),
  booking('m9', 'Intro call', 'jonas', 'aiko', '2026-10-22', at(11), 30),
  event('focus-thu', 'Focus time', '2026-10-22', at(12, 30), 60),
  booking('m10', 'Strategy session', 'elena', 'maya', '2026-10-22', at(14), 60),
  booking('m11', 'Product demo', 'amara', 'ben', '2026-10-22', at(16, 30), 45),
  event('standup-fri', 'Team standup', '2026-10-23', at(9), 30),
  booking('m12', 'Intro call', 'hana', 'sam', '2026-10-23', at(10), 30),
  booking('m13', 'Check-in', 'noah', 'ben', '2026-10-23', at(15), 30),
  event('standup-mon-2', 'Team standup', '2026-10-26', at(9), 30),
  booking('m14', 'Strategy session', 'marcus', 'maya', '2026-10-26', at(11), 60),
  event('standup-tue-2', 'Team standup', '2026-10-27', at(9), 30),
  booking('m15', 'Product demo', 'jonas', 'aiko', '2026-10-27', at(14), 45),
  event('standup-wed-2', 'Team standup', '2026-10-28', at(9), 30),
  booking('m16', 'Renewal call', 'sofia', 'maya', '2026-10-28', at(10, 30), 30),
  event('standup-thu-2', 'Team standup', '2026-10-29', at(9), 30),
  booking('m17', 'Intro call', 'grace', 'ben', '2026-10-29', at(13), 30),
  event('standup-fri-2', 'Team standup', '2026-10-30', at(9), 30),
];

export const DEALS: readonly DemoDeal[] = [
  { id: 'd1', name: 'Stripe · Team rollout', companyId: 'stripe', stageId: 'proposal', amount: 24000, ownerId: 'maya' },
  { id: 'd2', name: 'Linear · Pilot', companyId: 'linear', stageId: 'qualified', amount: 8500, ownerId: 'sam' },
  {
    id: 'd3',
    name: 'Notion · Annual plan',
    companyId: 'notion',
    stageId: 'negotiation',
    amount: 36000,
    ownerId: 'maya',
  },
  { id: 'd4', name: 'Figma · Design ops', companyId: 'figma', stageId: 'lead', amount: 12000, ownerId: 'aiko' },
  { id: 'd5', name: 'Vercel · Agency partner', companyId: 'vercel', stageId: 'won', amount: 18000, ownerId: 'ben' },
  { id: 'd6', name: 'Airbnb · Host success', companyId: 'airbnb', stageId: 'qualified', amount: 42000, ownerId: 'sam' },
  { id: 'd7', name: 'Ramp · Finance team', companyId: 'ramp', stageId: 'lead', amount: 9600, ownerId: 'aiko' },
  { id: 'd8', name: 'Slack · Expansion', companyId: 'slack', stageId: 'proposal', amount: 27500, ownerId: 'ben' },
  { id: 'd9', name: 'GitHub · Partner program', companyId: 'github', stageId: 'won', amount: 15000, ownerId: 'maya' },
  { id: 'd10', name: 'Anthropic · Ops team', companyId: 'anthropic', stageId: 'lead', amount: 31000, ownerId: 'sam' },
];

/** A day of a week the calendar shows. */
export interface DemoDay {
  readonly key: string;
  readonly weekday: string;
  readonly dayNumber: number;
  readonly long: string;
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** The seven days from the Monday `mondayNumber` of October 2026 (19 for this week, 26 for the next). */
export function weekOf(mondayNumber: number): readonly DemoDay[] {
  return WEEKDAYS.map((weekday, index) => {
    const date = new Date(Date.UTC(2026, 9, mondayNumber + index));
    const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
    const dayNumber = date.getUTCDate();
    return {
      key: date.toISOString().slice(0, 10),
      weekday: weekday.slice(0, 3),
      dayNumber,
      long: `${weekday}, ${month} ${String(dayNumber)}`,
    };
  });
}

/** The demo's two weeks: this one (today's) and the next. */
export const WEEKS = [19, 26] as const;

/** Today in the demo, and the minute of it "now" falls on (9:40 AM). */
export const TODAY = '2026-10-22';
export const NOW_MINUTE = at(9, 40);

/** The booking page a visitor can try: Maya's 30 minute intro call. */
export const BOOKING_PAGE = {
  hostId: 'maya',
  title: 'Intro call',
  minutes: 30,
  where: 'Google Meet',
  address: 'timefix.com/maya/intro-call',
} as const;

/** The minutes of the day a booking page offers, every half hour from 9 AM to 5 PM. */
export const OFFERED_STARTS: readonly number[] = Array.from({ length: 16 }, (_, index) => at(9) + index * 30);

/** "10:30 AM", from minutes since midnight. */
export function clockLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12)}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** "10:30 – 11:00 AM" or "11:30 AM – 12:15 PM". */
export function spanLabel(start: number, end: number): string {
  const sameHalf = start < at(12) === end <= at(12);
  const from = clockLabel(start);
  return `${sameHalf ? from.replace(/ (AM|PM)$/, '') : from} – ${clockLabel(end)}`;
}

/** "Thu, Oct 22", from a day key (`YYYY-MM-DD`). */
export function shortDay(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00Z`);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The days a visitor can book on the demo's page: the rest of this week's working days, and next week's. */
export const OPEN_DAYS: ReadonlySet<string> = new Set([
  '2026-10-22',
  '2026-10-23',
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
]);

/** The starts a host is free for on `dayKey`, among the page's offered starts: none overlapping their meetings,
 * and none before now today. */
export function freeStarts(meetings: readonly DemoMeeting[], hostId: string, dayKey: string): readonly number[] {
  const taken = meetings.filter((meeting) => meeting.hostId === hostId && meeting.dayKey === dayKey);
  return OFFERED_STARTS.filter((start) => {
    const end = start + BOOKING_PAGE.minutes;
    if (dayKey === TODAY && start <= NOW_MINUTE) return false;
    return taken.every((meeting) => end <= meeting.startMinute || start >= meeting.endMinute);
  });
}

/** "$24,000". */
export function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}
