// Offering and booking a visit (spec 0066, AC-6605, AC-6606; the cross check's engine rules). `visitTimes` answers
// the offered starts of one day (cached 30 seconds per place, services, staff choice and day, purged by any visit
// write at the place); `bookVisit` books one, in `bookPublicSlot`'s order:
// 1. A retry of the same attempt (its idempotency key, unique per place) answers the first visit.
// 2. The linked staff's calendars are read OUTSIDE any lock, fresh, and the plan for the chosen start is made from
//    what the database says before the lock.
// 3. One transaction takes the place lock, then every involved person's lock in sorted order (a linked staff member's
//    is the host key meetings take, so a meeting and an appointment for one person serialise), reads again, and
//    plans the chosen start again narrowed to the allocation offered; SLOT_TAKEN (with the next free times) when it
//    no longer holds. Then it inserts the visit, its items and its holds; the exclusion constraints are the last guard
//    (a `23P01` reads as SLOT_TAKEN).
// 4. In the same transaction, in a savepoint under a lock on the client's email, the client's Person is matched by
//    email or made (`matchVisitor`); a phone is stored on the visit, never matched alone.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  LOOKUP_ALPHABET,
  LOOKUP_LENGTH,
  VISIT_LIMITS,
  type AppointmentSource,
  type ConsentPurpose,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import type { BusyReader } from '../booking/calendar.ts';
import { matchVisitor } from '../booking/visitor.ts';
import { checkId, newId } from '../engine/ids.ts';
import type { ManageLinkKey } from '../booking/tokens.ts';
import { inputInvalid, isRefusal, postgresError, refuse, type RefusalError } from '../engine/refusals.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { auditSetup, installedHospitalityApps } from '../hospitality/gate.ts';
import { addDays, placeDateOf, wallToInstant } from '../hospitality/hours.ts';
import { calendarBusy, loadVisitInputs, withCalendarBusy, type AskedItem, type VisitInputs } from './load.ts';
import { lockVisit } from './locks.ts';
import { queueVisitMail, visitManageToken } from './mail.ts';
import { planVisit, type PlanInput, type PlannedStart, type PlanStats } from './planner.ts';

const { appointmentHolds, appointmentItems, appointments, objects } = schema;
const DAY = 86_400_000;

/** The words a client sees when the time went while they were booking. */
export const VISIT_TAKEN_MESSAGE = 'That time was just taken. Pick another.';

/** A SLOT_TAKEN refusal carrying the next free starts (ISO), so the flow offers them at once (AC-6605). */
export type VisitTakenError = RefusalError & { readonly next: readonly string[] };

/** Whether an error is a visit's SLOT_TAKEN with its next free times. */
export function isVisitTaken(error: unknown): error is VisitTakenError {
  return isRefusal(error) && error.refusal.code === 'SLOT_TAKEN' && 'next' in error;
}

/** A log the caller passes, for a hit cap (the place and services, never a client). */
export interface VisitLog {
  readonly warn: (message: string, fields: Readonly<Record<string, unknown>>) => void;
}

/**
 * The slot answer cache (the cross check: 30 seconds per place, services, staff choice and day, purged by any write at
 * the place). A factory, so no state lives at module level: the api makes one per process.
 */
export interface SlotCache {
  readonly get: (key: string) => readonly PlannedStart[] | undefined;
  readonly set: (key: string, placeId: string, starts: readonly PlannedStart[]) => void;
  /** Drops every answer of the place (a visit, a move, a change of hours or staff). */
  readonly purge: (placeId: string) => void;
}

