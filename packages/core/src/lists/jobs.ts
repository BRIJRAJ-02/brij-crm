// A list's bulk changes as background jobs (spec 0048, AC-4817, AC-4818,
// AC-4825), on spec 0022's job path: adding more than 500 records (or every
// record an object view matches) to a list, taking more than 500 entries (or
// every entry a list view matches) out of it, and the undo of each. Each is a
// member's job: its snapshot counts exactly what it will touch through the
// starter's door, it waits for the confirm (an undo runs without one), and
// each batch of 500 runs the same engine write as the inline call, entered
// again as the starter at every slice. Logs never carry params or values.
import { sql, type SQL } from 'drizzle-orm';
import { BulkTarget, EntryTarget, type JobView } from '@crm/contracts';
import * as z from 'zod';
import { checkScope } from '../access/mint.ts';
import { checkMatching, matchingIdsIn } from '../engine/query/page.ts';
import { checkId, uuidArray } from '../engine/ids.ts';
import { addEntriesIn, changeEntriesIn, checkWritableList, visibleEntries } from '../engine/lists.ts';
import { isOpen } from '../access/policy.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { UNKNOWN_LIST } from '../access/visibility.ts';
import { snapshotIds } from '../bulk/kinds.ts';
import { defineKind, MAX_ATTEMPTS, type ItemOutcome, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import { getJob, startJob } from '../jobs/service.ts';
import type { JobRegistry } from '../jobs/registry.ts';

/** The list job kinds (spec 0048). */
export const ENTRY_JOB_KINDS = {
  add: 'entries.bulk_add',
  remove: 'entries.bulk_remove',
  restore: 'entries.bulk_restore',
} as const;

/** What a bulk add works on: records of the list's object, by id or every one a view matches. */
const AddParams = z.strictObject({
  listId: z.uuid(),
  objectId: z.uuid(),
  target: BulkTarget,
  timeZone: z.string().min(1).max(64).optional(),
});
type AddParams = z.infer<typeof AddParams>;

/**
 * What a bulk removal or restore works on: entries by id, every entry a list
 * view matches, the entries a bulk add of the starter's made (its undo), or
 * those a bulk removal of theirs took out (its undo).
 */
const EntryJobTarget = z.union([
  EntryTarget,
  z.strictObject({ kind: z.literal('added'), jobId: z.uuid() }),
  z.strictObject({ kind: z.literal('removed'), jobId: z.uuid() }),
]);
type EntryJobTarget = z.infer<typeof EntryJobTarget>;

const EntryParams = z.strictObject({ listId: z.uuid(), target: EntryJobTarget });
type EntryParams = z.infer<typeof EntryParams>;

/** A refusal of the whole batch (the starter lost write, the list was archived) ends the job with its words. */
async function orFailed(work: () => Promise<StepOutcome>): Promise<StepOutcome> {
  try {
    return await work();
  } catch (error) {
    if (!isRefusal(error)) throw error;
    if (error.refusal.code === 'QUERY_CANCELLED') throw error;
    return { finished: false, failed: { code: error.refusal.code, message: error.refusal.message } };
  }
}

/** The item states of a batch from each id's refusal (undefined when it went through), by id. */
function statesOf(
  items: readonly { readonly position: number; readonly itemId: string }[],
  refusalOf: (id: string) => { readonly code: string; readonly message: string } | 'done' | undefined,
  skipped: ReadonlySet<string>,
): readonly ItemOutcome[] {
  return items.map((item): ItemOutcome => {
    const outcome = refusalOf(item.itemId);
    if (outcome === 'done') return { position: item.position, state: 'done' };
    if (outcome === undefined) {
      return { position: item.position, state: 'skipped', code: 'NOT_FOUND', message: 'That record does not exist.' };
    }
    return {
      position: item.position,
      state: skipped.has(outcome.code) ? 'skipped' : 'refused',
      code: outcome.code,
      message: outcome.message,
    };
  });
}

/** An entry row a snapshot reads, with what the door judges it by. */
interface EntryRow {
  readonly id: string;
  readonly listId: string;
  readonly recordId: string;
}

/**
 * Reads entry rows page by page (after a keyset, in id order) and keeps those
 * the starter may see (AC-4836), until `limit` are kept or the rows run out,
 * so a page that drops hidden entries still comes back full while more exist
 * (the runner takes a short page as the end).
 */
async function filledEntries(
  context: WriteContext,
  read: (keyset: SQL, limit: number) => SQL,
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const { tx, scope } = context;
  const kept: string[] = [];
  let from = after;
  for (;;) {
    const keyset = from === undefined ? sql`true` : sql`e.id > ${from}::uuid`;
    const rows = (await tx.execute<{ id: string; list_id: string; record_id: string }>(read(keyset, limit))).rows.map(
      (row): EntryRow => ({ id: row.id, listId: row.list_id, recordId: row.record_id }),
    );
    const shown = isOpen(scope.access) ? rows : await visibleEntries(tx, scope.access, rows);
    for (const row of shown) if (kept.length < limit) kept.push(row.id);
    if (rows.length < limit || kept.length >= limit) return kept;
    from = rows.at(-1)?.id;
  }
}

/** The entries a job of the starter's finished on, as a keyset page: what its undo works through. */
async function entriesOfJob(
  context: WriteContext,
  params: EntryParams,
  target: { readonly kind: 'added' | 'removed'; readonly jobId: string },
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  if (target.kind === 'removed') {
    // A removal's items are its entries: those it took out, still out.
    return filledEntries(
      context,
      (keyset, size) => sql`
        select e.id::text as id, e.list_id::text as list_id, e.record_id::text as record_id from job_items i
        join list_entries e on e.workspace_id = i.workspace_id and e.id = i.item_id
        where i.job_id = ${target.jobId}::uuid and i.state = 'done' and e.list_id = ${params.listId}::uuid
          and e.deleted_at is not null and ${keyset}
        order by e.id limit ${size}
      `,
      after,
      limit,
    );
  }
  // An add's items are records: the live entries the starter made for them in this list once it started.
  return filledEntries(
    context,
    (keyset, size) => sql`
      select e.id::text as id, e.list_id::text as list_id, e.record_id::text as record_id from list_entries e
      join jobs j on j.workspace_id = e.workspace_id and j.id = ${target.jobId}::uuid
      join job_items i on i.workspace_id = e.workspace_id and i.job_id = j.id and i.item_id = e.record_id
        and i.state = 'done'
      where e.list_id = ${params.listId}::uuid and e.deleted_at is null and e.created_at >= j.created_at
        and e.created_by_member_id is not distinct from j.created_by_member_id and ${keyset}
      order by e.id limit ${size}
    `,
    after,
    limit,
  );
}

/** A sample for the shared kind contract test. */
const LIST_SAMPLE = '00000000-0000-7000-8000-000000000001';

/** `entries.bulk_add`: `addEntriesIn` over each batch of records; one already in is skipped. */
export function entriesAddKind(): KindDefinition<AddParams> {
  return defineKind<AddParams>({
    kind: ENTRY_JOB_KINDS.add,
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: AddParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 500,
    sample: {
      listId: LIST_SAMPLE,
      objectId: LIST_SAMPLE,
      target: { kind: 'ids', recordIds: ['00000000-0000-7000-8000-000000000002'] },
    },
    emptySnapshotSucceeds: true,
    snapshot: (context, params, after, limit) =>
      snapshotIds(context, 'edit', { objectId: params.objectId, target: params.target }, after, limit),
    step: (context, { job, items = [] }) =>
      orFailed(async () => {
        const outcomes = await addEntriesIn(context, {
          listId: job.params.listId,
          recordIds: items.map((item) => item.itemId),
          timeZone: job.params.timeZone,
        });
        return {
          finished: false,
          items: statesOf(
            items,
            (id) => {
              const outcome = outcomes.get(id);
              if (outcome === undefined) return undefined;
              return outcome.entryId !== undefined ? 'done' : outcome.refusal;
            },
            new Set(['ENTRY_EXISTS', 'RECORD_DELETED', 'NOT_FOUND']),
          ),
        };
      }),
  });
}

/** The snapshot of a removal or restore: entries by id, matching a list view, or another job's. */
async function entrySnapshot(
  context: WriteContext,
  params: EntryParams,
  action: 'remove' | 'restore',
  after: string | undefined,
  limit: number,
): Promise<readonly string[]> {
  const { tx, scope } = context;
  const { target, listId } = params;
  switch (target.kind) {
    case 'added':
    case 'removed':
      return entriesOfJob(context, params, target, after, limit);
    case 'matching':
      return matchingIdsIn(
        tx,
        scope,
        {
          listId,
          ...(target.filter === undefined ? {} : { filter: target.filter }),
          ...(target.now === undefined ? {} : { now: target.now }),
          ...(target.timeZone === undefined ? {} : { timeZone: target.timeZone }),
        },
        { after, limit, asOf: target.asOf, except: target.except },
      );
    case 'ids': {
      const state = action === 'remove' ? sql`e.deleted_at is null` : sql`e.deleted_at is not null`;
      return filledEntries(
        context,
        (keyset, size) => sql`
          select e.id::text as id, e.list_id::text as list_id, e.record_id::text as record_id from list_entries e
          where e.list_id = ${listId}::uuid and e.id = any(${uuidArray(target.entryIds)}) and ${state} and ${keyset}
          order by e.id limit ${size}
        `,
        after,
        limit,
      );
    }
  }
}

/** `entries.bulk_remove` and `entries.bulk_restore`: `changeEntriesIn` over each batch of entries. */
function entryChangeKind(action: 'remove' | 'restore'): KindDefinition<EntryParams> {
  return defineKind<EntryParams>({
    kind: ENTRY_JOB_KINDS[action],
    lane: 'heavy',
    actor: 'member',
    mode: 'items',
    params: EntryParams,
    cancellable: true,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 500,
    sample: { listId: LIST_SAMPLE, target: { kind: 'ids', entryIds: ['00000000-0000-7000-8000-000000000002'] } },
    emptySnapshotSucceeds: true,
    snapshot: (context, params, after, limit) => entrySnapshot(context, params, action, after, limit),
    step: (context, { job, items = [] }) =>
      orFailed(async () => {
        const outcomes = await changeEntriesIn(context, {
          entryIds: items.map((item) => item.itemId),
          action,
          listId: job.params.listId,
        });
        const byId = new Map(outcomes.map((outcome) => [outcome.entryId, outcome]));
        return {
          finished: false,
          items: statesOf(
            items,
            (id) => {
              const outcome = byId.get(id);
              if (outcome === undefined) return undefined;
              return outcome.refusal ?? 'done';
            },
            new Set(['NOT_FOUND', 'RECORD_DELETED']),
          ),
        };
      }),
  });
}

/** `entries.bulk_remove`. */
export function entriesRemoveKind(): KindDefinition<EntryParams> {
  return entryChangeKind('remove');
}

/** `entries.bulk_restore`. */
export function entriesRestoreKind(): KindDefinition<EntryParams> {
  return entryChangeKind('restore');
}

/** Every list job kind a process runs. */
export function entryJobKinds(): readonly (KindDefinition<AddParams> | KindDefinition<EntryParams>)[] {
  return [entriesAddKind(), entriesRemoveKind(), entriesRestoreKind()];
}

/** The words of a refused start. */
export const ENTRY_JOB_WORDS = {
  otherObject: "Those records can't go in this list; it holds another object's records.",
  notUndoable: 'Nothing from that change can be undone.',
} as const;

/**
 * Adds many records to a list as a counted job (AC-4825): the list checked
 * as an add checks it (hidden is unknown, read only 403, archived
 * `NOT_FOUND`), the target an object's (the list's own object), an "all
 * matching" filter compiled as the starter reads it; then the job counts and
 * waits for `jobs.confirm`. The same id again answers the same job.
 */
export async function startAddMatching(
  scope: EngineScope,
  registry: JobRegistry,
  input: {
    readonly id: string;
    readonly listId: string;
    readonly target: BulkTarget;
    readonly timeZone?: string | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  const listId = checkId(input.listId, UNKNOWN_LIST);
  const { target } = input;
  if (target.kind !== 'ids' && target.kind !== 'matching') throw refuse('CONFIG_INVALID', ENTRY_JOB_WORDS.otherObject);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { objectId } = await checkWritableList(context, listId);
      if (target.objectId !== undefined && target.objectId.toLowerCase() !== objectId) {
        throw refuse('CONFIG_INVALID', ENTRY_JOB_WORDS.otherObject);
      }
      if (target.kind === 'matching') {
        await checkMatching(context.tx, scope, {
          objectId,
          ...(target.filter === undefined ? {} : { filter: target.filter }),
          ...(target.now === undefined ? {} : { now: target.now }),
          ...(target.timeZone === undefined ? {} : { timeZone: target.timeZone }),
        });
      }
      const stored = target.kind === 'matching' ? { ...target, objectId, asOf: notLater(target.asOf) } : target;
      const { jobId } = await startJob(context, registry, {
        id: input.id,
        kind: ENTRY_JOB_KINDS.add,
        params: {
          listId,
          objectId,
          target: stored,
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
        },
        snapshot: true,
        confirm: true,
        subject: { type: 'object', id: objectId },
      });
      return jobId;
    },
    hooks,
  );
  return getJob(scope, registry, result);
}

