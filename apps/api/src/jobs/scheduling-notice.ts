// The scheduling notice task (spec 0037, AC-1264): `crm_scheduling_notice`,
// which `crm_enqueue_scheduling_notice` queues (migration 0122) ten minutes
// after someone changes another member's scheduling, keyed per actor and
// member so a burst queues one. It runs core's `runSchedulingNotice` as the
// system in the workspace, which queues one `scheduling_changed` email
// (and its inbox notice) through the workspace email queue (`crm_email` sends it), keyed by the last
// change it tells, so a retry never sends twice. A failure throws plainly for
// Graphile to try again (5 tries).
import { outboxHook } from '@crm/core';
import { runSchedulingNotice, type systemScope } from '@crm/core/system';
import * as z from 'zod';

/** The task's name on Graphile's queue. */
export const SCHEDULING_NOTICE_TASK = 'crm_scheduling_notice';

/** Its payload: what `crm_enqueue_scheduling_notice` writes, ids only. */
export const SchedulingNoticePayload = z.strictObject({
  workspaceId: z.uuid(),
  actorMemberId: z.uuid(),
  memberId: z.uuid(),
});
export type SchedulingNoticePayload = z.infer<typeof SchedulingNoticePayload>;

/** What the task needs: the system's scope in a workspace, and the log. */
export interface SchedulingNoticeDeps {
  readonly systemScope: (workspaceId: string) => ReturnType<typeof systemScope>;
  readonly log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
  };
}

/** Queues one member's scheduling notice, or nothing when the changes cancelled out or they left. */
export async function runSchedulingNoticeTask(deps: SchedulingNoticeDeps, payload: unknown): Promise<void> {
  const parsed = SchedulingNoticePayload.safeParse(payload);
  if (!parsed.success) {
    // Not ours, or tampered with: nothing to tell, and nothing to retry.
    deps.log.warn('scheduling.notice.payload_invalid', {});
    return;
  }
  const { workspaceId, actorMemberId, memberId } = parsed.data;
  // The outbox hook: the member's open inbox hears of its new notice (spec 0038).
  const outcome = await runSchedulingNotice(deps.systemScope(workspaceId), { actorMemberId, memberId }, [outboxHook()]);
  // A refused email (params its template doesn't take) is a fault to see, never silence.
  if (outcome === 'refused') deps.log.warn('scheduling.notice', { workspaceId, actorMemberId, memberId, outcome });
  else deps.log.info('scheduling.notice', { workspaceId, actorMemberId, memberId, outcome });
}
