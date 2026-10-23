// Push channels (spec 0024, milestone 2, AC-602 and AC-622; per calendar from
// milestone 5, AC-1003; Graph subscriptions from milestone 4, AC-1008): the
// provider posts a notice whenever a calendar changes, to
// `<CALENDAR_WEBHOOK_ORIGIN>/api/calendar/google/notify` (Google) or
// `/api/calendar/microsoft/notify` (Graph), and the notice brings that
// calendar's account's next sync forward to now. The poll fallback keeps
// running underneath, so a lost notice or a closed channel costs 15 minutes,
// never a change.
//
// A channel is opened for each pulled calendar after a sync succeeds, and
// opened again (the old one stopped) once it expires within 48 hours, so a
// sync, which runs at least every 15 minutes, renews it long before Google's
// 7 days or Graph's 3 run out. Its token (Google's channel token, Graph's
// `clientState`) is `<workspace>.<calendar>.<secret>`: the ids say where to
// look (the notice comes from outside any workspace), and only a hash of the
// secret is stored, so a leaked row can't forge a notice. A token from before
// milestone 5 names the connection, and is found as its main calendar's. A
// notice is checked against the stored channel id and the hash in constant
// time; anything that doesn't match queues nothing and answers the same, so
// the endpoint tells a caller nothing. Graph's lifecycle notices (the
// subscription needs reauthorising, or was removed) mark the channel for
// renewal and bring the sync forward, which opens a new one.
//
// A deleted workspace (spec 0031, AC-823) keeps no channel: the deletion
// brings each account's next run forward, and that run ends the channels at
// the provider and syncs nothing (`sync.ts`). A notice that still arrives
// for one queues that run again, so a channel the provider couldn't end the
// first time is tried again, and is never a sync.
//
// What became of each channel (`ChannelReport`) and of each notice
// (`NoticeResult`) is answered in our ids and the provider's codes only, so
// the api logs them (`calendar.channel`, `calendar.notice`) and a channel that
// never opened, or a notice that went elsewhere, shows in the logs.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import {
  failureOf,
  isProviderError,
  type CalendarChannel,
  type CalendarProvider,
  type CalendarTokens,
  type ProviderFailure,
} from './provider.ts';

/** A channel expiring within this is replaced (spec: renewed when it expires within 48 hours). */
export const CHANNEL_RENEW_MS = 48 * 3_600_000;

/** The longest channel token a notice may carry (Google's limit; Graph's `clientState` takes 128). */
const TOKEN_MAX = 256;

/** A channel as stored on its calendar: the provider's ids, its expiry, and the hash of its secret. */
export interface StoredChannel extends CalendarChannel {
  readonly tokenHash: string;
}

const hashOf = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** A stored channel read back from the `channel` column, or undefined for none or a malformed one. */
export function storedChannel(value: unknown): StoredChannel | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, resourceId, expiresAt, tokenHash } = value as Record<string, unknown>;
  if (typeof id !== 'string' || typeof resourceId !== 'string') return undefined;
  if (typeof expiresAt !== 'string' || typeof tokenHash !== 'string') return undefined;
  return { id, resourceId, expiresAt, tokenHash };
}

/** Whether a calendar needs a channel opened now: none yet, or the one it has expires within 48 hours. */
export function needsChannel(channel: StoredChannel | undefined, now: Date): boolean {
  if (channel === undefined) return true;
  const expires = Date.parse(channel.expiresAt);
  return !Number.isFinite(expires) || expires - now.getTime() < CHANNEL_RENEW_MS;
}

/** Why a stored channel was ended: its calendar is no longer pulled, or its workspace was deleted. */
export type ChannelStopReason = 'not-pulled' | 'workspace-deleted';

/**
 * What became of one calendar's push channel in a run, for the `calendar.channel` log line: the calendar's row id,
 * the channel's expiry, and the provider's code, status and reason when it refused. Never a token or a channel id.
 */
