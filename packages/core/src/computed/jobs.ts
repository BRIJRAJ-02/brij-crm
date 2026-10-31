// The computed jobs (spec 0015, spec 0008 kinds): both the system's, never
// cancellable, 500 records a batch, started in the write that caused them and
// coalesced for a second, so a burst of edits is one job.
//
// - `computed.recompute` (light, items): the records one change touched, for one attribute.
// - `computed.fill` (heavy, cursor): every live record of the object, by id, after a definition change or a
//   change too wide to name records (more than 1,000, or coarse). Its job row holds its progress; the last batch
//   marks the attribute up to date and tells every member's definitions store.
//
// A failed fill marks the attribute "Not updating" (its `onFailed`, AC-334); a failed recompute hands its records
// to a whole fill, so none is forgotten.
import { and, eq, sql } from 'drizzle-orm';
import * as z from 'zod';
import { schema } from '@crm/db';
import { uuidArray } from '../engine/ids.ts';
import { loadAttribute } from '../engine/values.ts';
import type { WriteContext } from '../engine/write.ts';
import { recordDefinition } from '../engine/definitions.ts';
import { createRegistry, defineKind, type AnyKind, type JobRegistry, type KindDefinition } from '../jobs/registry.ts';
import { startJob } from '../jobs/service.ts';
import { recomputeRecords } from './recompute.ts';

const { attributes, jobs } = schema;

/** The two computed kinds' names. */
export const COMPUTED_JOBS = { recompute: 'computed.recompute', fill: 'computed.fill' } as const;

/** The coalescing window: a start waits a second, so a burst of changes lands in one job (AC-319). */
const START_DELAY_MS = 1_000;

/** What failing to work out values says (AC-334). */
export const FILL_FAILED = 'Working out values failed.';

const RecomputeParams = z.strictObject({ attributeId: z.uuid() });
type RecomputeParams = z.infer<typeof RecomputeParams>;

const FillParams = z.strictObject({ attributeId: z.uuid(), version: z.number().int().min(0) });
type FillParams = z.infer<typeof FillParams>;

/** A fill's checkpoint: the last record id done, and when its progress was last told. */
const FillCheckpoint = z.object({ after: z.uuid().optional() }).catch({});

const SAMPLE_ID = '01920000-0000-7000-8000-000000000000';

/** The attribute a job works on, while it is computed, live and not stopped. */
async function liveComputed(context: WriteContext, attributeId: string) {
  const attribute = await loadAttribute(context.tx, attributeId).catch(() => undefined);
  if (attribute === undefined || attribute.objectId === null || attribute.archivedAt !== null) return undefined;
  if (attribute.computed === null || attribute.computedState === 'broken') return undefined;
  return attribute;
}

/** The computed version an attribute's row holds now. */
async function versionOf(context: WriteContext, attributeId: string): Promise<number | undefined> {
  const [row] = await context.tx
    .select({ version: attributes.computedVersion })
    .from(attributes)
    .where(eq(attributes.id, attributeId));
  return row?.version;
}

/** `computed.recompute`: the records one change touched. */
function recomputeKind(): KindDefinition<RecomputeParams> {
  return defineKind<RecomputeParams>({
    kind: COMPUTED_JOBS.recompute,
    lane: 'light',
    actor: 'system',
    mode: 'items',
    params: RecomputeParams,
    cancellable: false,
    maxAttempts: 5,
    batchSize: 500,
    startDelayMs: START_DELAY_MS,
    countsTowardLimit: false,
    sample: { attributeId: SAMPLE_ID },
    async step(context, input) {
      const items = input.items ?? [];
      const attribute = await liveComputed(context, input.job.params.attributeId);
      if (attribute !== undefined) {
        await recomputeRecords(
          context,
          attribute.id,
          items.map((item) => item.itemId),
        );
      }
      return { finished: false, items: items.map((item) => ({ position: item.position, state: 'done' })) };
    },
    async onFailed(context, job) {
      if (job.params === undefined) return;
      const attribute = await liveComputed(context, job.params.attributeId);
      if (attribute === undefined) return;
      await startFill(context, attribute.id);
    },
  });
}

