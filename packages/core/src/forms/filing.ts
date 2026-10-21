// Filing submissions with the form's current mapping, by a member (spec 0023
// follow-up, the owner's asks): "Add to CRM" for submissions that aren't in
// the CRM (failed, or whose record went to the trash), one or many, and "Sync
// old records", which applies the current published mapping to earlier
// submissions after it changed, previewed first. Both run as the member's own
// background jobs (`forms.file`, `forms.sync`, heavy lane, cancellable), and
// every record write goes through the engine as that member, so their access
// decides what lands (an attribute they can't write is skipped and said),
// with value history and change events as any write. Each submission is
// locked while it files, and filing it again finds its record and writes
// only what is new, so a retried batch or a second sync is safe.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import {
  ADD_TO_CRM_MAX,
  SYNC_PREVIEW_MAX,
  type AddToCrmResult,
  type FormDocument,
  type SyncCounts,
  type SyncPreview,
  type SyncScope,
  type SyncStarted,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { checkId, uuidList } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { currentItems, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { can, fieldLevel, objectLevel, type Access } from '../access/policy.ts';
import { recordVisibleSql, visibleRecords } from '../access/visibility.ts';
import { inWorkspace } from '../access/run.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { UNKNOWN_FORM } from './forms.ts';
import {
  answersOf,
  changesFor,
  chooseOwner,
  fileAnswers,
  heldValues,
  indexHeld,
  matchKey,
  optionsFor,
  ownerAttribute,
  plan,
  settle,
} from './process.ts';
import { canSeeForm, loadForm, loadVersions, type FormRow } from './shared.ts';

/** The Add to CRM job's name. */
export const FORMS_FILE = 'forms.file';
/** The Sync old records job's name. */
export const FORMS_SYNC = 'forms.sync';

/** What a form with no published version answers to filing. */
export const NOT_PUBLISHED = 'Publish the form first: filing uses its published questions.';

/** What a form whose published version keeps its submissions only answers to filing. */
export const NOT_MAPPED =
  'This form keeps its submissions only. Turn on Add each submission to the CRM in its settings, and publish, first.';

/** What a submission no longer in scope says on its job item. */
const NOT_ELIGIBLE = 'This submission is no longer one to file (it was filed, marked as spam, or deleted).';

/** What a submission already in the CRM on another object than the form now files onto says on its job item. */
export const ON_ANOTHER_OBJECT =
  'This submission is in the CRM on another object than the form now files onto, so it was left as it is.';

/** A form's live mapping: its published document, the object it files onto and that object's attributes. */
interface Mapping {
  readonly form: FormRow;
  readonly document: FormDocument;
  readonly versionNumber: number;
  readonly objectId: string;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  readonly options: Awaited<ReturnType<typeof optionsFor>>;
}

/** A form's live mapping; `unpublished` with no live version, `unmapped` when that version keeps submissions only. */
async function mappingOf(tx: WorkspaceTx, formId: string): Promise<Mapping | 'unpublished' | 'unmapped'> {
  const form = await loadForm(tx, formId);
  if (form === undefined || form.liveVersionId === null) return 'unpublished';
  const live = (await loadVersions(tx, [form.liveVersionId])).get(form.liveVersionId);
  if (live === undefined) return 'unpublished';
  const target = live.document.targets.main;
  if (target === undefined) return 'unmapped';
  const attributes = await loadAttributes(tx, target.objectId);
  return {
    form,
    document: live.document,
    versionNumber: live.number,
    objectId: target.objectId,
    attributes,
    options: await optionsFor(tx, live.document, attributes),
  };
}

/** The form a member acts on: one they can see, or NOT_FOUND; published and adding to the CRM, or FORM_STATE. */
async function managedForm(tx: WorkspaceTx, scope: EngineScope, formId: string): Promise<Mapping> {
  const id = checkId(formId, UNKNOWN_FORM);
  const form = await loadForm(tx, id);
  // A form the member can't see is absent to them, as everywhere.
  if (form === undefined || !canSeeForm(scope.access, form)) throw refuse('NOT_FOUND', UNKNOWN_FORM);
  const mapping = await mappingOf(tx, id);
  if (mapping === 'unpublished') throw refuse('FORM_STATE', NOT_PUBLISHED);
  if (mapping === 'unmapped') throw refuse('FORM_STATE', NOT_MAPPED);
  // Filing writes the live target's records: the member must see that object too.
  if (objectLevel(scope.access, mapping.objectId) === 'none') throw refuse('NOT_FOUND', UNKNOWN_FORM);
  return mapping;
}

/** The records of `ids` the member can see: filing never reads or links one they can't. */
async function seenBy(tx: WorkspaceTx, scope: EngineScope, objectId: string, ids: readonly string[]) {
  return visibleRecords(
    tx,
    scope.access,
    ids.map((recordId) => ({ objectId, recordId })),
  );
}

/**
 * The SQL test for a submission in a sync's scope (or, for `unfiled`, one Add
 * to CRM takes): failed, or processed with no live record (`unfiled`); or
 * every failed and processed one (`all`). Only ever one the member may see,
 * as Submissions shows it (`visibleRows`): with no main record, or one they
 * can see wherever it is, live or in the trash, so filing never takes, counts
 * or names a submission whose record their rules hide (security review,
 * 21 October 2026). `s` is the submission, `r` its live main record from a
 * left join; nothing more under the open policy.
 */
function scopeTest(scope: SyncScope, access: Access) {
  const state =
    scope === 'unfiled'
      ? sql`(s.state = 'failed' or (s.state = 'processed' and r.id is null))`
      : sql`s.state in ('failed', 'processed')`;
  const visible = recordVisibleSql(access, 'rm');
  if (visible === undefined) return state;
  return sql`${state} and (s.main_record_id is null or exists (
    select 1 from records rm where rm.workspace_id = s.workspace_id and rm.id = s.main_record_id and ${visible}
  ))`;
}

/** A submission as filing reads it, with its main record while that is live, and the object it is on. */
interface ScopedRow extends Record<string, unknown> {
  readonly id: string;
  readonly state: string;
  readonly answers: unknown;
  readonly live_record_id: string | null;
  readonly live_object_id: string | null;
}

/** Totals a filing job keeps in its checkpoint and shows as its result. */
const Totals = z.object({
  created: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  failures: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
type Totals = z.infer<typeof Totals>;
const NO_TOTALS: Totals = { created: 0, updated: 0, unchanged: 0, failures: 0, skipped: 0 };

function totalsOf(checkpoint: unknown): Totals {
  const parsed = Totals.safeParse(checkpoint);
  return parsed.success ? parsed.data : NO_TOTALS;
}

/**
 * One batch of a filing job: each submission locked, checked against the
 * scope again (it may have changed since the start), and filed with the
 * form's live mapping as the member. A failed one that fails again keeps its
 * new reason; a filed one whose update now fails keeps its record and state,
 * and is counted and said on its item.
 */
async function fileBatch(
  context: WriteContext,
  input: {
    readonly formId: string;
    readonly scope: SyncScope;
    readonly items: readonly { readonly position: number; readonly itemId: string }[];
    readonly checkpoint: unknown;
  },
): Promise<StepOutcome> {
  const { tx } = context;
  const totals = { ...totalsOf(input.checkpoint) };
  // The member as they are now: one who lost forms.manage since the start files nothing more.
  if (!can(context.scope.access, 'forms.manage')) {
    return {
      finished: true,
      failed: { code: 'FORBIDDEN', message: 'You can no longer manage forms, so nothing more was filed.' },
    };
  }
  const mapping = await mappingOf(tx, input.formId);
  if (mapping === 'unmapped') {
    return {
      finished: true,
      failed: { code: 'FORM_STATE', message: 'The form now keeps its submissions only, so nothing more was filed.' },
    };
  }
  if (
    mapping === 'unpublished' ||
    !canSeeForm(context.scope.access, mapping.form) ||
    objectLevel(context.scope.access, mapping.objectId) === 'none'
  ) {
    return {
      finished: true,
      failed: { code: 'FORM_STATE', message: 'The form is gone or no longer published, so nothing more was filed.' },
    };
  }
  const outcomes: ItemOutcome[] = [];
  for (const item of input.items) {
    const found = await tx.execute<ScopedRow>(sql`
      select s.id::text, s.state, s.answers, r.id::text as live_record_id, r.object_id::text as live_object_id
      from form_submissions s
      left join records r on r.workspace_id = s.workspace_id and r.id = s.main_record_id and r.deleted_at is null
      where s.id = ${item.itemId} and s.form_id = ${input.formId} and ${scopeTest(input.scope, context.scope.access)}
      for update of s
    `);
    const row = found.rows[0];
    if (row === undefined) {
      totals.skipped += 1;
      outcomes.push({ position: item.position, state: 'skipped', code: 'FORM_STATE', message: NOT_ELIGIBLE });
      continue;
    }
    // Filed on another object before the form's target changed: the new mapping has nothing to write there.
    if (row.live_record_id !== null && row.live_object_id !== mapping.objectId) {
      totals.skipped += 1;
      outcomes.push({ position: item.position, state: 'skipped', code: 'FORM_STATE', message: ON_ANOTHER_OBJECT });
      continue;
    }
    const filed = await fileAnswers(context, {
      submissionId: row.id,
      answers: answersOf(row.answers),
      form: mapping.form,
      document: mapping.document,
      objectId: mapping.objectId,
      attributes: mapping.attributes,
      options: mapping.options,
      ...(row.live_record_id === null ? {} : { keepRecordId: row.live_record_id }),
      // The member writes, through their own access: the mapping's answers only, into records they can see.
      writer: () => context,
      canUse: async (recordId) => (await seenBy(tx, context.scope, mapping.objectId, [recordId])).has(recordId),
    });
    if (filed.kind === 'failed') {
      totals.failures += 1;
      // A filed submission keeps its record and state; one not in the CRM records why it still isn't.
      if (row.live_record_id === null) await settle(tx, row.id, filed, { filedWith: mapping.versionNumber });
      outcomes.push({ position: item.position, state: 'refused', code: 'FORM_STATE', message: filed.failure });
      continue;
    }
    if (filed.action === 'created') totals.created += 1;
    else if (filed.action === 'updated') totals.updated += 1;
    else totals.unchanged += 1;
    await settle(tx, row.id, filed, { filedWith: mapping.versionNumber });
    outcomes.push({ position: item.position, state: 'done' });
  }
  return { finished: false, items: outcomes, checkpoint: totals, result: { filing: totals } };
}

/** The Add to CRM job's params: the form (its items are the submissions). */
export const FormsFileParams = z.strictObject({ formId: z.uuid() });
/** The Add to CRM job's params. */
export type FormsFileParams = z.infer<typeof FormsFileParams>;

/** `forms.file`: the member's, heavy lane, cancellable, 20 submissions a batch. */
export function formsFile(): KindDefinition<FormsFileParams> {
  return defineKind<FormsFileParams>({
    kind: FORMS_FILE,
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: FormsFileParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 20,
    sample: { formId: '0199f0a0-0000-7000-8000-000000000001' },
    step: (context, { job, items }) =>
      fileBatch(context, {
        formId: job.params.formId,
        scope: 'unfiled',
        items: items ?? [],
        checkpoint: job.checkpoint,
      }),
  });
}

/**
 * Add to CRM: starts one `forms.file` job for the named submissions of a form
 * that aren't in the CRM (failed, or processed with no live record), in the
 * order given. Ones that don't qualify are counted as skipped; when none
 * does, no job starts. Needs `forms.manage` and a published form.
 */
export async function addToCrm(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly formId: string; readonly submissionIds: readonly string[] },
  hooks: readonly AfterWrite[] = [],
): Promise<AddToCrmResult> {
  requirePermission(scope, 'forms.manage');
  const ids = [...new Set(input.submissionIds)].slice(0, ADD_TO_CRM_MAX).map((id) => checkId(id, NOT_ELIGIBLE));
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { form } = await managedForm(context.tx, scope, input.formId);
      const found = await context.tx.execute<{ id: string }>(sql`
        select s.id::text from form_submissions s
        left join records r on r.workspace_id = s.workspace_id and r.id = s.main_record_id and r.deleted_at is null
        where s.form_id = ${form.id} and s.id = any(${uuidList(ids)}) and ${scopeTest('unfiled', scope.access)}
      `);
      const eligible = new Set(found.rows.map((row) => row.id));
      // In id order, as a sync takes them, so two jobs on one form lock submissions in the same order.
      const queued = ids.filter((id) => eligible.has(id)).sort();
      if (queued.length === 0) return { queued: 0, skipped: ids.length };
      const { jobId } = await startJob(context, registry, {
        kind: FORMS_FILE,
        params: { formId: form.id },
        items: queued,
      });
      return { jobId, queued: queued.length, skipped: ids.length - queued.length };
    },
    hooks,
  );
  return result;
}

