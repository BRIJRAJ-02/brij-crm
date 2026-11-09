// Table seating (spec 0066 B7 lite; spec 0065 AC-6550 to AC-6565): the guest's reservation page at
// timefix.com/r/<key> (public, no session) and the staff's setup, Service list and status moves (the RPC contract).
// One schema per shape, the type beside it under the same name.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { hasControl } from './booking/public.ts';
import { Area, Place, PlaceHours, PropertyScoped, Resource } from './hospitality.ts';
import { Timestamp } from './values/attribute-values.ts';
import { Uuid } from './values/ids.ts';
import { APPOINTMENT_STATUSES, LOOKUP_PATTERN, VISIT_LIMITS } from './visits-model.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** A place date on its own wall clock, `YYYY-MM-DD`. */
export const PlaceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a day.');
/** A place date. */
export type PlaceDate = z.infer<typeof PlaceDate>;

/** A party size as a guest or the desk asks for it. */
export const PartySize = z
  .number()
  .int('Choose a whole number of guests.')
  .min(VISIT_LIMITS.partyMin, 'Choose at least 1 guest.')
  .max(VISIT_LIMITS.partyMax, 'Choose at most 100 guests.');
/** A party size. */
export type PartySize = z.infer<typeof PartySize>;

/** The occasions a guest may mark (0065 AC-6551; the competitor pass adds date night). */
export const TABLE_OCCASIONS = ['birthday', 'anniversary', 'date', 'business', 'other'] as const;
/** One occasion. */
export const TableOccasion = z.enum(TABLE_OCCASIONS, { error: 'Pick an occasion.' });
/** One occasion. */
export type TableOccasion = z.infer<typeof TableOccasion>;

/** A visit status on the wire. */
export const VisitStatus = z.enum(APPOINTMENT_STATUSES);
/** A visit status. */
export type VisitStatus = z.infer<typeof VisitStatus>;

/** The reservation rules a guest's flow reads, and the setup screen edits (0065 AC-6550). */
export const TableRules = z.object({
  minutes: z.number().int(),
  holds: z
    .array(z.object({ size: z.number().int(), minutes: z.number().int() }))
    .max(VISIT_LIMITS.holdSizes)
    .readonly(),
  partyMin: z.number().int(),
  partyMax: z.number().int(),
  stepMinutes: z.number().int(),
  noticeMinutes: z.number().int(),
  windowDays: z.number().int(),
  coversCap: z.number().int().optional(),
  changeCutoffMinutes: z.number().int(),
  cancelCutoffMinutes: z.number().int(),
  online: z.boolean(),
});
/** The reservation rules. */
export type TableRules = z.infer<typeof TableRules>;

// ---- The guest's page (public) ----

/** A reservation page's facts: the place, whether it takes reservations now, the party range and the days. */
export const PublicTablePage = z.object({
  key: z.string(),
  business: z.object({ name: z.string() }),
  place: z.object({
    name: z.string(),
    addressLine: z.string().optional(),
    city: z.string().optional(),
    postcode: z.string().optional(),
    phone: z.string().optional(),
    timeZone: z.string(),
  }),
  /** False while Table seating is off or its setup isn't published: the page says so and offers the phone. */
  taking: z.boolean(),
  partyMin: z.number().int(),
  partyMax: z.number().int(),
  windowDays: z.number().int(),
  cancelCutoffMinutes: z.number().int(),
  changeCutoffMinutes: z.number().int(),
  hours: PlaceHours,
  /** Today on the place's wall clock. */
  today: PlaceDate,
  /**
   * The place's areas a guest may ask to sit in (Inside, Terrace), in the floor's order: the page offers them as a
   * seating preference. Absent or empty, no seating choice.
   */
  areas: z.array(z.string()).readonly().optional(),
  /** The place's guest menu on our own host (`/m/<menu key>`), while one is published and shown. */
  menuPath: z.string().optional(),
  /**
   * The version of the guest look the page wears (the menu's look stylesheet, the brand's accent in it), served at
   * `/api/public/tables/<key>/look.css?v=<look>`. Absent, the page wears the look's token fallbacks.
   */
  look: z.string().optional(),
  /** Which side the look pins the page to; absent, it follows the visitor. */
  scheme: z.enum(['light', 'dark']).optional(),
});
/** A reservation page's facts. */
export type PublicTablePage = z.infer<typeof PublicTablePage>;