/** A slot cache keeping answers `ttlMs` (30 seconds by default), at most `max` (the oldest dropped first). */
export function createSlotCache(
  options: { readonly ttlMs?: number; readonly max?: number; readonly now?: () => number } = {},
): SlotCache {
  const ttl = options.ttlMs ?? VISIT_LIMITS.slotCacheMs;
  const max = options.max ?? 2_000;
  const now = options.now ?? Date.now;
  const kept = new Map<
    string,
    { readonly at: number; readonly placeId: string; readonly starts: readonly PlannedStart[] }
  >();
  return {
    get(key) {
      const hit = kept.get(key);
      if (hit === undefined || now() - hit.at >= ttl) return undefined;
      return hit.starts;
    },
    set(key, placeId, starts) {
      kept.delete(key);
      kept.set(key, { at: now(), placeId, starts });
      while (kept.size > max) {
        const oldest = kept.keys().next();
        if (oldest.done === true) break;
        kept.delete(oldest.value);
      }
    },
    purge(placeId) {
      for (const [key, entry] of kept) if (entry.placeId === placeId) kept.delete(key);
    },
  };
}

/** What offering and booking need: the calendars, the cache, the clock and a log. */
export interface VisitDeps {
  readonly busy: BusyReader & { readonly fresh?: BusyReader };
  readonly slotCache?: SlotCache;
  readonly now?: () => Date;
  readonly log?: VisitLog;
  /**
   * The key a visit's manage token derives from (the booking pages' key, shared with the worker), so its emails can
   * write the link again without storing the token. Without it (tests) the token is random.
   */
  readonly linkKey?: ManageLinkKey;
}

/** Refuses APP_NOT_INSTALLED unless Appointments or Table seating is installed (the engine's apps). */
export async function requireVisitApp(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  const installed = await installedHospitalityApps(tx, workspaceId);
  if (!installed.has('appointments') && !installed.has('table_seating')) {
    throw refuse('APP_NOT_INSTALLED', 'Install Appointments or Table seating first, in Settings, Apps.');
  }
}

/** The items asked for, checked: 1 to 5, each with uuids. */
function checkItems(items: readonly AskedItem[]): readonly AskedItem[] {
  if (items.length === 0 || items.length > VISIT_LIMITS.items) {
    throw inputInvalid('items', `Choose 1 to ${String(VISIT_LIMITS.items)} services.`);
  }
  return items.map((item) => ({
    serviceId: checkId(item.serviceId, 'That service isn’t offered here.'),
    variantId: checkId(item.variantId, 'That service isn’t offered here.'),
    ...(item.staffId === undefined
      ? {}
      : { staffId: checkId(item.staffId, 'That professional doesn’t do this service here.') }),
  }));
}

/** The party, checked: a whole number in the engine's range. */
function checkParty(party: number): number {
  if (!Number.isInteger(party) || party < VISIT_LIMITS.partyMin || party > VISIT_LIMITS.partyMax) {
    throw inputInvalid('party', 'Choose a party of 1 to 100.');
  }
  return party;
}

/** The planner's input from loaded inputs. */
function planInputOf(
  inputs: VisitInputs,
  options: {
    readonly party: number;
    readonly now: Date;
    readonly from: Date;
    readonly to: Date;
    readonly onlineOnly: boolean;
  },
): PlanInput {
  return {
    zone: inputs.place.zone,
    hours: inputs.place.hours,
    staff: inputs.staff,
    resources: inputs.resources,
    items: inputs.items,
    party: options.party,
    now: options.now,
    from: options.from,
    to: options.to,
    noticeMinutes: options.onlineOnly ? inputs.rules.noticeMinutes : 0,
    ...(options.onlineOnly ? { windowDays: inputs.rules.windowDays } : {}),
    stepMinutes: inputs.rules.stepMinutes,
    pacing: inputs.pacing,
    onlineOnly: options.onlineOnly,
  };
}

/** Logs a hit cap with the place and services (the cross check), never the client. */
function logCaps(log: VisitLog | undefined, placeId: string, items: readonly AskedItem[], stats: PlanStats): void {
  if (log === undefined || (stats.startsCapped === 0 && !stats.requestCapped)) return;
  log.warn('visits.plan_capped', {
    placeId,
    serviceIds: items.map((item) => item.serviceId),
    tries: stats.tries,
    startsCapped: stats.startsCapped,
    requestCapped: stats.requestCapped,
  });
}