export type ChannelReport =
  /** A channel is open and stored; `renewed` when it took over from one about to run out, which was then stopped. */
  | { readonly calendarId: string; readonly outcome: 'opened'; readonly expiresAt: string; readonly renewed: boolean }
  /** The provider refused to open one, or didn't answer: the poll keeps the calendar current, the next run retries. */
  | ({ readonly calendarId: string; readonly outcome: 'failed' } & ProviderFailure)
  /**
   * One opened, but nothing could keep it: the calendar was switched off, or its account disconnected or its
   * workspace deleted, while it opened. It was stopped at once.
   */
  | { readonly calendarId: string; readonly outcome: 'dropped' }
  /** A stored channel ended at the provider. */
  | { readonly calendarId: string; readonly outcome: 'stopped'; readonly why: ChannelStopReason }
  /** The provider refused to end a stored channel: it runs out by itself, and its notices no longer queue a sync. */
  | ({ readonly calendarId: string; readonly outcome: 'unstopped'; readonly why: ChannelStopReason } & ProviderFailure);

/**
 * Opens a channel for one calendar and stores it, then stops the one it replaces. Answers what happened: `opened`,
 * `failed` (the provider refused, with its code, status and reason; the poll keeps the calendar current and the
 * next run tries again; never the sync's failure), or `dropped` (it opened, but the calendar stopped being pulled,
 * or its account or workspace stopped, before it was stored, so it was stopped at once). Anything else throws.
 */
