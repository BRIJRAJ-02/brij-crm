// Syncing one connection (spec 0024, Sync): what the worker's
// `crm_calendar_sync` task runs, one at a time per connection. It refreshes
// the access token when it expires within 5 minutes, lists the changes since
// the stored sync token (or every event in the window, a full sync: 90 days
// back, 180 ahead), writes them in batches (`apply.ts`, one transaction and
// one `meetings` outbox row each), and only then stores the next sync token,
// so a crash in between syncs the same changes again (every write is an
// upsert). A 410 Gone clears the token and syncs in full; a full sync drops
// this connection's copies of events in the window the provider no longer
// lists. The provider is called outside every transaction.
//
// What it answers tells the task when to run again: 15 minutes after a sync
// (the poll fallback, AC-602), sooner and backing off after a failure it
// records on the connection, never for a connection that stopped. A refused
// grant marks the connection `expired` and stops it (AC-619); any other
// failure that has lasted 6 hours marks it `failed` (AC-620), and the sync
// keeps trying at the poll's pace, so a long outage heals by itself. With a
// push address, a successful sync also opens (or renews) each calendar's
// push channel (`push.ts`), whose notices bring the next run forward.
//
// Milestone 5 (AC-991, AC-1003): a run first lists the account's calendars
// when it never has, when the member pressed Refresh, or once a day
// (`storeCalendars`), then syncs each pulled calendar (one that syncs
// meetings or shows on the member's week) by its own sync token, one after
// another, and stops the channel of any calendar no longer pulled. One
// calendar failing is recorded on that calendar and never stops the others;
// a refused grant, or every pulled calendar failing, is the connection's.
//
// A run in a deleted workspace (spec 0031, AC-823) syncs nothing: it ends
// each calendar's push channel at the provider, so the provider stops posting
// notices for a workspace nobody can open, and stops. A revoked connection's
// run (its member removed, its workspace purged; AC-815) ends its channels
// too, then its grant, unless another connection in any workspace still
// holds the account (Google ends a user's whole grant to the app), and goes.
// What became of every channel it touched is in its outcome (`channels`), for
// the log.
import { sql } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { queueCalendarDisconnected } from '../emails/queue.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { applyEvents, dropBusyTimes, dropSources } from './apply.ts';
import { CALENDARS_LIST_EVERY_MS, isPulled, moveDestinationOff, storeCalendars } from './calendars.ts';
import { isBusyOnly } from './match.ts';
import {
  failureOf,
  isProviderError,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTokens,
  type ProviderChanges,
  type ProviderFailure,
  type SyncWindow,
} from './provider.ts';
import {
  needsChannel,
  openChannel,
  pushPaused,
  stopChannel,
  storedChannel,
  type ChannelReport,
  type ChannelStopReason,
  type StoredChannel,
} from './push.ts';
import { openTokens, sealTokens, type TokenBinding, type TokenKey } from './tokens.ts';

/** How far back and ahead a full sync reads (spec 0024's call). */
export const SYNC_DAYS_BACK = 90;
export const SYNC_DAYS_AHEAD = 180;

/** The poll fallback: a connection syncs at least this often (AC-602). */
export const POLL_INTERVAL_MS = 15 * 60_000;

/** A token expiring within this is refreshed first. */
export const REFRESH_LEAD_MS = 5 * 60_000;

/** Events one transaction writes. */
export const APPLY_BATCH = 200;

/** The first wait after a failure, doubled while failures last, never past the poll interval. */
export const RETRY_FIRST_MS = 60_000;

/** How long failures last before a connection is `failed` (AC-620). */
export const FAILED_AFTER_MS = 6 * 3_600_000;

/** The statuses a connection syncs in: a `failed` one keeps trying, and heals on its next success. */
export const SYNCING_STATUSES = ['syncing', 'connected', 'failed'] as const;

const DAY_MS = 86_400_000;

