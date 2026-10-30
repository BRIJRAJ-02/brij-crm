// The automation tasks (parity #53). `crm_automation` is what `crm_enqueue_automation` queues (migration 0142) after a
// write queued runs, and what the hourly due sweep queues for a workspace holding a task due automation: it runs the
// workspace's queued runs through core's `runAutomationQueue`, each as the member its automation runs as. A call that
// ran out of time queues itself again. `crm_cron_automation_due` is the sweep: it pages the workspaces with an
// enabled task due automation (`crm_automation_due_workspaces`, ids only) and queues each one's task with `due` set,
// which also queues the runs for tasks that came due and prunes old runs.
import { pruneAutomations, queueDueAutomations, runAutomationQueue, type AutomationRunDeps } from '@crm/core/system';
import * as z from 'zod';

/** The task's name on Graphile's queue. */
export const AUTOMATION_TASK = 'crm_automation';

/** The due sweep's name, its hourly crontab line (a quarter past, with an hour of fill) and its page size. */
export const AUTOMATION_DUE_TASK = 'crm_cron_automation_due';
export const AUTOMATION_DUE_CRONTAB = `15 * * * * ${AUTOMATION_DUE_TASK} ?fill=1h&id=automation_due&max=3`;
export const AUTOMATION_DUE_PAGE = 500;
export const AUTOMATION_DUE_PAGES_A_CALL = 10;

/** Its payload: the workspace id, and `due` when the sweep queued it. Ids only. */
export const AutomationPayload = z.strictObject({ workspaceId: z.uuid(), due: z.literal(true).optional() });
export type AutomationPayload = z.infer<typeof AutomationPayload>;

/** What the task needs besides core's deps: how to queue the next call when this one ran out of time. */
export interface AutomationTaskDeps extends AutomationRunDeps {
  readonly again: (workspaceId: string) => Promise<void>;
}

/** Runs one workspace's queued automation runs. A payload that is not ours is logged and dropped. */
export async function runAutomationTask(deps: AutomationTaskDeps, payload: unknown): Promise<void> {
  const parsed = AutomationPayload.safeParse(payload);
  if (!parsed.success) {
    deps.log.warn('automation.payload_invalid', {});
    return;
  }
  const { workspaceId, due } = parsed.data;
  if (due === true) {
    const queued = await queueDueAutomations(deps, workspaceId);
    deps.log.info('automation.due', { workspaceId, queued });
  }
  const { ran, more } = await runAutomationQueue(deps, workspaceId);
  if (ran > 0) deps.onStored?.();
  if (more) {
    await deps.again(workspaceId);
    return;
  }
  // Caught up: one batch of old runs and long deleted automations goes (an indexed probe when there is none).
  const pruned = await pruneAutomations(deps, workspaceId);
  if (pruned.runs + pruned.automations > 0) deps.log.info('automation.pruned', { workspaceId, ...pruned });
}
