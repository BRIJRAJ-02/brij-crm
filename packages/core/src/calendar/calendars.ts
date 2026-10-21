// Every calendar of each connected account (spec 0024 milestone 5, the
// amendment of 20 October 2026, AC-991 to AC-1005), Calendly style. A
// connection's calendars are listed from the provider by its sync (after
// connecting, once a day, and on Refresh: `storeCalendars`), keeping at most
// 50, the main one first. Each has three switches: Check for conflicts (free
// and busy reads it live, AC-994), Show on my calendar (the member's Bookings
// week, AC-1001) and Sync meetings (its meetings reach records, AC-1002). A
// calendar that syncs or shows is *pulled*: the sync keeps a copy of its
// events, with its own sync token and push channel (AC-1003). One that only
// checks for conflicts is never stored, so a calendar a member asked only to
// keep them from being double booked never leaves its titles here.
//
// Switching a calendar on to pulled forgets its sync token and brings its
// account's sync forward, so its whole window arrives; switching it off drops
// its copy at once, the meetings only it held with it (as a disconnect does).
// Turning Sync meetings off while it still shows takes its meetings off every
// record but keeps them on the member's week.
//
// One calendar per member takes new bookings (`is_destination`, AC-996), one
// they can write (AC-1004). When the provider removes it, or it stops taking
// events, the destination falls back to the main calendar of the member's
// default connection and the member is told until they dismiss it (AC-1005).
//
// Everything here is the member's own (spec 0037, AC-1306): another member's
// calendar answers as absent, and nothing here is readable by anyone else.
import { sql } from 'drizzle-orm';
import {
  MAX_CALENDARS_PER_ACCOUNT,
  type CalendarAccessRole,
  type CalendarAccountView,
  type CalendarView,
  type CalendarWarning,
} from '@crm/contracts';
import type { Hue } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite, type MeetingChange, type WriteContext } from '../engine/write.ts';
import { dropBusyTimes, dropSources, unlinkUnsynced } from './apply.ts';
import { listCalendarConnections } from './connections.ts';
import { calendarHue, hueOverride } from './hues.ts';
import { PRIMARY_CALENDAR, type ProviderCalendar } from './provider.ts';

/** What another member's calendar, or one that doesn't exist, answers. */
export const UNKNOWN_CALENDAR = 'That calendar does not exist.';

/** What a destination the member can't write answers (AC-1004). */
export const NOT_WRITABLE = 'New bookings can only go to a calendar you can add events to.';

/** What a principal that isn't a member answers: calendars are a member's own. */
export const CALENDARS_ARE_MEMBERS = 'Calendars belong to members.';

/** How long a listing of an account's calendars lasts before its sync lists them again (AC-991: once a day). */
export const CALENDARS_LIST_EVERY_MS = 24 * 3_600_000;

/** The statuses a connection still reads its calendars in. */
const LIVE_STATUSES = ['syncing', 'connected', 'failed'] as const;

/** A calendar as stored, with its connection's status. */
export interface CalendarRow extends Record<string, unknown> {
  readonly id: string;
  readonly connection_id: string;
  readonly member_id: string;
  readonly provider_calendar_id: string;
  readonly name: string;
  readonly provider_colour: string | null;
  readonly colour_override: string | null;
  readonly access_role: CalendarAccessRole;
  readonly is_primary: boolean;
  readonly check_conflicts: boolean;
  readonly show_in_week: boolean;
  readonly sync: boolean;
  readonly time_zone: string | null;
  readonly is_destination: boolean;
  readonly fell_back_from: string | null;
  readonly last_error: { readonly code?: unknown; readonly message?: unknown; readonly at?: unknown } | null;
  readonly connection_status: string;
}

/** Whether a calendar's events are kept here: it syncs meetings or shows on the member's week. */
export const isPulled = (row: Pick<CalendarRow, 'sync' | 'show_in_week'>): boolean => row.sync || row.show_in_week;

/** Whether a calendar can take new bookings: the member may write it, on an account that still works. */
export const isWritable = (row: Pick<CalendarRow, 'access_role' | 'connection_status'>): boolean =>
  (row.access_role === 'owner' || row.access_role === 'writer') &&
  (LIVE_STATUSES as readonly string[]).includes(row.connection_status);

