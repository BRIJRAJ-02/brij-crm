// The dummy workspace (Northwind) and a first visit. Every date is relative to today so the prototype always looks current.
import type { WeekHours } from '../HoursEditor/HoursEditor.tsx';
import type { FormQuestion } from '../HostedForm/answers.ts';
import type { Notification } from '../NotificationList/NotificationList.tsx';
import {
  HOST, HOST_ZONE, PLACES, at, dayFrom, isoDay, nextId, slugify,
  type BookedMeeting, type BookingPage, type BookingsState, type PlaceKind,
} from './state.ts';

const r = (id: string, from: number, to: number) => [{ id, start: from * 60, end: to * 60 }];
const off = { on: false, ranges: [] };
/** Weekdays open between two hours. */
export function weekdays(from: number, to: number, prefix = 'h'): WeekHours {
  return { mon: { on: true, ranges: r(`${prefix}m`, from, to) }, tue: { on: true, ranges: r(`${prefix}t`, from, to) }, wed: { on: true, ranges: r(`${prefix}w`, from, to) },
    thu: { on: true, ranges: r(`${prefix}h`, from, to) }, fri: { on: true, ranges: r(`${prefix}f`, from, to) }, sat: off, sun: off };
}
const WEEKEND_CLINIC: WeekHours = { mon: off, tue: off, wed: off, thu: off, fri: off, sat: { on: true, ranges: r('ws', 10, 14) }, sun: off };

/** The look every new page starts with. */
export const CALM = { look: 'calm', accent: '#1F5FD6', font: 'sans', scheme: 'light' } as const;

