// Push channels (spec 0024, milestone 2, AC-602 and AC-622): the provider
// posts a notice to `<CALENDAR_WEBHOOK_ORIGIN>/api/calendar/google/notify`
// whenever a connection's calendar changes, and the notice brings that
// connection's next sync forward to now. The poll fallback keeps running
// underneath, so a lost notice or a closed channel costs 15 minutes, never
// a change.
//
// A channel is opened after a sync succeeds and opened again (the old one
// stopped) once it expires within 48 hours, so a sync, which runs at least
// every 15 minutes, renews it long before Google's 7 days run out. Its token
// is `<workspace>.<connection>.<secret>`: the ids say where to look (the
// notice comes from outside any workspace), and only a hash of the secret is
// stored, so a leaked row can't forge a notice. A notice is checked against
// the stored channel id and the hash in constant time; anything that doesn't
// match queues nothing and answers the same, so the endpoint tells a caller
// nothing.
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

/** The longest channel token a notice may carry (Google's limit). */
const TOKEN_MAX = 256;

/** A channel as stored on its connection: the provider's ids, its expiry, and the hash of its secret. */
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

/** Whether a connection needs a channel opened now: none yet, or the one it has expires within 48 hours. */
export function needsChannel(channel: StoredChannel | undefined, now: Date): boolean {
  if (channel === undefined) return true;
  const expires = Date.parse(channel.expiresAt);
  return !Number.isFinite(expires) || expires - now.getTime() < CHANNEL_RENEW_MS;
}

/**
 * Opens a channel for one connection's primary calendar and stores it, then
 * stops the one it replaces. Answers whether one is open now. A provider's
 * failure opens none (the poll keeps the calendar current) and is never the
 * sync's failure; anything else throws.
 */
export async function openChannel(
  scope: EngineScope,
  input: {
    readonly provider: CalendarProvider;
    readonly tokens: CalendarTokens;
    readonly connectionId: string;
    readonly address: string;
    readonly previous: StoredChannel | undefined;
  },
): Promise<boolean> {
  const secret = randomBytes(24).toString('base64url');
  const token = `${scope.workspaceId}.${input.connectionId}.${secret}`;
  let channel: CalendarChannel;
  try {
    channel = await input.provider.watch(input.tokens, 'primary', input.address, token);
  } catch (error) {
    if (isProviderError(error)) return false;
    throw error;
  }
  const stored: StoredChannel = { ...channel, tokenHash: hashOf(secret) };
  const kept = await inWorkspace(scope, (tx) =>
    tx.execute(sql`
      update calendar_connections set channel = ${JSON.stringify(stored)}::jsonb,
        updated_at = now(), updated_by_type = 'calendar', updated_by_id = null, updated_by_member_id = null
      where id = ${input.connectionId}::uuid and status in ('syncing', 'connected', 'failed')
    `),
  );
  // Disconnected meanwhile: the channel just opened has nothing to wake.
  const stale = kept.rowCount === 0 ? channel : input.previous;
  if (stale !== undefined) {
    try {
      await input.provider.stopWatch(input.tokens, stale);
    } catch (error) {
      // A channel left open expires on its own, and its notices no longer match.
      if (!isProviderError(error)) throw error;
    }
  }
  return kept.rowCount !== 0;
}

/** A provider's change notice, as the endpoint read its headers. */
export interface CalendarNotice {
  readonly channelId: string | undefined;
  readonly token: string | undefined;
  /** Google's `X-Goog-Resource-State`: `sync` (the channel just opened), `exists` or `not_exists`. */
  readonly state: string | undefined;
}

/** What a notice did: queued a sync, ignored (the opening handshake), or refused (no such channel). */
export type NoticeOutcome = 'queued' | 'ignored' | 'refused';

/**
 * Takes one change notice (AC-602): when its token names a connection whose
 * stored channel has this id and this secret, the connection's next sync is
 * brought forward to now (`crm_enqueue_calendar_sync`, keyed by connection,
 * so a burst of notices is one waiting sync). Reads as the system in the
 * workspace the token names; nothing else is read or written.
 */
export async function takeCalendarNotice(db: Database, notice: CalendarNotice): Promise<NoticeOutcome> {
  const { channelId, token } = notice;
  if (channelId === undefined || token === undefined || token.length > TOKEN_MAX) return 'refused';
  const [workspaceId, connectionId, secret, ...rest] = token.split('.');
  if (rest.length > 0 || workspaceId === undefined || connectionId === undefined || secret === undefined) {
    return 'refused';
  }
  if (!isUuid(workspaceId) || !isUuid(connectionId) || secret.length === 0) return 'refused';
  const scope = systemScope(db, workspaceId);
  return inWorkspace(scope, async (tx) => {
    const rows = await tx.execute<{ channel: unknown }>(sql`
      select channel from calendar_connections where id = ${connectionId}::uuid
    `);
    const channel = storedChannel(rows.rows[0]?.channel);
    if (channel === undefined) return 'refused';
    const given = Buffer.from(hashOf(secret));
    const held = Buffer.from(channel.tokenHash);
    const sameSecret = given.length === held.length && timingSafeEqual(given, held);
    if (!sameSecret || channel.id !== channelId) return 'refused';
    // The handshake Google sends as a channel opens says nothing changed.
    if (notice.state === 'sync') return 'ignored';
    const queued = await tx.execute<{ queued: boolean }>(
      sql`select crm_enqueue_calendar_sync(${connectionId}::uuid) as queued`,
    );
    return queued.rows[0]?.queued === true ? 'queued' : 'refused';
  });
}
