// The durable cut off (late trap #41, spec 0031 AC-817): `crm_realtime_cutoff`,
// a Graphile task on the worker's light runner. Once the relay has published
// an `access` row that names removed members, it queues this task on its own
// direct connection (the worker's login, in crm_worker) before it marks the
// row published, keyed by the workspace and the row's `seq`, so a restart at
// any point either publishes the row again and queues it again, or finds it
// queued. The task reads which of those members are removed now (a user who
// joined again since is left alone), unsubscribes their users from
// `workspace:<id>`, and when Centrifugo keeps refusing that, closes those
// users' connections instead, in every workspace (4501: each tab checks its
// session and reconnects, and the member door then refuses this workspace's
// channel). Both are harmless to repeat. A failure queues the task again
// under its own key (`retry`, which the task in `jobs/graphile.ts` adds),
// after e^n seconds capped at five minutes (about 3, 7, 20, 55, 148 seconds,
// then every five minutes), the try count carried in the payload, and the
// last wait clamped to the moment the row is a token's life old: Graphile's
// own backoff (e^n uncapped) would leave the half hour before that empty while
// the members' tokens still hold. That last run finds every token issued
// before the removal run out and ends as `lapsed`, at error when tries failed.
// Graphile's own tries are left for a re-queue that fails (the database gone).
// The relay still tries the cut at once, the fast path, and this task is the
// guarantee. Logs carry ids and counts only.
import { workspaceChannel } from '@crm/contracts';
import type { QueuedTask } from '@crm/db';
import * as z from 'zod';
import type { DisconnectReason, DisconnectUser, Unsubscribe } from './centrifugo.ts';
import { SIGNED_OUT } from './signed-out.ts';
import { REALTIME_TOKEN_SECONDS } from './tokens.ts';

/** The task's name on Graphile's queue. */
export const CUTOFF_TASK = 'crm_realtime_cutoff';

/** The most member ids one task holds: the most `removedUserIds` reads. */
const MAX_MEMBERS = 500;

/**
 * Graphile's tries of one queue row, used only when queueing the next try
 * fails (Graphile waits e^n seconds, so about 29 minutes); a try that fails
 * otherwise queues the next itself (`CutOffResult` `retry`).
 */
export const CUTOFF_MAX_ATTEMPTS = 8;

/** The longest wait between two tries: the hour holds a try at least this often. */
export const CUTOFF_MAX_WAIT_MS = 5 * 60_000;

/** The shortest, so a clock a little behind the database's never runs it back to back. */
const MIN_WAIT_MS = 1_000;

/** How long a token issued before the removal can still hold the channel: the issuer's own life. */
export const CUTOFF_WINDOW_MS = REALTIME_TOKEN_SECONDS * 1_000;

/** The most tries one cut off carries: about 18 fit the hour, so more is a payload not ours. */
const MAX_TRIES = 100;

/** The first try that falls back to closing the users' connections when the unsubscribe is refused. */
export const CUTOFF_FALLBACK_FROM = 3;

/** How long after the relay's own try the task first runs: the fast path usually landed by then. */
export const CUTOFF_DELAY_MS = 15_000;

const MemberId = z.uuid();
/**
 * Its payload: the workspace, the members the `access` row named, the row's
 * commit time, and how many tries came before this queue row (none from the
 * relay). Ids and counts only.
 */
export const CutOffPayload = z.strictObject({
  workspaceId: z.uuid(),
  memberIds: z.array(MemberId).min(1).max(MAX_MEMBERS),
  at: z.iso.datetime(),
  tried: z.int().min(1).max(MAX_TRIES).optional(),
});
/** Its payload. */
export type CutOffPayload = z.infer<typeof CutOffPayload>;

/** The connection close the fallback sends: the same 4501 the client already handles by checking its session. */
export const REMOVED: DisconnectReason = { code: SIGNED_OUT.code, reason: 'removed' };

/**
 * The queue row for one published `access` row: keyed by its workspace and
 * `seq`, so the relay queueing it again (the row published again after a
 * restart) replaces the waiting row rather than adding one. Undefined when the
 * row names no member id.
 */
export function cutOffTask(
  workspaceId: string,
  seq: number,
  memberIds: readonly string[],
  at: string,
  now: number,
): QueuedTask | undefined {
  const ids = [...new Set(memberIds)].filter((id) => MemberId.safeParse(id).success).slice(0, MAX_MEMBERS);
  if (ids.length === 0) return undefined;
  const payload: CutOffPayload = { workspaceId, memberIds: ids, at };
  return {
    identifier: CUTOFF_TASK,
    payload,
    jobKey: `crm-cutoff:${workspaceId}:${String(seq)}`,
    maxAttempts: CUTOFF_MAX_ATTEMPTS,
    runAt: new Date(now + CUTOFF_DELAY_MS),
  };
}