/** The columns a calendar read takes, with its connection's status (`k` the calendar, `c` the connection). */
export const CALENDAR_COLUMNS = sql`k.id::text as id, k.connection_id::text as connection_id,
  k.member_id::text as member_id, k.provider_calendar_id, k.name, k.provider_colour, k.colour_override, k.access_role,
  k.is_primary, k.check_conflicts, k.show_in_week, k.sync, k.time_zone, k.is_destination, k.fell_back_from,
  k.last_error, c.status::text as connection_status`;

/** The member acting, or `FORBIDDEN` for an API key or the system. */
function actingMember(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', CALENDARS_ARE_MEMBERS);
  return principal.memberId;
}

/** A stored failure as the member reads it, or undefined. */
function warningOf(error: CalendarRow['last_error']): CalendarWarning | undefined {
  if (error === null || typeof error.code !== 'string' || typeof error.message !== 'string') return undefined;
  const at = typeof error.at === 'string' && Number.isFinite(Date.parse(error.at)) ? error.at : undefined;
  return at === undefined ? undefined : { code: error.code, message: error.message, at: new Date(at).toISOString() };
}

/** A calendar as its member sees it. */
export function calendarViewOf(row: CalendarRow): CalendarView {
  const override = hueOverride(row.colour_override);
  const warning = warningOf(row.last_error);
  return {
    id: row.id,
    connectionId: row.connection_id,
    name: row.name,
    hue: calendarHue({ colourOverride: row.colour_override, providerColour: row.provider_colour }),
    ...(override === undefined ? {} : { colourOverride: override }),
    accessRole: row.access_role,
    isPrimary: row.is_primary,
    checkConflicts: row.check_conflicts,
    showInWeek: row.show_in_week,
    sync: row.sync,
    isDestination: row.is_destination,
    canBeDestination: isWritable(row),
    ...(row.time_zone === null ? {} : { timeZone: row.time_zone }),
    ...(warning === undefined ? {} : { warning }),
  };
}

/** Calendars in the order they list: the main one first, then by name. */
const byListing = (a: Pick<CalendarRow, 'is_primary' | 'name'>, b: Pick<CalendarRow, 'is_primary' | 'name'>) =>
  Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name);

/** The member's calendars (one connection's, when given), each with its connection's status. */
async function calendarsOf(tx: WorkspaceTx, memberId: string, connectionId?: string): Promise<CalendarRow[]> {
  const rows = await tx.execute<CalendarRow>(sql`
    select ${CALENDAR_COLUMNS}
    from calendar_calendars k
    join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
    where k.member_id = ${memberId}::uuid
      ${connectionId === undefined ? sql`` : sql`and k.connection_id = ${connectionId}::uuid`}
  `);
  return rows.rows.toSorted(byListing);
}

/** One of the member's own calendars, locked for the write; `NOT_FOUND` for anyone else's. */
async function ownCalendar(tx: WorkspaceTx, memberId: string, calendarId: string): Promise<CalendarRow> {
  const id = checkId(calendarId, UNKNOWN_CALENDAR);
  const rows = await tx.execute<CalendarRow>(sql`
    select ${CALENDAR_COLUMNS}
    from calendar_calendars k
    join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
    where k.id = ${id}::uuid and k.member_id = ${memberId}::uuid
    for update of k
  `);
  const [row] = rows.rows;
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_CALENDAR);
  return row;
}

/** Who changed a calendar: the member, or (a sync) the calendar actor. */
const touchedBy = (memberId: string | undefined) =>
  memberId === undefined
    ? sql`updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null`
    : sql`updated_at = now(), updated_by_type = 'member', updated_by_id = ${memberId}::uuid,
        updated_by_member_id = ${memberId}::uuid`;

/**
 * Drops one calendar's copy (AC-1002, AC-1003): its sources (and the meetings only it held), its busy times, its
 * sync token, and its channel (the next sync stops it at the provider). Answers the meetings touched.
 */
async function dropCopy(
  tx: WorkspaceTx,
  row: Pick<CalendarRow, 'id' | 'connection_id' | 'provider_calendar_id'>,
): Promise<readonly MeetingChange[]> {
  const meetings = await dropSources(tx, row.connection_id, row.provider_calendar_id, 'all');
  await dropBusyTimes(tx, row.connection_id, row.provider_calendar_id, 'all');
  await tx.execute(sql`update calendar_calendars set sync_state = '{}'::jsonb where id = ${row.id}::uuid`);
  return meetings;
}

