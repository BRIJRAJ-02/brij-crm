// Two dummy businesses built for today: Lumen Hair Studio (services with staff) and Olive Kitchen (tables).
import type { DayHours, WeekHours } from '../HoursEditor/HoursEditor.tsx';
import { at, dayFrom, type Appointment, type BizState, type Reservation, type Service, type Staff, type Table } from './state.ts';

const off: DayHours = { on: false, ranges: [] };
const open = (id: string, from: number, to: number): DayHours => ({ on: true, ranges: [{ id, start: from * 60, end: to * 60 }] });
const split = (id: string, a: number, b: number, c: number, d: number): DayHours => ({ on: true, ranges: [{ id: `${id}a`, start: a * 60, end: b * 60 }, { id: `${id}b`, start: c * 60, end: d * 60 }] });
/** The same hours on the given days (Mon = 0), off on the rest. */
const week = (prefix: string, days: ReadonlyArray<number>, from: number, to: number): WeekHours => {
  const keys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
  return Object.fromEntries(keys.map((k, i) => [k, days.includes(i) ? open(`${prefix}${k}`, from, to) : off])) as WeekHours;
};
const client = (name: string, phone: string) => ({ name, phone, email: `${name.split(' ')[0]?.toLowerCase() ?? 'guest'}@mail.com` });

/** A hair salon in Bandra: three categories, four people, today's book half full. */
export function lumen(now = new Date()): BizState {
  const services: Service[] = [
    { id: 's-cut', categoryId: 'c-hair', name: 'Haircut and blow dry', description: 'A consultation, wash, cut and finish.', variants: [{ id: 'v-short', name: 'Short hair', minutes: 45, price: 1200, priceType: 'fixed' }, { id: 'v-long', name: 'Long hair', minutes: 60, price: 1600, priceType: 'fixed' }], staff: 'all', bufferAfter: 10, online: true },
    { id: 's-trim', categoryId: 'c-hair', name: 'Fringe trim', description: '', variants: [{ id: 'v-trim', name: '', minutes: 15, price: 300, priceType: 'fixed' }], staff: 'all', bufferAfter: 0, online: true },
    { id: 's-mens', categoryId: 'c-hair', name: 'Men’s cut', description: 'Clipper and scissor work, finished with a wash.', variants: [{ id: 'v-mens', name: '', minutes: 30, price: 700, priceType: 'fixed' }], staff: ['p-sam', 'p-ava'], bufferAfter: 5, online: true },
    { id: 's-roots', categoryId: 'c-colour', name: 'Root colour', description: '', variants: [{ id: 'v-roots', name: '', minutes: 75, price: 2500, priceType: 'from' }], staff: ['p-maria', 'p-jo'], bufferAfter: 15, online: true },
    { id: 's-balayage', categoryId: 'c-colour', name: 'Balayage', description: 'Hand-painted lightening. A patch test is needed 48 hours before.', variants: [{ id: 'v-bal', name: '', minutes: 180, price: 7500, priceType: 'from' }], staff: ['p-jo'], bufferAfter: 15, online: true },
    { id: 's-gloss', categoryId: 'c-colour', name: 'Gloss and tone', description: '', variants: [{ id: 'v-gloss', name: '', minutes: 45, price: 1800, priceType: 'fixed' }], staff: ['p-maria', 'p-jo'], bufferAfter: 10, online: false },
    { id: 's-mask', categoryId: 'c-care', name: 'Repair mask', description: '', variants: [{ id: 'v-mask', name: '', minutes: 20, price: 800, priceType: 'fixed' }], staff: 'all', bufferAfter: 0, online: true },
    { id: 's-consult', categoryId: 'c-care', name: 'Colour consultation', description: 'Talk through what you want before booking colour.', variants: [{ id: 'v-consult', name: '', minutes: 15, price: 0, priceType: 'free' }], staff: ['p-jo'], bufferAfter: 0, online: true },
  ];
  const staff: Staff[] = [
    { id: 'p-maria', name: 'Maria Bell', title: 'Senior stylist', week: week('m', [1, 2, 3, 4, 5], 10, 19), services: 'all' },
    { id: 'p-jo', name: 'Jo Mendes', title: 'Colour specialist', week: week('j', [0, 1, 2, 4, 5], 10, 18), services: 'all' },
    { id: 'p-sam', name: 'Sam Kim', title: 'Stylist', week: week('s', [0, 1, 3, 4, 5, 6], 11, 20), services: 'all' },
    { id: 'p-ava', name: 'Ava Chen', title: 'Junior stylist', week: week('a', [2, 3, 4, 5, 6], 10, 18), services: ['s-cut', 's-trim', 's-mens', 's-mask'] },
  ];
  const today = dayFrom(now, 0);
  const appt = (id: string, serviceId: string, variantId: string, staffId: string, day: Date, h: number, m: number, minutes: number, who: string, phone: string, source: Appointment['source'] = 'online', status: Appointment['status'] = 'booked'): Appointment =>
    ({ id, serviceId, variantId, staffId, start: at(day, h * 60 + m), end: at(day, h * 60 + m + minutes), client: client(who, phone), status, source });
  const tomorrow = dayFrom(now, 1);
  return {
    business: {
      name: 'Lumen Hair Studio', kind: 'salon', kindLabel: 'Hair salon', handle: 'lumen', address: '14 Hill Road, Bandra West, Mumbai', phone: '+91 98200 11223',
      about: 'A calm, bright studio for cuts and colour. Free consultations before any colour work.', amenities: ['Wi-Fi', 'Card payments', 'Wheelchair access'],
      hours: { mon: open('hm', 10, 19), tue: open('ht', 10, 20), wed: open('hw', 10, 20), thu: open('hh', 10, 20), fri: open('hf', 10, 20), sat: open('hs', 9, 20), sun: open('hu', 11, 18) },
      published: true, showInSearch: true, photos: 6,
    },
    categories: [{ id: 'c-hair', name: 'Hair' }, { id: 'c-colour', name: 'Colour' }, { id: 'c-care', name: 'Treatments' }],
    services, staff,
    appointments: [
      appt('a1', 's-cut', 'v-long', 'p-maria', today, 10, 30, 60, 'Riya Shah', '+91 98111 22334', 'online', 'done'),
      appt('a2', 's-roots', 'v-roots', 'p-jo', today, 11, 0, 75, 'Neha Kapoor', '+91 98222 33445', 'phone', 'arrived'),
      appt('a3', 's-mens', 'v-mens', 'p-sam', today, 12, 0, 30, 'Arjun Mehta', '+91 98333 44556'),
      appt('a4', 's-cut', 'v-short', 'p-maria', today, 14, 0, 45, 'Tara Iyer', '+91 98444 55667'),
      appt('a5', 's-balayage', 'v-bal', 'p-jo', today, 14, 30, 180, 'Zoya Khan', '+91 98555 66778'),
      appt('a6', 's-mask', 'v-mask', 'p-sam', today, 16, 0, 20, 'Kabir Rao', '+91 98666 77889', 'walk-in'),
      appt('a7', 's-cut', 'v-short', 'p-sam', tomorrow, 12, 0, 45, 'Isha Nair', '+91 98777 88990'),
      appt('a8', 's-consult', 'v-consult', 'p-jo', tomorrow, 10, 0, 15, 'Maya Pillai', '+91 98888 99001'),
    ],
    areas: [], tables: [], reservations: [],
    online: { accept: true, interval: 30, turn: 90, lead: 120, window: 60, partyMin: 1, partyMax: 8, maxCovers: 0, cutoff: 12 },
  };
}