/** The times query: a party on one place date. */
export const PublicTableTimesQuery = z.object({
  party: z.coerce.number().pipe(PartySize),
  date: PlaceDate,
});
/** The times query. */
export type PublicTableTimesQuery = z.infer<typeof PublicTableTimesQuery>;

/** The offered starts of a day, ISO instants in order. */
export const PublicTableTimes = z.object({ date: PlaceDate, times: z.array(Timestamp) });
/** The offered starts of a day. */
export type PublicTableTimes = z.infer<typeof PublicTableTimes>;

const GuestName = z
  .string()
  .trim()
  .min(1, 'Give your name.')
  .max(VISIT_LIMITS.clientNameMax, 'Use 120 characters or fewer.')
  .refine((name) => !hasControl(name), 'Give your name as plain text.');
const GuestEmail = z.email({ error: 'Give an email address like name@example.com.' }).trim().toLowerCase().max(254);
const GuestPhone = z
  .string()
  .trim()
  .min(5, 'Give a phone number we can call.')
  .max(VISIT_LIMITS.clientPhoneMax)
  .refine((phone) => !hasControl(phone), 'Give a phone number we can call.');
const GuestNote = z
  .string()
  .trim()
  .max(VISIT_LIMITS.noteMax, 'Use 500 characters or fewer.')
  // Lines and tabs are a note's own; nothing else that doesn't print.
  .refine((note) => !hasControl(note.replace(/[\n\r\t]/g, '')), 'Write your note as plain text.');

/** A guest's reservation (0065 AC-6551): the party, the time, who they are, and the bot checks' fields. */
export const PublicReserveInput = z.object({
  idempotencyKey: Uuid,
  party: PartySize,
  start: Timestamp,
  name: GuestName,
  email: GuestEmail,
  phone: GuestPhone,
  note: GuestNote.optional(),
  occasion: TableOccasion.optional(),
  /**
   * News and offers from the business: unticked by default, separate from the reservation. A tick is a request the
   * guest confirms from an email (double opt-in, migration 0202); it is a consent only once they do.
   */
  marketing: z.boolean().default(false),
  timeZone: z.string().max(64).optional(),
  company_url: z.string().max(200).optional(),
  /** The fill ticket the page fetched (spec 0023, B-04): the server's clock for the minimum fill time. */
  ticket: z.string().max(200).optional(),
  startedAt: z.number().int().nonnegative().optional(),
});
/** A guest's reservation. */
export type PublicReserveInput = z.infer<typeof PublicReserveInput>;

/** A reservation as its guest sees it: never another guest, a table or why a time isn't offered. */
export const PublicTableVisit = z.object({
  lookupCode: z.string(),
  status: VisitStatus,
  start: Timestamp,
  end: Timestamp,
  party: z.number().int(),
  name: z.string(),
  occasion: TableOccasion.optional(),
  note: z.string().optional(),
  /** Until when the guest may change or cancel it here; absent once it can't be. */
  changeUntil: Timestamp.optional(),
  cancelUntil: Timestamp.optional(),
});
/** A reservation as its guest sees it. */
export type PublicTableVisit = z.infer<typeof PublicTableVisit>;

/** The answer to a reservation: the visit, and the manage link's token (shown once, kept by the page). */
export const PublicReserved = z.object({ visit: PublicTableVisit, manageToken: z.string().optional() });
/** The answer to a reservation. */
export type PublicReserved = z.infer<typeof PublicReserved>;

