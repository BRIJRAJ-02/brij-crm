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
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '@crm/db';
import { systemScope } from '../access/door.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { isUuid } from '../engine/ids.ts';
import { isProviderError, type CalendarChannel, type CalendarProvider, type CalendarTokens } from './provider.ts';

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

/**
 * Opens a channel for one calendar and stores it, then stops the one it replaces. Answers whether one is open now.
 * A provider's failure opens none (the poll keeps the calendar current) and is never the sync's failure; anything
 * else throws.
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
): Promise<boolean> {
  const secret = randomBytes(24).toString('base64url');
  const token = `${scope.workspaceId}.${input.calendarRowId}.${secret}`;
  let channel: CalendarChannel;
  try {
    channel = await input.provider.watch(input.tokens, input.calendarId, input.address, token);
  } catch (error) {
    if (isProviderError(error)) return false;
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
    `),
  );
  // Disconnected or switched off meanwhile: the channel just opened has nothing to wake.
  const stale = kept.rowCount === 0 ? channel : input.previous;
  if (stale !== undefined) await stopChannel(input.provider, input.tokens, stale);
  return kept.rowCount !== 0;
}

/** Stops a channel at the provider, best effort: one left open expires on its own, and its notices no longer match. */
export async function stopChannel(
  provider: CalendarProvider,
  tokens: CalendarTokens,
  channel: CalendarChannel,
): Promise<void> {
  try {
    await provider.stopWatch(tokens, channel);
  } catch (error) {
    if (!isProviderError(error)) throw error;
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

/** What a notice did: queued a sync, ignored (the opening handshake), or refused (no such channel). */
export type NoticeOutcome = 'queued' | 'ignored' | 'refused';

/** Graph's lifecycle events that mean the subscription must be made again. */
const RENEW_STATES: ReadonlySet<string> = new Set(['reauthorizationRequired', 'subscriptionRemoved']);

/**
 * Takes one change notice (AC-602, AC-1008): when its token names a calendar whose stored channel has this id and
 * this secret, the calendar's account's next sync is brought forward to now (`crm_enqueue_calendar_sync`, keyed
 * by connection, so a burst of notices is one waiting sync). A lifecycle notice also marks the channel for renewal,
 * so that sync opens a new one. Reads as the system in the workspace the token names; nothing else is read or
 * written.
 */
export async function takeCalendarNotice(db: Database, notice: CalendarNotice): Promise<NoticeOutcome> {
  const { channelId, token } = notice;
  if (channelId === undefined || token === undefined || token.length > TOKEN_MAX) return 'refused';
  const [workspaceId, ownerId, secret, ...rest] = token.split('.');
  if (rest.length > 0 || workspaceId === undefined || ownerId === undefined || secret === undefined) {
    return 'refused';
  }
  if (!isUuid(workspaceId) || !isUuid(ownerId) || secret.length === 0) return 'refused';
  const scope = systemScope(db, workspaceId);
  return inWorkspace(scope, async (tx) => {
    // The calendar the token names, or (a token from before milestone 5) its connection's main calendar.
    const rows = await tx.execute<{ id: string; connection_id: string; channel: unknown }>(sql`
      select id::text as id, connection_id::text as connection_id, channel from calendar_calendars
      where id = ${ownerId}::uuid or (connection_id = ${ownerId}::uuid and is_primary)
      order by (id = ${ownerId}::uuid) desc
      limit 1
    `);
    const [row] = rows.rows;
    const channel = storedChannel(row?.channel);
    if (row === undefined || channel === undefined) return 'refused';
    const given = Buffer.from(hashOf(secret));
    const held = Buffer.from(channel.tokenHash);
    const sameSecret = given.length === held.length && timingSafeEqual(given, held);
    if (!sameSecret || channel.id !== channelId) return 'refused';
    // The handshake Google sends as a channel opens says nothing changed.
    if (notice.state === 'sync') return 'ignored';
    if (notice.state !== undefined && RENEW_STATES.has(notice.state)) {
      await tx.execute(sql`
        update calendar_calendars set channel = jsonb_set(channel, '{expiresAt}',
          to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
        where id = ${row.id}::uuid
      `);
    }
    const queued = await tx.execute<{ queued: boolean }>(
      sql`select crm_enqueue_calendar_sync(${row.connection_id}::uuid) as queued`,
    );
    return queued.rows[0]?.queued === true ? 'queued' : 'refused';
  });
}