/** The full sync's window around `now`. */
export function syncWindow(now: Date): SyncWindow {
  return {
    from: new Date(now.getTime() - SYNC_DAYS_BACK * DAY_MS).toISOString(),
    to: new Date(now.getTime() + SYNC_DAYS_AHEAD * DAY_MS).toISOString(),
  };
}

/** What a sync needs, passed in by the worker. */
export interface CalendarSyncDeps {
  /** The adapter for each provider this deployment connects (Google in milestone 1). */
  readonly providers: Readonly<Partial<Record<'google' | 'microsoft', CalendarProvider>>>;
  readonly tokenKey: TokenKey;
  /** The system's scope in a workspace: the sync reads and writes as the system, storing the `calendar` actor. */
  readonly systemScope: (workspaceId: string) => EngineScope;
  /** The write hooks every background write stores its events through (the outbox). */
  readonly hooks: readonly AfterWrite[];
  /** Whether an email domain is a free one (gmail.com), which names no company (AC-607). */
  readonly isFreeDomain: (domain: string) => boolean;
  /**
   * Where the provider posts change notices (`<CALENDAR_WEBHOOK_ORIGIN>/api/calendar/google/notify`).
   * Absent (local development, no public origin), no channel opens and the poll alone keeps calendars current.
   */
  readonly pushAddress?: string;
  /** Each provider's notify address (Graph's is `/api/calendar/microsoft/notify`); Google's falls back to `pushAddress`. */
  readonly pushAddresses?: Readonly<Partial<Record<'google' | 'microsoft', string>>>;
  /** A write stored a change event outside the batches (a listing removed a calendar's meetings): wake the relay. */
  readonly onStored?: () => void;
  readonly now?: () => Date;
}

/** Which connection to sync. */
export interface CalendarSyncInput {
  readonly workspaceId: string;
  readonly connectionId: string;
}

/** One pulled calendar a run couldn't sync (the others still did): its row id and the provider's refusal. */
export type CalendarFailure = { readonly calendarId: string } & ProviderFailure;

/**
 * How a sync ended, and when the next one should run (`nextInMs`), if ever. `channels`, when the run opened, failed
 * to open or ended any push channel, says what became of each (the `calendar.channel` log lines); `failedCalendars`,
 * when one or more pulled calendars couldn't be read while the account synced, names them, so a calendar that
 * silently stops syncing shows in the log (`calendar.sync`).
 */
export type CalendarSyncOutcome = (
  | { readonly kind: 'synced'; readonly full: boolean; readonly events: number; readonly nextInMs: number }
  | { readonly kind: 'retry'; readonly code: CalendarErrorCode; readonly nextInMs: number }
  | {
      readonly kind: 'stopped';
      readonly reason: 'gone' | 'not-syncing' | 'expired' | 'no-provider' | 'revoked' | 'workspace-deleted';
      /**
       * A revoked connection whose grant was kept: another connection, in any workspace, still holds the account,
       * so only this one's tokens and channels went (Google ends the whole grant of a user to the app).
       */
      readonly grantKept?: true;
    }
) & { readonly channels?: readonly ChannelReport[]; readonly failedCalendars?: readonly CalendarFailure[] };

/** An outcome with the channel reports and calendar failures a run gathered, when it gathered any. */
function withReports(
  outcome: CalendarSyncOutcome,
  channels: readonly ChannelReport[],
  failedCalendars: readonly CalendarFailure[] = [],
): CalendarSyncOutcome {
  return {
    ...outcome,
    ...(channels.length === 0 ? {} : { channels }),
    ...(failedCalendars.length === 0 ? {} : { failedCalendars }),
  };
}

/** A connection as the sync reads it. */
interface ConnectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly member_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly account_email: string;
  readonly status: string;
  readonly tokens: Buffer;
  readonly failing_since: string | null;
  /** Whether its calendars are due to be listed: never yet, Refresh, or a day since. */
  readonly list_due: boolean;
  /** Its workspace was deleted (spec 0031, AC-823): the sync stops until a restore. */
  readonly workspace_deleted: boolean;
}

