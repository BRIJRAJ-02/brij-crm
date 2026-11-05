// The guest's side of Table seating (spec 0066 B7 lite; spec 0065 AC-6550 to AC-6557), through the table door
// (`access/table-door.ts`): the page's facts, the offered times of a day, a reservation, and the manage page's view,
// change and cancel by the link's token or by the lookup code with the email. Nothing about another guest, a table
// or why a time isn't offered is ever in an answer: times are offered or not.
//
// Kept from checklabs' guest flow, with its faults fixed: the code a guest is shown is the one a lookup finds (theirs
// showed part of the id), a lookup needs the email too, the cutoffs hold on the server (theirs only hid a button), and
// a change re-plans under the place lock (theirs checked outside any transaction).
import { createHash } from 'node:crypto';
import {
  normalLookupCode,
  type ConsentPurpose,
  type PlaceHoursShape,
  type PublicReserveInput,
  type PublicTablePage,
  type PublicTableVisit,
} from '@crm/contracts';
import { sql } from 'drizzle-orm';
import type { TableEntry } from '../access/table-door.ts';
import { inWorkspace } from '../access/run.ts';
import { readMenuBrandIn, type PageBrand } from '../brand/public.ts';
import { guestMenuPathOf, menuLookPin, menuLookVersion } from '../hospitality/public-menu.ts';
import { buildBookingIcs } from '../booking/ics.ts';
import { refuse } from '../engine/refusals.ts';
import type { AfterWrite } from '../engine/write.ts';
import { placeDateOf } from '../hospitality/hours.ts';
import { offerVisitTimes, placeVisit, type BookedVisit, type VisitDeps } from './book.ts';
import { cancelVisit, moveVisit } from './move.ts';
import { guestPartyRange, placeTables, readTableService } from './table-service.ts';

/** At most this many upcoming reservations per email per place (0065's limits). */
export const UPCOMING_PER_EMAIL = 3;

/** The wording a guest ticks for news and offers, stored with the consent (version 1). */
export const MARKETING_WORDING = (business: string): string => `Send me news and offers from ${business}.`;

/** Who the guest is on the manage page: the link's token, or the lookup code with the email. */
export type GuestKey = { readonly token: string } | { readonly code: string; readonly email: string };

/** The one refusal for a guest over the upcoming limit: it says nothing about which reservations exist. */
export const UPCOMING_REFUSED = (phone: string | null): string =>
  phone === null
    ? 'We couldn’t take this reservation online. Please call the restaurant.'
    : `We couldn’t take this reservation online. Please call ${phone}.`;

const CLOSED = (): Error => refuse('BOOKING_CLOSED', 'This place isn’t taking reservations online right now.');
const NO_VISIT = (): Error =>
  refuse('NOT_FOUND', 'We couldn’t find that reservation. Check the code and the email you booked with.');

interface PlaceRow extends Record<string, unknown> {
  readonly name: string;
  readonly address_line: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly phone: string | null;
  readonly time_zone: string;
  readonly hours: PlaceHoursShape;
  readonly business: string | null;
}

async function placeOf(entry: TableEntry) {
  return inWorkspace(entry.scope, async (tx) => {
    const [place] = (
      await tx.execute<PlaceRow>(sql`
        select p.name, p.address_line, p.city, p.postcode, p.phone, p.time_zone, p.hours,
          (select b.name from business_profiles b where b.workspace_id = p.workspace_id) as business
        from places p where p.id = ${entry.placeId}::uuid
      `)
    ).rows;
    if (place === undefined) throw refuse('NOT_FOUND', 'This page is no longer available.');
    const service = await readTableService(tx, entry.placeId);
    const parties =
      service === undefined ? undefined : guestPartyRange(await placeTables(tx, entry.placeId), service.rules);
    return { place, service, parties };
  });
}

