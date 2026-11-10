// Business booking: the data and the rules. A salon books services with a person; a restaurant books tables.
// Pure functions over one state object; times are minutes from midnight on a date, in the business's own zone.
import { HOURS_DAYS, type WeekHours } from '../HoursEditor/HoursEditor.tsx';

/** Which kind of business: services with staff, or tables. */
export type BizKind = 'salon' | 'restaurant';
/** How a price reads: "₹1,200", "from ₹1,200", "Free" or "Price on request". */
export type PriceType = 'fixed' | 'from' | 'free' | 'request';

/** One way to have a service: its own length and price ("Short hair", "Long hair"). */
export interface Variant { readonly id: string; readonly name: string; readonly minutes: number; readonly price: number; readonly priceType: PriceType }
/** A service on the menu. */
export interface Service {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly description: string;
  /** At least one; the first is the default. */
  readonly variants: ReadonlyArray<Variant>;
  /** Who does it: everyone, or chosen people. */
  readonly staff: 'all' | ReadonlyArray<string>;
  /** Clean-up time held after it, 0 to 120 minutes. */
  readonly bufferAfter: number;
  /** Shown and bookable on the business page. */
  readonly online: boolean;
  readonly archived?: boolean;
}
export interface Category { readonly id: string; readonly name: string }
/** Someone guests can book with. */
export interface Staff { readonly id: string; readonly name: string; readonly title: string; readonly week: WeekHours; readonly services: 'all' | ReadonlyArray<string>; readonly archived?: boolean }
export type AppointmentStatus = 'booked' | 'arrived' | 'done' | 'no-show' | 'cancelled';
export type Source = 'online' | 'phone' | 'walk-in';
export interface Client { readonly name: string; readonly phone: string; readonly email: string }
export interface Appointment {
  readonly id: string; readonly serviceId: string; readonly variantId: string; readonly staffId: string;
  readonly start: Date; readonly end: Date; readonly client: Client; readonly status: AppointmentStatus; readonly source: Source; readonly note?: string;
}
export interface Area { readonly id: string; readonly name: string }
/** A table: its seats, where it is, whether guests can book it online, and whether it joins its neighbours for bigger parties. */
export interface Table { readonly id: string; readonly name: string; readonly seats: number; readonly areaId: string; readonly online: boolean; readonly joinable: boolean }
export type ReservationStatus = 'booked' | 'confirmed' | 'seated' | 'finished' | 'no-show' | 'cancelled';
export interface Reservation {
  readonly id: string; readonly start: Date; readonly party: number; readonly tables: ReadonlyArray<string>; readonly guest: Client;
  readonly note: string; readonly occasion?: string; readonly status: ReservationStatus; readonly source: Source; readonly seatedAt?: Date;
}
/** Online table booking rules, with main's defaults. */
export interface OnlineRules {
  readonly accept: boolean;
  /** A time can start every this many minutes. */
  readonly interval: number;
  /** How long a table is held. */
  readonly turn: number;
  /** How soon before a time it can still be booked, in minutes. */
  readonly lead: number;
  /** How many days ahead. */
  readonly window: number;
  readonly partyMin: number;
  readonly partyMax: number;
  /** Most guests starting in one slot (0 no limit). */
  readonly maxCovers: number;
  /** Guests can't change or cancel online this many hours before. */
  readonly cutoff: number;
}
export interface Business {
  readonly name: string; readonly kind: BizKind; readonly kindLabel: string; readonly handle: string; readonly address: string; readonly phone: string;
  readonly about: string; readonly amenities: ReadonlyArray<string>; readonly hours: WeekHours;
  readonly published: boolean; readonly showInSearch: boolean; readonly photos: number;
}
export interface BizState {
  readonly business: Business;
  readonly categories: ReadonlyArray<Category>;
  readonly services: ReadonlyArray<Service>;
  readonly staff: ReadonlyArray<Staff>;
  readonly appointments: ReadonlyArray<Appointment>;
  readonly areas: ReadonlyArray<Area>;
  readonly tables: ReadonlyArray<Table>;
  readonly reservations: ReadonlyArray<Reservation>;
  readonly online: OnlineRules;
  readonly setupHidden?: boolean;
}

/** Every change: one patch of the state, or a whole new state. */
export type BizAction = { readonly type: 'patch'; readonly patch: Partial<BizState> } | { readonly type: 'reset'; readonly state: BizState };
/** The reducer: patches merge, a reset replaces. */
export function bizReducer(state: BizState, action: BizAction): BizState {
  return action.type === 'reset' ? action.state : { ...state, ...action.patch };
}

