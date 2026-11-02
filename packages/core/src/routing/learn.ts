// The nightly learning run (spec 0037, AC-1366, AC-1368, AC-1369, AC-1381):
// `routing.learn`, the system's, on the heavy lane, one team page per batch
// with a checkpoint, so bookings never wait on it.
//
// **No AI vendor is called or imported from anywhere in this folder**
// (decision 27, AC-1379). "Learn" is SQL over this workspace's own tables
// under row level security, and the arithmetic in `learning.ts`. Nothing
// leaves the product, and the only inputs are those AC-1370 allows: the team
// page, the rotation, the segment, the member's id and the outcomes.
//
// Each batch:
//  1. reads one page's ranked decisions in the learning window, through the
//     partial index (`routing_decisions_ranked`), joined to their booking;
//  2. reads the deals linked to those bookings' people and companies, and
//     when each first reached a Won means stage (spec 0004's value history);
//  3. decides each booking's trial and outcome (`learning.ts`), one deal
//     credited once and one person counted once per page per window;
//  4. writes `routing_stats` at `model_version + 1` for the segment cells,
//     for `*` and for `?`.
// The last batch switches `model_version` and `model_trained_at`, then drops
// every model older than the one before it.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { ALL_SEGMENTS, learnWindowDays, objectiveOf, type RoutingObjective } from '@crm/contracts';
import { schema } from '@crm/db';
import { uuidArray } from '../engine/ids.ts';
import type { WriteContext } from '../engine/write.ts';
import { defineKind, MAX_ATTEMPTS, type KindDefinition, type StepOutcome } from '../jobs/registry.ts';
import { countCell, type RankedBooking } from './learning.ts';
import { wonStageOf } from './settings.ts';
import { pruneStats, writeStats } from './stats.ts';

const { routingSettings } = schema;

/** The kind's name, as `JOB_KINDS` lists it. */
export const ROUTING_LEARN = 'routing.learn';

/** The run's params: the day it is for (its once key names the same day), so a second run of a day is the same job. */
export const LearnParams = z.strictObject({ day: z.iso.date() });
/** The run's params. */
export type LearnParams = z.infer<typeof LearnParams>;

/** Where the run is up to: the pages still to do, the model being written, and what it has counted. */
const Checkpoint = z.strictObject({
  /** The team pages left, in id order; absent on the first batch, which lists them. */
  pages: z.array(z.string()).readonly().optional(),
  modelVersion: z.number().int().min(1),
  cells: z.number().int().min(0),
  trials: z.number().int().min(0),
  /** Pages whose ranked bookings in the window went past `LEARN_PAGE_MAX`. */
  capped: z.number().int().min(0).default(0),
});
type Checkpoint = z.infer<typeof Checkpoint>;

/** One ranked seat as the snapshot froze it: all the run needs of it (AC-1373's shape, read defensively). */
const Seat = z.object({
  rotationId: z.string(),
  pickedMemberId: z.string(),
  candidates: z.array(z.unknown()).default([]),
});

/** The seats of one decision's snapshot; anything that doesn't parse is no seat, so it is simply not counted. */
function seatsOf(stored: unknown): readonly z.infer<typeof Seat>[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((each) => {
    const parsed = Seat.safeParse(each);
    return parsed.success ? [parsed.data] : [];
  });
}

/** One ranked decision joined to its booking, as the batch reads it. */
interface DecisionRow extends Record<string, unknown> {
  readonly id: string;
  readonly segment_key: string | null;
  readonly holdout: boolean | null;
  readonly snapshot: unknown;
  readonly status: string;
  readonly cancelled_by: string | null;
  readonly no_show_at: string | null;
  readonly starts_ms: string;
  readonly ends_ms: string;
  readonly host_member_id: string | null;
  readonly person_record_id: string | null;
  readonly company_record_id: string | null;
}

/** One deal linked to a booking's person or company, with when it was made and when it first counted as won. */
interface DealRow extends Record<string, unknown> {
  readonly anchor: string;
  readonly deal_id: string;
  readonly created_ms: string;
  readonly won_ms: string | null;
}

/** Every live round robin page of the workspace, in id order: the batches walk them. */
async function pagesOf(context: WriteContext): Promise<readonly string[]> {
  const found = await context.tx.execute<{ id: string }>(sql`
    select id::text from booking_pages
    where kind = 'round_robin' and deleted_at is null
    order by id
  `);
  return found.rows.map((row) => row.id);
}

/** The most ranked bookings one page's batch counts. Past it the newest are kept, and the run says so. */
export const LEARN_PAGE_MAX = 20_000;