/**
 * Moves the member's destination off an account that stopped (its grant revoked, or failing for 6 hours) to the
 * main calendar of their other live account, saying which calendar it replaced (AC-1005; the owner's rule of 21
 * October 2026). With no other account to take it, it stays: bookings close by AC-995 until the account heals.
 */
export async function moveDestinationOff(tx: WorkspaceTx, connectionId: string): Promise<void> {
  const held = await tx.execute<{ id: string; member_id: string; name: string }>(sql`
    select id::text as id, member_id::text as member_id, name from calendar_calendars
    where connection_id = ${connectionId}::uuid and is_destination
  `);
  const [lost] = held.rows;
  if (lost === undefined) return;
  const next = await tx.execute<{ id: string }>(sql`
    select k.id::text as id from calendar_calendars k
    join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
    where k.member_id = ${lost.member_id}::uuid and k.connection_id <> ${connectionId}::uuid
      and k.access_role in ('owner', 'writer') and c.status in ('syncing', 'connected')
    order by k.is_primary desc, c.is_default desc, c.created_at, c.id, k.name
    limit 1
  `);
  const [target] = next.rows;
  if (target === undefined) return;
  // The calendar sync moved it, not a member: stamped so.
  const stamp = sql`updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null`;
  await tx.execute(sql`update calendar_calendars set is_destination = false, ${stamp} where id = ${lost.id}::uuid`);
  await tx.execute(sql`
    update calendar_calendars set is_destination = true, fell_back_from = ${lost.name.slice(0, 255)}, ${stamp}
    where id = ${target.id}::uuid
  `);
}

/**
 * Makes the main calendar of the member's default connection their destination (else the main calendar of their
 * oldest live connection, else any calendar they can write), when they have none: after their destination was
 * removed, stopped taking events, or went with its account. `removedName` says what it replaced (AC-1005).
 */
export async function fallBackDestination(tx: WorkspaceTx, memberId: string, removedName?: string): Promise<void> {
  const has = await tx.execute(sql`
    select 1 from calendar_calendars where member_id = ${memberId}::uuid and is_destination
  `);
  if (has.rows.length > 0) return;
  await tx.execute(sql`
    update calendar_calendars set is_destination = true, fell_back_from = ${removedName?.slice(0, 255) ?? null}
    where id = (
      select k.id from calendar_calendars k
      join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
      where k.member_id = ${memberId}::uuid and k.access_role in ('owner', 'writer')
        and c.status in ('syncing', 'connected', 'failed')
      -- A working account first; a failing one only when nothing else can take bookings.
      order by c.status = 'failed', c.is_default desc, k.is_primary desc, c.created_at, c.id, k.name
      limit 1
    )
  `);
}

/** What a listing did: the calendars added and removed, and whether the main one's id changed. */
export interface StoredCalendars {
  readonly added: number;
  readonly removed: number;
  readonly meetings: readonly MeetingChange[];
}

/**
 * Stores what the provider listed of one connection's calendars (AC-991), in the write's transaction: the main
 * one first, then by name, at most 50. A calendar the provider no longer lists goes, with its copy (and, when it
 * was the destination, the destination falls back, AC-1005); a new one arrives with every switch off, except the
 * account's main calendar on its first listing, which has all three on (AC-992). Name, colour, access and time
 * zone follow the provider; the switches, colour pick and destination are the member's. The main calendar a
 * connection made before its first listing (`primary`, or the backfill's address) takes the real id it lists
 * under, keeping its switches, sources and busy times.
 */
