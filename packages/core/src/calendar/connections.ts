// A member's calendar connections (spec 0024, AC-597, AC-599, AC-611): each
// member reads and changes only their own, and anyone else's is answered as
// absent. Connecting (the OAuth callback) stores the sealed tokens and queues
// the first full sync through `crm_enqueue_calendar_sync`, in the same
// transaction; disconnecting deletes the tokens with the row, and the meetings
// no other connection holds go with it. A change to who sees a connection's
// meetings, or a meeting removed, stores one `meetings` outbox row naming
// the meetings and their records, so open timelines read again.
import { sql } from 'drizzle-orm';
import {
  MAX_CALENDAR_CONNECTIONS,
  type CalendarConnectionView,
  type CalendarProvider as ProviderName,
  type CalendarSharing,
  type CalendarStatus,
  type RemovedCalendarConnection,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, uuidList } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import { runWrite, type AfterWrite, type MeetingChange, type WriteContext } from '../engine/write.ts';
import { recomputePrivacy } from './apply.ts';
import { addMainCalendar, fallBackDestination } from './calendars.ts';
import { normaliseEmail, type ExchangedTokens } from './provider.ts';
import { sealTokens, type TokenKey } from './tokens.ts';

/** What a connection that isn't the reader's own (or doesn't exist) answers. */
export const UNKNOWN_CONNECTION = 'That calendar connection does not exist.';

/** What a principal that isn't a member answers: connections are a member's own. */
export const CONNECTIONS_ARE_MEMBERS = 'Calendar connections belong to members.';

/** What a seventh account answers (AC-1000). */
export const CONNECTIONS_FULL = `Connect at most ${String(MAX_CALENDAR_CONNECTIONS)} calendar accounts.`;

/** A newly consented account (`connectCalendar`): its provider, and the tokens and account the code exchanged for. */
export interface ConnectCalendarInput {
  readonly provider: ProviderName;
  readonly exchanged: ExchangedTokens;
  readonly tokenKey: TokenKey;
}

/** A change to one of the member's own connections. */
export interface UpdateCalendarConnectionInput {
  readonly connectionId: string;
  readonly sharing?: CalendarSharing;
  readonly isDefault?: true;
}

/** The acting member, or `FORBIDDEN` for an API key or the system: connections are a member's own. */
function actingMember(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', CONNECTIONS_ARE_MEMBERS);
  return principal.memberId;
}

/** A moment as fixed width UTC text with milliseconds. */
const millis = (column: string) => sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

interface ConnectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly provider: ProviderName;
  readonly account_email: string;
  readonly status: CalendarStatus;
  readonly sharing: CalendarSharing;
  readonly is_default: boolean;
  readonly last_synced_at: string | null;
  readonly last_error: { readonly code?: unknown; readonly message?: unknown } | null;
  readonly created_at: string;
}

/** The columns a view reads: never the tokens, the sync state or the channel. */
const VIEW_COLUMNS = sql`id::text as id, provider, account_email, status, sharing, is_default,
  ${millis('last_synced_at')} as last_synced_at, last_error, ${millis('created_at')} as created_at`;

function viewOf(row: ConnectionRow): CalendarConnectionView {
  const error = row.last_error;
  return {
    id: row.id,
    provider: row.provider,
    accountEmail: row.account_email,
    status: row.status,
    sharing: row.sharing,
    isDefault: row.is_default,
    ...(row.last_synced_at === null ? {} : { lastSyncedAt: row.last_synced_at }),
    ...(error !== null && typeof error.code === 'string' && typeof error.message === 'string'
      ? { lastError: { code: error.code, message: error.message } }
      : {}),
    createdAt: row.created_at,
  };
}

/** One of the member's own connections, locked for the write; `NOT_FOUND` for anyone else's. */
async function ownConnection(tx: WorkspaceTx, memberId: string, connectionId: string): Promise<ConnectionRow> {
  const id = checkId(connectionId, UNKNOWN_CONNECTION);
  const rows = await tx.execute<ConnectionRow>(sql`
    select ${VIEW_COLUMNS} from calendar_connections
    where id = ${id}::uuid and member_id = ${memberId}::uuid
    for update
  `);
  const [row] = rows.rows;
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_CONNECTION);
  return row;
}

/** The member's connections, newest first (AC-597, AC-621). */
export async function listCalendarConnections(scope: EngineScope): Promise<CalendarConnectionView[]> {
  checkScope(scope);
  const memberId = actingMember(scope);
  return inWorkspace(scope, async (tx) => {
    const rows = await tx.execute<ConnectionRow>(sql`
      select ${VIEW_COLUMNS} from calendar_connections
      where member_id = ${memberId}::uuid
      order by created_at desc, id desc
    `);
    return rows.rows.map(viewOf);
  });
}

