// Handing a removed member's work on (spec 0031, AC-816): a background job,
// the remover's (run as them through the door at every slice, so a remover
// demoted or removed since stops), that moves every member typed value naming
// the removed member on live records to the chosen member through the same
// engine write a bulk edit makes (value history included, refusals counted),
// then the assignee of their open tasks the remover may change (AC-447). A
// remover without `members.manage` any more hands nothing on. Its progress
// shows in Background jobs. Logs never carry ids beyond the job's.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { can } from '../access/policy.ts';
import { updateManyIn } from '../engine/bulk-edit.ts';
import { uuidList } from '../engine/ids.ts';
import { actorRow } from '../engine/scope.ts';
import type { WriteContext } from '../engine/write.ts';
import { changeableTaskIds } from '../tasks/tasks.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';

/** The kind's name, as `JOB_KINDS` in `@crm/contracts` lists it. */
export const REASSIGN_KIND = 'members.reassign';

/** The job's params: whose work, and to whom. Ids only. */
export const ReassignParams = z.strictObject({ fromMemberId: z.uuid(), toMemberId: z.uuid() });
/** The job's params. */
export type ReassignParams = z.infer<typeof ReassignParams>;

/** Where the next batch starts: in the records (after this record id), then in the tasks (after this task id). */
const Checkpoint = z.object({ phase: z.enum(['records', 'tasks']), after: z.uuid().optional() });

/** The member typed values naming `from` on live records after `after`, at most `limit` records' worth. */
async function namingValues(context: WriteContext, from: string, after: string | undefined, limit: number) {
  const workspaceId = context.scope.workspaceId;
  const found = await context.tx.execute<{
    record_id: string;
    object_id: string;
    attribute_id: string;
    is_multi: boolean;
  }>(
    sql`
      with picked as (
        select distinct v.owner_id
        from "values" v
        join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
        join records r on r.workspace_id = v.workspace_id and r.id = v.owner_id
        -- actor_id (equal to actor_member_id for a member, by the check) lets values_actor serve it.
        where v.workspace_id = ${workspaceId}::uuid and v.active_until is null and not v.is_cleared
          and v.actor_type = 'member' and v.actor_id = ${from}::uuid
          and a.type = 'actor_reference' and not a.is_system and a.archived_at is null and a.object_id is not null
          and r.deleted_at is null
          ${after === undefined ? sql`` : sql`and v.owner_id > ${after}::uuid`}
        order by v.owner_id
        limit ${limit}
      )
      select distinct v.owner_id::text as record_id, r.object_id::text as object_id, a.id::text as attribute_id,
        a.is_multi
      from "values" v
      join picked p on p.owner_id = v.owner_id
      join attributes a on a.workspace_id = v.workspace_id and a.id = v.attribute_id
      join records r on r.workspace_id = v.workspace_id and r.id = v.owner_id
      where v.workspace_id = ${workspaceId}::uuid and v.active_until is null and not v.is_cleared
        and v.actor_type = 'member' and v.actor_id = ${from}::uuid
        and a.type = 'actor_reference' and not a.is_system and a.archived_at is null
      order by 1, 3
    `,
  );
  return found.rows;
}

/** One batch of records: each attribute naming `from` names `to` instead, a bulk edit per object and attribute. */
async function moveValues(
  context: WriteContext,
  params: ReassignParams,
  after: string | undefined,
  limit: number,
): Promise<StepOutcome> {
  const rows = await namingValues(context, params.fromMemberId, after, limit);
  if (rows.length === 0) return { checkpoint: { phase: 'tasks' }, finished: false, counts: { done: 0 } };
  const groups = new Map<string, { objectId: string; attributeId: string; isMulti: boolean; recordIds: string[] }>();
  for (const row of rows) {
    const key = `${row.object_id}:${row.attribute_id}`;
    const group = groups.get(key) ?? {
      objectId: row.object_id,
      attributeId: row.attribute_id,
      isMulti: row.is_multi,
      recordIds: [],
    };
    group.recordIds.push(row.record_id);
    groups.set(key, group);
  }
  const to = { type: 'member', id: params.toMemberId };
  const from = { type: 'member', id: params.fromMemberId };
  let done = 0;
  let refused = 0;
  for (const group of groups.values()) {
    const edits = group.isMulti
      ? [
          { attributeId: group.attributeId, op: 'remove' as const, value: [from] },
          { attributeId: group.attributeId, op: 'add' as const, value: [to] },
        ]
      : [{ attributeId: group.attributeId, op: 'set' as const, value: to }];
    // A record counts as handed on only when every edit on it applied (a multi value's remove and add).
    const refusedIds = new Set<string>();
    for (const edit of edits) {
      const outcomes = await updateManyIn(context, { objectId: group.objectId, recordIds: group.recordIds, edit });
      outcomes.forEach((outcome, index) => {
        if (outcome.state === 'refused') refusedIds.add(group.recordIds[index] ?? '');
      });
    }
    refused += refusedIds.size;
    done += group.recordIds.length - refusedIds.size;
  }
  const last = rows.reduce((max, row) => (row.record_id > max ? row.record_id : max), rows[0]?.record_id ?? '');
  return { checkpoint: { phase: 'records', after: last }, finished: false, counts: { done, refused } };
}