/** One offered start as a screen shows it: when, and who and what it would hold. */
export interface OfferedVisit {
  readonly start: string;
  readonly end: string;
  readonly items: readonly {
    readonly start: string;
    readonly end: string;
    readonly staffId?: string;
    readonly resourceIds: readonly string[];
  }[];
}

const offered = (start: PlannedStart): OfferedVisit => ({
  start: start.start.toISOString(),
  end: start.end.toISOString(),
  items: start.items.map((item) => ({
    start: item.start.toISOString(),
    end: item.end.toISOString(),
    ...(item.staffId === undefined ? {} : { staffId: item.staffId }),
    resourceIds: item.resourceIds,
  })),
});

/** The [from, to) of a place date. */
function dayBounds(date: string, zone: string): { readonly from: Date; readonly to: Date } {
  return { from: wallToInstant(date, 0, zone), to: wallToInstant(addDays(date, 1), 0, zone) };
}

/**
 * The offered starts at a place on one of its dates (`YYYY-MM-DD` on its wall clock), for the desk (B0;
 * `services.calendar`) and, through B2's entry, a guest. Cached 30 seconds per place, services, staff choice, party
 * and day (`deps.slotCache`); any visit write at the place purges it.
 */
export async function visitTimes(
  scope: EngineScope,
  deps: VisitDeps,
  query: {
    readonly placeId: string;
    readonly items: readonly AskedItem[];
    readonly party: number;
    readonly date: string;
  },
): Promise<readonly OfferedVisit[]> {
  requirePermission(scope, 'services.calendar');
  return offerVisitTimes(scope, deps, { ...query, online: false });
}

/**
 * The offered starts with no permission check: `visitTimes` (the desk) after its check, and the public door's guest
 * read (`online`: notice, window, online services and the online party range only). Never exported from the package.
 */
export async function offerVisitTimes(
  scope: EngineScope,
  deps: VisitDeps,
  query: {
    readonly placeId: string;
    readonly items: readonly AskedItem[];
    readonly party: number;
    readonly date: string;
    readonly online: boolean;
  },
): Promise<readonly OfferedVisit[]> {
  const placeId = checkId(query.placeId, 'That place doesn’t exist.');
  const items = checkItems(query.items);
  const party = checkParty(query.party);
  const onlineOnly = query.online;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.date)) throw inputInvalid('date', 'Pick a day.');
  // The app is checked before the cache, so an answer cached before a removal is never served after it.
  await inWorkspace(scope, (tx) => requireVisitApp(tx, scope.workspaceId));
  const key = [
    scope.workspaceId,
    placeId,
    query.date,
    String(party),
    onlineOnly ? 'online' : 'desk',
    ...items.map((item) => `${item.serviceId}/${item.variantId}/${item.staffId ?? '*'}`),
  ].join('|');
  const hit = deps.slotCache?.get(key);
  if (hit !== undefined) return hit.map(offered);
  const now = deps.now?.() ?? new Date();
  const loaded = await inWorkspace(scope, async (tx) => {
    await requireVisitApp(tx, scope.workspaceId);
    const zone = (
      await tx.execute<{ time_zone: string }>(sql`select time_zone from places where id = ${placeId}::uuid`)
    ).rows[0]?.time_zone;
    if (zone === undefined) throw refuse('NOT_FOUND', 'That place doesn’t exist.');
    const range = dayBounds(query.date, zone);
    return {
      range,
      inputs: await loadVisitInputs(tx, {
        workspaceId: scope.workspaceId,
        placeId,
        items,
        party,
        ...range,
      }),
    };
  });
  const { range } = loaded;
  const busy = await calendarBusy(
    deps.busy,
    scope.workspaceId,
    loaded.inputs.links,
    new Date(range.from.getTime() - DAY),
    new Date(range.to.getTime() + DAY),
  );
  const inputs = withCalendarBusy(loaded.inputs, busy);
  if (onlineOnly && (!inputs.online || party < inputs.rules.partyMin || party > inputs.rules.partyMax)) {
    deps.slotCache?.set(key, placeId, []);
    return [];
  }
  const plan = planVisit(planInputOf(inputs, { party, now, ...range, onlineOnly }));
  logCaps(deps.log, placeId, items, plan.stats);
  deps.slotCache?.set(key, placeId, plan.starts);
  return plan.starts.map(offered);
}