/**
 * Connects an account the member consented to (AC-597, AC-599): the tokens
 * sealed, the connection `syncing`, its first full sync queued. The same
 * account again reconnects it (fresh tokens, a fresh full sync, its sharing
 * and default kept); a fourth account is `LIMIT_REACHED`. The member's first
 * connection becomes their default.
 */
export async function connectCalendar(
  scope: EngineScope,
  input: ConnectCalendarInput,
  hooks: readonly AfterWrite[] = [],
): Promise<CalendarConnectionView> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const accountEmail = normaliseEmail(input.exchanged.accountEmail);
  const sealed = sealTokens(input.tokenKey, input.exchanged, {
    workspaceId: scope.workspaceId,
    memberId,
    provider: input.provider,
    accountEmail,
  });
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      // The member's connections, locked, so two consents at once can't both take the third place.
      const mine = await tx.execute<{ id: string; provider: string; account_email: string }>(sql`
        select id::text as id, provider, account_email from calendar_connections
        where member_id = ${memberId}::uuid for update
      `);
      const existing = mine.rows.find((row) => row.provider === input.provider && row.account_email === accountEmail);
      if (existing === undefined && mine.rows.length >= MAX_CALENDAR_CONNECTIONS) {
        throw refuse('LIMIT_REACHED', CONNECTIONS_FULL);
      }
      const rows = await tx.execute<ConnectionRow>(sql`
        insert into calendar_connections (workspace_id, member_id, provider, account_email, status, is_default, tokens,
          created_by_type, created_by_id, created_by_member_id, updated_by_type, updated_by_id, updated_by_member_id)
        values (${scope.workspaceId}::uuid, ${memberId}::uuid, ${input.provider}, ${accountEmail}, 'syncing',
          ${mine.rows.length === 0}, ${sealed},
          'member', ${memberId}::uuid, ${memberId}::uuid, 'member', ${memberId}::uuid, ${memberId}::uuid)
        on conflict (workspace_id, member_id, provider, account_email) do update set
          tokens = excluded.tokens, status = 'syncing', sync_state = '{}'::jsonb, last_error = null,
          failing_since = null, calendars_listed_at = null, updated_at = now(), updated_by_type = 'member',
          updated_by_id = excluded.updated_by_id, updated_by_member_id = excluded.updated_by_member_id
        returning ${VIEW_COLUMNS}
      `);
      const [row] = rows.rows;
      if (row === undefined) throw new Error('A calendar connection just written could not be read back.');
      // Milestone 5: its main calendar from the first minute (AC-992), and a reconnect syncs every calendar in full.
      await addMainCalendar(tx, { workspaceId: scope.workspaceId, connectionId: row.id, memberId, name: accountEmail });
      await tx.execute(sql`
        update calendar_calendars set sync_state = '{}'::jsonb, last_error = null, failing_since = null
        where connection_id = ${row.id}::uuid
      `);
      // The first full sync, queued with the connection, so a rolled back connect queues nothing.
      await tx.execute(sql`select crm_enqueue_calendar_sync(${row.id}::uuid)`);
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/** Every meeting `connectionId` holds, with the records each shows on now. */
async function heldMeetings(tx: WorkspaceTx, connectionId: string): Promise<readonly MeetingChange[]> {
  const rows = await tx.execute<{ meeting_id: string; record_ids: string[] }>(sql`
    select s.meeting_id::text as meeting_id,
      coalesce((select array_agg(l.record_id::text) from meeting_records l
        where l.workspace_id = s.workspace_id and l.meeting_id = s.meeting_id), '{}') as record_ids
    from meeting_sources s where s.connection_id = ${connectionId}::uuid
  `);
  return rows.rows.map((row) => ({ meetingId: row.meeting_id, recordIds: row.record_ids }));
}

/**
 * Changes one of the member's own connections (AC-611): its sharing level
 * (every meeting it holds has its privacy worked out again, and its records'
 * timelines read again), or making it the member's default.
 */