/**
 * What the reservation page wears and offers beyond the place's facts (5 November 2026, after checklabs): the guest
 * look's version (the menu's look stylesheet with the workspace's accent), the areas a guest may ask to sit in (only
 * those holding a table taken online, in the floor's order), and the place's guest menu while one is published and
 * shown. Read in the place's own workspace, names and a path only.
 */
async function guestExtrasOf(entry: TableEntry): Promise<{
  readonly brand: PageBrand;
  readonly areas: readonly string[];
  readonly menuPath: string | undefined;
}> {
  const workspaceId = entry.scope.workspaceId;
  return inWorkspace(entry.scope, async (tx) => {
    const brand = await readMenuBrandIn(tx, workspaceId);
    const areas = (
      await tx.execute<{ name: string }>(sql`
        select a.name from areas a
        where a.place_id = ${entry.placeId}::uuid
          and exists (
            select 1 from resources r
            where r.workspace_id = a.workspace_id and r.area_id = a.id and r.kind = 'table'
              and r.archived_at is null and r.online
          )
        order by a.position, a.name
      `)
    ).rows.map((row) => row.name);
    const menuPath = await guestMenuPathOf(tx, workspaceId, entry.placeId);
    return { brand, areas, menuPath };
  });
}

/** The side the look pins the page to, as the answer says it: nothing while it follows the visitor. */
function pinnedScheme(brand: PageBrand): { readonly scheme?: 'light' | 'dark' } {
  const pin = menuLookPin(brand);
  return pin === undefined ? {} : { scheme: pin };
}

/** The reservation page's look (the guest look saved on the Design page), for its stylesheet route. */
export async function readTableLook(
  entry: TableEntry,
): Promise<{ readonly brand: PageBrand; readonly version: string }> {
  // The brand alone: a stylesheet's read never reads the areas or the menu.
  const brand = await inWorkspace(entry.scope, (tx) => readMenuBrandIn(tx, entry.scope.workspaceId));
  return { brand, version: menuLookVersion(brand) };
}

/** The reservation page's facts (AC-6550): the place, whether it takes reservations now, the party range, the days. */
export async function readTablePage(
  entry: TableEntry,
  deps: { readonly now?: () => Date } = {},
): Promise<PublicTablePage> {
  const { place, service, parties } = await placeOf(entry);
  const extras = await guestExtrasOf(entry);
  const now = deps.now?.() ?? new Date();
  const rules = service?.rules;
  return {
    key: entry.key,
    business: { name: place.business ?? place.name },
    place: {
      name: place.name,
      ...(place.address_line === null ? {} : { addressLine: place.address_line }),
      ...(place.city === null ? {} : { city: place.city }),
      ...(place.postcode === null ? {} : { postcode: place.postcode }),
      ...(place.phone === null ? {} : { phone: place.phone }),
      timeZone: place.time_zone,
    },
    taking: entry.installed && rules?.online === true,
    partyMin: parties?.min ?? rules?.partyMin ?? 1,
    partyMax: parties?.max ?? rules?.partyMax ?? 8,
    windowDays: rules?.windowDays ?? 60,
    cancelCutoffMinutes: rules?.cancelCutoffMinutes ?? 120,
    changeCutoffMinutes: rules?.changeCutoffMinutes ?? 120,
    hours: { weekly: place.hours.weekly, exceptions: place.hours.exceptions } as PublicTablePage['hours'],
    today: placeDateOf(now.getTime(), place.time_zone),
    // The areas only while the page takes reservations: an old link to a closed page never reads them.
    ...(extras.areas.length === 0 || !(entry.installed && rules?.online === true) ? {} : { areas: extras.areas }),
    ...(extras.menuPath === undefined ? {} : { menuPath: extras.menuPath }),
    look: menuLookVersion(extras.brand),
    ...pinnedScheme(extras.brand),
  };
}

/** The table service a guest may reserve now, or BOOKING_CLOSED. */
async function takingService(entry: TableEntry) {
  if (!entry.installed) throw CLOSED();
  const { place, service } = await placeOf(entry);
  if (service?.rules.online !== true) throw CLOSED();
  return { place, service };
}