/** One calendar as the sync reads it. */
interface CalendarSyncRow extends Record<string, unknown> {
  readonly id: string;
  readonly provider_calendar_id: string;
  readonly name: string;
  readonly sync: boolean;
  readonly show_in_week: boolean;
  readonly sync_token: string | null;
  readonly channel: unknown;
  readonly workspace_deleted: boolean;
}

/** The failure messages a connection shows in Settings: plain, and never the provider's own words. */
export const FAILURE_MESSAGES: Readonly<Record<CalendarErrorCode, string>> = {
  CALENDAR_AUTH_REVOKED: 'The calendar account no longer lets Timefix read it. Reconnect it.',
  CALENDAR_AUTH: 'The calendar account refused the request. If it keeps happening, reconnect it.',
  CALENDAR_SYNC_TOKEN_GONE: 'The calendar asked for a full sync.',
  CALENDAR_UNAVAILABLE: 'The calendar didn’t answer. Timefix tries again shortly.',
  CALENDAR_SCOPE_DECLINED: 'The calendar was connected without the access Timefix needs. Reconnect it.',
  CALENDAR_GONE: 'This calendar is no longer in the account.',
};

/** A failure as `recordFailure` stored it: when failures began, and the status before and after. */
interface FailureRow extends Record<string, unknown> {
  readonly failing_since: string;
  readonly since: string;
  readonly status: string;
  readonly was: string;
  readonly member_id: string;
  readonly account_email: string;
  readonly provider: 'google' | 'microsoft';
}

/**
 * Records a failure on the connection: its code and message, and since when.
 * A refused grant marks it `expired` (AC-619); any failure once failures
 * have lasted 6 hours marks it `failed` (AC-620). The moment it becomes one
 * of those, its member is told by email (`calendar_disconnected`), queued in
 * the same transaction, once per failing spell and reason.
 */
async function recordFailure(
  scope: EngineScope,
  connectionId: string,
  code: CalendarErrorCode,
): Promise<{ readonly since: string; readonly movedFor?: string }> {
  const rows = await inWorkspace(scope, async (tx) => {
    const stored = await tx.execute<FailureRow>(sql`
      with before as (
        select id, status from calendar_connections
        where id = ${connectionId}::uuid and status in ('syncing', 'connected', 'failed')
        for update
      )
      update calendar_connections c set
        last_error = ${JSON.stringify({ code, message: FAILURE_MESSAGES[code] })}::jsonb,
        failing_since = coalesce(c.failing_since, now()),
        status = case
          when ${code === 'CALENDAR_AUTH_REVOKED'} then 'expired'::calendar_status
          when coalesce(c.failing_since, now()) <= now() - make_interval(secs => ${FAILED_AFTER_MS / 1000})
            then 'failed'::calendar_status
          else c.status end,
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      from before
      where c.id = before.id
      returning c.failing_since::text as failing_since, to_json(c.failing_since)#>>'{}' as since,
        c.status::text as status, before.status::text as was, c.member_id::text as member_id, c.account_email,
        c.provider::text as provider
    `);
    const [row] = stored.rows;
    if (row !== undefined && (row.status === 'expired' || row.status === 'failed') && row.was !== row.status) {
      const workspace = await tx.execute<{ slug: string }>(sql`select slug from workspaces`);
      await queueCalendarDisconnected(tx, {
        connectionId,
        memberId: row.member_id,
        reason: row.status,
        since: new Date(row.since),
        params: {
          provider: row.provider,
          accountEmail: row.account_email,
          reason: row.status,
          settingsPath: `/w/${encodeURIComponent(workspace.rows[0]?.slug ?? '')}/settings/scheduling/calendars`,
        },
      });
    }
    // A stopped account no longer takes bookings: they move to the member's other account, and they are told.
    if (row?.status === 'expired' || row?.status === 'failed') await moveDestinationOff(tx, connectionId);
    return stored;
  });
  const [row] = rows.rows;
  return {
    since: row?.failing_since ?? new Date().toISOString(),
    ...(row !== undefined && row.was !== row.status ? { movedFor: row.member_id } : {}),
  };
}

