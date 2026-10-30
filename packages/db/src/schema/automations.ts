// Automations (parity #53): "when X, if Y, do Z". An automation is one trigger, optional same record conditions and
// one to three actions, stored whole as jsonb and checked by the contracts' schema before it is saved. The trigger's
// object and attribute are copied into plain columns so the write hook's matching and the due sweep read an index.
//
// `automation_runs` is the queue, the idempotency key and the log in one: the write hook (or the due sweep) inserts a
// `queued` row for each matching automation, unique per (automation, subject, event) so one event never runs twice,
// and the `crm_automation` task claims it, runs the actions as the person the automation runs as, and records how it
// ended. A run's subject is a record or a task by id alone (no foreign key: a purge never waits on the log).
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, auditColumns, id, timestamptz, workspaceId } from './common.ts';
import { actorConstraints, members, workspaces } from './workspaces.ts';

const deletedBy = actorColumns('deleted_by');

/** One automation. A deleted one stays, hidden, for the Undo and the daily cleanup's window. */
export const automations = pgTable(
  'automations',
  {
    workspaceId: workspaceId(),
    id: id(),
    /** `record_created`, `field_changed` or `task_due`. */
    triggerKind: text('trigger_kind').notNull(),
    /** The trigger's object (a record trigger's), copied out of `trigger` for the hook's index. */
    objectId: uuid('object_id'),
    /** The trigger's attribute (`field_changed`'s), copied out the same way. */
    attributeId: uuid('attribute_id'),
    /** The trigger as the contracts' `AutomationTrigger` parses it. */
    trigger: jsonb('trigger').notNull(),
    /** A same record filter (`FilterGroup`), or null for none. */
    conditions: jsonb('conditions'),
    /** One to three actions, in order. */
    actions: jsonb('actions').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** When it was last switched on: a task due automation never reaches back before it. */
    enabledAt: timestamptz('enabled_at').notNull().defaultNow(),
    /** Why it switched itself off: `FAILING` (repeated failures) or `CREATOR_GONE` (the person it runs as left). */
    disabledReason: text('disabled_reason'),
    /** Failed runs in a row since the last good one or the last switch on. */
    failures: smallint('failures').notNull().default(0),
    lastRunAt: timestamptz('last_run_at'),
    /** The member it runs as: whoever last saved it or switched it on. Its access never exceeds theirs. */
    runAsMemberId: uuid('run_as_member_id').notNull(),
    ...auditColumns(),
    deletedAt: timestamptz('deleted_at'),
    deletedByType: deletedBy.type,
    deletedById: deletedBy.id,
    deletedByMemberId: deletedBy.memberId,
  },
  (t) => [
    primaryKey({ name: 'automations_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({ name: 'automations_workspace', columns: [t.workspaceId], foreignColumns: [workspaces.id] }).onDelete(
      'cascade',
    ),
    foreignKey({
      name: 'automations_run_as',
      columns: [t.workspaceId, t.runAsMemberId],
      foreignColumns: [members.workspaceId, members.id],
    }),
    check('automations_trigger_kind', sql`${t.triggerKind} in ('record_created', 'field_changed', 'task_due')`),
    check(
      'automations_trigger_shape',
      sql`(${t.triggerKind} = 'record_created' and ${t.objectId} is not null and ${t.attributeId} is null)
        or (${t.triggerKind} = 'field_changed' and ${t.objectId} is not null and ${t.attributeId} is not null)
        or (${t.triggerKind} = 'task_due' and ${t.objectId} is null and ${t.attributeId} is null)`,
    ),
    check(
      'automations_actions',
      sql`jsonb_typeof(${t.actions}) = 'array' and jsonb_array_length(${t.actions}) between 1 and 3`,
    ),
    check('automations_disabled_reason', sql`${t.disabledReason} in ('FAILING', 'CREATOR_GONE')`),
    check('automations_on_has_no_reason', sql`not ${t.enabled} or ${t.disabledReason} is null`),
    check('automations_failures', sql`${t.failures} >= 0`),
    check('automations_deleted', sql`(${t.deletedAt} is null) = (${t.deletedByType} is null)`),
    // The write hook: the enabled automations of an object (record triggers), and the due sweep's workspaces.
    index('automations_hook')
      .on(t.workspaceId, t.objectId, t.triggerKind)
      .where(sql`${t.enabled} and ${t.deletedAt} is null`),
    index('automations_due')
      .on(t.workspaceId)
      .where(sql`${t.enabled} and ${t.deletedAt} is null and ${t.triggerKind} = 'task_due'`),
    // The list, oldest first, and the 50 per workspace count.
    index('automations_list')
      .on(t.workspaceId, t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null`),
    index('automations_trashed')
      .on(t.workspaceId, t.deletedAt)
      .where(sql`${t.deletedAt} is not null`),
    ...actorConstraints('automations', 'created_by', t.workspaceId, {
      type: t.createdByType,
      id: t.createdById,
      memberId: t.createdByMemberId,
    }),
    ...actorConstraints('automations', 'updated_by', t.workspaceId, {
      type: t.updatedByType,
      id: t.updatedById,
      memberId: t.updatedByMemberId,
    }),
    ...actorConstraints('automations', 'deleted_by', t.workspaceId, {
      type: t.deletedByType,
      id: t.deletedById,
      memberId: t.deletedByMemberId,
    }),
  ],
);

/** One run of one automation for one event: waiting, running, or how it ended. */
export const automationRuns = pgTable(
  'automation_runs',
  {
    workspaceId: workspaceId(),
    id: id(),
    automationId: uuid('automation_id').notNull(),
    /** What the event is about: a `record` or a `task`, by id (no foreign key). */
    subjectKind: text('subject_kind').notNull(),
    subjectId: uuid('subject_id').notNull(),
    /** The subject record's object, for the log's link; null for a task. */
    objectId: uuid('object_id'),
    /** `created`, `changed:<version id>` or `due:<date>`: with the subject, what makes a run once only. */
    eventKey: text('event_key').notNull(),
    /** A `changed` event's cell version, so a cell that has moved on by the time it runs is skipped. */
    versionId: uuid('version_id'),
    /** `queued`, `running`, `done`, `failed` or `skipped` (a condition or a stale event; hidden from the log). */
    status: text('status').notNull().default('queued'),
    /** Why it failed or was skipped: an error code or a short reason (`NOT_MATCHED`, `STALE`, `RATE_LIMITED`). */
    code: text('code'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    claimedAt: timestamptz('claimed_at'),
    finishedAt: timestamptz('finished_at'),
  },
  (t) => [
    primaryKey({ name: 'automation_runs_pkey', columns: [t.workspaceId, t.id] }),
    foreignKey({
      name: 'automation_runs_workspace',
      columns: [t.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'automation_runs_automation',
      columns: [t.workspaceId, t.automationId],
      foreignColumns: [automations.workspaceId, automations.id],
    }).onDelete('cascade'),
    check('automation_runs_subject_kind', sql`${t.subjectKind} in ('record', 'task')`),
    check('automation_runs_status', sql`${t.status} in ('queued', 'running', 'done', 'failed', 'skipped')`),
    check('automation_runs_event_key', sql`char_length(${t.eventKey}) between 1 and 80`),
    check('automation_runs_code', sql`char_length(${t.code}) between 1 and 40`),
    // One run per automation, subject and event: the hook and the sweep insert `on conflict do nothing`.
    uniqueIndex('automation_runs_once').on(t.workspaceId, t.automationId, t.subjectId, t.eventKey),
    // The task's queue, oldest first, and the hook's cap on what waits.
    index('automation_runs_queue')
      .on(t.workspaceId, t.createdAt, t.id)
      .where(sql`${t.status} = 'queued'`),
    // A claim that never finished is taken again.
    index('automation_runs_running')
      .on(t.workspaceId, t.claimedAt)
      .where(sql`${t.status} = 'running'`),
    // The run log (the newest first, skipped ones left out) and the hourly cap's count.
    index('automation_runs_log')
      .on(t.workspaceId, t.createdAt.desc(), t.id)
      .where(sql`${t.status} <> 'skipped'`),
    index('automation_runs_claimed')
      .on(t.workspaceId, t.claimedAt)
      .where(sql`${t.claimedAt} is not null`),
    // The cleanup's batch of runs past their week.
    index('automation_runs_by_age').on(t.workspaceId, t.createdAt),
    // The cascade from an automation, and one automation's own log.
    index('automation_runs_by_automation').on(t.workspaceId, t.automationId, t.createdAt.desc()),
  ],
);