export async function storeCalendars(
  context: WriteContext,
  connection: { readonly id: string; readonly memberId: string },
  listed: readonly ProviderCalendar[],
): Promise<StoredCalendars> {
  const { tx } = context;
  const kept = [...listed]
    .filter((each) => each.id.length > 0 && each.id.length <= 1024)
    .toSorted((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name))
    .slice(0, MAX_CALENDARS_PER_ACCOUNT);
  const existing = (
    await tx.execute<CalendarRow>(sql`
      select ${CALENDAR_COLUMNS}
      from calendar_calendars k
      join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
      where k.connection_id = ${connection.id}::uuid
      for update of k
    `)
  ).rows;
  const listedIds = new Set(kept.map((each) => each.id));
  const main = kept.find((each) => each.isPrimary);
  // The main calendar under a placeholder id takes its real one.
  const oldMain = existing.find((row) => row.is_primary);
  if (main !== undefined && oldMain !== undefined && oldMain.provider_calendar_id !== main.id) {
    const clash = existing.find((row) => row.provider_calendar_id === main.id);
    if (clash === undefined) {
      await tx.execute(sql`
        update calendar_calendars set provider_calendar_id = ${main.id} where id = ${oldMain.id}::uuid
      `);
      await tx.execute(sql`
        update meeting_sources set calendar_id = ${main.id}
        where connection_id = ${connection.id}::uuid and calendar_id = ${oldMain.provider_calendar_id}
      `);
      await tx.execute(sql`
        update calendar_busy_times set calendar_id = ${main.id}
        where connection_id = ${connection.id}::uuid and calendar_id = ${oldMain.provider_calendar_id}
      `);
      existing.splice(existing.indexOf(oldMain), 1, { ...oldMain, provider_calendar_id: main.id });
    }
  }
  const meetings: MeetingChange[] = [];
  // Gone at the provider (or past the 50): its copy first, then the row; a destination falls back.
  const gone = existing.filter((row) => !listedIds.has(row.provider_calendar_id));
  let lostDestination: string | undefined;
  for (const row of gone) {
    meetings.push(...(await dropCopy(tx, row)));
    await tx.execute(sql`delete from calendar_calendars where id = ${row.id}::uuid`);
    if (row.is_destination) lostDestination = row.name;
  }
  // A destination that can no longer take events stops being it.
  for (const each of kept) {
    const row = existing.find((held) => held.provider_calendar_id === each.id);
    if (row?.is_destination === true && each.accessRole !== 'owner' && each.accessRole !== 'writer') {
      await tx.execute(sql`update calendar_calendars set is_destination = false where id = ${row.id}::uuid`);
      lostDestination = row.name;
    }
  }
  const firstListing = existing.length === 0;
  const rows = kept.map((each) => {
    const on = firstListing && each.isPrimary;
    return {
      provider_calendar_id: each.id,
      name: (each.name.trim() === '' ? each.id : each.name.trim()).slice(0, 255),
      provider_colour: each.colour !== undefined && /^#[0-9a-f]{6}$/.test(each.colour) ? each.colour : null,
      access_role: each.accessRole,
      is_primary: each.isPrimary,
      time_zone: each.timeZone?.slice(0, 64) ?? null,
      on,
    };
  });
  let added = 0;
  if (rows.length > 0) {
    const upserted = await tx.execute<{ inserted: boolean }>(sql`
      insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name,
        provider_colour, access_role, is_primary, check_conflicts, show_in_week, sync, time_zone, created_by_type,
        updated_by_type)
      select ${context.scope.workspaceId}::uuid, ${connection.id}::uuid, ${connection.memberId}::uuid,
        x.provider_calendar_id, x.name, x.provider_colour, x.access_role::calendar_access_role, x.is_primary, x.on,
        x.on, x.on, x.time_zone, 'calendar', 'calendar'
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(provider_calendar_id text, name text,
        provider_colour text, access_role text, is_primary boolean, time_zone text, "on" boolean)
      on conflict (workspace_id, connection_id, provider_calendar_id) do update set
        name = excluded.name, provider_colour = excluded.provider_colour, access_role = excluded.access_role,
        is_primary = excluded.is_primary, time_zone = excluded.time_zone, ${touchedBy(undefined)}
      returning (xmax = 0) as inserted
    `);
    added = upserted.rows.filter((row) => row.inserted).length;
  }
  await tx.execute(sql`
    update calendar_connections set calendars_listed_at = now() where id = ${connection.id}::uuid
  `);
  // A listing that went through heals the warning a refused one left.
  await tx.execute(sql`
    update calendar_calendars set last_error = null
    where connection_id = ${connection.id}::uuid and last_error ->> 'source' = 'list'
  `);
  await fallBackDestination(tx, connection.memberId, lostDestination);
  return { added, removed: gone.length, meetings };
}