/** A visit to book. */
export interface VisitBookInput {
  readonly placeId: string;
  readonly items: readonly AskedItem[];
  readonly party: number;
  /** The chosen start (ISO 8601). */
  readonly start: string;
  readonly client: {
    readonly name: string;
    readonly email?: string | undefined;
    readonly phone?: string | undefined;
    readonly note?: string | undefined;
    readonly timeZone?: string | undefined;
    /** Birthday, anniversary, business, date or other. */
    readonly occasion?: 'birthday' | 'anniversary' | 'business' | 'date' | 'other' | undefined;
  };
  readonly source: AppointmentSource;
  readonly idempotencyKey: string;
  /**
   * A consent the client ticked (news and offers), kept on their Person with the words they were shown and this visit
   * as its source. A grant never overrides a withdrawal the Person already has for the purpose: an email typed on a
   * public page is unverified, so it can't opt someone back in.
   */
  readonly consent?: { readonly purpose: ConsentPurpose; readonly wording: string } | undefined;
  /**
   * At most `max` upcoming visits per client email at the place, counted again under the place lock (so two tabs
   * can't both slip past a count made before it); over it, refused CONFLICT with `message`.
   */
  readonly perEmail?: { readonly max: number; readonly message: string } | undefined;
}

/** A booked visit: its id, whether it was a retry, the keys the client keeps, and its items. */
export interface BookedVisit {
  readonly appointmentId: string;
  readonly replayed: boolean;
  /** The 8 character code the client reads at the desk. */
  readonly lookupCode: string;
  /** The manage link's token, only on the first answer (a retry can't show it again). */
  readonly manageToken?: string;
  readonly start: string;
  readonly end: string;
  readonly personRecordId?: string;
  readonly items: readonly {
    readonly start: string;
    readonly end: string;
    readonly staffId?: string;
    readonly resourceIds: readonly string[];
  }[];
}

/** A lookup code: 8 characters of the 31 a guest reads aloud without confusing (checklabs' reservation lookup). */
export function newLookupCode(): string {
  let code = '';
  for (let index = 0; index < LOOKUP_LENGTH; index += 1)
    code += LOOKUP_ALPHABET.charAt(randomInt(LOOKUP_ALPHABET.length));
  return code;
}

/** A manage token (24 random bytes, URL safe) and the hash the visit keeps; the token itself is never stored. */
function newManageToken(): { readonly token: string; readonly hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/** The visit a retry of the same attempt already made, as booked. */
async function replayOf(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
  key: string,
): Promise<BookedVisit | undefined> {
  const [row] = await tx
    .select({
      id: appointments.id,
      lookupCode: appointments.lookupCode,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      personRecordId: appointments.personRecordId,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.workspaceId, workspaceId),
        eq(appointments.placeId, placeId),
        eq(appointments.idempotencyKey, key),
      ),
    );
  if (row === undefined) return undefined;
  const items = await tx
    .select({
      id: appointmentItems.id,
      start: appointmentItems.startsAt,
      end: appointmentItems.endsAt,
      staffId: appointmentItems.staffId,
    })
    .from(appointmentItems)
    .where(eq(appointmentItems.appointmentId, row.id))
    .orderBy(appointmentItems.position);
  const holds = await tx
    .select({ itemId: appointmentHolds.itemId, resourceId: appointmentHolds.resourceId })
    .from(appointmentHolds)
    .where(eq(appointmentHolds.appointmentId, row.id));
  return {
    appointmentId: row.id,
    replayed: true,
    lookupCode: row.lookupCode,
    start: new Date(row.startsAt).toISOString(),
    end: new Date(row.endsAt).toISOString(),
    ...(row.personRecordId === null ? {} : { personRecordId: row.personRecordId }),
    items: items.map((item) => ({
      start: new Date(item.start).toISOString(),
      end: new Date(item.end).toISOString(),
      ...(item.staffId === null ? {} : { staffId: item.staffId }),
      resourceIds: [
        ...new Set(
          holds
            .filter((hold) => hold.itemId === item.id && hold.resourceId !== null)
            .map((hold) => hold.resourceId ?? ''),
        ),
      ],
    })),
  };
}