/** A lookup code as typed: any case, spaces and dashes allowed. */
export const LookupCode = z
  .string()
  .trim()
  .transform((typed) => typed.replace(/[\s-]/g, '').toUpperCase())
  .pipe(z.string().regex(LOOKUP_PATTERN, 'Use the 8 letters and numbers from your confirmation.'));

/** Finding a reservation without the link: the code from the confirmation and the email it was made with. */
export const PublicTableLookupInput = z.object({ code: LookupCode, email: GuestEmail });
/** Finding a reservation by code and email. */
export type PublicTableLookupInput = z.infer<typeof PublicTableLookupInput>;

/** Who the guest is on the manage page: the link's token, or the code with the email. */
export const GuestKey = z.union([
  z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{32}$/, 'This link doesn’t open a reservation.') }),
  PublicTableLookupInput,
]);
/** Who the guest is. */
export type GuestKey = z.infer<typeof GuestKey>;

/** A guest's change: a new time, a new party size, or both. */
export const PublicTableChangeInput = z.object({ guest: GuestKey, start: Timestamp, party: PartySize.optional() });
/** A guest's change. */
export type PublicTableChangeInput = z.infer<typeof PublicTableChangeInput>;

/** A guest's cancel, with an optional reason. */
export const PublicTableCancelInput = z.object({
  guest: GuestKey,
  reason: z.string().trim().max(VISIT_LIMITS.cancelReasonMax).optional(),
});
/** A guest's cancel. */
export type PublicTableCancelInput = z.infer<typeof PublicTableCancelInput>;

/** A news and offers confirm (migration 0202): the signed token from the email's link, sent in the body. */
export const PublicNewsConfirmInput = z.object({ token: z.string().min(1).max(1024) });
/** A news and offers confirm. */
export type PublicNewsConfirmInput = z.infer<typeof PublicNewsConfirmInput>;

/** What a news confirm came to: saved now, or saved before (the link pressed again). */
export const PublicNewsConfirmed = z.object({ status: z.enum(['confirmed', 'already']) });
/** What a news confirm came to. */
export type PublicNewsConfirmed = z.infer<typeof PublicNewsConfirmed>;

// ---- The staff's side (RPC) ----

/** One step of the setup checklist, with its one line fix. */
export const TableSetupStep = z.object({
  step: z.enum(['hours', 'tables', 'rules']),
  done: z.boolean(),
  fix: z.string().optional(),
});
/** One setup step. */
export type TableSetupStep = z.infer<typeof TableSetupStep>;

/** A place's Table setup: the rules (defaults until saved), the checklist, and whether guests can reserve now. */
export const TableSetupView = z.object({
  placeId: Uuid,
  serviceId: Uuid.optional(),
  rules: TableRules,
  saved: z.boolean(),
  steps: z.array(TableSetupStep).readonly(),
  ready: z.boolean(),
  /** The guest page's address key (the place's public key). */
  publicKey: z.string(),
  /** Whether the member reading it gets an email for each new online reservation here (the owner's default is on). */
  notifyMe: z.boolean(),
});
/** A place's Table setup. */
export type TableSetupView = z.infer<typeof TableSetupView>;

/** One place's input. */
export const TablePlaceInput = WorkspaceScoped.extend({ placeId: Uuid });
/** One place's input. */
export type TablePlaceInput = z.infer<typeof TablePlaceInput>;

/** A place as the Reservations page draws it, and no more: its name, its zone and the hours its calendar opens at. */
export const TablePlace = Place.pick({ id: true, name: true, timeZone: true, hours: true });
/** A place as the Reservations page draws it. */
export type TablePlace = z.infer<typeof TablePlace>;

/**
 * The places those who run the floor can pick between, in the business's order: the chosen business's (spec 0065
 * H7). `elsewhere` names the workspace's other businesses' places, ids only, so a link to one (`?place=`) opens the
 * business it belongs to (AC-6517).
 */