/** What the task needs: who is removed now, Centrifugo's unsubscribe and disconnect, the log and a clock. */
export interface CutOffDeps {
  /** The users of those members who are no longer active (`removedUserIds` with the system's scope). */
  readonly removedUserIds: (workspaceId: string, memberIds: readonly string[]) => Promise<readonly string[]>;
  readonly unsubscribe: Unsubscribe;
  readonly disconnectUser: DisconnectUser;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
  readonly now?: () => number;
}

/** Where a try stands against the queue row's tries (Graphile counts the one running). */
export interface CutOffTry {
  readonly attempt: number;
  readonly maxAttempts: number;
}

/** How a try ended with nothing left to do. */
export type CutOffOutcome = 'unsubscribed' | 'disconnected' | 'none' | 'lapsed' | 'invalid';

/**
 * How a try ended: done, or `retry`, the payload to queue again under the
 * same key at `runAt` (the task adds it; queueing fails over to Graphile's
 * backoff).
 */
export type CutOffResult =
  | { readonly outcome: CutOffOutcome }
  | { readonly outcome: 'retry'; readonly payload: CutOffPayload; readonly runAt: Date };

/**
 * When the try after `tries` failed ones runs: e^tries seconds from `now`,
 * capped at `CUTOFF_MAX_WAIT_MS`, never past the moment the row is a token's
 * life old (that run ends it), and at least a second away.
 */
export function nextTryAt(tries: number, at: string, now: number): Date {
  const wait = Math.min(Math.exp(tries) * 1_000, CUTOFF_MAX_WAIT_MS);
  const end = Date.parse(at) + CUTOFF_WINDOW_MS;
  return new Date(Math.max(Math.min(now + wait, end), now + MIN_WAIT_MS));
}

/**
 * One try of a cut off. Resolves `retry` with the next try's time when
 * neither the unsubscribe nor the fallback landed, or the database read
 * failed; otherwise with how it ended.
 */
export async function runCutOff(deps: CutOffDeps, payload: unknown, attempt: CutOffTry): Promise<CutOffResult> {
  const parsed = CutOffPayload.safeParse(payload);
  if (!parsed.success) {
    // Not ours, or tampered with: nothing to cut, and nothing to retry.
    deps.log.error('realtime.cutoff.payload_invalid', {});
    return { outcome: 'invalid' };
  }
  const { workspaceId, memberIds, at, tried = 0 } = parsed.data;
  const now = deps.now?.() ?? Date.now();
  // This try's number across every queue row the cut off has had.
  const tryNumber = tried + attempt.attempt;
  const fields = { workspaceId, members: memberIds.length, attempt: tryNumber };
  // Every token they held when removed has run out: nothing left to cut. A first try this late (the worker was
  // down) is only noted; one that kept failing never cut them off, which is a fault to see.
  if (now - Date.parse(at) >= CUTOFF_WINDOW_MS) {
    if (tryNumber > 1) deps.log.error('realtime.cutoff.lapsed', fields);
    else deps.log.info('realtime.cutoff', { ...fields, outcome: 'lapsed' });
    return { outcome: 'lapsed' };
  }
  const failed = (reason: 'database' | 'centrifugo', more: Record<string, unknown>): CutOffResult => {
    if (tryNumber >= MAX_TRIES) {
      // Never expected inside the hour: a bound, so a payload can't keep the task going.
      deps.log.error('realtime.cutoff.failed', { ...fields, reason, ...more });
      return { outcome: 'lapsed' };
    }
    const runAt = nextTryAt(tryNumber, at, now);
    deps.log.warn('realtime.cutoff.retry', { ...fields, reason, ...more, inMs: runAt.getTime() - now });
    return { outcome: 'retry', payload: { ...parsed.data, tried: tryNumber }, runAt };
  };
  let userIds: readonly string[];
  try {
    userIds = await deps.removedUserIds(workspaceId, memberIds);
  } catch (error) {
    // The error's class only: a database error's text can quote what it was given.
    return failed('database', { error: error instanceof Error ? error.name : 'unknown' });
  }
  if (userIds.length === 0) {
    deps.log.info('realtime.cutoff', { ...fields, outcome: 'none' });
    return { outcome: 'none' };
  }
  try {
    await deps.unsubscribe(workspaceChannel(workspaceId), userIds);
    deps.log.info('realtime.cutoff', { ...fields, users: userIds.length, outcome: 'unsubscribed' });
    return { outcome: 'unsubscribed' };
  } catch {
    // Refused or unreachable. From the third try on, close their connections instead, one user at a time: that
    // drops their tabs in every workspace for a moment, so a brief refusal is only tried again.
  }
  if (tryNumber < CUTOFF_FALLBACK_FROM) return failed('centrifugo', { users: userIds.length });
  const closed = await Promise.all(userIds.map((userId) => deps.disconnectUser(userId, REMOVED).catch(() => false)));
  if (closed.every(Boolean)) {
    deps.log.warn('realtime.cutoff', { ...fields, users: userIds.length, outcome: 'disconnected' });
    return { outcome: 'disconnected' };
  }
  return failed('centrifugo', { users: userIds.length });
}