/**
 * One page's ranked decisions in the window, joined to their booking.
 *
 * Driven from `bookings`, not from `routing_decisions`: the page is a column
 * of the booking, so starting there uses the bookings page-and-time index and
 * then finds each decision by `routing_decisions_one_per_booking`. Starting
 * from the decisions instead made every batch scan the whole workspace's
 * ranked window and throw away the other pages' rows, which is O(pages ×
 * decisions) over a run (state-performance review, must-fix).
 *
 * Ordered newest first, so a page past `LEARN_PAGE_MAX` trains on its most
 * recent bookings rather than its oldest — the opposite order would have a
 * busy page learning from a window it has already left behind.
 */
async function decisionsOf(context: WriteContext, pageId: string, since: Date): Promise<readonly DecisionRow[]> {
  const found = await context.tx.execute<DecisionRow>(sql`
    select d.id::text, d.segment_key, d.holdout, d.snapshot,
      b.status, b.cancelled_by, b.no_show_at::text,
      (extract(epoch from b.starts_at) * 1000)::bigint::text as starts_ms,
      (extract(epoch from b.ends_at) * 1000)::bigint::text as ends_ms,
      b.host_member_id::text, b.person_record_id::text, b.company_record_id::text
    from bookings b
    join routing_decisions d on d.workspace_id = b.workspace_id and d.booking_id = b.id and d.snapshot is not null
    where b.page_id = ${pageId}::uuid and b.starts_at >= ${since.toISOString()}::timestamptz
    order by b.starts_at desc, d.id desc
    limit ${LEARN_PAGE_MAX}
  `);
  // Back into the order the deal claim wants: the earliest booking claims a deal (AC-1366, AC-1368).
  return [...found.rows].reverse();
}

/** The Deals object's id, when the workspace has one live. */
async function dealsObject(context: WriteContext): Promise<string | undefined> {
  const found = await context.tx.execute<{ id: string }>(sql`
    select id::text from objects where standard_key = 'deals' and archived_at is null limit 1
  `);
  return found.rows[0]?.id;
}

/**
 * Every live deal linked to any of `anchors` (the bookings' people and
 * companies), when it was made, and when it first reached a Won means stage
 * (spec 0004's `values` with `active_from`). Nothing at all without Won means
 * set: then `won_ms` is simply null everywhere, and only Deals created and
 * Meetings held can be learned toward.
 */
async function dealsFor(
  context: WriteContext,
  anchors: readonly string[],
  dealsId: string,
  wonStage: { readonly attributeId: string; readonly optionIds: readonly string[] } | undefined,
): Promise<readonly DealRow[]> {
  if (anchors.length === 0) return [];
  const ids = uuidArray(anchors);
  const wonAt =
    wonStage === undefined
      ? sql`null::bigint`
      : sql`(
          select (extract(epoch from min(v.active_from)) * 1000)::bigint from "values" v
          where v.record_id = d.id and v.attribute_id = ${wonStage.attributeId}::uuid
            and not v.is_cleared and v.option_id = any(${`{${wonStage.optionIds.join(',')}}`}::uuid[])
        )`;
  const found = await context.tx.execute<DealRow>(sql`
    with links as (
      select l.from_record_id as anchor, l.to_record_id as deal_id from record_links l
      where l.from_record_id = any(${ids}) and l.active_until is null
      union all
      select l.to_record_id as anchor, l.from_record_id as deal_id from record_links l
      where l.to_record_id = any(${ids}) and l.active_until is null
    )
    select distinct on (k.anchor, d.id)
      k.anchor::text, d.id::text as deal_id,
      (extract(epoch from d.created_at) * 1000)::bigint::text as created_ms,
      ${wonAt}::text as won_ms
    from links k
    join records d on d.id = k.deal_id and d.object_id = ${dealsId}::uuid and d.deleted_at is null
    order by k.anchor, d.id
    limit 50000
  `);
  return found.rows;
}