/**
 * Tells the member's own tabs that their calendar connections changed (the `calendars` live kind): a write with
 * nothing in it but the member, so the outbox hook in `hooks` stores the one row. Only when something they see
 * moved (a status, a listing), never on each quiet poll, so a team's channel isn't a stream of stubs.
 */
async function tellCalendars(scope: EngineScope, hooks: readonly AfterWrite[], memberId: string): Promise<void> {
  await runWrite(
    scope,
    (context) => {
      context.record({ calendars: [memberId] });
      return Promise.resolve();
    },
    hooks,
  );
}

/** The wait before trying again: the time failures have lasted, at least a minute, at most the poll interval. */
export function retryDelay(failingSince: string, now: Date): number {
  const lasted = now.getTime() - Date.parse(failingSince);
  return Math.min(POLL_INTERVAL_MS, Math.max(RETRY_FIRST_MS, Number.isFinite(lasted) ? lasted : RETRY_FIRST_MS));
}

/** The connection's live tokens: refreshed (and stored sealed) when they expire within 5 minutes (booking reads them too). */
export async function liveTokens(
  deps: Pick<CalendarSyncDeps, 'tokenKey'>,
  scope: EngineScope,
  provider: CalendarProvider,
  row: { readonly id: string; readonly tokens: Buffer },
  binding: TokenBinding,
  now: Date,
): Promise<CalendarTokens> {
  const tokens = openTokens(deps.tokenKey, row.tokens, binding);
  if (Date.parse(tokens.expiresAt) - now.getTime() > REFRESH_LEAD_MS) return tokens;
  const fresh = await provider.refresh(tokens);
  await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      update calendar_connections set tokens = ${sealTokens(deps.tokenKey, fresh, binding)},
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      where id = ${row.id}::uuid
    `),
  );
  return fresh;
}

/** What a main calendar says when its account's grant can't list the account's other calendars. */
export const LIST_REFUSED = 'Reconnect this account to choose from its other calendars.';

/** Records one calendar's sync failure on it (AC-995's warning reads it), keeping when the failures began. */
async function recordCalendarFailure(scope: EngineScope, calendarRowId: string, code: CalendarErrorCode) {
  await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      update calendar_calendars set
        last_error = jsonb_build_object('code', ${code}::text, 'message', ${FAILURE_MESSAGES[code]}::text,
          'source', 'sync', 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
        failing_since = coalesce(failing_since, now())
      where id = ${calendarRowId}::uuid
    `),
  );
}

/** What syncing one calendar did. */
type CalendarRun =
  | { readonly kind: 'synced'; readonly full: boolean; readonly events: number }
  | { readonly kind: 'off' }
  | { readonly kind: 'failed'; readonly code: CalendarErrorCode; readonly failure: ProviderFailure };

/**
 * Ends each push channel a connection's calendars hold at the provider, and answers what became of each. A channel
 * the provider couldn't end for now (it didn't answer) stays stored, so a notice it still sends queues the account's
 * run again; one it ended, or refused for good (the grant is gone), is forgotten, since nothing more can end it, and
 * it runs out within days. None is asked for without the provider.
 */