/** One batch of open tasks assigned to `from`: assigned to `to` instead, by the remover. */
async function moveTasks(
  context: WriteContext,
  params: ReassignParams,
  after: string | undefined,
  limit: number,
): Promise<StepOutcome> {
  const { tx, scope } = context;
  const by = actorRow(scope.actor);
  const picked = await tx.execute<{ id: string }>(sql`
    select id::text as id from tasks
    where workspace_id = ${scope.workspaceId}::uuid and assignee_member_id = ${params.fromMemberId}::uuid
      and deleted_at is null and not is_done
      ${after === undefined ? sql`` : sql`and id > ${after}::uuid`}
    order by id limit ${limit} for update
  `);
  const pickedIds = picked.rows.map((row) => row.id);
  if (pickedIds.length === 0) return { finished: true, counts: { done: 0 } };
  // Only the tasks the remover may change (AC-447); the rest stay with them, counted as refused.
  const changeable = await changeableTaskIds(tx, scope, pickedIds);
  const ids = pickedIds.filter((id) => changeable.has(id)).sort();
  const next = { checkpoint: { phase: 'tasks', after: pickedIds.at(-1) }, finished: pickedIds.length < limit };
  const refused = pickedIds.length - ids.length;
  if (ids.length === 0) return { ...next, counts: { done: 0, refused } };
  await tx.execute(sql`
    update tasks set assignee_member_id = ${params.toMemberId}::uuid, updated_at = now(),
      updated_by_type = ${by.type}, updated_by_id = ${by.id}::uuid, updated_by_member_id = ${by.memberId}::uuid
    where workspace_id = ${scope.workspaceId}::uuid and id = any(${uuidList(ids)})
  `);
  const links = await tx.execute<{ task_id: string; record_id: string }>(sql`
    select task_id::text as task_id, record_id::text as record_id from task_records
    where workspace_id = ${scope.workspaceId}::uuid and task_id = any(${uuidList(ids)})
  `);
  // Every screen showing these tasks reads them again (spec 0019).
  context.record({
    tasks: ids.map((taskId) => ({
      taskId,
      recordIds: links.rows.filter((link) => link.task_id === taskId).map((link) => link.record_id),
    })),
  });
  return { ...next, counts: { done: ids.length, refused } };
}

/** The reassignment kind: a member's heavy cursor job, cancellable, 200 records or tasks a batch. */
export function reassignKind(): KindDefinition<ReassignParams> {
  return defineKind<ReassignParams>({
    kind: REASSIGN_KIND,
    lane: 'heavy',
    actor: 'member',
    mode: 'cursor',
    params: ReassignParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 200,
    sample: {
      fromMemberId: '00000000-0000-7000-8000-000000000001',
      toMemberId: '00000000-0000-7000-8000-000000000002',
    },
    async step(context, input) {
      // A remover who no longer manages members (demoted since) hands nothing more on.
      if (!can(context.scope.access, 'members.manage')) return { finished: true, counts: { done: 0 } };
      // The chosen member may have left since: their work is never handed to someone no longer here.
      const heir = await context.tx.execute(sql`
        select 1 from members
        where workspace_id = ${context.scope.workspaceId}::uuid and id = ${input.job.params.toMemberId}::uuid
          and status = 'active'
        for share
      `);
      if (heir.rows.length === 0) return { finished: true, counts: { done: 0 } };
      const at = Checkpoint.safeParse(input.job.checkpoint);
      const checkpoint = at.success ? at.data : { phase: 'records' as const };
      return checkpoint.phase === 'records'
        ? moveValues(context, input.job.params, checkpoint.after, input.limit)
        : moveTasks(context, input.job.params, checkpoint.after, input.limit);
    },
  });
}
