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
// push address, a successful sync also opens (or renews) the connection's
// push channel (`push.ts`), whose notices bring the next run forward.
import { sql } from 'drizzle-orm';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { applyEvents, dropBusyTimes, dropSources } from './apply.ts';
import { isBusyOnly } from './match.ts';
import {
  isProviderError,
  type CalendarErrorCode,
  type CalendarProvider,
  type CalendarTokens,
  type ProviderEvent,
  type SyncWindow,
} from './provider.ts';
import { needsChannel, openChannel, storedChannel } from './push.ts';
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

/** The only calendar milestone 1 syncs (a Follow-up adds more). */
export const PRIMARY_CALENDAR = 'primary';

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
  readonly now?: () => Date;
}

/** Which connection to sync. */
export interface CalendarSyncInput {
  readonly workspaceId: string;
  readonly connectionId: string;
}

/** How a sync ended, and when the next one should run (`nextInMs`), if ever. */
export type CalendarSyncOutcome =
  | { readonly kind: 'synced'; readonly full: boolean; readonly events: number; readonly nextInMs: number }
  | { readonly kind: 'retry'; readonly code: CalendarErrorCode; readonly nextInMs: number }
  | {
      readonly kind: 'stopped';
      readonly reason: 'gone' | 'not-syncing' | 'expired' | 'no-provider' | 'revoked' | 'workspace-deleted';
    };

/** A connection as the sync reads it. */
interface ConnectionRow extends Record<string, unknown> {
  readonly id: string;
  readonly member_id: string;
  readonly provider: 'google' | 'microsoft';
  readonly account_email: string;
  readonly status: string;
  readonly tokens: Buffer;
  readonly sync_token: string | null;
  readonly failing_since: string | null;
  readonly channel: unknown;
  readonly workspace_deleted: boolean;
}

/** The failure messages a connection shows in Settings: plain, and never the provider's own words. */
const FAILURE_MESSAGES: Readonly<Record<CalendarErrorCode, string>> = {
  CALENDAR_AUTH_REVOKED: 'Google no longer lets Timefix read this calendar. Reconnect it.',
  CALENDAR_AUTH: 'Google refused the calendar request. If it keeps happening, reconnect it.',
  CALENDAR_SYNC_TOKEN_GONE: 'The calendar asked for a full sync.',
  CALENDAR_UNAVAILABLE: 'Google’s calendar didn’t answer. Timefix tries again shortly.',
  CALENDAR_SCOPE_DECLINED: 'The calendar was connected without the access Timefix needs. Reconnect it.',
};

/**
 * Records a failure on the connection: its code and message, and since when.
 * A refused grant marks it `expired` (AC-619); any failure once failures
 * have lasted 6 hours marks it `failed` (AC-620).
 */