/* ------------------------------------------------------------------ Small helpers */

let seq = 0;
/** A fresh id with a readable prefix. */
export const nextId = (prefix: string) => { seq += 1; return `${prefix}-${Date.now().toString(36)}-${seq}`; };
/** Midnight on the day `n` days after `d`. */
export const dayFrom = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** A date at `minutes` past midnight. */
export const at = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const dayKey = (d: Date) => HOURS_DAYS[(d.getDay() + 6) % 7] ?? 'mon';
export const first = (name: string) => name.split(' ')[0] ?? name;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "₹1,200" in the business's currency. */
export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
/** How a variant's price reads to a guest. */
export const priceText = (v: Variant) => (v.priceType === 'free' ? 'Free' : v.priceType === 'request' ? 'Price on request' : `${v.priceType === 'from' ? 'from ' : ''}${rupees(v.price)}`);
/** "45 min", "1 h 30 min". */
export const lengthText = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`);
const overlap = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
const within = (week: WeekHours, day: Date, start: number, end: number) => { const d = week[dayKey(day)]; return d.on && d.ranges.some((r) => r.start <= start && end <= r.end); };

/* ------------------------------------------------------------------ Services and staff */

export const serviceById = (s: BizState, id: string) => s.services.find((x) => x.id === id);
export const staffById = (s: BizState, id: string) => s.staff.find((x) => x.id === id);
export const variantOf = (svc: Service | undefined, id?: string) => svc?.variants.find((v) => v.id === id) ?? svc?.variants[0];
/** Whether this person does this service: both the service and the person have to say so. */
export const canDo = (person: Staff, svc: Service) => !person.archived && (svc.staff === 'all' || svc.staff.includes(person.id)) && (person.services === 'all' || person.services.includes(svc.id));
/** The people who do a service, in the team's order. */
export const doers = (s: BizState, svc: Service) => s.staff.filter((p) => canDo(p, svc));
/** Booked minutes that day, for "any professional". */
const bookedMinutes = (s: BizState, staffId: string, day: Date) => s.appointments.filter((a) => a.staffId === staffId && a.status !== 'cancelled' && sameDay(a.start, day)).reduce((t, a) => t + (a.end.getTime() - a.start.getTime()) / 60_000, 0);
/** Whether a person can take this time: working then (inside the business's hours too) and no other appointment, counting each one's clean-up time. */
export function staffFree(s: BizState, staffId: string, day: Date, start: number, end: number, skipId?: string): boolean {
  const person = staffById(s, staffId);
  if (!person || !within(person.week, day, start, end) || !within(s.business.hours, day, start, end)) return false;
  return !s.appointments.some((a) => a.id !== skipId && a.staffId === staffId && a.status !== 'cancelled' && sameDay(a.start, day)
    && overlap(start, end, minutesOf(a.start), minutesOf(a.end) + (serviceById(s, a.serviceId)?.bufferAfter ?? 0)));
}
/** "Any professional": whoever is free with the fewest booked minutes that day; ties go by the team's order. */
export function pickAny(s: BizState, svc: Service, day: Date, start: number, end: number): Staff | undefined {
  const free = doers(s, svc).filter((p) => staffFree(s, p.id, day, start, end + svc.bufferAfter));
  return [...free].sort((a, b) => bookedMinutes(s, a.id, day) - bookedMinutes(s, b.id, day) || s.staff.indexOf(a) - s.staff.indexOf(b))[0];
}
/** Open start times for a service on a day: every 15 minutes, with one person or anyone; never in the past or within the hour. */
export function serviceSlots(s: BizState, svc: Service, variant: Variant, staffId: string, day: Date, now: Date): ReadonlyArray<number> {
  const d = s.business.hours[dayKey(day)];
  if (!d.on || dayFrom(day, 0) < dayFrom(now, 0)) return [];
  const earliest = sameDay(day, now) ? minutesOf(now) + 60 : -1;
  const out: number[] = [];
  d.ranges.forEach((r) => {
    for (let m = r.start; m + variant.minutes <= r.end; m += 15) {
      if (m <= earliest) continue;
      const ok = staffId === 'any' ? pickAny(s, svc, day, m, m + variant.minutes) !== undefined : staffFree(s, staffId, day, m, m + variant.minutes + svc.bufferAfter);
      if (ok) out.push(m);
    }
  });
  return out;
}

/* ------------------------------------------------------------------ Tables */

const holding: ReadonlyArray<ReservationStatus> = ['booked', 'confirmed', 'seated'];
/** Tables already held for any part of this time. */
function heldTables(s: BizState, day: Date, start: number, end: number, skipId?: string): ReadonlySet<string> {
  const out = new Set<string>();
  s.reservations.forEach((r) => {
    if (r.id === skipId || !holding.includes(r.status) || !sameDay(r.start, day)) return;
    const r0 = minutesOf(r.start);
    if (overlap(start, end, r0, r0 + s.online.turn)) r.tables.forEach((t) => out.add(t));
  });
  return out;
}
/** The best fit for a party then: the smallest free table that seats them, else up to three joinable tables in one area. `onlineOnly` for guests. */
export function fitTables(s: BizState, party: number, day: Date, start: number, onlineOnly: boolean, skipId?: string): ReadonlyArray<Table> | undefined {
  const held = heldTables(s, day, start, start + s.online.turn, skipId);
  const free = s.tables.filter((t) => !held.has(t.id) && (!onlineOnly || t.online));
  const single = [...free].filter((t) => t.seats >= party).sort((a, b) => a.seats - b.seats)[0];
  if (single) return [single];
  let best: ReadonlyArray<Table> | undefined;
  s.areas.forEach((area) => {
    const pool = free.filter((t) => t.areaId === area.id && t.joinable);
    for (let i = 0; i < pool.length; i += 1) for (let j = i + 1; j < pool.length; j += 1) {
      const pair = [pool[i], pool[j]].filter((x): x is Table => x !== undefined);
      const seats2 = pair.reduce((t, x) => t + x.seats, 0);
      if (seats2 >= party && (!best || seats2 < best.reduce((t, x) => t + x.seats, 0))) best = pair;
      for (let k = j + 1; k < pool.length; k += 1) {
        const trio = [...pair, pool[k]].filter((x): x is Table => x !== undefined);
        const seats3 = trio.reduce((t, x) => t + x.seats, 0);
        if (seats3 >= party && (!best || seats3 < best.reduce((t, x) => t + x.seats, 0))) best = trio;
      }
    }
  });
  return best;
}
/** Covers (guests) starting in one slot. */
const coversAt = (s: BizState, day: Date, m: number) => s.reservations.filter((r) => holding.includes(r.status) && sameDay(r.start, day) && minutesOf(r.start) === m).reduce((t, r) => t + r.party, 0);
/** Times a guest can reserve for a party: the online rules (interval, lead time, window, party size, covers) and a table that fits. */
export function tableSlots(s: BizState, party: number, day: Date, now: Date): ReadonlyArray<number> {
  const o = s.online;
  const d = s.business.hours[dayKey(day)];
  const ahead = Math.round((dayFrom(day, 0).getTime() - dayFrom(now, 0).getTime()) / 86_400_000);
  if (!o.accept || !d.on || ahead < 0 || ahead > o.window || party < o.partyMin || party > o.partyMax) return [];
  const earliest = ahead === 0 ? minutesOf(now) + o.lead : -1;
  const out: number[] = [];
  d.ranges.forEach((r) => {
    for (let m = r.start; m + 60 <= r.end; m += o.interval) {
      if (m < earliest) continue;
      if (o.maxCovers > 0 && coversAt(s, day, m) + party > o.maxCovers) continue;
      if (fitTables(s, party, day, m, true)) out.push(m);
    }
  });
  return out;
}
/** The tables' names, joined: "T4 + T5". */
export const tableNames = (s: BizState, ids: ReadonlyArray<string>) => ids.map((id) => s.tables.find((t) => t.id === id)?.name ?? '?').join(' + ');

/* ------------------------------------------------------------------ Setup */

/** What the page still needs before it can go live, in order; empty when it can be published. */
export function pageProblems(s: BizState): ReadonlyArray<{ readonly id: string; readonly text: string }> {
  const out: Array<{ id: string; text: string }> = [];
  if (!s.business.name.trim()) out.push({ id: 'name', text: 'Add your business name.' });
  if (!s.business.address.trim()) out.push({ id: 'address', text: 'Add an address so guests can find you.' });
  if (!HOURS_DAYS.some((d) => s.business.hours[d].on)) out.push({ id: 'hours', text: 'Add your opening hours.' });
  if (s.business.kind === 'salon') {
    if (!s.services.some((x) => x.online && !x.archived)) out.push({ id: 'services', text: 'Put at least one service online.' });
    else if (!s.services.some((x) => x.online && !x.archived && doers(s, x).length > 0)) out.push({ id: 'staff', text: 'Give your online services someone who does them.' });
  } else if (!s.tables.some((t) => t.online)) out.push({ id: 'tables', text: 'Put at least one table online.' });
  return out;
}