/** A restaurant in Colaba: a main room and a terrace, lunch and dinner, today's book filling up. */
export function olive(now = new Date()): BizState {
  const t = (id: string, name: string, seats: number, areaId: string, joinable = false): Table => ({ id, name, seats, areaId, online: true, joinable });
  const tables: Table[] = [
    t('t1', 'T1', 2, 'a-main'), t('t2', 'T2', 2, 'a-main'), t('t3', 'T3', 4, 'a-main', true), t('t4', 'T4', 4, 'a-main', true), t('t5', 'T5', 6, 'a-main'),
    t('t6', 'T6', 2, 'a-terrace', true), t('t7', 'T7', 2, 'a-terrace', true), t('t8', 'T8', 4, 'a-terrace'), { ...t('t9', 'T9', 8, 'a-terrace'), online: false },
  ];
  const today = dayFrom(now, 0);
  const res = (id: string, h: number, m: number, party: number, tableIds: ReadonlyArray<string>, who: string, phone: string, status: Reservation['status'], source: Reservation['source'] = 'online', extra: Partial<Reservation> = {}): Reservation =>
    ({ id, start: at(today, h * 60 + m), party, tables: tableIds, guest: client(who, phone), note: '', status, source, ...extra });
  return {
    business: {
      name: 'Olive Kitchen', kind: 'restaurant', kindLabel: 'Mediterranean restaurant', handle: 'olive', address: '7 Apollo Bunder, Colaba, Mumbai', phone: '+91 22 4000 1188',
      about: 'Wood-fired plates and long lunches by the sea. The terrace opens at sunset.', amenities: ['Outdoor seating', 'Vegetarian options', 'Card payments'],
      hours: { mon: off, tue: split('ht', 12, 15, 19, 23), wed: split('hw', 12, 15, 19, 23), thu: split('hh', 12, 15, 19, 23), fri: split('hf', 12, 15, 19, 24), sat: split('hs', 12, 16, 19, 24), sun: split('hu', 12, 16, 19, 23) },
      published: true, showInSearch: true, photos: 8,
    },
    categories: [], services: [], staff: [], appointments: [],
    areas: [{ id: 'a-main', name: 'Main room' }, { id: 'a-terrace', name: 'Terrace' }],
    tables,
    reservations: [
      res('r1', 12, 30, 2, ['t1'], 'Anika Desai', '+91 98100 10101', 'finished', 'phone'),
      res('r2', 13, 0, 4, ['t3'], 'Rohan Gupta', '+91 98100 20202', 'seated', 'online', { seatedAt: at(today, 13 * 60 + 5) }),
      res('r3', 19, 30, 2, ['t6'], 'Sara Fernandes', '+91 98100 30303', 'confirmed', 'online', { occasion: 'Anniversary' }),
      res('r4', 20, 0, 6, ['t5'], 'Vikram Shetty', '+91 98100 40404', 'booked', 'online', { note: 'One high chair, please.' }),
      res('r5', 20, 0, 4, ['t8'], 'Leela Menon', '+91 98100 50505', 'booked', 'phone'),
      res('r6', 20, 30, 8, ['t3', 't4'], 'Dev Malhotra', '+91 98100 60606', 'confirmed', 'online', { occasion: 'Birthday' }),
      res('r7', 21, 0, 2, ['t2'], 'Priya Joshi', '+91 98100 70707', 'booked', 'online'),
    ],
    online: { accept: true, interval: 30, turn: 90, lead: 120, window: 60, partyMin: 1, partyMax: 8, maxCovers: 24, cutoff: 2 },
  };
}