/** The offered starts of one place date for a party (AC-6551): the guest's notice, window and party range apply. */
export async function guestTimes(
  entry: TableEntry,
  deps: VisitDeps,
  query: { readonly party: number; readonly date: string },
): Promise<readonly string[]> {
  const { service } = await takingService(entry);
  const offered = await offerVisitTimes(entry.scope, deps, {
    placeId: entry.placeId,
    items: [{ serviceId: service.serviceId, variantId: service.variantId }],
    party: query.party,
    date: query.date,
    online: true,
  });
  return offered.map((each) => each.start);
}

/** A reservation's guest view, from its row and its service's cutoffs. */
function viewOf(
  row: VisitRow,
  rules: { readonly changeCutoffMinutes: number; readonly cancelCutoffMinutes: number } | undefined,
  now: Date,
): PublicTableVisit {
  const start = new Date(row.starts_at);
  const open = row.status === 'booked' || row.status === 'confirmed';
  const until = (minutes: number) => {
    const at = new Date(start.getTime() - minutes * 60_000);
    return open && at.getTime() > now.getTime() ? at.toISOString() : undefined;
  };
  const changeUntil = until(rules?.changeCutoffMinutes ?? 120);
  const cancelUntil = until(rules?.cancelCutoffMinutes ?? 120);
  return {
    lookupCode: row.lookup_code,
    status: row.status,
    start: start.toISOString(),
    end: new Date(row.ends_at).toISOString(),
    party: row.party_size,
    name: row.client_name,
    ...(row.occasion === null ? {} : { occasion: row.occasion as NonNullable<PublicTableVisit['occasion']> }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(changeUntil === undefined ? {} : { changeUntil }),
    ...(cancelUntil === undefined ? {} : { cancelUntil }),
  };
}

interface VisitRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: PublicTableVisit['status'];
  readonly starts_at: string;
  readonly ends_at: string;
  readonly party_size: number;
  readonly client_name: string;
  readonly client_email: string | null;
  readonly occasion: string | null;
  readonly note: string | null;
  readonly lookup_code: string;
}

/** The SHA-256 of a manage token, as the visit keeps it. */
const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** The guest's visit at the entry's place, by token or by code with email; NOT_FOUND for anything else. */
async function findVisit(entry: TableEntry, guest: GuestKey): Promise<VisitRow> {
  let match;
  if ('token' in guest) {
    if (!/^[A-Za-z0-9_-]{32}$/.test(guest.token)) throw NO_VISIT();
    match = sql`a.manage_token_hash = ${tokenHash(guest.token)}`;
  } else {
    const code = normalLookupCode(guest.code);
    const email = guest.email.trim().toLowerCase();
    if (code === undefined || email === '') throw NO_VISIT();
    match = sql`a.lookup_code = ${code} and lower(a.client_email) = ${email}`;
  }
  const [row] = (
    await inWorkspace(entry.scope, (tx) =>
      tx.execute<VisitRow>(sql`
        select a.id::text, a.status, a.starts_at, a.ends_at, a.party_size, a.client_name, a.client_email, a.occasion,
          a.note, a.lookup_code
        from appointments a
        where a.place_id = ${entry.placeId}::uuid and ${match}
          and not exists (
            select 1 from appointment_items ti join services ts on ts.workspace_id = ti.workspace_id and ts.id = ti.service_id
            where ti.workspace_id = a.workspace_id and ti.appointment_id = a.id
              and not (ts.capacity_mode = 'party' and ts.staff_rule = 'none')
          )
        limit 1
      `),
    )
  ).rows;
  if (row === undefined) throw NO_VISIT();
  return row;
}

/** The guest's reservation (the manage page). */
export async function guestVisit(
  entry: TableEntry,
  guest: GuestKey,
  deps: { readonly now?: () => Date } = {},
): Promise<PublicTableVisit> {
  const row = await findVisit(entry, guest);
  const { service } = await placeOf(entry);
  return viewOf(row, service?.rules, deps.now?.() ?? new Date());
}