/** The People and Companies objects, live, for matching the client. */
async function crmObjects(
  tx: WorkspaceTx,
): Promise<{ readonly people: string; readonly companies: string } | undefined> {
  const rows = await tx
    .select({ id: objects.id, key: objects.standardKey })
    .from(objects)
    .where(and(sql`${objects.standardKey} in ('people', 'companies')`, isNull(objects.archivedAt)));
  const people = rows.find((row) => row.key === 'people')?.id;
  const companies = rows.find((row) => row.key === 'companies')?.id;
  return people === undefined || companies === undefined ? undefined : { people, companies };
}

/** The client's fields, checked. */
function checkClient(client: VisitBookInput['client']): VisitBookInput['client'] {
  const name = client.name.trim();
  if (name.length === 0 || name.length > VISIT_LIMITS.clientNameMax)
    throw inputInvalid('client.name', 'Give your name.');
  const email = client.email?.trim().toLowerCase();
  if (email !== undefined && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw inputInvalid('client.email', 'Give an email address like name@example.com.');
  }
  const phone = client.phone?.trim();
  if (phone !== undefined && phone.length > VISIT_LIMITS.clientPhoneMax)
    throw inputInvalid('client.phone', 'Use 40 characters or fewer.');
  if (
    client.occasion !== undefined &&
    !['birthday', 'anniversary', 'business', 'date', 'other'].includes(client.occasion)
  ) {
    throw inputInvalid('client.occasion', 'Pick an occasion.');
  }
  const note = client.note?.trim();
  if (note !== undefined && note.length > VISIT_LIMITS.noteMax)
    throw inputInvalid('client.note', 'Use 500 characters or fewer.');
  return {
    name,
    ...(email === undefined || email === '' ? {} : { email }),
    ...(phone === undefined || phone === '' ? {} : { phone }),
    ...(note === undefined || note === '' ? {} : { note }),
    ...(client.timeZone === undefined ? {} : { timeZone: client.timeZone }),
    ...(client.occasion === undefined ? {} : { occasion: client.occasion }),
  };
}

/**
 * Books a visit (AC-6605, AC-6606): see the header for the steps. `services.calendar` today (the desk, B0); B2 adds a
 * guest's entry with the public limiter in front. Refuses SLOT_TAKEN (with `next`, the next free starts that day)
 * when the start no longer holds, NOT_FOUND for a place, service or professional that isn't there.
 */
export async function bookVisit(
  scope: EngineScope,
  deps: VisitDeps,
  input: VisitBookInput,
  hooks: readonly AfterWrite[] = [],
): Promise<BookedVisit> {
  requirePermission(scope, 'services.calendar');
  return placeVisit(scope, deps, input, hooks);
}

/**
 * Books a visit with no permission check: `bookVisit` (the desk) after its check, and the public door's guest
 * reservation (source `online`). Never exported from the package.
 */