export const ServicePlaces = z.object({
  places: z.array(TablePlace),
  elsewhere: z.array(z.object({ id: Uuid, property: Uuid })).optional(),
});
/** The places those who run the floor can pick between. */
export type ServicePlaces = z.infer<typeof ServicePlaces>;

/** A live table as the Reservations page draws it: none of the setup on it (online, joins, order). */
export const ServiceTable = Resource.pick({
  id: true,
  label: true,
  areaId: true,
  minCapacity: true,
  maxCapacity: true,
});
/** A live table as the Reservations page draws it. */
export type ServiceTable = z.infer<typeof ServiceTable>;

/** A place's areas and live tables, as the Reservations page draws them. */
export const ServiceFloor = z.object({ placeId: Uuid, areas: z.array(Area), resources: z.array(ServiceTable) });
/** A place's areas and live tables, as the Reservations page draws them. */
export type ServiceFloor = z.infer<typeof ServiceFloor>;

/** Saving the rules; `online: true` is Publish, refused with the one line fix while a step isn't done. */
export const SaveTableSetupInput = WorkspaceScoped.extend({ placeId: Uuid, rules: TableRules, mutationId: Uuid });
/** Saving the rules. */
export type SaveTableSetupInput = z.infer<typeof SaveTableSetupInput>;

/** One reservation on the Service list and floor. */
export const ServiceVisit = z.object({
  id: Uuid,
  start: Timestamp,
  end: Timestamp,
  name: z.string(),
  party: z.number().int(),
  status: VisitStatus,
  resourceIds: z.array(Uuid).readonly(),
  note: z.string().optional(),
  occasion: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  lookupCode: z.string(),
  seatedAt: Timestamp.optional(),
  source: z.string(),
});
/** One reservation on the Service list. */
export type ServiceVisit = z.infer<typeof ServiceVisit>;

/** A place's day. */
export const ServiceDayView = z.object({
  date: PlaceDate,
  zone: z.string(),
  visits: z.array(ServiceVisit).readonly(),
  covers: z.object({ booked: z.number().int(), seated: z.number().int(), toCome: z.number().int() }),
  truncated: z.boolean(),
});
/** A place's day. */
export type ServiceDayView = z.infer<typeof ServiceDayView>;

/** A place's day input. */
export const ServiceDayInput = WorkspaceScoped.extend({ placeId: Uuid, date: PlaceDate });
/** A place's day input. */
export type ServiceDayInput = z.infer<typeof ServiceDayInput>;

/** A status move (seat, finish, no show, cancel, or Undo back). */
export const SetVisitStatusInput = WorkspaceScoped.extend({
  appointmentId: Uuid,
  status: VisitStatus,
  mutationId: Uuid,
});
/** A status move. */
export type SetVisitStatusInput = z.infer<typeof SetVisitStatusInput>;

/** A status move's answer. */
export const VisitStatusMoved = z.object({ id: Uuid, status: VisitStatus });
/** A status move's answer. */
export type VisitStatusMoved = z.infer<typeof VisitStatusMoved>;

/** The reader's new reservation emails at a place, on or off (Run service). */
export const SetTableNotifyInput = WorkspaceScoped.extend({ placeId: Uuid, on: z.boolean(), mutationId: Uuid });
/** The reader's new reservation emails at a place. */
export type SetTableNotifyInput = z.infer<typeof SetTableNotifyInput>;

/** The new reservation emails' state after a change. */
export const TableNotifySet = z.object({ placeId: Uuid, notifyMe: z.boolean() });
/** The new reservation emails' state after a change. */
export type TableNotifySet = z.infer<typeof TableNotifySet>;

/** A walk in's party at a place: which tables would seat it now. */
export const FreeTablesInput = WorkspaceScoped.extend({ placeId: Uuid, party: PartySize });
/** A walk in's party at a place. */
export type FreeTablesInput = z.infer<typeof FreeTablesInput>;