/** A reservation made: the guest's view, the manage token (once), and what the mail needs. */
export interface GuestReserved {
  readonly visit: PublicTableVisit;
  readonly manageToken?: string;
  readonly booked: BookedVisit;
}

/**
 * Reserves a table (AC-6551, AC-6553): Table seating installed and published, at most 3 upcoming reservations per
 * email at the place, then the engine's booking (idempotency, place lock, recheck, SLOT_TAKEN with the next times).
 * A ticked marketing box is kept as a consent on the guest's Person (spec 0023 records, source `appointment`).
 */
export async function guestReserve(
  entry: TableEntry,
  deps: VisitDeps,
  input: PublicReserveInput,
  hooks: readonly AfterWrite[] = [],
): Promise<GuestReserved> {
  const { place, service } = await takingService(entry);
  const now = deps.now?.() ?? new Date();
  // The upcoming limit refuses as generically as it can (the security review, 4 Nov 2026): the page never says
  // whether an email already has reservations here, and the refusal sends nothing. It is counted again under the
  // place lock in `placeVisit`, so parallel attempts can't slip past this first count.
  const refusal = UPCOMING_REFUSED(place.phone);
  const upcoming = await inWorkspace(entry.scope, (tx) =>
    tx.execute<{ n: number }>(sql`
      select count(*)::int as n from appointments
      where place_id = ${entry.placeId}::uuid and lower(client_email) = ${input.email}
        and status in ('booked', 'confirmed') and starts_at > ${now.toISOString()}::timestamptz
        and idempotency_key <> ${input.idempotencyKey}::uuid
    `),
  );
  if ((upcoming.rows[0]?.n ?? 0) >= UPCOMING_PER_EMAIL) throw refuse('CONFLICT', refusal);
  const business = place.business ?? place.name;
  const booked = await placeVisit(
    entry.scope,
    deps,
    {
      placeId: entry.placeId,
      items: [{ serviceId: service.serviceId, variantId: service.variantId }],
      party: input.party,
      start: input.start,
      client: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.occasion === undefined ? {} : { occasion: input.occasion }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      },
      ...(input.marketing
        ? { consent: { purpose: 'marketing_email' satisfies ConsentPurpose, wording: MARKETING_WORDING(business) } }
        : {}),
      perEmail: { max: UPCOMING_PER_EMAIL, message: refusal },
      source: 'online',
      idempotencyKey: input.idempotencyKey,
    },
    hooks,
  );
  const row = await findVisitById(entry, booked.appointmentId);
  return {
    visit: viewOf(row, service.rules, now),
    ...(booked.manageToken === undefined ? {} : { manageToken: booked.manageToken }),
    booked,
  };
}

async function findVisitById(entry: TableEntry, id: string): Promise<VisitRow> {
  const [row] = (
    await inWorkspace(entry.scope, (tx) =>
      tx.execute<VisitRow>(sql`
        select id::text, status, starts_at, ends_at, party_size, client_name, client_email, occasion, note, lookup_code
        from appointments where id = ${id}::uuid and place_id = ${entry.placeId}::uuid
      `),
    )
  ).rows;
  if (row === undefined) throw NO_VISIT();
  return row;
}

/** The words for a passed cutoff, with the place's phone. */
function tooLate(which: 'change' | 'cancel', phone: string | null): string {
  const call = phone === null ? 'Call the restaurant.' : `Call ${phone}.`;
  return which === 'change'
    ? `It’s too late to change this reservation online. ${call}`
    : `It’s too late to cancel this reservation online. ${call}`;
}

/** Whether a cutoff has passed for the visit: refused with the place's phone when it has. */
function checkCutoff(view: PublicTableVisit, which: 'change' | 'cancel', phone: string | null): void {
  const until = which === 'change' ? view.changeUntil : view.cancelUntil;
  if (until !== undefined) return;
  throw refuse('BOOKING_CLOSED', tooLate(which, phone));
}