async function endChannels(
  deps: Pick<CalendarSyncDeps, 'tokenKey'>,
  scope: EngineScope,
  provider: CalendarProvider,
  row: Pick<ConnectionRow, 'id' | 'tokens'>,
  binding: TokenBinding,
  now: Date,
  why: ChannelStopReason,
): Promise<readonly ChannelReport[]> {
  const held = (
    await inWorkspace(scope, (tx) =>
      tx.execute<{ id: string; channel: unknown }>(sql`
        select id::text as id, channel from calendar_calendars
        where connection_id = ${row.id}::uuid and channel is not null
        order by is_primary desc, name, id
      `),
    )
  ).rows.flatMap((each): { readonly id: string; readonly channel: StoredChannel }[] => {
    const channel = storedChannel(each.channel);
    return channel === undefined ? [] : [{ id: each.id, channel }];
  });
  if (held.length === 0) return [];
  let tokens: CalendarTokens | undefined;
  let refused: ProviderFailure | undefined;
  try {
    tokens = await liveTokens(deps, scope, provider, row, binding, now);
  } catch (error) {
    if (!isProviderError(error)) throw error;
    refused = failureOf(error);
  }
  const channels: ChannelReport[] = [];
  for (const each of held) {
    const failure = tokens === undefined ? refused : await stopChannel(provider, tokens, each.channel);
    if (failure?.code !== 'CALENDAR_UNAVAILABLE') {
      await inWorkspace(scope, (tx) =>
        tx.execute(sql`
          update calendar_calendars set channel = null
          where id = ${each.id}::uuid and channel ->> 'id' = ${each.channel.id}
        `),
      );
    }
    channels.push(
      failure === undefined
        ? { calendarId: each.id, outcome: 'stopped', why }
        : { calendarId: each.id, outcome: 'unstopped', why, ...failure },
    );
  }
  return channels;
}

/**
 * Ends a revoked connection (spec 0031, AC-815): its push channels end at the
 * provider, the provider ends its grant, then the row goes with its sealed
 * tokens; the meetings it held stay, flagged when the member was removed.
 * Google ends the whole grant of a user to the app, which would break the same
 * account's connection in the person's other workspaces: so when another
 * connection, in any workspace, still holds the account and may sync
 * (`crm_calendar_account_shared`), the grant is kept and only this
 * connection's channels and tokens go. A provider failure on the revoke
 * throws, so the task tries again later, and never blocked the removal, which
 * committed long before. A grant already gone still lets the row go; a
 * provider the worker doesn't run keeps the row for one that does.
 */
async function revokeConnection(
  deps: Pick<CalendarSyncDeps, 'tokenKey'>,
  scope: EngineScope,
  provider: CalendarProvider | undefined,
  row: Pick<ConnectionRow, 'id' | 'tokens'>,
  binding: TokenBinding,
  now: Date,
): Promise<CalendarSyncOutcome> {
  // A worker without this provider leaves the row for one that has it, so the grant is still ended.
  if (provider === undefined) return { kind: 'stopped', reason: 'no-provider' };
  const shared = await inWorkspace(scope, (tx) =>
    tx.execute<{ shared: boolean }>(sql`select crm_calendar_account_shared(${row.id}::uuid) as shared`),
  );
  const grantKept = shared.rows[0]?.shared === true;
  const channels = await endChannels(deps, scope, provider, row, binding, now, 'revoked');
  if (!grantKept) {
    try {
      await provider.revoke(openTokens(deps.tokenKey, row.tokens, binding));
    } catch (error) {
      if (!isProviderError(error, 'CALENDAR_AUTH_REVOKED') && !isProviderError(error, 'CALENDAR_AUTH')) throw error;
    }
  }
  await inWorkspace(scope, (tx) =>
    tx.execute(sql`delete from calendar_connections where id = ${row.id}::uuid and status = 'revoked'`),
  );
  return withReports({ kind: 'stopped', reason: 'revoked', ...(grantKept ? { grantKept } : {}) }, channels);
}

/**
 * A deleted workspace's account (spec 0031, AC-823): nothing syncs, and each of its calendars' push channels ends at
 * the provider (`endChannels`), so the provider stops posting notices for a workspace nobody can open. The grant
 * itself is kept: the member's other workspaces may hold the same account, and a restore syncs it again.
 */
async function endDeletedChannels(
  deps: Pick<CalendarSyncDeps, 'tokenKey'>,
  scope: EngineScope,
  provider: CalendarProvider | undefined,
  row: Pick<ConnectionRow, 'id' | 'tokens'>,
  binding: TokenBinding,
  now: Date,
): Promise<CalendarSyncOutcome> {
  const stopped: CalendarSyncOutcome = { kind: 'stopped', reason: 'workspace-deleted' };
  // A worker without this provider can't reach it: the channels wait for one that can.
  if (provider === undefined) return stopped;
  return withReports(stopped, await endChannels(deps, scope, provider, row, binding, now, 'workspace-deleted'));
}