export async function updateCalendarConnection(
  scope: EngineScope,
  input: UpdateCalendarConnectionInput,
  hooks: readonly AfterWrite[] = [],
): Promise<CalendarConnectionView> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const { result } = await runWrite(
    scope,
    async (context: WriteContext) => {
      const { tx } = context;
      const row = await ownConnection(tx, memberId, input.connectionId);
      const touch = sql`updated_at = now(), updated_by_type = 'member', updated_by_id = ${memberId}::uuid,
        updated_by_member_id = ${memberId}::uuid`;
      if (input.isDefault === true && !row.is_default) {
        await tx.execute(sql`
          update calendar_connections set is_default = false, ${touch}
          where member_id = ${memberId}::uuid and is_default
        `);
        await tx.execute(sql`update calendar_connections set is_default = true, ${touch} where id = ${row.id}::uuid`);
        // Milestone 5: new bookings go to its main calendar, when the member can write it (AC-996).
        const main = await tx.execute<{ id: string }>(sql`
          select id::text as id from calendar_calendars
          where connection_id = ${row.id}::uuid and is_primary and access_role in ('owner', 'writer')
        `);
        const mainId = main.rows[0]?.id;
        if (mainId !== undefined) {
          await tx.execute(sql`
            update calendar_calendars set is_destination = false, fell_back_from = null
            where member_id = ${memberId}::uuid and is_destination and id <> ${mainId}::uuid
          `);
          await tx.execute(sql`update calendar_calendars set is_destination = true where id = ${mainId}::uuid`);
        }
      }
      if (input.sharing !== undefined && input.sharing !== row.sharing) {
        await tx.execute(
          sql`update calendar_connections set sharing = ${input.sharing}::calendar_sharing, ${touch} where id = ${row.id}::uuid`,
        );
        const held = await heldMeetings(tx, row.id);
        await recomputePrivacy(
          tx,
          held.map((each) => each.meetingId),
        );
        context.record({ meetings: held });
      }
      const read = await tx.execute<ConnectionRow>(
        sql`select ${VIEW_COLUMNS} from calendar_connections where id = ${row.id}::uuid`,
      );
      const [after] = read.rows;
      if (after === undefined) throw new Error('A calendar connection just written could not be read back.');
      return viewOf(after);
    },
    hooks,
  );
  return result;
}

/**
 * Brings one of the member's own connections' next sync forward to now
 * (Sync now): the same keyed queue row a push notice moves, so pressing it
 * twice is one sync. Answers whether a sync was queued (a stopped connection
 * queues none).
 */
export async function syncCalendarNow(
  scope: EngineScope,
  input: { readonly connectionId: string },
): Promise<{ readonly queued: boolean }> {
  checkScope(scope);
  const memberId = actingMember(scope);
  return inWorkspace(scope, async (tx) => {
    const row = await ownConnection(tx, memberId, input.connectionId);
    const queued = await tx.execute<{ queued: boolean }>(
      sql`select crm_enqueue_calendar_sync(${row.id}::uuid) as queued`,
    );
    return { queued: queued.rows[0]?.queued === true };
  });
}

/**
 * Deletes connections (with their tokens and sources) and every meeting only
 * they held, in the write's transaction: what a disconnect and a member's
 * removal share. Answers how many meetings went.
 */
async function deleteConnections(context: WriteContext, connectionIds: readonly string[]): Promise<number> {
  if (connectionIds.length === 0) return 0;
  const { tx } = context;
  const held = (await Promise.all(connectionIds.map((id) => heldMeetings(tx, id)))).flat();
  await tx.execute(sql`delete from calendar_connections where id = any(${uuidList(connectionIds)})`);
  const meetingIds = [...new Set(held.map((each) => each.meetingId))];
  if (meetingIds.length === 0) return 0;
  const removed = await tx.execute(sql`
    delete from meetings m where m.id = any(${uuidList(meetingIds)})
      and not exists (select 1 from meeting_sources s where s.workspace_id = m.workspace_id and s.meeting_id = m.id)
  `);
  // Those another connection still holds may stop being private.
  await recomputePrivacy(tx, meetingIds);
  context.record({ meetings: held });
  return removed.rowCount ?? 0;
}

/**
 * Disconnects one of the member's own connections (AC-599): sync stops at
 * once (its queued sync finds it gone), its tokens go with the row, and the
 * meetings no other connection holds go too. When it was the default, the
 * member's newest other connection becomes it.
 */
export async function removeCalendarConnection(
  scope: EngineScope,
  input: { readonly connectionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<RemovedCalendarConnection> {
  checkScope(scope);
  const memberId = actingMember(scope);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const row = await ownConnection(context.tx, memberId, input.connectionId);
      // Its destination, by name, so the member is told which calendar new bookings no longer go to (AC-1005).
      const lost = await context.tx.execute<{ name: string }>(sql`
        select name from calendar_calendars where connection_id = ${row.id}::uuid and is_destination
      `);
      const meetingsRemoved = await deleteConnections(context, [row.id]);
      if (row.is_default) {
        await context.tx.execute(sql`
          update calendar_connections set is_default = true
          where id = (select id from calendar_connections where member_id = ${memberId}::uuid
            order by created_at desc, id desc limit 1)
        `);
      }
      // Its calendars went with it: a destination among them moves to the member's default connection (AC-1005).
      await fallBackDestination(context.tx, memberId, lost.rows[0]?.name);
      return { connectionId: row.id, meetingsRemoved };
    },
    hooks,
  );
  return result;
}

/**
 * A removed member's connections and the meetings only they held (AC-614),
 * inside `removeMember`'s write: spec 0009's removal hook.
 */
export async function deleteMemberCalendars(context: WriteContext, memberId: string): Promise<void> {
  const rows = await context.tx.execute<{ id: string }>(sql`
    select id::text as id from calendar_connections where member_id = ${memberId}::uuid for update
  `);
  await deleteConnections(
    context,
    rows.rows.map((row) => row.id),
  );
}