async function recordFailure(scope: EngineScope, connectionId: string, code: CalendarErrorCode): Promise<string> {
  const rows = await inWorkspace(scope, (tx) =>
    tx.execute<{ failing_since: string }>(sql`
      update calendar_connections set
        last_error = ${JSON.stringify({ code, message: FAILURE_MESSAGES[code] })}::jsonb,
        failing_since = coalesce(failing_since, now()),
        status = case
          when ${code === 'CALENDAR_AUTH_REVOKED'} then 'expired'::calendar_status
          when coalesce(failing_since, now()) <= now() - make_interval(secs => ${FAILED_AFTER_MS / 1000})
            then 'failed'::calendar_status
          else status end,
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      where id = ${connectionId}::uuid and status in ('syncing', 'connected', 'failed')
      returning failing_since::text as failing_since
    `),
  );
  return rows.rows[0]?.failing_since ?? new Date().toISOString();
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
  row: Pick<ConnectionRow, 'id' | 'tokens'>,
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

/**
 * Ends a revoked connection (spec 0031, AC-815): the provider ends its grant,
 * then the row goes with its sealed tokens; the meetings it held stay,
 * flagged when the member was removed. A provider failure throws, so the
 * task tries again later, and never blocked the removal, which committed
 * long before. A grant already gone still lets the row go; a provider the
 * worker doesn't run keeps the row for one that does.
 */
async function revokeConnection(
  deps: Pick<CalendarSyncDeps, 'tokenKey'>,
  scope: EngineScope,
  provider: CalendarProvider | undefined,
  row: Pick<ConnectionRow, 'id' | 'tokens'>,
  binding: TokenBinding,
): Promise<CalendarSyncOutcome> {
  // A worker without this provider leaves the row for one that has it, so the grant is still ended.
  if (provider === undefined) return { kind: 'stopped', reason: 'no-provider' };
  try {
    await provider.revoke(openTokens(deps.tokenKey, row.tokens, binding));
  } catch (error) {
    if (!isProviderError(error, 'CALENDAR_AUTH_REVOKED') && !isProviderError(error, 'CALENDAR_AUTH')) throw error;
  }
  await inWorkspace(scope, (tx) =>
    tx.execute(sql`delete from calendar_connections where id = ${row.id}::uuid and status = 'revoked'`),
  );
  return { kind: 'stopped', reason: 'revoked' };
}

/**
 * Syncs one connection: its changes since the last sync, or its whole window.
 * Expected provider failures are recorded on the connection and answered as
 * `retry` (or `stopped` for a refused grant, which marks it `expired`);
 * anything else throws, and the task's own retries take it.
 */
export async function syncConnection(deps: CalendarSyncDeps, input: CalendarSyncInput): Promise<CalendarSyncOutcome> {
  const now = deps.now?.() ?? new Date();
  const scope = deps.systemScope(input.workspaceId);
  const found = await inWorkspace(scope, (tx) =>
    tx.execute<ConnectionRow>(sql`
      select id::text as id, member_id::text as member_id, provider, account_email, status, tokens,
        sync_state #>> ${`{${PRIMARY_CALENDAR},syncToken}`} as sync_token, failing_since::text as failing_since,
        channel,
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
  // A removed member's connection (spec 0031, AC-815): its grant ends with the provider, then its stored tokens go.
  if (row.status === 'revoked') return revokeConnection(deps, scope, provider, row, binding);
  // A deleted workspace (spec 0031, AC-823) syncs nothing in its window; a restore queues each connection again.
  if (row.workspace_deleted) return { kind: 'stopped', reason: 'workspace-deleted' };
  if (!(SYNCING_STATUSES as readonly string[]).includes(row.status)) return { kind: 'stopped', reason: 'not-syncing' };
  if (provider === undefined) return { kind: 'stopped', reason: 'no-provider' };
  const window = syncWindow(now);

  let changes: { readonly events: readonly ProviderEvent[]; readonly nextSyncToken: string };
  let tokens: CalendarTokens;
  let full = row.sync_token === null;
  try {
    tokens = await liveTokens(deps, scope, provider, row, binding, now);
    try {
      changes = await provider.listChanges(tokens, PRIMARY_CALENDAR, row.sync_token ?? undefined, window);
    } catch (error) {
      // The token expired (410 Gone): sync the whole window again.
      if (!isProviderError(error, 'CALENDAR_SYNC_TOKEN_GONE') || full) throw error;
      full = true;
      changes = await provider.listChanges(tokens, PRIMARY_CALENDAR, undefined, window);
    }
  } catch (error) {
    if (!isProviderError(error)) throw error;
    const since = await recordFailure(scope, row.id, error.code);
    if (error.code === 'CALENDAR_AUTH_REVOKED') return { kind: 'stopped', reason: 'expired' };
    return { kind: 'retry', code: error.code, nextInMs: retryDelay(since, now) };
  }

  const { events } = changes;
  const connection = { id: row.id, memberId: row.member_id };
  for (let start = 0; start < events.length; start += APPLY_BATCH) {
    const batch = events.slice(start, start + APPLY_BATCH);
    const { result } = await runWrite(
      scope,
      (context) => applyEvents(context, connection, batch, deps.isFreeDomain),
      deps.hooks,
    );
    if (result === 'gone') return { kind: 'stopped', reason: 'gone' };
  }
  if (full) {
    // The provider listed every event in the window: this connection's copies of any other there are gone.
    const listed = events.filter((event) => event.status !== 'cancelled').map((event) => event.id);
    const busy = events.filter(isBusyOnly).map((event) => event.id);
    await runWrite(
      scope,
      async (context) => {
        context.record({ meetings: await dropSources(context.tx, row.id, { allBut: listed, ...window }) });
        await dropBusyTimes(context.tx, row.id, { allBut: busy, ...window });
      },
      deps.hooks,
    );
  }
  // Only now, with every batch committed, the next sync token.
  const stored = await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      update calendar_connections set
        sync_state = jsonb_set(sync_state, ${`{${PRIMARY_CALENDAR}}`}, ${JSON.stringify({ syncToken: changes.nextSyncToken })}::jsonb),
        status = 'connected', last_synced_at = now(), last_error = null, failing_since = null,
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      where id = ${row.id}::uuid and status in ('syncing', 'connected', 'failed')
    `),
  );
  if (stored.rowCount === 0) return { kind: 'stopped', reason: 'gone' };
  // Push (AC-602, AC-622): a channel opened once the calendar is current, and renewed before it runs out.
  const channel = storedChannel(row.channel);
  if (deps.pushAddress !== undefined && needsChannel(channel, now)) {
    await openChannel(scope, {
      provider,
      tokens,
      connectionId: row.id,
      address: deps.pushAddress,
      previous: channel,
    });
  }
  return { kind: 'synced', full, events: events.length, nextInMs: POLL_INTERVAL_MS };
}