/** `computed.fill`: every live record of the object, by id. */
function fillKind(): KindDefinition<FillParams> {
  return defineKind<FillParams>({
    kind: COMPUTED_JOBS.fill,
    lane: 'heavy',
    actor: 'system',
    mode: 'cursor',
    params: FillParams,
    cancellable: false,
    maxAttempts: 8,
    batchSize: 500,
    startDelayMs: START_DELAY_MS,
    countsTowardLimit: false,
    sample: { attributeId: SAMPLE_ID, version: 1 },
    async step(context, input) {
      const { tx } = context;
      const { attributeId, version } = input.job.params;
      const attribute = await liveComputed(context, attributeId);
      // Stopped, archived, or a newer definition's fill took over: nothing to do.
      if (attribute?.objectId === null || attribute === undefined) return { finished: true };
      if ((await versionOf(context, attributeId)) !== version) return { finished: true };
      const checkpoint = FillCheckpoint.parse(input.job.checkpoint ?? {});
      if (checkpoint.after === undefined) {
        // The first batch counts the records, so the header can say how far along it is.
        await tx.execute(sql`
          update jobs set total = (
            select count(*)::int from records where object_id = ${attribute.objectId} and deleted_at is null
          ) where id = ${input.job.id}
        `);
      }
      const page = await tx.execute<{ id: string }>(sql`
        select id::text as id from records
        where object_id = ${attribute.objectId} and deleted_at is null
          ${checkpoint.after === undefined ? sql`` : sql`and id > ${checkpoint.after}::uuid`}
        order by id limit ${input.limit}
      `);
      const ids = page.rows.map((row) => row.id);
      if (ids.length > 0) await recomputeRecords(context, attributeId, ids);
      const finished = ids.length < input.limit;
      if (finished) {
        await tx
          .update(attributes)
          .set({ computedState: 'ok' })
          .where(
            and(
              eq(attributes.id, attributeId),
              eq(attributes.computedVersion, version),
              eq(attributes.computedState, 'filling'),
            ),
          );
      }
      // Only the end tells every definitions store (it was told at the start): a definitions event a second would
      // make every open tab read its pages again for the whole fill (state review, 31 October 2026). Progress is on
      // the fill's job row, read with the definition (`computed.done`, `total`).
      if (finished) recordDefinition(context, attribute);
      return {
        finished,
        checkpoint: { after: ids.at(-1) ?? checkpoint.after },
        counts: { done: ids.length },
      };
    },
    async onFailed(context, job) {
      if (job.params === undefined) return;
      const attribute = await loadAttribute(context.tx, job.params.attributeId).catch(() => undefined);
      if (attribute === undefined || attribute.computed === null) return;
      await context.tx
        .update(attributes)
        .set({ computedState: 'broken', computedError: FILL_FAILED })
        .where(and(eq(attributes.id, attribute.id), eq(attributes.computedVersion, job.params.version)));
      recordDefinition(context, attribute);
    },
  });
}

/** Both computed kinds, for the registry every process runs. */
export function computedKinds(): readonly AnyKind[] {
  return [recomputeKind(), fillKind()];
}

/**
 * The registry the planner and the definition writes start computed jobs
 * through: only these two kinds, so a member's write needs no registry of its
 * own. Both are system kinds, which any write may start (spec 0008, AC-125).
 */
export function computedRegistry(): JobRegistry {
  return createRegistry(computedKinds());
}

/** Starts (or joins) the whole fill of an attribute's current definition, in the caller's write. */
export async function startFill(context: WriteContext, attributeId: string): Promise<string | undefined> {
  const version = await versionOf(context, attributeId);
  if (version === undefined) return undefined;
  const { jobId } = await startJob(context, computedRegistry(), {
    kind: COMPUTED_JOBS.fill,
    params: { attributeId, version },
    subject: { type: 'attribute', id: attributeId },
    dedupeKey: `${attributeId}:${String(version)}`,
  });
  return jobId;
}

/** Starts (or joins) the recompute of some records for an attribute, in the caller's write. */
export async function startRecompute(context: WriteContext, attributeId: string, recordIds: readonly string[]) {
  if (recordIds.length === 0) return;
  await startJob(context, computedRegistry(), {
    kind: COMPUTED_JOBS.recompute,
    params: { attributeId },
    items: recordIds,
    subject: { type: 'attribute', id: attributeId },
    dedupeKey: attributeId,
  });
}

/** The running fill of an attribute, for its definition's progress. */
export async function runningFill(
  context: Pick<WriteContext, 'tx'>,
  attributeIds: readonly string[],
): Promise<ReadonlyMap<string, { readonly jobId: string; readonly done: number; readonly total?: number }>> {
  if (attributeIds.length === 0) return new Map();
  const rows = await context.tx
    .select({ id: jobs.id, subjectId: jobs.subjectId, done: jobs.done, total: jobs.total })
    .from(jobs)
    .where(
      and(
        eq(jobs.kind, COMPUTED_JOBS.fill),
        eq(jobs.subjectType, 'attribute'),
        sql`${jobs.subjectId} = any(${uuidArray(attributeIds)})`,
        sql`${jobs.finishedAt} is null`,
      ),
    );
  return new Map(
    rows.flatMap((row) =>
      row.subjectId === null
        ? []
        : [[row.subjectId, { jobId: row.id, done: row.done, ...(row.total === null ? {} : { total: row.total }) }]],
    ),
  );
}
