// A workspace's businesses (spec 0065 H0, 0066 B1): each with its profile, places (hours, special days, details), its public page as a
// draft and a live copy, plus the staff who work there and their regular shifts at each place. Held beside the rest of Bookings' state.
import type { Hue } from '../Tag/Tag.tsx';
import type { WeekHours } from '../HoursEditor/HoursEditor.tsx';
import type { PhotoCropValue } from '../PhotoCrop/PhotoCrop.tsx';
import { HOST, TEAM, nextId, type BookingsState } from './state.ts';

/** A date a place keeps other hours: closed, or open for these minutes. */
export interface SpecialDay { readonly id: string; readonly date: string; readonly closed: boolean; readonly start: number; readonly end: number; readonly note: string }
/** One place a business works from. */
export interface Place {
  readonly id: string; readonly name: string; readonly address: string; readonly zone: string; readonly phone?: string;
  readonly hours: WeekHours; readonly specialDays: ReadonlyArray<SpecialDay>;
  /** Listed in search engines and Timefix's directory. */
  readonly listed: boolean;
}
/** What the public business page shows. Edited as a draft; guests see `live` until Publish. */
export interface BizPage { readonly gallery: ReadonlyArray<{ readonly id: string; readonly src: string; readonly caption: string; readonly crop?: PhotoCropValue }>; readonly about: string; readonly amenities: ReadonlyArray<string> }
/** A business: its profile, places and page. */
export interface Business {
  readonly id: string; readonly name: string; readonly kind: 'salon' | 'restaurant'; readonly kindLabel: string; readonly handle: string;
  readonly email: string; readonly website: string; readonly phone: string; readonly description: string; readonly currency: string; readonly zone: string;
  readonly places: ReadonlyArray<Place>; readonly page: { readonly draft: BizPage; readonly live?: BizPage };
}
/** A person who takes bookings. `member` links them to a workspace member's own availability. */
export interface Staff {
  readonly id: string; readonly name: string; readonly title: string; readonly colour: Hue; readonly bio: string; readonly photo?: string;
  readonly placeIds: ReadonlyArray<string>; readonly serviceIds: ReadonlyArray<string>; readonly member?: string; readonly archived?: boolean;
}
/** Everything about the businesses. Shifts are keyed "placeId|staffId". */
export interface BizState {
  readonly businesses: ReadonlyArray<Business>; readonly currentId: string; readonly staff: ReadonlyArray<Staff>;
  readonly shifts: Readonly<Record<string, WeekHours>>;
  /** Setup checklists put away in this browser. */
  readonly hidden?: ReadonlyArray<string>;
}

/** Amenities a business page can show. */
export const AMENITIES = ['Instant confirmation', 'Card payments', 'UPI', 'Wheelchair access', 'Parking', 'Wi-Fi', 'Air conditioned', 'Kid friendly', 'Pet friendly', 'Outdoor seating', 'Vegetarian options', 'Private dining'] as const;
/** Currencies a business can take. */
export const CURRENCIES = [{ id: 'INR', label: 'Indian rupee (₹)' }, { id: 'USD', label: 'US dollar ($)' }, { id: 'EUR', label: 'Euro (€)' }, { id: 'GBP', label: 'Pound (£)' }, { id: 'AED', label: 'UAE dirham' }] as const;
/** Time zones a place can keep. */
export const BIZ_ZONES = [{ id: 'Asia/Kolkata', label: 'India (IST)' }, { id: 'Asia/Dubai', label: 'Dubai (GST)' }, { id: 'Europe/London', label: 'London (GMT)' }, { id: 'Asia/Singapore', label: 'Singapore (SGT)' }, { id: 'America/New_York', label: 'New York (ET)' }] as const;
/** Staff colours, cycled for new people. */
export const STAFF_HUES: ReadonlyArray<Hue> = ['blue', 'purple', 'green', 'orange', 'sky', 'red', 'lime', 'yellow'];

const week = (from: number, to: number, off: ReadonlyArray<string> = []): WeekHours => Object.fromEntries((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).map((d) => [d, { on: !off.includes(d), ranges: [{ id: `${d}-${from}`, start: from * 60, end: to * 60 }] }])) as unknown as WeekHours;