/** One table, or tables joined, free from now for the party's whole hold: their ids, "T1 + T2", and the seats. */
export const FreeTable = z.object({
  resourceIds: z.array(Uuid).readonly(),
  label: z.string(),
  seats: z.number().int(),
});
/** One free table, or tables joined. */
export type FreeTable = z.infer<typeof FreeTable>;

/** The tables free now for a party, best fit first (the engine's order: smallest single, then joins). */
export const FreeTablesView = z.object({
  tables: z.array(FreeTable).readonly(),
  /** How long the party would hold the table, in minutes. */
  holdMinutes: z.number().int(),
});
/** The tables free now for a party. */
export type FreeTablesView = z.infer<typeof FreeTablesView>;

/** Seats a walk in now at the tables chosen; the name is optional ("Walk in" when left out). */
export const WalkInInput = WorkspaceScoped.extend({
  placeId: Uuid,
  party: PartySize,
  resourceIds: z.array(Uuid).min(1, 'Pick a table.').max(3, 'Join at most 3 tables.'),
  name: z.string().trim().max(VISIT_LIMITS.clientNameMax, 'Use 120 characters or fewer.').optional(),
  mutationId: Uuid,
});
/** Seats a walk in. */
export type WalkInInput = z.infer<typeof WalkInInput>;

/**
 * A reservation the host takes (checklabs' New booking: a call, an email, a guest at the desk for later): the day's
 * time, the party, who, how to reach them, a note, and the tables if the host picks them (else the engine's best
 * fit). Source `desk`; the opening hours apply, the online rules (party range, notice, window) don't.
 */
export const StaffBookInput = WorkspaceScoped.extend({
  placeId: Uuid,
  start: Timestamp,
  party: PartySize,
  name: z
    .string()
    .trim()
    .min(1, 'Give the guest’s name.')
    .max(VISIT_LIMITS.clientNameMax, 'Use 120 characters or fewer.'),
  phone: z.string().trim().max(VISIT_LIMITS.clientPhoneMax, 'Use a shorter phone number.').optional(),
  email: GuestEmail.optional(),
  note: GuestNote.optional(),
  resourceIds: z.array(Uuid).min(1, 'Pick a table.').max(3, 'Join at most 3 tables.').optional(),
  mutationId: Uuid,
});
/** A reservation the host takes. */
export type StaffBookInput = z.infer<typeof StaffBookInput>;

/**
 * Table seating's staff side. `setup` and `saveSetup` are `hospitality.manage`'s; `places` and `floor` (the page's
 * places and tables, only the fields it draws) answer whoever opens Reservations; `day` and `setStatus` are Run
 * service's (`hospitality.service`), which reaches table reservations only, as do `setNotify` (the reader's own new
 * reservation emails), `freeTables`, `walkIn` (seat a party that walked in, now) and `book` (a reservation
 * the host takes). Each refuses `APP_NOT_INSTALLED` without
 * Table seating.
 */
export const tablesContract = {
  setup: oc.input(TablePlaceInput).output(TableSetupView),
  saveSetup: oc.input(SaveTableSetupInput).output(TableSetupView),
  /** The chosen business's places (spec 0065 H7): `property` left out is the first. */
  places: oc.input(PropertyScoped).output(ServicePlaces),
  floor: oc.input(TablePlaceInput).output(ServiceFloor),
  day: oc.input(ServiceDayInput).output(ServiceDayView),
  setStatus: oc.input(SetVisitStatusInput).output(VisitStatusMoved),
  setNotify: oc.input(SetTableNotifyInput).output(TableNotifySet),
  freeTables: oc.input(FreeTablesInput).output(FreeTablesView),
  walkIn: oc.input(WalkInInput).output(VisitStatusMoved),
  book: oc.input(StaffBookInput).output(VisitStatusMoved),
};