/** The most submissions a count reads: past it a preview or a start says this many. */
export const SYNC_COUNT_MAX = 100_000;

/**
 * How many of a form's submissions a scope holds for the member, counting at most `SYNC_COUNT_MAX` (bounded on a
 * huge form).
 */
async function countInScope(tx: WorkspaceTx, access: Access, formId: string, scope: SyncScope): Promise<number> {
  const counted = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from (
      select 1 from form_submissions s
      left join records r on r.workspace_id = s.workspace_id and r.id = s.main_record_id and r.deleted_at is null
      where s.form_id = ${formId} and ${scopeTest(scope, access)}
      limit ${SYNC_COUNT_MAX}
    ) as counted
  `);
  return counted.rows[0]?.n ?? 0;
}

/**
 * What Sync old records would do (read only): the newest submissions in scope
 * (at most `SYNC_PREVIEW_MAX`), each planned against the live mapping and
 * compared with its record as it is, in a handful of reads for the whole
 * page (one for the candidate matches, one for their values). Only the
 * fields the member may write are compared, so a field their rules hide is
 * never read; one filed on another object than the form's now is left as it
 * is, as the run leaves it. An estimate: a refusal only the engine finds at
 * write time (a rule, a required field) shows at the run, not here; two
 * submissions for one new person count as a create and an update.
 */
export async function previewSync(
  scope: EngineScope,
  input: { readonly formId: string; readonly scope: SyncScope },
): Promise<SyncPreview> {
  requirePermission(scope, 'forms.manage');
  return inWorkspace(scope, async (tx) => {
    const mapping = await managedForm(tx, scope, input.formId);
    const { form, document, attributes, options, objectId } = mapping;
    const total = await countInScope(tx, scope.access, form.id, input.scope);
    const page = await tx.execute<ScopedRow>(sql`
      select s.id::text, s.state, s.answers, r.id::text as live_record_id, r.object_id::text as live_object_id
      from form_submissions s
      left join records r on r.workspace_id = s.workspace_id and r.id = s.main_record_id and r.deleted_at is null
      where s.form_id = ${form.id} and ${scopeTest(input.scope, scope.access)}
      order by s.received_at desc, s.id desc
      limit ${SYNC_PREVIEW_MAX}
    `);
    const planned = page.rows.map((row) => ({ row, ...plan(document, attributes, options, answersOf(row.answers)) }));

    // Every candidate match in one read: the main object's records holding the planned match keys.
    const keys = new Map<string, string>();
    for (const each of planned) {
      if (each.row.live_record_id !== null) continue;
      const match = matchKey(each.planned, document.targets.main?.matchAttributeId);
      if (match !== undefined) keys.set(each.row.id, match.key);
    }
    const matchAttributeId = document.targets.main?.matchAttributeId;
    const matched = new Map<string, string>();
    if (keys.size > 0 && matchAttributeId !== undefined) {
      const hits = await tx.execute<{ unique_key: string; record_id: string }>(sql`
        select distinct on (v.unique_key) v.unique_key, v.record_id::text
        from "values" v join records r on r.workspace_id = v.workspace_id and r.id = v.record_id
        where v.attribute_id = ${matchAttributeId} and v.unique_key = any(array(select jsonb_array_elements_text(${JSON.stringify([...new Set(keys.values())])}::jsonb)))
          and v.active_until is null and r.object_id = ${objectId} and r.deleted_at is null
        order by v.unique_key, r.created_at, r.id
      `);
      for (const hit of hits.rows) matched.set(hit.unique_key, hit.record_id);
    }

    // Only what the member may write is compared (security review, 21 October 2026): a field their rules hide is
    // never read, and one they may only read is left as it is by the run, as their own write would leave it.
    const writesObject = objectLevel(scope.access, objectId) === 'write';
    const writable = (attribute: AttributeDef) =>
      writesObject && fieldLevel(scope.access, { id: attribute.id, objectId }) === 'write';
    const writes = (each: (typeof planned)[number]) => each.planned.filter((item) => writable(item.attribute));
    const ownerAll = ownerAttribute(attributes);
    const owner = ownerAll !== undefined && writable(ownerAll) ? ownerAll : undefined;
    const assignment = await chooseOwner(tx, form.ownerMemberId);
    const ownerValue = assignment.memberId === undefined ? undefined : { type: 'member', id: assignment.memberId };
    // Filed on another object before the form's target changed: the run leaves it as it is (ON_ANOTHER_OBJECT).
    const elsewhere = (each: (typeof planned)[number]) =>
      each.row.live_record_id !== null && each.row.live_object_id !== objectId;
    const targetOf = (each: (typeof planned)[number]) => {
      if (each.row.live_record_id !== null) return each.row.live_record_id;
      const key = keys.get(each.row.id);
      return key === undefined ? undefined : matched.get(key);
    };
    const candidates = [...new Set(planned.flatMap((each) => (elsewhere(each) ? [] : (targetOf(each) ?? []))))];
    // Only records the member can see: one they can't is a failure here, as it is when the job runs.
    const seen = candidates.length === 0 ? new Set<string>() : await seenBy(tx, scope, objectId, candidates);
    const mapped = [
      ...new Set([
        ...planned.flatMap((each) => writes(each).map((item) => item.attribute.id)),
        ...(owner === undefined ? [] : [owner.id]),
      ]),
    ];
    const visible = candidates.filter((id) => seen.has(id));
    const held = indexHeld(visible.length === 0 || mapped.length === 0 ? [] : await currentItems(tx, visible, mapped));

    const counts: { -readonly [K in keyof SyncCounts]: number } = { creates: 0, updates: 0, unchanged: 0, failures: 0 };
    const createdKeys = new Set<string>();
    for (const each of planned) {
      if (elsewhere(each)) {
        counts.unchanged += 1;
        continue;
      }
      const target = targetOf(each);
      if (target === undefined) {
        const key = keys.get(each.row.id);
        if (each.planned.length === 0) counts.failures += 1;
        else if (key !== undefined && createdKeys.has(key)) counts.updates += 1;
        else {
          counts.creates += 1;
          if (key !== undefined) createdKeys.add(key);
        }
        continue;
      }
      if (!seen.has(target)) {
        counts.failures += 1;
        continue;
      }
      const { changes } = await changesFor(tx, target, writes(each), owner, ownerValue, heldValues(held, target));
      if (changes.size === 0) counts.unchanged += 1;
      else counts.updates += 1;
    }
    return {
      ...counts,
      total,
      checked: planned.length,
      capped: total > planned.length,
      versionNumber: mapping.versionNumber,
    };
  });
}

/** The Sync old records job's params: the form, the scope, and the moment it started (later submissions are left). */
export const FormsSyncParams = z.strictObject({
  formId: z.uuid(),
  scope: z.enum(['all', 'unfiled']),
  asOf: z.iso.datetime(),
});
/** The Sync old records job's params. */
export type FormsSyncParams = z.infer<typeof FormsSyncParams>;

/**
 * `forms.sync`: the member's, heavy lane, cancellable, 20 submissions a
 * batch. Its snapshot walks the form's submissions in scope received up to
 * its start, by id; each batch files them as `forms.file` does.
 */
export function formsSync(): KindDefinition<FormsSyncParams> {
  return defineKind<FormsSyncParams>({
    kind: FORMS_SYNC,
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: FormsSyncParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 20,
    sample: { formId: '0199f0a0-0000-7000-8000-000000000001', scope: 'all', asOf: '2026-10-20T00:00:00.000Z' },
    async snapshot(context, params, after, limit) {
      const found = await context.tx.execute<{ id: string }>(sql`
        select s.id::text from form_submissions s
        left join records r on r.workspace_id = s.workspace_id and r.id = s.main_record_id and r.deleted_at is null
        where s.form_id = ${params.formId} and s.received_at <= ${params.asOf}::timestamptz
          and ${scopeTest(params.scope, context.scope.access)} ${after === undefined ? sql`` : sql`and s.id > ${after}::uuid`}
        order by s.id
        limit ${limit}
      `);
      return found.rows.map((row) => row.id);
    },
    step: (context, { job, items }) =>
      fileBatch(context, {
        formId: job.params.formId,
        scope: job.params.scope,
        items: items ?? [],
        checkpoint: job.checkpoint,
      }),
  });
}

/**
 * Starts Sync old records: one `forms.sync` job (its id the caller's, so a
 * retry starts one), which snapshots the submissions in scope, then files
 * them. Answers how many are in scope now. Needs `forms.manage` and a
 * published form.
 */
export async function startSync(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly formId: string; readonly scope: SyncScope; readonly jobId?: string },
  hooks: readonly AfterWrite[] = [],
): Promise<SyncStarted> {
  requirePermission(scope, 'forms.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { form } = await managedForm(context.tx, scope, input.formId);
      const total = await countInScope(context.tx, scope.access, form.id, input.scope);
      const asOf = await context.tx.execute<{ now: string }>(
        sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now`,
      );
      const { jobId } = await startJob(context, registry, {
        id: input.jobId ?? randomUUID(),
        kind: FORMS_SYNC,
        params: { formId: form.id, scope: input.scope, asOf: asOf.rows[0]?.now ?? new Date().toISOString() },
        snapshot: true,
      });
      return { jobId, total };
    },
    hooks,
  );
  return result;
}