/**
 * A guest's change of time and party (AC-6555): only before the change cutoff and while Table seating takes
 * reservations, re-planned under the place lock (SLOT_TAKEN with the next times when the new one doesn't hold).
 */
export async function guestChange(
  entry: TableEntry,
  deps: VisitDeps,
  input: { readonly guest: GuestKey; readonly start: string; readonly party?: number | undefined },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly visit: PublicTableVisit; readonly appointmentId: string; readonly email?: string }> {
  const { place, service } = await takingService(entry);
  const row = await findVisit(entry, input.guest);
  const now = deps.now?.() ?? new Date();
  checkCutoff(viewOf(row, service.rules, now), 'change', place.phone);
  await moveVisit(
    entry.scope,
    deps,
    {
      appointmentId: row.id,
      start: input.start,
      ...(input.party === undefined ? {} : { party: input.party }),
      online: true,
      // Checked again against the locked row, so a change racing another can't slip past the cutoff.
      cutoff: { minutes: service.rules.changeCutoffMinutes, message: tooLate('change', place.phone) },
    },
    hooks,
  );
  const after = await findVisitById(entry, row.id);
  return {
    visit: viewOf(after, service.rules, now),
    appointmentId: row.id,
    ...(row.client_email === null ? {} : { email: row.client_email }),
  };
}

/** A guest's cancel (AC-6555): only before the cancel cutoff. A repeat answers the cancelled reservation. */
export async function guestCancel(
  entry: TableEntry,
  deps: { readonly now?: () => Date; readonly slotCache?: VisitDeps['slotCache'] },
  input: { readonly guest: GuestKey; readonly reason?: string | undefined },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly visit: PublicTableVisit; readonly appointmentId: string; readonly cancelled: boolean }> {
  const row = await findVisit(entry, input.guest);
  const { place, service } = await placeOf(entry);
  const now = deps.now?.() ?? new Date();
  if (row.status !== 'cancelled') checkCutoff(viewOf(row, service?.rules, now), 'cancel', place.phone);
  const done = await cancelVisit(
    entry.scope,
    deps,
    {
      appointmentId: row.id,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
      cutoff: {
        minutes: service?.rules.cancelCutoffMinutes ?? 120,
        message: tooLate('cancel', place.phone),
      },
    },
    hooks,
  );
  const after = await findVisitById(entry, row.id);
  return { visit: viewOf(after, service?.rules, now), appointmentId: row.id, cancelled: done.cancelled };
}

/** The reservation as a calendar file (Add to calendar), CANCEL once cancelled. */
export async function guestIcs(
  entry: TableEntry,
  guest: GuestKey,
  origin: { readonly uidDomain: string; readonly pageUrl: string; readonly organizerEmail: string },
  deps: { readonly now?: () => Date } = {},
): Promise<string> {
  const row = await findVisit(entry, guest);
  const { place } = await placeOf(entry);
  const business = place.business ?? place.name;
  const address = [place.address_line, place.city, place.postcode].filter((part) => part !== null).join(', ');
  return buildBookingIcs({
    bookingId: row.id,
    uidDomain: origin.uidDomain,
    method: row.status === 'cancelled' ? 'CANCEL' : 'REQUEST',
    start: new Date(row.starts_at),
    end: new Date(row.ends_at),
    summary: `Table for ${String(row.party_size)} at ${business}`,
    description: `Your reservation code is ${row.lookup_code}. Change or cancel: ${origin.pageUrl}`,
    location: address === '' ? null : address,
    url: origin.pageUrl,
    organizerEmail: origin.organizerEmail,
    organizerName: business,
    attendees: row.client_email === null ? [] : [{ name: row.client_name, email: row.client_email }],
    sequence: Math.floor((deps.now?.() ?? new Date()).getTime() / 1000),
    now: deps.now?.() ?? new Date(),
  });
}
