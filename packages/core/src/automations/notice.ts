// An automation's notice (parity #53): the inbox row a "notify" action leaves for one member, written in the
// transaction of the action so the notice and the member's unread count move together. It names the automation, the
// run (one notice per member per run: a retried run leaves no second) and what it is about by id, and copies no text:
// the inbox reads the automation's message and the record or task name when it is shown, through the access door. An
// automation's notice is never emailed (in app only, parity #53 v1).
import { sql } from 'drizzle-orm';
import type { WriteContext } from '../engine/write.ts';

/** What a notice is about. */
export interface AutomationNotice {
  readonly memberId: string;
  readonly automationId: string;
  readonly runId: string;
  /** The record the automation ran for, if a record. */
  readonly recordId?: string;
  /** The task that came due, if a task. */
  readonly dueTaskId?: string;
}

/**
 * Notifies one member. Answers false when they are not an active member (they left meanwhile), and also when this run
 * already notified them (a retry), so the caller tells the two apart by what it asked: an unknown member is checked
 * before the run starts, a repeat is no failure.
 */
export async function notifyAutomation(context: WriteContext, notice: AutomationNotice): Promise<boolean> {
  const { workspaceId } = context.scope;
  const inserted = await context.tx.execute(sql`
    insert into notifications (workspace_id, member_id, kind, actor_type, actor_id, record_id, automation_id,
      automation_run_id, due_task_id)
    select ${workspaceId}::uuid, m.id, 'automation', 'automation', ${notice.automationId}::uuid,
      ${notice.recordId ?? null}::uuid, ${notice.automationId}::uuid, ${notice.runId}::uuid,
      ${notice.dueTaskId ?? null}::uuid
    from members m
    where m.id = ${notice.memberId}::uuid and m.status = 'active'
    on conflict (workspace_id, member_id, automation_run_id) where automation_run_id is not null do nothing
    returning member_id
  `);
  if ((inserted.rowCount ?? 0) === 0) return false;
  context.record({ notifications: [notice.memberId] });
  return true;
}
