// Sample data (one button on an empty workspace): "Add sample data" sets up the Sales template on Deals (its stages
// and a Pipeline board, only where the workspace hasn't made its own) in the request, then starts the
// `workspace.sample_data` job, which writes 8 companies, 15 people and 10 deals with a few notes and tasks as the
// member who pressed it, through the engine's own writes, so history, access, the outbox and realtime all see them as
// any other. Each record and task it made gets a `sample_data` row, so "Remove sample data" moves exactly those to
// the trash (the tasks deleted with them) in one batch, and its Undo brings exactly that batch back. Owners and
// admins only (`schema.manage`): the template changes Deals' stages and adds a workspace view.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import type { SampleDataState } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { can } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkId, newId, uuidList } from '../engine/ids.ts';
import { defineOption, listOptions, updateOption } from '../engine/options.ts';
import { insertRecord } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { deleteIn, restoreIn } from '../engine/trash.ts';
import { loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { defineKind, type JobRegistry, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { saveNoteIn } from '../notes/notes.ts';
import { createTaskIn } from '../tasks/tasks.ts';
import { createView } from '../views/manage.ts';
import { listViews } from '../views/views.ts';
import {
  dayFrom,
  PIPELINE_VIEW_NAME,
  planStages,
  SALES_STAGES,
  SAMPLE_COMPANIES,
  SAMPLE_DEALS,
  SAMPLE_NOTES,
  SAMPLE_PEOPLE,
  SAMPLE_TASKS,
  sampleEmail,
} from './seed.ts';

/** The kind's name, as `JOB_KINDS` in `@crm/contracts` lists it. */
export const SAMPLE_DATA_KIND = 'workspace.sample_data';

/** Who may add or remove sample data. */
export const SAMPLE_FORBIDDEN = 'Only owners and admins can add or remove sample data.';
/** What a workspace without its standard objects answers. */
export const SAMPLE_NO_OBJECTS = 'Sample data needs the People, Companies and Deals objects.';
/** What a second add answers while the first is on screen. */
export const SAMPLE_PRESENT = 'This workspace already has sample data.';
/** What Remove answers when there is nothing to remove. */
export const SAMPLE_NONE = 'There is no sample data to remove.';

/** The job's params: none (the starter is the job's member). */
export const SampleDataParams = z.strictObject({});
/** The job's params. */
export type SampleDataParams = z.infer<typeof SampleDataParams>;

/** Refuses `FORBIDDEN` unless the caller is an owner or an admin. */
function requireManager(scope: EngineScope): void {
  if (!can(scope.access, 'schema.manage')) throw refuse('FORBIDDEN', SAMPLE_FORBIDDEN);
}

/** Whether a live sample record exists. */
async function samplePresent(tx: WorkspaceTx): Promise<boolean> {
  const found = await tx.execute(sql`
    select 1 from sample_data s join records r on r.workspace_id = s.workspace_id and r.id = s.record_id
    where r.deleted_at is null limit 1
  `);
  return found.rows.length > 0;
}

/** The live standard objects by key (`people`, `companies`, `deals`); `lock` holds Deals' row for the job's turn. */
async function standardObjects(tx: WorkspaceTx, lock = false): Promise<ReadonlyMap<string, string>> {
  const found = await tx.execute<{ key: string; id: string }>(sql`
    select standard_key as key, id::text as id from objects
    where standard_key in ('people', 'companies', 'deals') and archived_at is null
    order by id
    ${lock ? sql`for no key update` : sql``}
  `);
  return new Map(found.rows.map((row) => [row.key, row.id]));
}

/** A live attribute of an object by its api slug. */
const bySlug = (attributes: ReadonlyMap<string, AttributeDef>, slug: string): AttributeDef | undefined =>
  [...attributes.values()].find((each) => each.apiSlug === slug && each.archivedAt === null);

/** Values keyed by attribute id from values keyed by api slug, leaving out a slug the object no longer has live. */
function valuesOf(
  attributes: ReadonlyMap<string, AttributeDef>,
  bySlugValues: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(bySlugValues).flatMap(([slug, value]) => {
      const attribute = bySlug(attributes, slug);
      return attribute === undefined || value === undefined ? [] : [[attribute.id, value]];
    }),
  );
}

/** A note's body: one paragraph of plain text. */
const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/**
 * Writes the sample set in the job's one batch, as the member who started it: companies, then people at them, then
 * deals on both, each through `insertRecord` (access, rules, history and the outbox as any create), then the notes
 * and tasks, and a `sample_data` row for each record and task. Answers how many records it made; none when sample
 * data is live already (a second press, or a retry after the first committed).
 */
async function writeSample(context: WriteContext): Promise<number> {
  const { tx, scope } = context;
  const objects = await standardObjects(tx, true);
  const peopleId = objects.get('people');
  const companiesId = objects.get('companies');
  const dealsId = objects.get('deals');
  if (peopleId === undefined || companiesId === undefined || dealsId === undefined) {
    throw refuse('NOT_FOUND', SAMPLE_NO_OBJECTS);
  }
  if (await samplePresent(tx)) return 0;
  const today = new Date(
    (await tx.execute<{ now: string }>(sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD') as now`)).rows[0]
      ?.now ?? '1970-01-01',
  );
  const me = scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;
  const owner = me === undefined ? undefined : { type: 'member', id: me };
  const [companyAttributes, peopleAttributes, dealAttributes] = [
    await loadAttributes(tx, companiesId),
    await loadAttributes(tx, peopleId),
    await loadAttributes(tx, dealsId),
  ];
  const stage = bySlug(dealAttributes, 'stage');
  const stages = new Map(
    stage === undefined
      ? []
      : (
          await tx.execute<{ id: string; label: string }>(sql`
            select id::text as id, lower(label) as label from attribute_options
            where attribute_id = ${stage.id}::uuid and archived_at is null
          `)
        ).rows.map((row) => [row.label, row.id]),
  );
  const ids = new Map<string, { readonly objectId: string; readonly recordId: string }>();
  const ref = (key: string) => ids.get(key);
  for (const company of SAMPLE_COMPANIES) {
    const recordId = newId();
    await insertRecord(context, {
      objectId: companiesId,
      id: recordId,
      values: valuesOf(companyAttributes, {
        name: company.name,
        domains: [company.domain],
        description: company.description,
        owner,
      }),
    });
    ids.set(company.key, { objectId: companiesId, recordId });
  }
  for (const person of SAMPLE_PEOPLE) {
    const recordId = newId();
    await insertRecord(context, {
      objectId: peopleId,
      id: recordId,
      values: valuesOf(peopleAttributes, {
        name: { firstName: person.firstName, lastName: person.lastName },
        email_addresses: [sampleEmail(person, SAMPLE_COMPANIES)],
        job_title: person.jobTitle,
        company: ref(person.company),
        owner,
      }),
    });
    ids.set(person.key, { objectId: peopleId, recordId });
  }
  for (const deal of SAMPLE_DEALS) {
    const recordId = newId();
    await insertRecord(context, {
      objectId: dealsId,
      id: recordId,
      values: valuesOf(dealAttributes, {
        name: deal.name,
        // A stage the workspace renamed or archived leaves the deal on its first stage, as a new deal starts.
        stage: stages.get(deal.stage.toLowerCase()),
        value: { amount: deal.value, currency: 'USD' },
        close_date: dayFrom(today, deal.closesInDays),
        next_step: deal.nextStep,
        associated_company: ref(deal.company),
        associated_people: deal.people.flatMap((key) => {
          const person = ref(key);
          return person === undefined ? [] : [person];
        }),
        owner,
      }),
    });
    ids.set(deal.key, { objectId: dealsId, recordId });
  }
  for (const note of SAMPLE_NOTES) {
    const on = ref(note.on);
    if (on === undefined) continue;
    await saveNoteIn(context, { id: newId(), recordId: on.recordId, title: note.title, content: paragraph(note.text) });
  }
  const taskIds: string[] = [];
  for (const task of SAMPLE_TASKS) {
    const on = ref(task.on);
    if (on === undefined) continue;
    const id = newId();
    await createTaskIn(context, {
      id,
      title: task.title,
      dueOn: dayFrom(today, task.dueInDays),
      ...(me === undefined ? {} : { assigneeMemberId: me }),
      recordIds: [on.recordId],
    });
    taskIds.push(id);
  }
  const recordIds = [...ids.values()].map((each) => each.recordId);
  await tx.execute(sql`
    insert into sample_data (workspace_id, record_id)
    select ${scope.workspaceId}::uuid, x.id from unnest(${uuidList(recordIds)}) as x(id)
  `);
  await tx.execute(sql`
    insert into sample_data (workspace_id, task_id)
    select ${scope.workspaceId}::uuid, x.id from unnest(${uuidList(taskIds)}) as x(id)
  `);
  return recordIds.length;
}

/** The `workspace.sample_data` kind: a member's, one batch, never cancelled (it is over in a moment). */
export function sampleDataKind(): KindDefinition<SampleDataParams> {
  return defineKind<SampleDataParams>({
    kind: SAMPLE_DATA_KIND,
    lane: 'light',
    actor: 'member',
    mode: 'cursor',
    params: SampleDataParams,
    cancellable: false,
    maxAttempts: 3,
    batchSize: 1,
    sample: {},
    async step(context): Promise<StepOutcome> {
      // A starter demoted since adds nothing.
      if (!can(context.scope.access, 'schema.manage')) {
        return { finished: true, counts: { done: 0 }, failed: { code: 'FORBIDDEN', message: SAMPLE_FORBIDDEN } };
      }
      const made = await writeSample(context);
      return { finished: true, counts: { done: made }, result: { records: made } };
    },
  });
}

/**
 * The Sales template on Deals (owners and admins): its stages by `planStages` (none: all six; still the four a
 * workspace starts with: In progress renamed Qualified, Proposal and Negotiation added after it; any other set left
 * alone), then a shared "Pipeline" board grouped by stage, totalling value, unless Deals has a view of that name.
 * Each step is its own write through the engine's option and view services, and running it again changes nothing.
 */
export async function applySalesTemplate(scope: EngineScope, hooks: readonly AfterWrite[] = []): Promise<void> {
  requireManager(scope);
  const found = await inWorkspace(scope, async (tx) => {
    const dealsId = (await standardObjects(tx)).get('deals');
    if (dealsId === undefined) return undefined;
    return { dealsId, attributes: await loadAttributes(tx, dealsId) };
  });
  if (found === undefined) return;
  const stage = bySlug(found.attributes, 'stage');
  if (stage === undefined || stage.type !== 'status') return;
  const live = (await listOptions(scope, stage.id)).filter((option) => !option.archived);
  const plan = planStages(live.map((option) => option.label));
  if (plan.kind === 'upgrade') {
    const renamed = live.find((option) => option.label.trim().toLowerCase() === plan.rename.from.toLowerCase());
    if (renamed !== undefined) {
      await updateOption(scope, { optionId: renamed.id, label: plan.rename.to, hue: 'sky' }, hooks);
    }
  }
  if (plan.kind !== 'keep') {
    for (const label of plan.add) {
      const spec = SALES_STAGES.find((each) => each.label === label);
      if (spec === undefined) continue;
      const made = await defineOption(
        scope,
        { id: newId(), attributeId: stage.id, label, hue: spec.hue, outcome: spec.outcome },
        hooks,
      );
      // Added after the open stages, before Won and Lost: Proposal at 2, Negotiation at 3.
      const position = SALES_STAGES.findIndex((each) => each.label === label);
      if (plan.kind === 'upgrade') await updateOption(scope, { optionId: made.optionId, position }, hooks);
    }
  }
  const { views } = await listViews(scope, found.dealsId);
  if (views.some((view) => view.name.trim().toLowerCase() === PIPELINE_VIEW_NAME.toLowerCase())) return;
  const value = bySlug(found.attributes, 'value');
  const cardFields = ['value', 'owner', 'close_date'].flatMap((slug) => {
    const attribute = bySlug(found.attributes, slug);
    return attribute === undefined ? [] : [attribute.id];
  });
  await createView(
    scope,
    {
      id: newId(),
      objectId: found.dealsId,
      name: PIPELINE_VIEW_NAME,
      kind: 'board',
      visibility: 'workspace',
      config: {
        columns: [],
        showNewAttributes: true,
        pinnedCount: 1,
        sorts: [],
        board: {
          groupByAttributeId: stage.id,
          cardFields,
          showEmptyColumns: true,
          ...(value?.type === 'currency' ? { totalAttributeId: value.id } : {}),
        },
      },
    },
    hooks,
  );
}

/** A workspace's sample data as the caller sees it: live or not, the job adding it, and whether they may manage it. */
export async function getSampleData(scope: EngineScope): Promise<SampleDataState> {
  checkScope(scope);
  const canManage = can(scope.access, 'schema.manage');
  return inWorkspace(scope, async (tx) => {
    const present = await samplePresent(tx);
    const running = await tx.execute<{ id: string }>(sql`
      select id::text as id from jobs
      where kind = ${SAMPLE_DATA_KIND} and status in ('preparing', 'ready', 'queued', 'running')
      order by created_at desc limit 1
    `);
    const jobId = running.rows[0]?.id;
    return { present, canManage, ...(jobId === undefined ? {} : { jobId }) };
  });
}

/**
 * "Add sample data" (owners and admins): the Sales template first, then the job, in the caller's write, so it runs
 * only once that commits. A workspace with sample data live answers `CONFIG_INVALID`; one with the job already
 * running answers that job.
 */
export async function addSampleData(
  scope: EngineScope,
  registry: JobRegistry,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly jobId: string }> {
  checkScope(scope);
  requireManager(scope);
  const state = await getSampleData(scope);
  if (state.jobId !== undefined) return { jobId: state.jobId };
  if (state.present) throw refuse('CONFIG_INVALID', SAMPLE_PRESENT);
  await applySalesTemplate(scope, hooks);
  const { result } = await runWrite(
    scope,
    async (context) => (await startJob(context, registry, { kind: SAMPLE_DATA_KIND, params: {} })).jobId,
    hooks,
  );
  return { jobId: result };
}

/**
 * "Remove sample data" (owners and admins): every live sample record to the trash in one batch (`batchId`, so its
 * Undo restores exactly these), one object at a time through the trash's own delete, and the sample tasks deleted
 * with them. `NOT_FOUND` when none is live. Answers how many records went.
 */
export async function removeSampleData(
  scope: EngineScope,
  input: { readonly batchId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly records: number }> {
  checkScope(scope);
  requireManager(scope);
  const batchId = checkId(input.batchId, 'Give the remove a batch id.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const live = await tx.execute<{ record_id: string; object_id: string }>(sql`
        select s.record_id::text as record_id, r.object_id::text as object_id
        from sample_data s join records r on r.workspace_id = s.workspace_id and r.id = s.record_id
        where r.deleted_at is null
        order by r.id
      `);
      if (live.rows.length === 0) throw refuse('NOT_FOUND', SAMPLE_NONE);
      const byObject = new Map<string, string[]>();
      for (const row of live.rows) byObject.set(row.object_id, [...(byObject.get(row.object_id) ?? []), row.record_id]);
      const deleted: string[] = [];
      for (const [objectId, recordIds] of [...byObject].sort(([a], [b]) => a.localeCompare(b))) {
        const outcomes = await deleteIn(context, { objectId, recordIds, batchId });
        deleted.push(...outcomes.flatMap((each) => (each.state === 'deleted' ? [each.recordId] : [])));
      }
      if (deleted.length > 0) {
        await tx.execute(sql`
          update sample_data set removed_batch_id = ${batchId}::uuid where record_id = any(${uuidList(deleted)})
        `);
      }
      const { actor } = scope;
      const tasks = await tx.execute<{ id: string; record_ids: string[] }>(sql`
        with gone as (
          update tasks t set deleted_at = now(), deleted_by_type = ${actor.type}, deleted_by_id = ${actor.id}::uuid,
            deleted_by_member_id = ${actor.type === 'member' ? actor.id : null}::uuid
          from sample_data s
          where s.task_id = t.id and t.deleted_at is null
          returning t.id
        ),
        marked as (
          update sample_data s set removed_batch_id = ${batchId}::uuid from gone g where s.task_id = g.id
        )
        select g.id::text as id,
          coalesce((select array_agg(l.record_id::text) from task_records l where l.task_id = g.id), '{}') as record_ids
        from gone g
      `);
      if (tasks.rows.length > 0) {
        context.record({ tasks: tasks.rows.map((row) => ({ taskId: row.id, recordIds: row.record_ids })) });
      }
      return { records: deleted.length };
    },
    hooks,
  );
  return result;
}

/**
 * Undo of "Remove sample data": the records that remove's batch took, back from the trash through the trash's own
 * restore, and its tasks. `NOT_FOUND` when nothing of it is left (restored already, or purged).
 */
export async function undoRemoveSampleData(
  scope: EngineScope,
  input: { readonly batchId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly records: number }> {
  checkScope(scope);
  requireManager(scope);
  const batchId = checkId(input.batchId, 'Give the remove a batch id.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const taken = await tx.execute<{ record_id: string }>(sql`
        select s.record_id::text as record_id
        from sample_data s join records r on r.workspace_id = s.workspace_id and r.id = s.record_id
        where s.removed_batch_id = ${batchId}::uuid and r.deleted_batch_id = ${batchId}::uuid
          and r.deleted_at is not null
        order by r.id
      `);
      if (taken.rows.length === 0) throw refuse('NOT_FOUND', SAMPLE_NONE);
      const outcomes = await restoreIn(
        context,
        taken.rows.map((row) => row.record_id),
      );
      const tasks = await tx.execute<{ id: string; record_ids: string[] }>(sql`
        with back as (
          update tasks t set deleted_at = null, deleted_by_type = null, deleted_by_id = null,
            deleted_by_member_id = null
          from sample_data s
          where s.task_id = t.id and s.removed_batch_id = ${batchId}::uuid and t.deleted_at is not null
          returning t.id
        )
        select b.id::text as id,
          coalesce((select array_agg(l.record_id::text) from task_records l where l.task_id = b.id), '{}') as record_ids
        from back b
      `);
      if (tasks.rows.length > 0) {
        context.record({ tasks: tasks.rows.map((row) => ({ taskId: row.id, recordIds: row.record_ids })) });
      }
      await tx.execute(sql`update sample_data set removed_batch_id = null where removed_batch_id = ${batchId}::uuid`);
      return { records: outcomes.filter((each) => each.state === 'restored').length };
    },
    hooks,
  );
  return result;
}