/** `asOf` no later than now, so an entry or record made after the start is never caught (spec 0022, AC-528). */
function notLater(asOf: string): string {
  const at = Date.parse(asOf);
  return Number.isNaN(at) || at <= Date.now() ? asOf : new Date().toISOString();
}

/**
 * Takes many entries out of a list as a counted job (AC-4817): the list
 * checked as a removal checks it, an "all matching" filter compiled as the
 * starter reads the list; then the job counts and waits for `jobs.confirm`.
 */
export async function startRemoveMatching(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly id: string; readonly listId: string; readonly target: EntryTarget },
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  const listId = checkId(input.listId, UNKNOWN_LIST);
  const { target } = input;
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { objectId } = await checkWritableList(context, listId);
      if (target.kind === 'matching') {
        await checkMatching(context.tx, scope, {
          listId,
          ...(target.filter === undefined ? {} : { filter: target.filter }),
          ...(target.now === undefined ? {} : { now: target.now }),
          ...(target.timeZone === undefined ? {} : { timeZone: target.timeZone }),
        });
      }
      const stored = target.kind === 'matching' ? { ...target, asOf: notLater(target.asOf) } : target;
      const { jobId } = await startJob(context, registry, {
        id: input.id,
        kind: ENTRY_JOB_KINDS.remove,
        params: { listId, target: stored },
        snapshot: true,
        confirm: true,
        subject: { type: 'object', id: objectId },
      });
      return jobId;
    },
    hooks,
  );
  return getJob(scope, registry, result);
}