/** The member's own accounts with their calendars (AC-993), and where new bookings go. */
export interface MemberCalendars {
  readonly accounts: readonly CalendarAccountView[];
  readonly destinationId?: string;
  readonly fellBack?: { readonly removedName: string };
}

/** The member's accounts, newest first, each with its calendars, the main one first (AC-993). */
export async function listMemberCalendars(scope: EngineScope): Promise<MemberCalendars> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const connections = await listCalendarConnections(scope);
  const rows = await inWorkspace(scope, (tx) => calendarsOf(tx, memberId));
  const destination = rows.find((row) => row.is_destination);
  return {
    accounts: connections.map((connection) => ({
      ...connection,
      calendars: rows.filter((row) => row.connection_id === connection.id).map(calendarViewOf),
    })),
    ...(destination === undefined ? {} : { destinationId: destination.id }),
    ...(destination?.fell_back_from === null || destination?.fell_back_from === undefined
      ? {}
      : { fellBack: { removedName: destination.fell_back_from } }),
  };
}

/** A change to one of the member's own calendars (AC-993): only the fields given. */
export interface UpdateCalendarInput {
  readonly calendarId: string;
  readonly checkConflicts?: boolean;
  readonly showInWeek?: boolean;
  readonly sync?: boolean;
  /** A hue, or null for the provider's colour again. */
  readonly colourOverride?: Hue | null;
}

/** What a calendar change did, beyond the view: whether its account's sync was brought forward. */
export interface UpdatedCalendar {
  readonly calendar: CalendarView;
  /** Free and busy for the member must be read again (a conflict switch changed, AC-994). */
  readonly busyChanged: boolean;
}

/**
 * Changes one of the member's own calendars (AC-993, AC-1002): its switches and its colour. Becoming pulled
 * forgets its sync token and brings its account's sync forward (a full sync of its window); stopping drops its
 * copy and the meetings only it held; Sync meetings off while it still shows takes its meetings off records.
 */
export async function updateMemberCalendar(
  scope: EngineScope,
  input: UpdateCalendarInput,
  hooks: readonly AfterWrite[] = [],
): Promise<UpdatedCalendar> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await ownCalendar(tx, memberId, input.calendarId);
      const next = {
        check_conflicts: input.checkConflicts ?? row.check_conflicts,
        show_in_week: input.showInWeek ?? row.show_in_week,
        sync: input.sync ?? row.sync,
      };
      const colour = input.colourOverride === undefined ? row.colour_override : input.colourOverride;
      await tx.execute(sql`
        update calendar_calendars set check_conflicts = ${next.check_conflicts}, show_in_week = ${next.show_in_week},
          sync = ${next.sync}, colour_override = ${colour}, ${touchedBy(memberId)}
        where id = ${row.id}::uuid
      `);
      const wasPulled = isPulled(row);
      const nowPulled = isPulled(next);
      if (wasPulled && !nowPulled) {
        context.record({ meetings: await dropCopy(tx, row) });
      } else if (!wasPulled && nowPulled) {
        await tx.execute(sql`update calendar_calendars set sync_state = '{}'::jsonb where id = ${row.id}::uuid`);
        await tx.execute(sql`select crm_enqueue_calendar_sync(${row.connection_id}::uuid)`);
      } else if (row.sync && !next.sync) {
        // Still on the week: off every record (AC-1002).
        const held = await tx.execute<{ meeting_id: string }>(sql`
          select meeting_id::text as meeting_id from meeting_sources
          where connection_id = ${row.connection_id}::uuid and calendar_id = ${row.provider_calendar_id}
        `);
        context.record({
          meetings: await unlinkUnsynced(
            tx,
            held.rows.map((each) => each.meeting_id),
          ),
        });
      } else if (!row.sync && next.sync) {
        // Its meetings reach records now: a full sync of its window writes their links (AC-1002).
        await tx.execute(sql`update calendar_calendars set sync_state = '{}'::jsonb where id = ${row.id}::uuid`);
        await tx.execute(sql`select crm_enqueue_calendar_sync(${row.connection_id}::uuid)`);
      }
      const [after] = (
        await tx.execute<CalendarRow>(sql`
          select ${CALENDAR_COLUMNS}
          from calendar_calendars k
          join calendar_connections c on c.workspace_id = k.workspace_id and c.id = k.connection_id
          where k.id = ${row.id}::uuid
        `)
      ).rows;
      if (after === undefined) throw new Error('A calendar just written could not be read back.');
      return { calendar: calendarViewOf(after), busyChanged: next.check_conflicts !== row.check_conflicts };
    },
    hooks,
  );
  return result;
}

