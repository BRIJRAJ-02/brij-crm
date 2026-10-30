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
// channel). Both are harmless to repeat. A failure throws plainly for
// Graphile's backoff (about 3, 7, 20, 55 seconds and on, 8 tries over about
// 29 minutes, at error on the last); once the row is older than a
// subscription token's life the members have lost the channel anyway, so the
// task ends. The relay still tries the cut at once, the fast path, and this
// task is the guarantee. Logs carry ids and counts only.
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
 * Its tries: Graphile waits e^n seconds after the nth failure, so the 8th and
 * last comes about 29 minutes in (a 9th, at 78, would only find the token's
 * hour over, and wake the database to say so).
 */
export const CUTOFF_MAX_ATTEMPTS = 8;

/** The first try that falls back to closing the users' connections when the unsubscribe is refused. */
export const CUTOFF_FALLBACK_FROM = 3;

/** How long after the relay's own try the task first runs: the fast path usually landed by then. */
export const CUTOFF_DELAY_MS = 15_000;

const MemberId = z.uuid();
/** Its payload: the workspace, the members the `access` row named, and the row's commit time. Ids only. */
export const CutOffPayload = z.strictObject({
  workspaceId: z.uuid(),
  memberIds: z.array(MemberId).min(1).max(MAX_MEMBERS),
  at: z.iso.datetime(),
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

/** How a try ended; a failure throws instead. */
export type CutOffOutcome = 'unsubscribed' | 'disconnected' | 'none' | 'lapsed' | 'invalid';

/**
 * One try of a cut off. Resolves when there is nothing left to do; throws a
 * plain error for Graphile to try again when neither the unsubscribe nor the
 * fallback landed.
 */
export async function runCutOff(deps: CutOffDeps, payload: unknown, attempt: CutOffTry): Promise<CutOffOutcome> {
  const parsed = CutOffPayload.safeParse(payload);
  if (!parsed.success) {
    // Not ours, or tampered with: nothing to cut, and nothing to retry.
    deps.log.error('realtime.cutoff.payload_invalid', {});
    return 'invalid';
  }
  const { workspaceId, memberIds, at } = parsed.data;
  const now = deps.now?.() ?? Date.now();
  const fields = { workspaceId, members: memberIds.length, attempt: attempt.attempt };
  // Every token they held when removed has run out: nothing left to cut. A first try this late (the worker was
  // down) is only noted; one that kept failing never cut them off, which is a fault to see.
  if (now - Date.parse(at) >= REALTIME_TOKEN_SECONDS * 1_000) {
    if (attempt.attempt > 1) deps.log.error('realtime.cutoff.lapsed', fields);
    else deps.log.info('realtime.cutoff', { ...fields, outcome: 'lapsed' });
    return 'lapsed';
  }
  const last = attempt.attempt >= attempt.maxAttempts;
  const failed = (reason: 'database' | 'centrifugo', more: Record<string, unknown>): Error => {
    deps.log[last ? 'error' : 'warn'](last ? 'realtime.cutoff.failed' : 'realtime.cutoff.retry', {
      ...fields,
      reason,
      ...more,
    });
    return new Error('Cutting removed members off the live channel failed; the worker log has the workspace id.');
  };
  let userIds: readonly string[];
  try {
    userIds = await deps.removedUserIds(workspaceId, memberIds);
  } catch (error) {
    // The error's class only: a database error's text can quote what it was given.
    throw failed('database', { error: error instanceof Error ? error.name : 'unknown' });
  }
  if (userIds.length === 0) {
    deps.log.info('realtime.cutoff', { ...fields, outcome: 'none' });
    return 'none';
  }
  try {
    await deps.unsubscribe(workspaceChannel(workspaceId), userIds);
    deps.log.info('realtime.cutoff', { ...fields, users: userIds.length, outcome: 'unsubscribed' });
    return 'unsubscribed';
  } catch {
    // Refused or unreachable. From the third try on, close their connections instead, one user at a time: that
    // drops their tabs in every workspace for a moment, so a brief refusal is only tried again.
  }
  if (attempt.attempt < CUTOFF_FALLBACK_FROM) throw failed('centrifugo', { users: userIds.length });
  const closed = await Promise.all(userIds.map((userId) => deps.disconnectUser(userId, REMOVED)));
  if (closed.every(Boolean)) {
    deps.log.warn('realtime.cutoff', { ...fields, users: userIds.length, outcome: 'disconnected' });
    return 'disconnected';
  }
  throw failed('centrifugo', { users: userIds.length });
}