/**
 * Undoes a finished bulk add or removal of the caller's (AC-4818, AC-4825):
 * an add's undo removes exactly the entries it made, a removal's brings back
 * exactly the ones it took out, as a job of its own run with no confirm
 * (undoing your own change asks nothing twice). A job that isn't the caller's
 * add or removal of a list is `NOT_FOUND`.
 */
export async function undoEntriesJob(
  scope: EngineScope,
  registry: JobRegistry,
  input: { readonly id: string; readonly jobId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<JobView> {
  checkScope(scope);
  const jobId = checkId(input.jobId, ENTRY_JOB_WORDS.notUndoable);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const memberId = scope.actor.type === 'member' ? scope.actor.id : undefined;
      const rows = await context.tx.execute<{ kind: string; params: unknown; member: string | null }>(sql`
        select kind, params, created_by_member_id::text as member from jobs where id = ${jobId}::uuid
      `);
      const [row] = rows.rows;
      const isOwn = row !== undefined && memberId !== undefined && row.member === memberId;
      const reverse =
        row?.kind === ENTRY_JOB_KINDS.add ? 'remove' : row?.kind === ENTRY_JOB_KINDS.remove ? 'restore' : undefined;
      const listId = z.object({ listId: z.uuid() }).safeParse(row?.params);
      if (!isOwn || reverse === undefined || !listId.success) throw refuse('NOT_FOUND', ENTRY_JOB_WORDS.notUndoable);
      const { objectId } = await checkWritableList(context, listId.data.listId);
      const { jobId: made } = await startJob(context, registry, {
        id: input.id,
        kind: ENTRY_JOB_KINDS[reverse],
        params: {
          listId: listId.data.listId,
          target: { kind: reverse === 'remove' ? 'added' : 'removed', jobId },
        } satisfies EntryParams,
        snapshot: true,
        confirm: false,
        subject: { type: 'object', id: objectId },
      });
      return made;
    },
    hooks,
  );
  return getJob(scope, registry, result);
}

/** The job kinds' targets, for the API's own checks. */
export type { EntryJobTarget };
