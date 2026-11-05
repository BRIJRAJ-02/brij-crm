// A reservation's guest emails (spec 0066 B7 lite; spec 0065 AC-6555), through the queue booking mail uses:
// `crm_enqueue_visit_mail` (migration 0184, crm_queue's) puts ids and a kind on Graphile's queue in the write's own
// transaction; the worker's `crm_visit_mail` task reads the visit again as the system (`prepareVisitMail`), and the
// api draws it with the booking email's layout and sends it with its calendar file. Kinds: `confirmed`, `changed`,
// `cancelled`, and the reminders 24 hours and 2 hours before (keyed per visit and replaced by a change, so an old one
// never fires; one that finds the visit no longer booked sends nothing).
//
// The manage link's token is never stored: like a booking's, it is an HMAC of the visit's id under the key the api and
// the worker share, so a reminder days later writes the same link. The visit keeps only its SHA-256.
import { createHash, createHmac } from 'node:crypto';
import { customRolePermissions, ROLE_PERMISSIONS, type Permission } from '@crm/contracts';
import { zoneDisplay } from '@crm/contracts/zones';
import { sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import type { BookingMail } from '../booking/mail.ts';
import { buildBookingIcs } from '../booking/ics.ts';
import type { ManageLinkKey } from '../booking/tokens.ts';

/** The kinds of reservation email. */
export const VISIT_MAIL_KINDS = ['confirmed', 'changed', 'cancelled', 'reminder_24h', 'reminder_2h'] as const;
/** One kind of reservation email. */
export type VisitMailKind = (typeof VISIT_MAIL_KINDS)[number];

/**
 * The link key's version a new visit's token is made under. The version is part of what the HMAC signs, so when the
 * link key is rotated, the next version signs new tokens while a lookup can still recompute an older visit's token
 * under its own version and key. Booking pages' tokens (`booking/tokens.ts`) are left as they are.
 */
export const VISIT_LINK_KEY_VERSION = 1;

/** A visit's manage token (32 URL safe characters) and the hash its row keeps, under link key version `version`. */
export function visitManageToken(
  key: ManageLinkKey,
  appointmentId: string,
  version: number = VISIT_LINK_KEY_VERSION,
): { readonly token: string; readonly hash: string } {
  const token = createHmac('sha256', key)
    .update(`visit-manage:v${String(version)}:${appointmentId}`)
    .digest('base64url')
    .slice(0, 32);
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/**
 * Queues `kinds` for a visit in the caller's transaction (its workspace setting), through crm_queue's definer: what
 * runs now runs now; a reminder whose time has passed is not queued; a reminder queued again replaces the old one.
 */
export async function queueVisitMail(
  tx: WorkspaceTx,
  appointmentId: string,
  kinds: readonly VisitMailKind[],
): Promise<void> {
  for (const kind of kinds) {
    await tx.execute(sql`select crm_enqueue_visit_mail(${appointmentId}::uuid, ${kind})`);
  }
}

/** Where the emails link and who sends the calendar file. */
export interface VisitMailDeps {
  readonly appOrigin: string;
  /** Where the reservation page is served (`BOOKING_PUBLIC_ORIGIN`, timefix.com): the manage link stays there. */
  readonly publicOrigin?: string;
  readonly linkKey: ManageLinkKey;
  readonly organizerEmail: string;
  readonly now?: () => Date;
}

/** One kind's email for its visit, or why nothing is sent. */
export interface PreparedVisitMail {
  readonly messages: readonly BookingMail[];
  readonly skipped?: string;
  /** When the visit was last written: the send's idempotency key with the visit and the kind. */
  readonly stamp?: number;
}

interface MailRow extends Record<string, unknown> {
  readonly id: string;
  readonly status: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly updated_at: string;
  readonly party_size: number;
  readonly client_name: string;
  readonly client_email: string | null;
  readonly lookup_code: string;
  readonly place_name: string;
  readonly address_line: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly phone: string | null;
  readonly time_zone: string;
  readonly public_key: string;
  readonly business: string | null;
  readonly source: string;
  readonly place_id: string;
  readonly party_note: string | null;
  readonly occasion: string | null;
  readonly client_phone: string | null;
  readonly slug: string;
}

/** "Monday 9 November, 6:00 PM, London time (GMT)". */
function whenLine(start: Date, zone: string): string {
  const at = DateTime.fromJSDate(start, { zone });
  return `${at.setLocale('en-GB').toFormat('cccc d LLLL')}, ${at.setLocale('en-US').toFormat('h:mm a')}, ${zoneDisplay(zone, start.getTime())}`;
}

/** The words of one kind (subject, heading and intro), for a business and a time. */
function wordsOf(kind: VisitMailKind, business: string, when: string, party: number) {
  const table = `a table for ${String(party)}`;
  switch (kind) {
    case 'confirmed':
      return {
        subject: `Your table at ${business} is booked`,
        heading: 'You’re booked',
        intro: `We’ve saved ${table} at ${business}. Show this code if anyone asks.`,
      };
    case 'changed':
      return {
        subject: `Your reservation at ${business} changed`,
        heading: 'Your reservation changed',
        intro: `It’s now ${table} on ${when}.`,
      };
    case 'cancelled':
      return {
        subject: `Your reservation at ${business} is cancelled`,
        heading: 'Reservation cancelled',
        intro: `Your reservation for ${table} on ${when} is cancelled. We hope to see you another time.`,
      };
    case 'reminder_24h':
      return {
        subject: `See you tomorrow at ${business}`,
        heading: 'See you tomorrow',
        intro: `A reminder of your reservation for ${table} at ${business}.`,
      };
    case 'reminder_2h':
      return {
        subject: `See you soon at ${business}`,
        heading: 'See you soon',
        intro: `Your table for ${String(party)} at ${business} is ready in about two hours.`,
      };
  }
}

/**
 * One kind's email for a visit, read as the system (the worker's scope): nothing for a visit without an email, a
 * reminder or change for a visit no longer booked, or a confirmation for one already cancelled.
 */
export async function prepareVisitMail(
  scope: EngineScope,
  deps: VisitMailDeps,
  input: { readonly appointmentId: string; readonly kind: VisitMailKind },
): Promise<PreparedVisitMail> {
  const [row] = (
    await inWorkspace(scope, (tx) =>
      tx.execute<MailRow>(sql`
        select a.id::text, a.status, a.starts_at, a.ends_at, a.updated_at, a.party_size, a.client_name, a.client_email,
          a.lookup_code, p.name as place_name, p.address_line, p.city, p.postcode, p.phone, p.time_zone, p.public_key,
          (select b.name from business_profiles b where b.workspace_id = a.workspace_id) as business,
          a.source, a.place_id::text, a.note as party_note, a.occasion, a.client_phone, w.slug
        from appointments a join places p on p.workspace_id = a.workspace_id and p.id = a.place_id
          join workspaces w on w.id = a.workspace_id
        where a.id = ${input.appointmentId}::uuid
      `),
    )
  ).rows;
  if (row === undefined) return { messages: [], skipped: 'gone' };
  if (row.client_email === null) return { messages: [], skipped: 'no email' };
  const live = row.status === 'booked' || row.status === 'confirmed';
  if (input.kind === 'cancelled' ? row.status !== 'cancelled' : !live) {
    return { messages: [], skipped: `status ${row.status}` };
  }
  const start = new Date(row.starts_at);
  const end = new Date(row.ends_at);
  const business = row.business ?? row.place_name;
  const when = whenLine(start, row.time_zone);
  const words = wordsOf(input.kind, business, when, row.party_size);
  const origin = deps.publicOrigin ?? deps.appOrigin;
  const { token } = visitManageToken(deps.linkKey, row.id);
  const manageUrl = `${origin}/r/${row.public_key}/manage#${token}`;
  const address = [row.address_line, row.city, row.postcode].filter((part) => part !== null).join(', ');
  const cancelled = input.kind === 'cancelled';
  const ics = buildBookingIcs({
    bookingId: row.id,
    uidDomain: new URL(deps.appOrigin).hostname,
    method: cancelled ? 'CANCEL' : 'REQUEST',
    start,
    end,
    summary: `Table for ${String(row.party_size)} at ${business}`,
    description: `Your reservation code is ${row.lookup_code}. Change or cancel: ${manageUrl}`,
    location: address === '' ? null : address,
    url: manageUrl,
    organizerEmail: deps.organizerEmail,
    organizerName: business,
    attendees: [{ name: row.client_name, email: row.client_email }],
    sequence: Math.floor(new Date(row.updated_at).getTime() / 1000),
    now: deps.now?.() ?? new Date(),
  });
  const mail: BookingMail = {
    to: row.client_email,
    subject: words.subject,
    preview: `${when} · ${String(row.party_size)} ${row.party_size === 1 ? 'guest' : 'guests'} · code ${row.lookup_code}`,
    heading: words.heading,
    intro: words.intro,
    rows: [
      { label: 'When', value: when },
      { label: 'Guests', value: String(row.party_size) },
      { label: 'Where', value: address === '' ? row.place_name : `${row.place_name}, ${address}` },
      { label: 'Reservation code', value: row.lookup_code },
      ...(row.phone === null ? [] : [{ label: 'Phone', value: row.phone }]),
    ],
    ...(cancelled ? {} : { button: { label: 'Change or cancel', url: manageUrl } }),
    ...(cancelled
      ? {}
      : { footnote: `Lost this email? Find your reservation with code ${row.lookup_code} and your email address.` }),
    why: `You made a reservation at ${business}.`,
    ics: { filename: 'reservation.ics', content: ics, method: cancelled ? 'CANCEL' : 'REQUEST' },
  };
  // A new online reservation also tells the staff who asked for it (the guest's own email goes first, so each
  // message's place in the list, and so its send key, stays the same on a retry).
  const staff =
    input.kind === 'confirmed' && row.source === 'online'
      ? await inWorkspace(scope, (tx) => alertRecipients(tx, row.place_id))
      : [];
  return {
    messages: [mail, ...staff.map((to) => staffMail(row, to, when, deps.appOrigin))],
    stamp: new Date(row.updated_at).getTime(),
  };
}

const OCCASIONS: Readonly<Record<string, string>> = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  date: 'Date night',
  business: 'Business',
  other: 'Occasion',
};

/**
 * The staff's email of a new online reservation: who, when, how many, and a button to the Reservations page on the
 * reservation's own place and day (`?date=`, the place's calendar date, and `?place=`).
 */
function staffMail(row: MailRow, to: string, when: string, appOrigin: string): BookingMail {
  const party = `${String(row.party_size)} ${row.party_size === 1 ? 'guest' : 'guests'}`;
  const day = DateTime.fromJSDate(new Date(row.starts_at), { zone: row.time_zone }).toISODate() ?? '';
  return {
    to,
    subject: `New reservation: ${row.client_name}, ${party}`,
    preview: `${when} · ${party} · ${row.place_name}`,
    heading: 'New reservation',
    intro: `${row.client_name} reserved a table for ${String(row.party_size)} at ${row.place_name}.`,
    rows: [
      { label: 'When', value: when },
      { label: 'Guests', value: String(row.party_size) },
      { label: 'Name', value: row.client_name },
      ...(row.client_phone === null ? [] : [{ label: 'Phone', value: row.client_phone }]),
      ...(row.occasion === null ? [] : [{ label: 'Occasion', value: OCCASIONS[row.occasion] ?? 'Occasion' }]),
      ...(row.party_note === null ? [] : [{ label: 'Note', value: row.party_note }]),
      { label: 'Reservation code', value: row.lookup_code },
    ],
    button: {
      label: 'Open reservations',
      url: `${appOrigin}/w/${encodeURIComponent(row.slug)}/reservations?${day === '' ? '' : `date=${day}&`}place=${row.place_id}`,
    },
    why: `You get this because new reservation emails are on for you at ${row.place_name}. Turn them off in Reservations, Online booking.`,
  };
}

/**
 * Who gets a new reservation email at a place: active members who can Run service (their role's permissions, a
 * custom role's kept to those it may hold) and whose choice for the place is on (no choice: on for the owner only).
 */
async function alertRecipients(tx: WorkspaceTx, placeId: string): Promise<readonly string[]> {
  const rows = (
    await tx.execute<{ email: string; role: string; custom: string[] | null; has_custom: boolean }>(sql`
      select m.email, m.role::text as role, cr.permissions as custom, m.custom_role_id is not null as has_custom
      from members m
      left join workspace_roles cr on cr.workspace_id = m.workspace_id and cr.id = m.custom_role_id
      left join reservation_alerts ra on ra.workspace_id = m.workspace_id and ra.place_id = ${placeId}::uuid
        and ra.member_id = m.id
      where m.status = 'active' and coalesce(ra.enabled, m.role = 'owner')
      order by m.id
    `)
  ).rows;
  const builtIn = ROLE_PERMISSIONS as Readonly<Record<string, readonly Permission[]>>;
  return rows
    .filter((row) =>
      row.has_custom
        ? row.role === 'member' &&
          row.custom !== null &&
          customRolePermissions(row.custom).includes('hospitality.service')
        : (builtIn[row.role] ?? []).includes('hospitality.service'),
    )
    .map((row) => row.email);
}