export async function placeVisit(
  scope: EngineScope,
  deps: VisitDeps,
  input: VisitBookInput,
  hooks: readonly AfterWrite[] = [],
): Promise<BookedVisit> {
  const placeId = checkId(input.placeId, 'That place doesn’t exist.');
  const items = checkItems(input.items);
  const key = checkId(input.idempotencyKey, 'Try booking again.');
  const client = checkClient(input.client);
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw inputInvalid('start', 'Pick a time.');
  checkParty(input.party);
  const now = deps.now?.() ?? new Date();
  const from = new Date(start.getTime() - DAY);
  const to = new Date(start.getTime() + DAY);
  const memberId = scope.access.principal.kind === 'member' ? scope.access.principal.memberId : undefined;
  const onlineOnly = input.source === 'online';

  // 1 and 2. A retry, then the plan before any lock, with the linked staff's calendars read fresh.
  const first = await inWorkspace(
    scope,
    async (tx): Promise<{ readonly again: BookedVisit } | { readonly inputs: VisitInputs }> => {
      await requireVisitApp(tx, scope.workspaceId);
      const again = await replayOf(tx, scope.workspaceId, placeId, key);
      if (again !== undefined) return { again };
      return {
        inputs: await loadVisitInputs(tx, {
          workspaceId: scope.workspaceId,
          placeId,
          items,
          party: input.party,
          from,
          to,
        }),
      };
    },
  );
  if ('again' in first) return first.again;
  if (onlineOnly && !first.inputs.online) throw refuse('NOT_FOUND', 'That service isn’t offered here.');
  if (onlineOnly && (input.party < first.inputs.rules.partyMin || input.party > first.inputs.rules.partyMax)) {
    throw inputInvalid(
      'party',
      `Online, we take parties of ${String(first.inputs.rules.partyMin)} to ${String(first.inputs.rules.partyMax)}. Call us for a larger one.`,
    );
  }
  const reader = deps.busy.fresh ?? deps.busy;
  const calendars = await calendarBusy(
    reader,
    scope.workspaceId,
    first.inputs.links,
    new Date(from.getTime() - DAY),
    new Date(to.getTime() + DAY),
  );
  const options = { party: input.party, now, from, to, onlineOnly };
  const before = planVisit({ ...planInputOf(withCalendarBusy(first.inputs, calendars), options), at: start });
  const offeredStart = before.starts[0];
  if (offeredStart === undefined) throw await taken(scope, deps, input, first.inputs, calendars, options);
  const people = [
    ...new Set(offeredStart.items.flatMap((item) => (item.staffId === undefined ? [] : [item.staffId]))),
  ].map((id) => ({ id, memberId: first.inputs.links.get(id) }));

  // 3. Under the locks: read again, plan the chosen start narrowed to its allocation, insert.
  const newVisitId = newId();
  const manage = deps.linkKey === undefined ? newManageToken() : visitManageToken(deps.linkKey, newVisitId);
  let written: BookedVisit;
  try {
    const { result } = await runWrite(
      scope,
      async (context) => {
        const { tx } = context;
        await lockVisit(tx, scope.workspaceId, placeId, people);
        const again = await replayOf(tx, scope.workspaceId, placeId, key);
        if (again !== undefined) return again;
        if (input.perEmail !== undefined && client.email !== undefined) {
          const [upcoming] = (
            await tx.execute<{ n: number }>(sql`
              select count(*)::int as n from appointments
              where place_id = ${placeId}::uuid and lower(client_email) = ${client.email}
                and status in ('booked', 'confirmed') and starts_at > ${now.toISOString()}::timestamptz
            `)
          ).rows;
          if ((upcoming?.n ?? 0) >= input.perEmail.max) throw refuse('CONFLICT', input.perEmail.message);
        }
        const now2 = await loadVisitInputs(tx, {
          workspaceId: scope.workspaceId,
          placeId,
          items,
          party: input.party,
          from,
          to,
        });
        // A staff member linked or unlinked since the plan: the person locks taken were the wrong ones.
        if (people.some((person) => now2.links.get(person.id) !== person.memberId)) {
          throw refuse('SLOT_TAKEN', VISIT_TAKEN_MESSAGE);
        }
        const recheck = planVisit({
          ...planInputOf(withCalendarBusy(now2, calendars), options),
          at: start,
          narrow: offeredStart.items.map((item) => ({ staffId: item.staffId, resourceIds: item.resourceIds })),
        });
        const plan = recheck.starts[0];
        if (plan === undefined) throw refuse('SLOT_TAKEN', VISIT_TAKEN_MESSAGE);
        const lookupCode = await freeLookupCode(tx, scope.workspaceId);
        const prices = plan.items.map((item, index) => {
          const fact = now2.facts[index];
          const own = item.staffId === undefined ? undefined : fact?.staffPrices.get(item.staffId);
          return own ?? fact?.priceMinor ?? 0;
        });
        let appointmentId: string;
        try {
          const [row] = await tx
            .insert(appointments)
            .values({
              workspaceId: scope.workspaceId,
              id: newVisitId,
              placeId,
              clientName: client.name,
              clientEmail: client.email ?? null,
              clientPhone: client.phone ?? null,
              note: client.note ?? null,
              occasion: client.occasion ?? null,
              partySize: input.party,
              startsAt: plan.start,
              endsAt: plan.end,
              status: 'booked',
              source: input.source,
              manageTokenHash: manage.hash,
              lookupCode,
              idempotencyKey: key,
              totalMinor: prices.reduce((sum, price) => sum + price, 0),
              currency: now2.currency,
              createdByMemberId: memberId ?? null,
            })
            .returning({ id: appointments.id });
          if (row === undefined) throw new Error('The visit was not stored.');
          appointmentId = row.id;
          const itemRows = await tx
            .insert(appointmentItems)
            .values(
              plan.items.map((item, index) => ({
                workspaceId: scope.workspaceId,
                appointmentId,
                serviceId: now2.facts[index]?.serviceId ?? '',
                variantId: now2.facts[index]?.variantId ?? '',
                serviceName: now2.facts[index]?.serviceName ?? '',
                variantName: now2.facts[index]?.variantName ?? '',
                startsAt: item.start,
                endsAt: item.end,
                priceMinor: prices[index] ?? 0,
                priceType: now2.facts[index]?.priceType ?? 'fixed',
                staffId: item.staffId ?? null,
                position: index,
              })),
            )
            .returning({ id: appointmentItems.id, position: appointmentItems.position });
          const itemIds = new Map(itemRows.map((row) => [row.position, row.id]));
          if (plan.holds.length > 0) {
            await tx.insert(appointmentHolds).values(
              plan.holds.map((hold) => ({
                workspaceId: scope.workspaceId,
                appointmentId,
                itemId: itemIds.get(hold.item) ?? '',
                placeId,
                staffId: hold.staffId ?? null,
                resourceId: hold.resourceId ?? null,
                during: sql`tstzrange(${hold.start.toISOString()}::timestamptz, ${hold.end.toISOString()}::timestamptz, '[)')`,
              })),
            );
          }
        } catch (error) {
          // The locks should make this unreachable: a write that skipped them, refused by either guard (AC-6602).
          if (postgresError(error)?.code === '23P01') throw refuse('SLOT_TAKEN', VISIT_TAKEN_MESSAGE);
          throw error;
        }
        await auditSetup(tx, scope, 'visit.created', { appointmentId, placeId, source: input.source });
        context.record({ visits: [placeId] });
        // The guest's confirmation and reminders (only a visit with an email is queued).
        if (client.email !== undefined) {
          await queueVisitMail(tx, appointmentId, ['confirmed', 'reminder_24h', 'reminder_2h']);
        }
        // 4. The client's Person, by email only, in a savepoint: a refusal keeps the visit.
        let personRecordId: string | undefined;
        if (client.email !== undefined) {
          const crm = await crmObjects(tx);
          if (crm !== undefined) {
            await lockKey(tx, `booking:email:${scope.workspaceId}:${client.email}`);
            const matched = await context.perRecord((step) =>
              matchVisitor(step, crm, {
                name: client.name,
                email: client.email ?? '',
                timeZone: client.timeZone ?? now2.place.zone,
              }),
            );
            if (matched.ok && matched.value.personId !== undefined) {
              personRecordId = matched.value.personId;
              await tx
                .update(appointments)
                .set({ personRecordId })
                .where(and(eq(appointments.workspaceId, scope.workspaceId), eq(appointments.id, appointmentId)));
              // A ticked consent (spec 0023 records, source `appointment` and this visit): ticking is a grant, never a
              // withdrawal, and never over a withdrawal already on the Person (the latest row for the purpose says no).
              if (input.consent !== undefined) {
                await tx.execute(sql`
                  insert into consent_records
                    (workspace_id, record_id, purpose, granted, wording, wording_version, source_type, source_id)
                  select ${scope.workspaceId}::uuid, ${personRecordId}::uuid, ${input.consent.purpose}, true,
                    ${input.consent.wording.slice(0, 2000)}, 1, 'appointment', ${appointmentId}::uuid
                  where coalesce((
                    select c.granted from consent_records c
                    where c.workspace_id = ${scope.workspaceId}::uuid and c.record_id = ${personRecordId}::uuid
                      and c.purpose = ${input.consent.purpose}
                    order by c.at desc, c.id desc limit 1
                  ), true)
                `);
              }
            }
          }
        }
        return {
          appointmentId,
          replayed: false,
          lookupCode,
          manageToken: manage.token,
          start: plan.start.toISOString(),
          end: plan.end.toISOString(),
          ...(personRecordId === undefined ? {} : { personRecordId }),
          items: offered(plan).items,
        } satisfies BookedVisit;
      },
      hooks,
    );
    written = result;
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'SLOT_TAKEN' && !isVisitTaken(error)) {
      throw await taken(scope, deps, input, first.inputs, calendars, options);
    }
    throw error;
  }
  if (!written.replayed) deps.slotCache?.purge(placeId);
  return written;
}