/** A millisecond number from a bigint read as text; an unreadable one is 0, which puts the row outside every window. */
const ms = (value: string | null) => {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** One page's ranked bookings, per rotation and segment, with each booking's outcome facts worked out. */
function bookingsOf(
  rows: readonly DecisionRow[],
  deals: readonly DealRow[],
): ReadonlyMap<string, readonly RankedBooking[]> {
  const byAnchor = new Map<string, DealRow[]>();
  for (const deal of deals) {
    const held = byAnchor.get(deal.anchor) ?? [];
    held.push(deal);
    byAnchor.set(deal.anchor, held);
  }
  // A deal is credited once (AC-1366, AC-1368): the earliest ranked booking whose window holds it takes it, and the
  // rows come back by start, so the first booking to claim a deal keeps it.
  const claimed = new Set<string>();
  const perCell = new Map<string, RankedBooking[]>();
  for (const row of rows) {
    const seats = seatsOf(row.snapshot);
    if (seats.length === 0) continue;
    const endsAt = ms(row.ends_ms);
    const startsAt = ms(row.starts_ms);
    const segmentKey = row.segment_key ?? ALL_SEGMENTS;
    // The deal window: made between the booking and 30 days after the meeting (AC-1366).
    const windowEnd = endsAt + 30 * 86_400_000;
    const anchors = [row.person_record_id, row.company_record_id].filter((id): id is string => id !== null);
    let hasDeal = false;
    let hasWon = false;
    for (const anchor of anchors) {
      if (hasDeal) break;
      for (const deal of byAnchor.get(anchor) ?? []) {
        const made = ms(deal.created_ms);
        if (claimed.has(deal.deal_id) || made < startsAt || made > windowEnd) continue;
        claimed.add(deal.deal_id);
        hasDeal = true;
        const wonAt = deal.won_ms === null ? undefined : ms(deal.won_ms);
        // Won within 90 days after the meeting (AC-1366).
        hasWon = wonAt !== undefined && wonAt <= endsAt + 90 * 86_400_000;
        break;
      }
    }
    for (const seat of seats) {
      const booking: RankedBooking = {
        memberId: seat.pickedMemberId,
        ...(anchors[0] === undefined ? {} : { personKey: anchors[0] }),
        segmentKey,
        rotationId: seat.rotationId,
        holdout: row.holdout === true,
        candidates: Math.max(seat.candidates.length, 2),
        isPreassigned: false,
        status: row.status === 'cancelled' ? 'cancelled' : 'confirmed',
        ...(row.cancelled_by === 'guest' || row.cancelled_by === 'host' || row.cancelled_by === 'calendar'
          ? { cancelledBy: row.cancelled_by }
          : {}),
        // Handed on after the pick (AC-1368): a failure for every objective.
        wasReassigned: row.host_member_id !== null && row.host_member_id !== seat.pickedMemberId,
        isNoShow: row.no_show_at !== null,
        endsAt,
        hasDeal,
        hasWon,
      };
      // Each decision counts in its own segment, in the page's all segments cell, and, when the lead was missing a
      // value, in the `?` cell too, which is never warm by itself (AC-1370).
      const keys = segmentKey === ALL_SEGMENTS ? [ALL_SEGMENTS] : [segmentKey, ALL_SEGMENTS];
      for (const key of keys) {
        const cell = `${seat.rotationId}\u0000${key}`;
        const held = perCell.get(cell) ?? [];
        held.push(booking);
        perCell.set(cell, held);
      }
    }
  }
  return perCell;
}

/** One page's batch: reads, counts and writes its cells at the model being trained. */
async function learnPage(
  context: WriteContext,
  input: {
    readonly pageId: string;
    readonly modelVersion: number;
    readonly learnSince: string | null;
    readonly wonStage?: { readonly attributeId: string; readonly optionIds: readonly string[] };
    readonly now: number;
  },
): Promise<{ readonly cells: number; readonly trials: number; readonly capped: boolean }> {
  const found = await context.tx.execute<{ objective: string | null }>(sql`
    select routing_objective as objective from booking_pages where id = ${input.pageId}::uuid
  `);
  const objective = objectiveOf(found.rows[0]?.objective);
  // The window: 180 days, 270 for Deals won, or since Learn from when that is later (AC-1386).
  const days = learnWindowDays(objective);
  const fromWindow = input.now - days * 86_400_000;
  const fromLearnSince = input.learnSince === null ? 0 : Date.parse(`${input.learnSince}T00:00:00Z`);
  const since = new Date(Math.max(fromWindow, Number.isFinite(fromLearnSince) ? fromLearnSince : 0));
  const rows = await decisionsOf(context, input.pageId, since);
  if (rows.length === 0) return { cells: 0, trials: 0, capped: false };
  const anchors = [
    ...new Set(
      rows.flatMap((row) => [row.person_record_id, row.company_record_id].filter((id): id is string => id !== null)),
    ),
  ];
  // Deals are only read for the objectives that need them: Meetings held reads no record at all.
  const dealsId = objective === 'held' ? undefined : await dealsObject(context);
  const deals =
    dealsId === undefined
      ? []
      : await dealsFor(context, anchors, dealsId, objective === 'won' ? input.wonStage : undefined);
  const perCell = bookingsOf(rows, deals);
  const page: {
    pageId: string;
    rotationId: string;
    segmentKey: string;
    objective: RoutingObjective;
    memberId: string;
    trials: number;
    successes: number;
    waiting: number;
  }[] = [];
  for (const [cell, bookings] of perCell) {
    const [rotationId = '', segmentKey = ALL_SEGMENTS] = cell.split('\u0000');
    for (const counts of countCell(bookings, objective, input.now)) {
      page.push({ pageId: input.pageId, rotationId, segmentKey, objective, ...counts });
    }
  }
  await writeStats(context.tx, context.scope.workspaceId, input.modelVersion, page);
  return {
    cells: page.length,
    trials: page.reduce((total, row) => total + row.trials, 0),
    // A page at the cap trained on its newest `LEARN_PAGE_MAX` only: the run's result says so, so a workspace
    // that outgrows one batch is visible rather than quietly learning from a slice.
    capped: rows.length >= LEARN_PAGE_MAX,
  };
}

/** The settings the run reads: the model to write, Learn from, and Won means. */
async function settingsFor(context: WriteContext): Promise<{
  readonly modelVersion: number;
  readonly learnSince: string | null;
  readonly wonStage?: { readonly attributeId: string; readonly optionIds: readonly string[] };
}> {
  const found = await context.tx.execute<{
    model_version: number;
    learn_since: string | null;
    won_stage: unknown;
  }>(sql`select model_version, learn_since::text, won_stage from routing_settings`);
  const row = found.rows[0];
  const stage = wonStageOf(row?.won_stage);
  return {
    modelVersion: Math.max(0, row?.model_version ?? 0),
    learnSince: row?.learn_since ?? null,
    ...(stage === undefined ? {} : { wonStage: stage }),
  };
}

/**
 * Switches the model in (AC-1381): the run's last batch sets `model_version`
 * and `model_trained_at`, and only then do the ranking's reads see the new
 * cells. Then every model older than the one before it goes, so a rollback to
 * the previous version is always possible.
 */
async function switchModel(context: WriteContext, modelVersion: number): Promise<void> {
  const by = { type: 'system' as const };
  await context.tx
    .insert(routingSettings)
    .values({
      workspaceId: context.scope.workspaceId,
      modelVersion,
      modelTrainedAt: sql`now()`,
      createdByType: by.type,
      updatedByType: by.type,
    })
    .onConflictDoUpdate({
      target: routingSettings.workspaceId,
      // Deliberately not `updated_at`: the run is machine written, and a screen's `updatedAt` check (409 `STALE`)
      // must never fail because the nightly run went past it.
      set: { modelVersion, modelTrainedAt: sql`now()` },
    });
  await pruneStats(context.tx, modelVersion - 1);
}

/**
 * `routing.learn` (AC-1381): the system's, heavy lane, never cancelled, one
 * team page a batch. Safe to run again: every batch counts from the bookings,
 * so a No show marked after a run flips the outcome at the next one, and a
 * batch that runs twice writes the same cells.
 */
export function routingLearn(now: () => number = Date.now): KindDefinition<LearnParams> {
  return defineKind<LearnParams>({
    kind: ROUTING_LEARN,
    lane: 'heavy',
    actor: 'system',
    mode: 'cursor',
    params: LearnParams,
    cancellable: false,
    maxAttempts: MAX_ATTEMPTS.heavy,
    batchSize: 1,
    sample: { day: '2026-11-01' },
    async step(context, input): Promise<StepOutcome> {
      const held = Checkpoint.safeParse(input.job.checkpoint);
      const settings = await settingsFor(context);
      const checkpoint: Checkpoint = held.success
        ? held.data
        : { pages: await pagesOf(context), modelVersion: settings.modelVersion + 1, cells: 0, trials: 0, capped: 0 };
      const pages = checkpoint.pages ?? [];
      const [pageId, ...rest] = pages;
      if (pageId === undefined) {
        await switchModel(context, checkpoint.modelVersion);
        return {
          finished: true,
          counts: { done: checkpoint.cells },
          result: {
            modelVersion: checkpoint.modelVersion,
            cells: checkpoint.cells,
            trials: checkpoint.trials,
            cappedPages: checkpoint.capped,
          },
        };
      }
      const done = await learnPage(context, {
        pageId,
        modelVersion: checkpoint.modelVersion,
        learnSince: settings.learnSince,
        ...(settings.wonStage === undefined ? {} : { wonStage: settings.wonStage }),
        now: now(),
      });
      const next: Checkpoint = {
        pages: rest,
        modelVersion: checkpoint.modelVersion,
        cells: checkpoint.cells + done.cells,
        trials: checkpoint.trials + done.trials,
        capped: checkpoint.capped + (done.capped ? 1 : 0),
      };
      return { checkpoint: next, finished: false, counts: { done: done.cells } };
    },
  });
}