/** The businesses as they stand: the held copy, or one made from the workspace's business profile the first time. */
export function bizOf(s: BookingsState): BizState {
  if (s.biz) return s.biz;
  const b = s.business;
  const kind = b?.kind ?? 'salon';
  const hours = s.savedHours.find((h) => h.id === s.defaultHoursId)?.hours ?? s.savedHours[0]?.hours ?? week(10, 19);
  const place: Place = { id: 'pl-1', name: b?.area ?? 'Main', address: b?.address ?? '', zone: 'Asia/Kolkata', phone: b?.phone, hours, specialDays: [{ id: 'sd-1', date: `${new Date().getFullYear()}-12-25`, closed: true, start: 600, end: 1080, note: 'Christmas' }], listed: true };
  const page: BizPage = { gallery: (b?.photos ?? []).map((src, i) => ({ id: `g-${i}`, src, caption: '' })), about: b?.about ?? '', amenities: b?.amenities ?? [] };
  const current: Business = {
    id: 'biz-1', name: s.workspace, kind, kindLabel: b?.kindLabel ?? 'Business', handle: b?.handle ?? 'business', email: `hello@${b?.handle ?? 'business'}.in`, website: `${b?.handle ?? 'business'}.in`,
    phone: b?.phone ?? '', description: b?.about ?? '', currency: 'INR', zone: 'Asia/Kolkata', places: [place], page: { draft: page, live: b?.published ? page : undefined },
  };
  const hosts = [...new Set(s.pages.filter((p) => p.kind === 'service').flatMap((p) => p.hosts))];
  const people = hosts.length ? hosts : kind === 'restaurant' ? [] : [HOST];
  const staff: Staff[] = people.map((name, i) => ({
    id: `st-${i + 1}`, name, title: b?.titles?.[name] ?? 'Stylist', colour: STAFF_HUES[i % STAFF_HUES.length] ?? 'blue', bio: '', placeIds: [place.id],
    serviceIds: s.pages.filter((p) => p.kind === 'service' && p.hosts.includes(name)).map((p) => p.id), member: TEAM.includes(name) ? name : undefined,
  }));
  const shifts = Object.fromEntries(staff.map((x) => [`${place.id}|${x.id}`, s.memberHours[x.name] ?? hours]));
  return { businesses: [current], currentId: current.id, staff, shifts };
}

/** The business being shown. */
export const currentBiz = (z: BizState): Business => z.businesses.find((b) => b.id === z.currentId) ?? (z.businesses[0] as Business);
/** A new empty business from the setup card. */
export function newBusiness(v: { readonly name: string; readonly kind: 'salon' | 'restaurant'; readonly address: string; readonly zone: string; readonly currency: string }, hours: WeekHours): Business {
  const handle = v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'business';
  return {
    id: nextId('biz'), name: v.name, kind: v.kind, kindLabel: v.kind === 'restaurant' ? 'Restaurant' : 'Salon', handle, email: '', website: '', phone: '', description: '', currency: v.currency, zone: v.zone,
    places: [{ id: nextId('pl'), name: 'Main', address: v.address, zone: v.zone, hours, specialDays: [], listed: true }], page: { draft: { gallery: [], about: '', amenities: [] } },
  };
}
/** What a draft page changes against the live one, in a few words each. */
export function pageDiff(b: Business): ReadonlyArray<string> {
  const d = b.page.draft; const l = b.page.live;
  if (!l) return ['Not published yet'];
  const out: string[] = [];
  if (d.about !== l.about) out.push('About');
  if (d.amenities.join() !== l.amenities.join()) out.push('Amenities');
  if (d.gallery.map((g) => g.id + g.caption).join() !== l.gallery.map((g) => g.id + g.caption).join()) out.push('Gallery');
  return out;
}
/** Why the page can't be published yet, with where to fix it. */
export function pageProblems(b: Business): ReadonlyArray<{ readonly id: string; readonly text: string }> {
  const out: { readonly id: string; readonly text: string }[] = [];
  if (!b.page.draft.about.trim()) out.push({ id: 'about', text: 'Add a few words about the business.' });
  if (b.page.draft.gallery.length === 0) out.push({ id: 'gallery', text: 'Add at least one photo.' });
  if (b.places.some((p) => !p.address.trim())) out.push({ id: 'address', text: 'Every place needs an address.' });
  return out;
}