/** A lookup code no visit of the workspace has (31^8 codes, so a second try is rare). */
async function freeLookupCode(tx: WorkspaceTx, workspaceId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newLookupCode();
    const [used] = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.workspaceId, workspaceId), eq(appointments.lookupCode, code)));
    if (used === undefined) return code;
  }
  throw new Error('No free lookup code after five tries.');
}

/** SLOT_TAKEN with the next free starts that day (up to 3), read again after the refusal. */
async function taken(
  scope: EngineScope,
  deps: VisitDeps,
  input: VisitBookInput,
  stale: VisitInputs,
  calendars: ReadonlyMap<string, readonly { readonly start: number; readonly end: number }[]>,
  options: { readonly party: number; readonly now: Date; readonly onlineOnly: boolean },
): Promise<VisitTakenError> {
  deps.slotCache?.purge(stale.place.id);
  const start = new Date(input.start);
  const date = placeDateOf(start.getTime(), stale.place.zone);
  const day = dayBounds(date, stale.place.zone);
  const fresh = await inWorkspace(scope, (tx) =>
    loadVisitInputs(tx, {
      workspaceId: scope.workspaceId,
      placeId: stale.place.id,
      items: input.items,
      party: input.party,
      ...day,
    }),
  ).catch(() => stale);
  const plan = planVisit(planInputOf(withCalendarBusy(fresh, calendars), { ...options, ...day }));
  logCaps(deps.log, stale.place.id, input.items, plan.stats);
  const next = plan.starts
    .filter((each) => each.start.getTime() > start.getTime())
    .slice(0, 3)
    .map((each) => each.start.toISOString());
  return Object.assign(refuse('SLOT_TAKEN', VISIT_TAKEN_MESSAGE), { next });
}
