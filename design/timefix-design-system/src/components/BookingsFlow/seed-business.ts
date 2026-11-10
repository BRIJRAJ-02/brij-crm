// Two businesses as ordinary Bookings workspaces: Lumen Hair Studio (services are booking pages with prices) and Olive Kitchen
// (one table page, tables in Availability). Same team, same pages, same meetings: only the business fields are new.
import type { DayHours, WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { FIRST_VISIT, newPage } from './seed.ts';
import { oliveMenus } from './menu-seed.ts';
import { HOST, PLACES, at, dayFrom, isoDay, nextId, type BookedMeeting, type BookingPage, type BookingsState, type Table, type WaitParty } from './state.ts';

const off: DayHours = { on: false, ranges: [] };
const open = (id: string, from: number, to: number): DayHours => ({ on: true, ranges: [{ id, start: from * 60, end: to * 60 }] });
const two = (id: string, a: number, b: number, c: number, d: number): DayHours => ({ on: true, ranges: [{ id: `${id}a`, start: a * 60, end: b * 60 }, { id: `${id}b`, start: c * 60, end: d * 60 }] });
const days = (prefix: string, on: ReadonlyArray<number>, from: number, to: number): WeekHours => {
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  return Object.fromEntries(keys.map((k, i) => [k, on.includes(i) ? open(`${prefix}${k}`, from, to) : off])) as WeekHours;
};

/** A drawn photo for the page gallery: soft walls, a counter, mirrors or tables, plants. No uploads in the prototype. */
function scene(kind: 'salon' | 'chairs' | 'basin' | 'dining' | 'terrace' | 'bar', hue: string): string {
  const art: Record<string, string> = {
    salon: `<rect width="800" height="520" fill="${hue}"/><rect y="380" width="800" height="140" fill="#d9c6ae"/><rect x="80" y="90" width="150" height="230" rx="75" fill="#f7f1e8"/><rect x="320" y="90" width="150" height="230" rx="75" fill="#f7f1e8"/><rect x="560" y="90" width="150" height="230" rx="75" fill="#f7f1e8"/><rect x="110" y="300" width="90" height="120" rx="18" fill="#3d3a36"/><rect x="350" y="300" width="90" height="120" rx="18" fill="#3d3a36"/><rect x="590" y="300" width="90" height="120" rx="18" fill="#3d3a36"/><circle cx="760" cy="300" r="60" fill="#7f9a6e"/>`,
    chairs: `<rect width="800" height="520" fill="${hue}"/><rect y="400" width="800" height="120" fill="#c9b49a"/><rect x="120" y="230" width="160" height="190" rx="30" fill="#2f2c29"/><rect x="460" y="230" width="160" height="190" rx="30" fill="#2f2c29"/><rect x="90" y="60" width="220" height="150" rx="12" fill="#efe7db"/><rect x="430" y="60" width="220" height="150" rx="12" fill="#efe7db"/>`,
    basin: `<rect width="800" height="520" fill="${hue}"/><rect y="360" width="800" height="160" fill="#e8ddd0"/><ellipse cx="260" cy="330" rx="140" ry="50" fill="#fafafa"/><ellipse cx="560" cy="330" rx="140" ry="50" fill="#fafafa"/><rect x="60" y="80" width="680" height="120" rx="14" fill="#f2ebe1"/><circle cx="120" cy="140" r="30" fill="#8aa37a"/>`,
    dining: `<rect width="800" height="520" fill="${hue}"/><rect y="380" width="800" height="140" fill="#a8835f"/><circle cx="200" cy="360" r="80" fill="#f4ede2"/><circle cx="520" cy="360" r="80" fill="#f4ede2"/><rect x="0" y="0" width="800" height="70" fill="#e9dcc6"/><circle cx="200" cy="120" r="22" fill="#ffd27a"/><circle cx="520" cy="120" r="22" fill="#ffd27a"/><rect x="680" y="160" width="80" height="220" rx="40" fill="#6f8b5d"/>`,
    terrace: `<rect width="800" height="520" fill="#f4c9a0"/><rect y="260" width="800" height="260" fill="#5f86a8"/><rect y="400" width="800" height="120" fill="#c9a77f"/><circle cx="640" cy="170" r="60" fill="#fff1d6"/><circle cx="200" cy="420" r="60" fill="#f7f0e6"/><circle cx="460" cy="420" r="60" fill="#f7f0e6"/>`,
    bar: `<rect width="800" height="520" fill="${hue}"/><rect y="320" width="800" height="200" fill="#6e4b33"/><rect x="60" y="80" width="680" height="40" fill="#d9c4a5"/><rect x="60" y="160" width="680" height="40" fill="#d9c4a5"/><circle cx="160" cy="360" r="26" fill="#2f2c29"/><circle cx="320" cy="360" r="26" fill="#2f2c29"/><circle cx="480" cy="360" r="26" fill="#2f2c29"/><circle cx="640" cy="360" r="26" fill="#2f2c29"/>`,
  };
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" preserveAspectRatio="xMidYMid slice">${art[kind] ?? ''}</svg>`)}`;
}

/** Lumen Hair Studio in Bandra: services are booking pages (a price and a category each), "any professional" is round robin over who does it. */
export function lumen(now = new Date()): BookingsState {
  const pages: BookingPage[] = [];
  const svc = (id: string, name: string, cat: string, minutes: number, price: number, hosts: ReadonlyArray<string>, extra: Partial<BookingPage> = {}) => {
    const p = newPage(pages, { id, name, kind: 'service', categoryId: cat, durations: [minutes], price, priceType: 'fixed', places: ['in-person'], address: '14 Hill Road, Bandra West',
      hostMode: hosts.length > 1 ? 'roundrobin' : 'one', hosts, shareOut: 'equal', owner: HOST, noticeHours: 1, bufferAfter: 10, accent: cat === 'c-colour' ? 'purple' : cat === 'c-care' ? 'green' : 'blue',
      stats: { views: 60 + minutes, bookings: Math.round(price / 120), showRate: 94 }, ...extra });
    pages.push(p);
    return p;
  };
  const everyone = ['Priya Raman', 'Sam Kim', 'Jo Mendes', 'Ava Chen'];
  const cut = svc('s-cut', 'Haircut and blow dry', 'c-hair', 45, 1200, everyone, { description: 'A consultation, wash, cut and finish.', durations: [45, 60], prices: { '45': 1200, '60': 1500 } });
  const trim = svc('s-trim', 'Fringe trim', 'c-hair', 15, 300, everyone, { bufferAfter: 0 });
  const mens = svc('s-mens', 'Men’s cut', 'c-hair', 30, 700, ['Sam Kim', 'Ava Chen'], { description: 'Clipper and scissor work, finished with a wash.' });
  const roots = svc('s-roots', 'Root colour', 'c-colour', 75, 2500, ['Priya Raman', 'Jo Mendes'], { priceType: 'from' });
  const balayage = svc('s-balayage', 'Balayage', 'c-colour', 180, 7500, ['Jo Mendes'], { priceType: 'from', description: 'Hand-painted lightening. A patch test is needed 48 hours before.' });
  svc('s-gloss', 'Gloss and tone', 'c-colour', 45, 1800, ['Priya Raman', 'Jo Mendes'], { isOn: false });
  const mask = svc('s-mask', 'Repair mask', 'c-care', 20, 800, everyone, { bufferAfter: 0 });
  svc('s-consult', 'Colour consultation', 'c-care', 15, 0, ['Jo Mendes'], { priceType: 'free', description: 'Talk through what you want before booking colour.' });

  const meetings: BookedMeeting[] = [];
  const book = (p: BookingPage, offset: number, h: number, m: number, host: string, name: string, minutes = p.durations[0] ?? 30, status?: BookedMeeting['status']) => {
    const day = dayFrom(now, offset);
    const start = at(day, h * 60 + m);
    const end = new Date(start.getTime() + minutes * 60_000);
    meetings.push({ id: nextId('m'), pageId: p.id, host, start, end, title: p.name, invitee: { name, email: `${name.split(' ')[0]?.toLowerCase() ?? 'guest'}@mail.com` }, place: PLACES['in-person'].meeting, placeLabel: 'Lumen, Bandra',
      status: status ?? (end <= now ? 'completed' : 'confirmed'), guestZone: 'Asia/Kolkata', notes: '', answers: [], activity: [{ id: nextId('a'), text: `Booked by ${name}`, at: new Date(start.getTime() - 2 * 86_400_000) }] });
  };
  book(cut, 0, 10, 30, 'Priya Raman', 'Riya Shah', 60); book(roots, 0, 11, 0, 'Jo Mendes', 'Neha Kapoor'); book(mens, 0, 12, 0, 'Sam Kim', 'Arjun Mehta');
  book(cut, 0, 14, 0, 'Priya Raman', 'Tara Iyer'); book(balayage, 0, 14, 30, 'Jo Mendes', 'Zoya Khan'); book(mask, 0, 16, 0, 'Sam Kim', 'Kabir Rao');
  book(cut, 1, 12, 0, 'Sam Kim', 'Isha Nair'); book(trim, 1, 10, 0, 'Ava Chen', 'Maya Pillai'); book(roots, 2, 11, 30, 'Priya Raman', 'Sana Ali');
  book(cut, 3, 15, 0, 'Ava Chen', 'Dev Rao'); book(balayage, 4, 11, 0, 'Jo Mendes', 'Anya Sen');
  meetings.sort((a, b) => a.start.getTime() - b.start.getTime());

  const hours: WeekHours = { mon: open('hm', 10, 19), tue: open('ht', 10, 20), wed: open('hw', 10, 20), thu: open('hh', 10, 20), fri: open('hf', 10, 20), sat: open('hs', 9, 20), sun: open('hu', 11, 18) };
  return {
    ...FIRST_VISIT,
    workspace: 'Lumen Hair Studio',
    pages, meetings,
    savedHours: [{ id: 'working', name: 'Opening hours', hours }],
    memberHours: { 'Priya Raman': days('p', [1, 2, 3, 4, 5], 10, 19), 'Sam Kim': days('s', [0, 1, 3, 4, 5, 6], 11, 20), 'Jo Mendes': days('j', [0, 1, 2, 4, 5], 10, 18), 'Ava Chen': days('a', [2, 3, 4, 5, 6], 10, 18) },
    calendars: [{ id: 'google', provider: 'Google', email: 'priya@lumen.in', calendars: 1, status: 'connected', checkConflicts: true }],
    business: {
      kind: 'salon', kindLabel: 'Hair salon', handle: 'lumen', address: '14 Hill Road, Bandra West, Mumbai', area: 'Bandra West', phone: '+91 98200 11223',
      about: 'A calm, bright studio for cuts and colour. Free consultations before any colour work, and a quiet corner for long appointments.',
      rating: 4.9, reviews: 312, amenities: ['Instant confirmation', 'Card payments', 'Wheelchair access'], published: true,
      titles: { 'Priya Raman': 'Owner, senior stylist', 'Sam Kim': 'Stylist', 'Jo Mendes': 'Colour specialist', 'Ava Chen': 'Junior stylist' },
      photos: [scene('salon', '#efe3d3'), scene('chairs', '#e6ddd2'), scene('basin', '#e9e2d8')],
    },
    categories: [{ id: 'c-hair', name: 'Hair' }, { id: 'c-colour', name: 'Colour' }, { id: 'c-care', name: 'Treatments' }],
  };
}

/** Olive Kitchen in Colaba: one table page, tables in Availability, reservations are meetings with a party and tables. */
export function olive(now = new Date()): BookingsState {
  const t = (id: string, name: string, seats: number, area: string, joinable = false): Table => ({ id, name, seats, area, online: true, joinable, minParty: seats >= 8 ? 5 : seats >= 6 ? 3 : undefined, code: `${name.toLowerCase()}-${(seats * 7919 + name.length * 31).toString(36)}` });
  const tables: Table[] = [t('t1', 'T1', 2, 'Main room'), t('t2', 'T2', 2, 'Main room'), t('t3', 'T3', 4, 'Main room', true), t('t4', 'T4', 4, 'Main room', true), t('t5', 'T5', 6, 'Main room'),
    t('t6', 'T6', 2, 'Terrace', true), t('t7', 'T7', 2, 'Terrace', true), t('t8', 'T8', 4, 'Terrace'), { ...t('t9', 'T9', 8, 'Terrace'), online: false }];
  const table = newPage([], { id: 'p-table', name: 'Book a table', kind: 'table', party: { min: 1, max: 8 }, durations: [90], places: ['in-person'], address: '7 Apollo Bunder, Colaba',
    hostMode: 'one', hosts: [HOST], noticeHours: 1, slotStep: 15, accent: 'green', pacing: 16, holdLate: 15, pickArea: true, bigTurn: { from: 5, minutes: 120 }, turns: [{ upTo: 2, minutes: 75 }, { upTo: 4, minutes: 90 }, { upTo: 6, minutes: 120 }, { upTo: 99, minutes: 150 }], cancelCutoff: 2,
    stats: { views: 1840, bookings: 412, showRate: 93 } });
  const meetings: BookedMeeting[] = [];
  type Extra = { readonly status?: BookedMeeting['status']; readonly offset?: number; readonly tags?: ReadonlyArray<string>; readonly occasion?: string; readonly note?: string; readonly area?: string };
  const res = (h: number, m: number, party: number, tableIds: ReadonlyArray<string>, name: string, x: Extra = {}) => {
    const start = at(dayFrom(now, x.offset ?? 0), h * 60 + m);
    const end = new Date(start.getTime() + (party >= 5 ? 120 : 90) * 60_000);
    // Tonight as the host stand would have it: tables that started are seated, ones that ended have left.
    const seating = x.status ? undefined : end <= now ? 'left' as const : start <= now ? 'seated' as const : undefined;
    const digits = String(9800000000 + name.length * 7919 + h * 101 + m).slice(-10);
    meetings.push({ id: nextId('m'), pageId: table.id, host: HOST, start, end, title: `Table for ${party}`, invitee: { name, email: `${name.split(' ')[0]?.toLowerCase() ?? 'guest'}@mail.com` },
      place: PLACES['in-person'].meeting, placeLabel: tableIds.map((id) => tables.find((y) => y.id === id)?.name ?? '').join(' + '), status: x.status ?? (end <= now ? 'completed' : 'confirmed'), guestZone: 'Asia/Kolkata',
      notes: x.note ?? '', answers: [], activity: [], party, tables: tableIds, seating, seatedAt: seating ? new Date(start.getTime() + 4 * 60_000) : undefined,
      phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`, tags: x.tags, occasion: x.occasion, area: x.area });
  };
  res(12, 30, 2, ['t1'], 'Anika Desai', { tags: ['Regular'] }); res(13, 0, 4, ['t3'], 'Rohan Gupta'); res(13, 15, 2, ['t6'], 'Meera Pillai', { area: 'Terrace' }); res(14, 0, 3, ['t4'], 'Tom Walsh', { status: 'no-show' });
  res(19, 0, 2, ['t2'], 'Aarav Nair', { occasion: 'Date night' }); res(19, 30, 2, ['t6'], 'Sara Fernandes', { area: 'Terrace', occasion: 'Anniversary' }); res(19, 30, 4, ['t8'], 'Neha Kapoor', { tags: ['VIP'], note: 'Owner’s guest. Send the octopus.' });
  res(20, 0, 6, ['t5'], 'Vikram Shetty', { occasion: 'Birthday', note: 'Bringing a cake, candles at dessert.' }); res(18, 30, 4, ['t3'], 'Leela Menon', { status: 'pending' });
  res(20, 30, 8, ['t3', 't4'], 'Dev Malhotra', { tags: ['Allergy'], note: 'One guest allergic to tree nuts.' }); res(21, 0, 2, ['t2'], 'Priya Joshi'); res(21, 15, 2, ['t7'], 'Kabir Rao', { area: 'Terrace' });
  res(20, 0, 4, ['t3'], 'Kiran Bose', { offset: 1, tags: ['VIP'] }); res(13, 0, 2, ['t6'], 'Lara Dias', { offset: 2 }); res(20, 30, 6, ['t5'], 'Ishaan Mehta', { offset: 2, occasion: 'Birthday' });
  const book = oliveMenus();
  const today = isoDay(now);
  const waitlist: WaitParty[] = [
    { id: nextId('w'), name: 'Rhea Sen', phone: '+91 98111 20456', party: 2, added: new Date(now.getTime() - 12 * 60_000), day: today, quote: 20 },
    { id: nextId('w'), name: 'Arjun Das', phone: '+91 99300 77120', party: 4, added: new Date(now.getTime() - 5 * 60_000), day: today, quote: 35 },
    { id: nextId('w'), name: 'Fatima Khan', phone: '+91 98670 33018', party: 2, added: new Date(now.getTime() - 90 * 60_000), day: today, wanted: 20 * 60 + 30, online: true },
  ];
  meetings.sort((a, b) => a.start.getTime() - b.start.getTime());
  const hours: WeekHours = { mon: off, tue: two('ht', 12, 15, 19, 23), wed: two('hw', 12, 15, 19, 23), thu: two('hh', 12, 15, 19, 23), fri: two('hf', 12, 15, 19, 24), sat: two('hs', 12, 16, 19, 24), sun: two('hu', 12, 16, 19, 23) };
  return {
    ...FIRST_VISIT,
    workspace: 'Olive Kitchen',
    pages: [table], meetings,
    savedHours: [{ id: 'working', name: 'Opening hours', hours }],
    business: {
      kind: 'restaurant', kindLabel: 'Mediterranean restaurant', handle: 'olive', address: '7 Apollo Bunder, Colaba, Mumbai', area: 'Colaba', phone: '+91 22 4000 1188',
      about: 'Wood-fired plates and long lunches by the sea. The terrace opens at sunset.',
      menu: [
        { name: 'Burrata, heirloom tomatoes', description: 'Basil oil, toasted sourdough', price: '₹780', tag: 'Vegetarian' },
        { name: 'Wood-fired octopus', description: 'Smoked paprika, crushed potatoes, lemon', price: '₹1,250' },
        { name: 'Lamb shoulder for two', description: 'Slow roasted for eight hours, salsa verde', price: '₹2,400' },
        { name: 'Wild mushroom orzo', description: 'Parmesan, thyme, truffle oil', price: '₹920', tag: 'Vegetarian' },
        { name: 'Olive oil cake', description: 'Orange, mascarpone', price: '₹480' },
      ], rating: 4.7, reviews: 1204, amenities: ['Outdoor seating', 'Vegetarian options', 'Card payments'], published: true,
      photos: [scene('dining', '#e8d9c3'), scene('terrace', '#f4c9a0'), scene('bar', '#d8c3a5')],
    },
    tables, waitlist, menu: book, menuLive: book,
  };
}