/** A fresh page with the zero-setup defaults: the host's hours, 30 minutes, Google Meet. */
export function newPage(pages: ReadonlyArray<BookingPage>, patch: Partial<BookingPage> = {}): BookingPage {
  const base: BookingPage = {
    id: nextId('page'), name: '30 min meeting', slug: '30-min-meeting', durations: [30], places: ['meet'], address: '', phoneWho: 'host', description: '', isOn: true, owner: HOST,
    hoursFrom: 'working', bufferBefore: 0, bufferAfter: 0, noticeHours: 4, daysAhead: 60, perDay: 0, perWeek: 0,
    hostMode: 'one', hosts: [HOST], shareOut: 'equal', weights: {}, whoCanBook: 'anyone', formName: '', questions: [], confirmFirst: false,
    calendarId: 'work', addToPeople: true, after: 'message', redirectUrl: '', reminders: ['day'], look: CALM, showPhoto: true, socials: [], accent: 'blue',
    stats: { views: 0, bookings: 0, showRate: 0 }, links: [], offers: [],
  };
  const page = { ...base, ...patch };
  return { ...page, slug: uniqueSlug(patch.slug ?? slugify(page.name), pages) };
}
/** A slug no other page uses ("demo", "demo-2"). */
export function uniqueSlug(base: string, pages: ReadonlyArray<BookingPage>, selfId?: string): string {
  const taken = new Set(pages.filter((p) => p.id !== selfId).map((p) => p.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

const q = (id: string, title: string, kind: FormQuestion['kind'], extra: Partial<FormQuestion> = {}): FormQuestion => ({ id, title, kind, required: false, ...extra });

/** Northwind, a small team on the team plan, mid-month: pages, about twenty meetings, time off, calendars, groups and routing. */
export function northwind(now: Date = new Date()): BookingsState {
  // The nth weekday from today (0 is today, or the next weekday on a weekend); negative counts back.
  const wd = (n: number) => {
    const d = dayFrom(now, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    let left = Math.abs(n);
    const step = n < 0 ? -1 : 1;
    while (left > 0) { d.setDate(d.getDate() + step); if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1; }
    return d;
  };
  // The next given weekday after today (1 = Monday).
  const next = (dow: number) => { const d = dayFrom(now, 1); while (d.getDay() !== dow) d.setDate(d.getDate() + 1); return d; };

  const pages: BookingPage[] = [];
  const add = (patch: Partial<BookingPage>) => { const p = newPage(pages, patch); pages.push(p); return p; };
  const discovery = add({ id: 'p-discovery', name: 'Discovery call', accent: 'blue', stats: { views: 412, bookings: 38, showRate: 92 },
    questions: [q('q-co', 'Company', 'short'), q('q-goal', 'What would you like to talk about?', 'long')],
    links: [
      { id: 'otl-1', label: 'For Liam at Acme', uses: 1, used: 0, expires: isoDay(dayFrom(now, 7)), revoked: false },
      { id: 'otl-2', label: 'Board intro', uses: 3, used: 1, expires: isoDay(dayFrom(now, 14)), revoked: false },
    ],
    cancelCutoff: 24, moveCutoff: 4, tooLateMessage: 'It’s too close to the call to change it here. Reply to your invite and Priya will sort it out.' });
  // Two earlier versions, so Versions has something to restore.
  pages[pages.length - 1] = { ...discovery, versions: [
    { id: 'v-2', at: new Date(now.getTime() - 3 * 86_400_000), by: 'Priya Raman', changes: ['Questions', 'Cancel cut-off'], page: { ...discovery, questions: discovery.questions.slice(0, 1) } },
    { id: 'v-1', at: new Date(now.getTime() - 21 * 86_400_000), by: 'Sam Kim', changes: ['Lengths', 'Gap'], page: { ...discovery, durations: [45], bufferAfter: 0 } },
  ] };
  const demo = add({ id: 'p-demo', name: 'Product demo', durations: [45], places: ['zoom'], confirmFirst: true, accent: 'purple', stats: { views: 268, bookings: 21, showRate: 86 },
    questions: [q('q-co2', 'Company', 'short', { required: true }), q('q-size', 'Team size', 'dropdown', { options: ['1–10', '11–50', '51–200', '200+'] })],
    offers: [{ id: 'off-1', slots: [{ day: isoDay(wd(3)), start: 10 * 60 }, { day: isoDay(wd(3)), start: 14 * 60 }, { day: isoDay(wd(4)), start: 11 * 60 }], created: isoDay(dayFrom(now, -1)) }] });
  const onboarding = add({ id: 'p-onboarding', name: 'Onboarding', durations: [60], owner: 'Sam Kim', hostMode: 'roundrobin', hosts: ['Sam Kim', 'Jo Mendes', 'Ava Chen'], groupId: 'g-onboard',
    shareOut: 'even', evenGap: 2, countDays: 30, caps: { 'Jo Mendes': 3 }, rrReschedule: 'same', weights: { 'Sam Kim': 1, 'Jo Mendes': 1, 'Ava Chen': 1 }, accent: 'green', stats: { views: 190, bookings: 27, showRate: 95 } });
  // A managed page: each member has their own copy; length and questions are locked.
  add({ id: 'p-intro', name: 'Intro call', durations: [20], hostMode: 'managed', hosts: ['Priya Raman', 'Sam Kim', 'Ava Chen'], shareOut: 'equal', weights: {}, accent: 'purple',
    locked: ['length', 'questions'], drift: { 'Sam Kim': ['where'], 'Ava Chen': ['length'] }, editors: ['Sam Kim'], stats: { views: 74, bookings: 9, showRate: 94 } });
  add({ id: 'p-quick', name: 'Quick chat', durations: [15, 30], isOn: false, places: ['meet', 'phone'], accent: 'orange', stats: { views: 33, bookings: 4, showRate: 100 } });
  const site = add({ id: 'p-site', name: 'Site visit', durations: [60], places: ['in-person'], address: 'Northwind office, 12 Harbour Street', accent: 'sky', bufferBefore: 30, bufferAfter: 30, perDay: 1, visibility: 'link', inHeldTime: true, stats: { views: 58, bookings: 6, showRate: 100 } });
  const support = add({ id: 'p-support', name: 'Support call', owner: 'Jo Mendes', hosts: ['Jo Mendes'], whoCanBook: 'form', formName: 'Support request', places: ['phone'], accent: 'yellow',
    stats: { views: 120, bookings: 19, showRate: 89 } });

  const guests: ReadonlyArray<readonly [string, string, string]> = [
    ['Liam Ortiz', 'liam@acme.com', 'Acme Corp'], ['Noor Haddad', 'noor@globex.io', 'Globex'], ['Ben Carter', 'ben@initech.co', 'Initech'], ['Mia Novak', 'mia@umbrella.health', 'Umbrella Health'],
    ['Ethan Park', 'ethan@stark.studio', 'Stark Studio'], ['Zoe Laurent', 'zoe@waynelog.com', 'Wayne Logistics'], ['Omar Said', 'omar@acme.com', 'Acme Corp'], ['Lena Fischer', 'lena@globex.io', 'Globex'],
    ['Chris Doyle', 'chris@initech.co', 'Initech'], ['Hana Sato', 'hana@stark.studio', 'Stark Studio'], ['Ravi Kumar', 'ravi@umbrella.health', 'Umbrella Health'], ['Grace Lee', 'grace@waynelog.com', 'Wayne Logistics'],
  ];
  const meetings: BookedMeeting[] = [];
  let g = 0;
  const book = (page: BookingPage, day: Date, startHour: number, host: string, status?: BookedMeeting['status'], extra: Partial<BookedMeeting> = {}) => {
    const [name, email, company] = guests[g % guests.length] ?? ['Guest', 'guest@example.com', 'Acme Corp'];
    g += 1;
    const start = at(day, Math.round(startHour * 60));
    const end = new Date(start.getTime() + (page.durations[0] ?? 30) * 60_000);
    const place: PlaceKind = page.places[0] ?? 'meet';
    meetings.push({
      id: nextId('m'), pageId: page.id, host, start, end, title: page.name, invitee: { name, email }, place: PLACES[place].meeting, placeLabel: place === 'in-person' ? page.address || PLACES[place].label : PLACES[place].label,
      status: status ?? (end <= now ? 'completed' : 'confirmed'), guestZone: g % 3 === 0 ? 'Europe/London' : HOST_ZONE, notes: '',
      answers: page.questions.map((x) => ({ question: x.title, answer: x.title === 'Company' ? company : x.kind === 'dropdown' ? '51–200' : 'How you handle round robin for a team of 40.' })),
      record: page.id === 'p-discovery' && g % 2 === 0 ? { id: `rec-${g}`, name: company, kind: 'company', sub: email.split('@')[1] } : undefined,
      activity: [{ id: nextId('a'), text: `Booked by ${name}`, at: new Date(start.getTime() - 3 * 86_400_000) }],
      ...extra,
    });
  };
  // Last week.
  book(discovery, wd(-5), 10, HOST); book(demo, wd(-4), 15, HOST); book(onboarding, wd(-4), 11, 'Sam Kim');
  book(discovery, wd(-3), 14, HOST, 'no-show'); book(site, wd(-2), 11, HOST); book(onboarding, wd(-1), 9.5, 'Ava Chen', 'cancelled');
  // Today.
  book(discovery, wd(0), 10, HOST); book(onboarding, wd(0), 14, 'Sam Kim'); book(demo, wd(0), 16.5, HOST);
  // The next two weeks: two requests waiting, a few cancelled, one clash.
  book(onboarding, next(1), 10, 'Jo Mendes'); book(support, next(2), 9.5, 'Jo Mendes');
  book(discovery, wd(1), 11, HOST); book(demo, wd(2), 15, HOST, 'pending'); book(site, wd(2), 11, HOST);
  book(discovery, wd(3), 12, HOST, 'cancelled'); book(onboarding, wd(4), 13, 'Ava Chen'); book(demo, wd(4), 10.5, HOST, 'pending');
  book(discovery, wd(5), 10, HOST); book(discovery, wd(6), 16, HOST); book(onboarding, wd(7), 11, 'Sam Kim', 'cancelled');
  book(discovery, wd(8), 14, HOST); book(site, wd(9), 10, HOST);
  // Booked before Jo took the Thursday off: it needs a host now.
  book(support, next(4), 11, 'Jo Mendes');
  meetings.sort((a, b) => a.start.getTime() - b.start.getTime());
  // How the earlier calls went, so a person's record shows outcomes beside their meetings.
  meetings.forEach((m, n) => { if (m.end < now && m.status !== 'cancelled' && m.status !== 'no-show' && m.invitee.email === 'noor@globex.io') meetings[n] = { ...m, outcome: 'Qualified' }; });

  // Google holds lunch every weekday and one dentist visit that lands on a booked call.
  const busy = Array.from({ length: 12 }, (_, n) => wd(n)).flatMap((d) => [
    { id: nextId('busy'), member: HOST, day: isoDay(d), start: 13 * 60, end: 14 * 60, source: 'Lunch · Google Calendar' },
    { id: nextId('busy'), member: 'Sam Kim', day: isoDay(d), start: 12 * 60, end: 13 * 60, source: 'Gym · Google Calendar' },
  ]);
  busy.push({ id: 'busy-dentist', member: HOST, day: isoDay(wd(5)), start: 9 * 60 + 30, end: 10 * 60 + 30, source: 'Dentist · Google Calendar' });

  const thu = next(4);
  const fri = dayFrom(thu, 1);
  const pending = meetings.filter((m) => m.status === 'pending');
  const notifications: Notification[] = [
    ...pending.map((m): Notification => ({ id: m.id, actor: m.invitee.name, action: 'asked to book', object: `${m.title} · 45 min`, excerpt: 'Waiting for your OK', time: '2h ago', group: 'Today', read: false })),
    ...meetings.filter((m) => m.status === 'confirmed').slice(0, 2).map((m): Notification => ({ id: m.id, actor: m.invitee.name, action: 'booked', object: m.title, time: 'Yesterday', group: 'Earlier', read: true })),
  ];

  return {
    workspace: 'Northwind',
    pages,
    meetings,
    notifications,
    savedHours: [{ id: 'working', name: 'Working hours', hours: weekdays(9, 17) }, { id: 'weekend', name: 'Weekend clinic', hours: WEEKEND_CLINIC }],
    defaultHoursId: 'working',
    memberHours: { 'Sam Kim': weekdays(8, 16, 's'), 'Ava Chen': weekdays(10, 18, 'a') },
    timeOff: [{ id: 'off-jo', member: 'Jo Mendes', from: isoDay(thu), to: isoDay(fri), allDay: true, start: 0, end: 0, note: 'Family trip', reason: 'vacation', cover: 'Ava Chen' }],
    memberZones: { 'Ava Chen': 'London' },
    access: { 'Jo Mendes': 'admins' },
    memberCalendars: { 'Priya Raman': 'ok', 'Sam Kim': 'skipped', 'Jo Mendes': 'reconnect', 'Ava Chen': 'ok' },
    // Product demo has an unpublished change: guests still see the live version.
    drafts: { [demo.id]: { ...demo, durations: [30, 45] } },
    // Ava covers the afternoon while Jo is away: a change for that date only.
    overrides: { [`Ava Chen|${isoDay(thu)}`]: { on: true, ranges: r('ov-a', 12, 20) } },
    calendars: [
      { id: 'google', provider: 'Google', email: 'priya@northwind.com', calendars: 3, status: 'connected', checkConflicts: true },
      { id: 'outlook', provider: 'Outlook', email: 'priya.raman@outlook.com', calendars: 1, status: 'reconnect', checkConflicts: true },
    ],
    health: { skipped: { google: 1 }, bookingCalendar: 'work' },
    busy,
    blocks: [],
    groups: [{ id: 'g-onboard', name: 'Onboarding team', members: [{ name: 'Sam Kim', paused: false }, { name: 'Jo Mendes', paused: false }, { name: 'Ava Chen', paused: false }] }],
    routing: {
      formName: 'Contact sales',
      rules: [
        { id: 'rule-1', conditions: [{ id: 'c1', attributeId: 'size', operator: 'gt', value: 50 }], conjunction: 'and', pageId: demo.id, team: 'Sales', tag: 'qualified' },
        { id: 'rule-2', conditions: [{ id: 'c2', attributeId: 'need', operator: 'is', value: 'help' }], conjunction: 'and', pageId: support.id, team: 'Support' },
        { id: 'rule-3', conditions: [{ id: 'c3', attributeId: 'need', operator: 'is', value: 'partner' }, { id: 'c4', attributeId: 'region', operator: 'is', value: 'apac' }], conjunction: 'or', pageId: discovery.id, team: 'Partnerships' },
      ],
      fallbackPageId: discovery.id,
      log: [
        { id: 'd1', at: new Date(now.getTime() - 25 * 60_000), name: 'Maya Chen', company: 'Acme', answers: { size: 120, region: 'eu', need: 'buy', source: 'web', known: 'no' }, ruleId: 'rule-1', booked: true },
        { id: 'd2', at: new Date(now.getTime() - 3 * 3_600_000), name: 'Leo Brandt', company: 'Globex', answers: { size: 12, region: 'eu', need: 'help', source: 'email', known: 'yes' }, ruleId: 'rule-2', booked: true },
        { id: 'd3', at: new Date(now.getTime() - 26 * 3_600_000), name: 'Aiko Tanaka', company: 'Initech', answers: { size: 40, region: 'apac', need: 'partner', source: 'linkedin', known: 'no' }, ruleId: 'rule-3', booked: false },
        { id: 'd4', at: new Date(now.getTime() - 30 * 3_600_000), name: 'Sara Ortiz', company: 'Umbrella', answers: { size: 300, region: 'na', need: 'buy', source: 'ads', known: 'no' }, ruleId: 'rule-1', booked: true, won: true },
        { id: 'd5', at: new Date(now.getTime() - 50 * 3_600_000), name: 'Tom Price', company: 'Hooli', answers: { size: 8, region: 'na', need: 'buy', source: 'web', known: 'no' }, booked: true, noShow: true },
        { id: 'd6', at: new Date(now.getTime() - 74 * 3_600_000), name: 'Nina Rossi', company: 'Stark', answers: { size: 75, region: 'eu', need: 'buy', source: 'email', known: 'yes' }, ruleId: 'rule-1', booked: true, won: true },
        { id: 'd7', at: new Date(now.getTime() - 98 * 3_600_000), name: 'Omar Haddad', company: 'Waynelog', answers: { size: 20, region: 'eu', need: 'help', source: 'web', known: 'yes' }, ruleId: 'rule-2', booked: true },
        { id: 'd8', at: new Date(now.getTime() - 120 * 3_600_000), name: 'Ivy Park', company: 'Soylent', answers: { size: 5, region: 'na', need: 'buy', source: 'ads', known: 'no' }, booked: false },
      ],
      skills: { 'Priya Raman': ['Sales', 'Partnerships'], 'Sam Kim': ['Sales', 'Onboarding'], 'Jo Mendes': ['Support', 'Onboarding'], 'Ava Chen': ['Support', 'Onboarding'] },
      wonMeans: 'won',
    },
  };
}

/** The dummy workspace, built for today. */
export const NORTHWIND: BookingsState = northwind();

/** A first visit: no pages, no meetings, no calendar yet. */
export const FIRST_VISIT: BookingsState = {
  workspace: 'Northwind', pages: [], meetings: [], notifications: [],
  savedHours: [{ id: 'working', name: 'Working hours', hours: weekdays(9, 17) }], defaultHoursId: 'working', memberHours: {},
  timeOff: [], calendars: [], health: { skipped: {}, bookingCalendar: 'work' }, busy: [], blocks: [], groups: [],
  routing: { formName: 'Contact sales', rules: [], fallbackPageId: '', skills: {}, wonMeans: 'won' },
};