export async function openChannel(
  scope: EngineScope,
  input: {
    readonly provider: CalendarProvider;
    readonly tokens: CalendarTokens;
    /** The calendar's row id: what the token names. */
    readonly calendarRowId: string;
    /** The provider's calendar id. */
    readonly calendarId: string;
    readonly address: string;
    readonly previous: StoredChannel | undefined;
  },
): Promise<ChannelReport> {
  const calendarId = input.calendarRowId;
  const secret = randomBytes(24).toString('base64url');
  const token = `${scope.workspaceId}.${input.calendarRowId}.${secret}`;
  let channel: CalendarChannel;
  try {
    channel = await input.provider.watch(input.tokens, input.calendarId, input.address, token);
  } catch (error) {
    if (isProviderError(error)) return { calendarId, outcome: 'failed', ...failureOf(error) };
    throw error;
  }
  const stored: StoredChannel = { ...channel, tokenHash: hashOf(secret) };
  const kept = await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      update calendar_calendars k set channel = ${JSON.stringify(stored)}::jsonb
      from calendar_connections c
      where k.id = ${input.calendarRowId}::uuid and (k.sync or k.show_in_week)
        and c.workspace_id = k.workspace_id and c.id = k.connection_id
        and c.status in ('syncing', 'connected', 'failed')
        and not exists (select 1 from workspaces w where w.id = k.workspace_id and w.deleted_at is not null)
    `),
  );
  if (kept.rowCount === 0) {
    // Switched off, disconnected or its workspace deleted meanwhile: the channel just opened has nothing to wake.
    await stopChannel(input.provider, input.tokens, channel);
    return { calendarId, outcome: 'dropped' };
  }
  if (input.previous !== undefined) await stopChannel(input.provider, input.tokens, input.previous);
  return { calendarId, outcome: 'opened', expiresAt: channel.expiresAt, renewed: input.previous !== undefined };
}

/**
 * Stops a channel at the provider, best effort: one left open expires on its own, and its notices no longer match.
 * Answers the provider's refusal, or undefined once it ended (or was already gone); anything else throws.
 */
export async function stopChannel(
  provider: CalendarProvider,
  tokens: CalendarTokens,
  channel: CalendarChannel,
): Promise<ProviderFailure | undefined> {
  try {
    await provider.stopWatch(tokens, channel);
    return undefined;
  } catch (error) {
    if (!isProviderError(error)) throw error;
    return failureOf(error);
  }
}

/** A provider's change notice, as the endpoint read it. */
export interface CalendarNotice {
  /** Google's channel id, or Graph's subscription id. */
  readonly channelId: string | undefined;
  /** Google's channel token, or Graph's `clientState`. */
  readonly token: string | undefined;
  /**
   * Google's `X-Goog-Resource-State` (`sync` as a channel opens, `exists`, `not_exists`), or Graph's lifecycle
   * event (`reauthorizationRequired`, `subscriptionRemoved`, `missed`) when the notice is one.
   */
  readonly state: string | undefined;
}

/** The calendar a notice matched: its workspace, its row and its account, our ids only. */
interface MatchedNotice {
  readonly workspaceId: string;
  readonly calendarId: string;
  readonly connectionId: string;
}

/**
 * What a notice did, for the endpoint and its `calendar.notice` log line: our ids, never the token or anything the
 * caller sent.
 */
export type NoticeResult =
  /**
   * It matched a calendar's channel and brought its account's next run forward to now: for a `change`, a `renew`
   * (Graph wants the subscription made again, so the run opens a new one), or a `stop` (the workspace was deleted:
   * the run ends the account's channels and syncs nothing).
   */
  | (MatchedNotice & { readonly outcome: 'queued'; readonly reason: 'change' | 'renew' | 'stop' })
  /** It matched, but asks for nothing: the handshake a channel opens with, or an account that no longer syncs. */
  | (MatchedNotice & { readonly outcome: 'ignored'; readonly reason: 'handshake' | 'not-syncing' })
  /** It names no channel of ours: malformed, no such calendar or channel, or another channel id or secret. */
  | { readonly outcome: 'refused'; readonly reason: 'malformed' | 'unknown' | 'mismatch' };

/** What a notice did, in one word. */
export type NoticeOutcome = NoticeResult['outcome'];

/** Graph's lifecycle events that mean the subscription must be made again. */
const RENEW_STATES: ReadonlySet<string> = new Set(['reauthorizationRequired', 'subscriptionRemoved']);

/**
 * Takes one change notice (AC-602, AC-1008): when its token names a calendar whose stored channel has this id and
 * this secret, the calendar's account's next run is brought forward to now (`crm_enqueue_calendar_sync`, keyed by
 * connection, so a burst of notices is one waiting run). A lifecycle notice also marks the channel for renewal, so
 * that run opens a new one; in a deleted workspace the run ends the channels instead (spec 0031). Reads as the
 * system in the workspace the token names; nothing else is read or written.
 */
export async function takeCalendarNotice(db: Database, notice: CalendarNotice): Promise<NoticeResult> {
  const { channelId, token } = notice;
  if (channelId === undefined || token === undefined || token.length > TOKEN_MAX) {
    return { outcome: 'refused', reason: 'malformed' };
  }
  const [workspaceId, ownerId, secret, ...rest] = token.split('.');
  if (rest.length > 0 || workspaceId === undefined || ownerId === undefined || secret === undefined) {
    return { outcome: 'refused', reason: 'malformed' };
  }
  if (!isUuid(workspaceId) || !isUuid(ownerId) || secret.length === 0) {
    return { outcome: 'refused', reason: 'malformed' };
  }
  const scope = systemScope(db, workspaceId);
  return inWorkspace(scope, async (tx): Promise<NoticeResult> => {
    // The calendar the token names, or (a token from before milestone 5) its connection's main calendar.
    const rows = await tx.execute<{
      id: string;
      connection_id: string;
      channel: unknown;
      workspace_deleted: boolean;
    }>(sql`
      select k.id::text as id, k.connection_id::text as connection_id, k.channel,
        exists (select 1 from workspaces w where w.id = k.workspace_id and w.deleted_at is not null)
          as workspace_deleted
      from calendar_calendars k
      where k.id = ${ownerId}::uuid or (k.connection_id = ${ownerId}::uuid and k.is_primary)
      order by (k.id = ${ownerId}::uuid) desc
      limit 1
    `);
    const [row] = rows.rows;
    const channel = storedChannel(row?.channel);
    if (row === undefined || channel === undefined) return { outcome: 'refused', reason: 'unknown' };
    const given = Buffer.from(hashOf(secret));
    const held = Buffer.from(channel.tokenHash);
    const sameSecret = given.length === held.length && timingSafeEqual(given, held);
    if (!sameSecret || channel.id !== channelId) return { outcome: 'refused', reason: 'mismatch' };
    const matched: MatchedNotice = { workspaceId, calendarId: row.id, connectionId: row.connection_id };
    // The handshake Google sends as a channel opens says nothing changed.
    if (notice.state === 'sync') return { ...matched, outcome: 'ignored', reason: 'handshake' };
    const renew = notice.state !== undefined && RENEW_STATES.has(notice.state);
    if (renew && !row.workspace_deleted) {
      await tx.execute(sql`
        update calendar_calendars set channel = jsonb_set(channel, '{expiresAt}',
          to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
        where id = ${row.id}::uuid
      `);
    }
    const queued = await tx.execute<{ queued: boolean }>(
      sql`select crm_enqueue_calendar_sync(${row.connection_id}::uuid) as queued`,
    );
    if (queued.rows[0]?.queued !== true) return { ...matched, outcome: 'ignored', reason: 'not-syncing' };
    return { ...matched, outcome: 'queued', reason: row.workspace_deleted ? 'stop' : renew ? 'renew' : 'change' };
  });
}