/** Makes one of the member's own calendars where new bookings go (AC-996): one they can write (AC-1004). */
export async function setCalendarDestination(
  scope: EngineScope,
  input: { readonly calendarId: string },
): Promise<{ readonly destinationId: string }> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const { result } = await runWrite(scope, async ({ tx }) => {
    const row = await ownCalendar(tx, memberId, input.calendarId);
    if (!isWritable(row)) throw refuse('CALENDAR_NOT_WRITABLE', NOT_WRITABLE);
    await tx.execute(sql`
      update calendar_calendars set is_destination = false, fell_back_from = null, ${touchedBy(memberId)}
      where member_id = ${memberId}::uuid and (is_destination or fell_back_from is not null) and id <> ${row.id}::uuid
    `);
    await tx.execute(sql`
      update calendar_calendars set is_destination = true, fell_back_from = null, ${touchedBy(memberId)}
      where id = ${row.id}::uuid
    `);
    return { destinationId: row.id };
  });
  return result;
}

/** The member read that their destination fell back (AC-1005): the notice goes. */
export async function dismissCalendarNotice(scope: EngineScope): Promise<{ readonly destinationId?: string }> {
  checkScope(scope);
  const memberId = actingMember(scope);
  return inWorkspace(scope, async (tx) => {
    await tx.execute(sql`
      update calendar_calendars set fell_back_from = null, ${touchedBy(memberId)}
      where member_id = ${memberId}::uuid and fell_back_from is not null
    `);
    const found = await tx.execute<{ id: string }>(sql`
      select id::text as id from calendar_calendars where member_id = ${memberId}::uuid and is_destination
    `);
    const id = found.rows[0]?.id;
    return id === undefined ? {} : { destinationId: id };
  });
}

/**
 * Refresh (AC-991): one of the member's own accounts lists its calendars on its next sync, brought forward to now.
 * Answers whether a sync was queued (a stopped connection queues none).
 */
export async function refreshCalendarConnection(
  scope: EngineScope,
  input: { readonly connectionId: string },
): Promise<{ readonly queued: boolean }> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const connectionId = checkId(input.connectionId, 'That calendar connection does not exist.');
  return inWorkspace(scope, async (tx) => {
    const found = await tx.execute<{ id: string }>(sql`
      update calendar_connections set calendars_listed_at = null
      where id = ${connectionId}::uuid and member_id = ${memberId}::uuid
      returning id::text as id
    `);
    if (found.rows.length === 0) throw refuse('NOT_FOUND', 'That calendar connection does not exist.');
    const queued = await tx.execute<{ queued: boolean }>(
      sql`select crm_enqueue_calendar_sync(${connectionId}::uuid) as queued`,
    );
    return { queued: queued.rows[0]?.queued === true };
  });
}

/**
 * The main calendar a new connection starts with, before its first listing (AC-992): under the provider's alias
 * for it, every switch on, and the member's destination when they have none, so a member who just connected has
 * conflicts read and bookings written from the first minute. The listing gives it its real id and name.
 */
export async function addMainCalendar(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly memberId: string;
    readonly name: string;
  },
): Promise<void> {
  await tx.execute(sql`
    insert into calendar_calendars (workspace_id, connection_id, member_id, provider_calendar_id, name, access_role,
      is_primary, check_conflicts, show_in_week, sync, created_by_type, created_by_id, created_by_member_id,
      updated_by_type, updated_by_id, updated_by_member_id)
    select ${input.workspaceId}::uuid, ${input.connectionId}::uuid, ${input.memberId}::uuid, ${PRIMARY_CALENDAR},
      ${input.name.slice(0, 255)}, 'owner', true, true, true, true, 'member', ${input.memberId}::uuid,
      ${input.memberId}::uuid, 'member', ${input.memberId}::uuid, ${input.memberId}::uuid
    -- A reconnect keeps the calendars it had.
    where not exists (select 1 from calendar_calendars where connection_id = ${input.connectionId}::uuid)
  `);
  await fallBackDestination(tx, input.memberId);
}