/**
 * Syncs one pulled calendar: its changes since its token, or its whole window. Every batch is written before its
 * next token is stored. A provider failure is answered, not thrown.
 */
async function syncCalendar(
  deps: CalendarSyncDeps,
  scope: EngineScope,
  provider: CalendarProvider,
  tokens: CalendarTokens,
  connection: { readonly id: string; readonly memberId: string },
  calendar: CalendarSyncRow,
  window: SyncWindow,
): Promise<CalendarRun> {
  let changes: ProviderChanges;
  let full = calendar.sync_token === null;
  try {
    try {
      changes = await provider.listChanges(
        tokens,
        calendar.provider_calendar_id,
        calendar.sync_token ?? undefined,
        window,
      );
    } catch (error) {
      // The token expired (410 Gone, Graph's syncStateNotFound): sync the whole window again.
      if (!isProviderError(error, 'CALENDAR_SYNC_TOKEN_GONE') || full) throw error;
      full = true;
      changes = await provider.listChanges(tokens, calendar.provider_calendar_id, undefined, window);
    }
  } catch (error) {
    if (!isProviderError(error)) throw error;
    return { kind: 'failed', code: error.code, failure: failureOf(error) };
  }
  const synced = { ...connection, calendarId: calendar.provider_calendar_id, syncs: calendar.sync };
  const { events } = changes;
  for (let start = 0; start < events.length; start += APPLY_BATCH) {
    const batch = events.slice(start, start + APPLY_BATCH);
    const { result } = await runWrite(
      scope,
      (context) => applyEvents(context, synced, batch, deps.isFreeDomain),
      deps.hooks,
    );
    if (result === 'gone') return { kind: 'off' };
  }
  if (full) {
    // The provider listed every event in the window: this calendar's copies of any other there are gone.
    const listed = events.filter((event) => event.status !== 'cancelled').map((event) => event.id);
    const busy = events.filter(isBusyOnly).map((event) => event.id);
    await runWrite(
      scope,
      async (context) => {
        context.record({
          meetings: await dropSources(context.tx, connection.id, calendar.provider_calendar_id, {
            allBut: listed,
            ...window,
          }),
        });
        await dropBusyTimes(context.tx, connection.id, calendar.provider_calendar_id, { allBut: busy, ...window });
      },
      deps.hooks,
    );
  }
  // Only now, with every batch committed, the next sync token; and the calendar's own sync failure, if any, healed.
  const stored = await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      update calendar_calendars set sync_state = ${JSON.stringify({ syncToken: changes.nextSyncToken })}::jsonb,
        last_error = case when last_error ->> 'source' = 'sync' then null else last_error end,
        failing_since = case when last_error ->> 'source' = 'sync' then null else failing_since end
      where id = ${calendar.id}::uuid and (sync or show_in_week)
    `),
  );
  if (stored.rowCount === 0) return { kind: 'off' };
  return { kind: 'synced', full, events: events.length };
}

/**
 * Syncs one connection: its calendars listed when due, then each pulled calendar's changes since its last sync,
 * or its whole window. Expected provider failures are recorded (on the connection, or on the one calendar) and
 * answered as `retry` (or `stopped` for a refused grant, which marks the connection `expired`); anything else
 * throws, and the task's own retries take it.
 */
export async function syncConnection(deps: CalendarSyncDeps, input: CalendarSyncInput): Promise<CalendarSyncOutcome> {
  const now = deps.now?.() ?? new Date();
  const scope = deps.systemScope(input.workspaceId);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<ConnectionRow>(sql`
      select id::text as id, member_id::text as member_id, provider, account_email, status, tokens,
        failing_since::text as failing_since,
        (calendars_listed_at is null
          or calendars_listed_at <= now() - make_interval(secs => ${CALENDARS_LIST_EVERY_MS / 1000})) as list_due,
        exists (select 1 from workspaces w where w.id = calendar_connections.workspace_id and w.deleted_at is not null)
          as workspace_deleted
      from calendar_connections where id = ${input.connectionId}::uuid
    `),
  );
  const [row] = found.rows;
  if (row === undefined) return { kind: 'stopped', reason: 'gone' };
  const provider = deps.providers[row.provider];
  const binding: TokenBinding = {
    workspaceId: input.workspaceId,
    memberId: row.member_id,
    provider: row.provider,
    accountEmail: row.account_email,
  };
  // A removed member's connection (spec 0031, AC-815): its channels and grant end with the provider (the grant only
  // when no other connection holds the account), then its stored tokens go.
  if (row.status === 'revoked') return revokeConnection(deps, scope, provider, row, binding, now);
  // A deleted workspace (spec 0031, AC-823) syncs nothing in its window and ends its push channels; a restore queues
  // each connection again, which opens new ones.
  if (row.workspace_deleted) return endDeletedChannels(deps, scope, provider, row, binding, now);
  if (!(SYNCING_STATUSES as readonly string[]).includes(row.status)) return { kind: 'stopped', reason: 'not-syncing' };
  if (provider === undefined) return { kind: 'stopped', reason: 'no-provider' };
  const window = syncWindow(now);
  const connection = { id: row.id, memberId: row.member_id };
  const failed = async (code: CalendarErrorCode): Promise<CalendarSyncOutcome> => {
    const { since, movedFor } = await recordFailure(scope, row.id, code);
    if (movedFor !== undefined) await tellCalendars(scope, deps.hooks, movedFor);
    if (code === 'CALENDAR_AUTH_REVOKED') return { kind: 'stopped', reason: 'expired' };
    return { kind: 'retry', code, nextInMs: retryDelay(since, now) };
  };

  let tokens: CalendarTokens;
  try {
    tokens = await liveTokens(deps, scope, provider, row, binding, now);
  } catch (error) {
    if (!isProviderError(error)) throw error;
    return failed(error.code);
  }
  if (row.list_due) {
    try {
      const listed = await provider.listCalendars(tokens);
      const stored = await runWrite(
        scope,
        async (context) => {
          const result = await storeCalendars(context, connection, listed);
          context.record({ meetings: result.meetings, calendars: [connection.memberId] });
          return result;
        },
        deps.hooks,
      );
      if (stored.result.meetings.length > 0) deps.onStored?.();
    } catch (error) {
      if (!isProviderError(error)) throw error;
      if (error.code === 'CALENDAR_AUTH_REVOKED') return failed(error.code);
      // A grant from before milestone 5 can't list calendars (Google's calendar list scope): the calendars it has
      // keep syncing, its main one says to reconnect, and the listing is tried again tomorrow. A passing failure
      // leaves the listing due.
      if (error.code === 'CALENDAR_AUTH' || error.code === 'CALENDAR_SCOPE_DECLINED') {
        await inWorkspace(scope, async (tx) => {
          await tx.execute(sql`update calendar_connections set calendars_listed_at = now() where id = ${row.id}::uuid`);
          await tx.execute(sql`
            update calendar_calendars set last_error = jsonb_build_object('code', 'CALENDAR_SCOPE_DECLINED',
              'message', ${LIST_REFUSED}::text, 'source', 'list',
              'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
            where connection_id = ${row.id}::uuid and is_primary and last_error is null
          `);
        });
      }
    }
  }

  const calendars = (
    await inWorkspace(scope, (tx) =>
      tx.execute<CalendarSyncRow>(sql`
        select id::text as id, provider_calendar_id, name, sync, show_in_week,
          sync_state ->> 'syncToken' as sync_token, channel
        from calendar_calendars where connection_id = ${row.id}::uuid
        order by is_primary desc, name, id
      `),
    )
  ).rows;
  const pulled = calendars.filter(isPulled);
  const pushAddress = deps.pushAddresses?.[row.provider] ?? (row.provider === 'google' ? deps.pushAddress : undefined);
  let events = 0;
  let full = false;
  let failures = 0;
  let relist = false;
  let lastCode: CalendarErrorCode | undefined;
  // What became of each push channel this run touched, and each calendar it couldn't read, for the log.
  const channels: ChannelReport[] = [];
  const failedCalendars: CalendarFailure[] = [];
  for (const calendar of pulled) {
    const run = await syncCalendar(deps, scope, provider, tokens, connection, calendar, window);
    if (run.kind === 'synced') {
      events += run.events;
      full ||= run.full;
      // Push (AC-602, AC-622, AC-1003): a channel opened once the calendar is current, and renewed before it runs out;
      // none asked for, and nothing said, while a refusal for good waits out its day (`noPushUntil`).
      const channel = storedChannel(calendar.channel);
      if (pushAddress !== undefined && needsChannel(channel, now) && !pushPaused(calendar.channel, now)) {
        channels.push(
          await openChannel(scope, {
            provider,
            tokens,
            calendarRowId: calendar.id,
            calendarId: calendar.provider_calendar_id,
            address: pushAddress,
            previous: channel,
            stored: calendar.channel,
            now,
          }),
        );
      }
      continue;
    }
    if (run.kind === 'off') continue;
    // A refused grant is the whole account's.
    if (
      run.code === 'CALENDAR_AUTH_REVOKED' ||
      run.code === 'CALENDAR_AUTH' ||
      run.code === 'CALENDAR_SCOPE_DECLINED'
    ) {
      return withReports(await failed(run.code), channels, failedCalendars);
    }
    failures += 1;
    lastCode = run.code;
    if (run.code === 'CALENDAR_GONE') relist = true;
    failedCalendars.push({ calendarId: calendar.id, ...run.failure });
    await recordCalendarFailure(scope, calendar.id, run.code);
  }
  // A calendar no longer pulled stops its channel at the provider.
  for (const calendar of calendars.filter((each) => !isPulled(each))) {
    const channel = storedChannel(calendar.channel);
    if (channel === undefined) continue;
    const failure = await stopChannel(provider, tokens, channel);
    await inWorkspace(scope, (tx) =>
      tx.execute(sql`update calendar_calendars set channel = null where id = ${calendar.id}::uuid`),
    );
    channels.push(
      failure === undefined
        ? { calendarId: calendar.id, outcome: 'stopped', why: 'not-pulled' }
        : { calendarId: calendar.id, outcome: 'unstopped', why: 'not-pulled', ...failure },
    );
  }
  if (relist) {
    // A calendar the provider no longer has: the next run lists the account's calendars again.
    await inWorkspace(scope, (tx) =>
      tx.execute(sql`update calendar_connections set calendars_listed_at = null where id = ${row.id}::uuid`),
    );
  }
  // Every pulled calendar failing is the connection's failure: it backs off, and fails after 6 hours (AC-620).
  if (pulled.length > 0 && failures === pulled.length && lastCode !== undefined) {
    return withReports(await failed(lastCode), channels, failedCalendars);
  }
  const stored = await inWorkspace(scope, (tx) =>
    tx.execute<{ was: string }>(sql`
      with before as (
        select id, status from calendar_connections
        where id = ${row.id}::uuid and status in ('syncing', 'connected', 'failed')
        for update
      )
      update calendar_connections c set
        status = 'connected', last_synced_at = now(), last_error = null, failing_since = null,
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      from before
      where c.id = before.id
      returning before.status::text as was
    `),
  );
  const [synced] = stored.rows;
  if (synced === undefined) return withReports({ kind: 'stopped', reason: 'gone' }, channels, failedCalendars);
  // Connected again (a first sync, or healed): the member's other tabs show it.
  if (synced.was !== 'connected') await tellCalendars(scope, deps.hooks, row.member_id);
  return withReports(
    {
      kind: 'synced',
      full,
      events,
      nextInMs: relist ? RETRY_FIRST_MS : POLL_INTERVAL_MS,
    },
    channels,
    failedCalendars,
  );
}
