// What the nightly run left for the booking path (spec 0037, AC-1369): the
// cells of `routing_stats` at the model the ranking reads, for one team page
// and one segment. Two cells come back per rotation, the segment's and the
// page's all segments cell, so a cold segment can fall back without a second
// round trip (`liftsOf`).
//
// One indexed read for the whole booking: the primary key's prefix is
// (workspace, model, page), so every rotation and both segments come back in
// one scan. A workspace whose model is 0 (nothing trained yet) is never read
// at all.
import { ALL_SEGMENTS, UNKNOWN_SEGMENT, type RoutingObjective } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { cellOf, liftsOf, type Cell } from './learning.ts';

const { routingStats } = schema;

/** A seat's learned lift, and whether it came from a warm cell at all. */
export interface SeatLift {
  readonly lift: ReadonlyMap<string, number>;
  readonly cell?: Cell;
  readonly allSegments?: Cell;
}

/** The lift of every rotation of one page, by rotation id: what `assign.ts` hands each seat. */
export type PageLift = ReadonlyMap<string, SeatLift>;

/** Nothing learned: every seat ranks on fit alone. */
export const NO_LIFT: PageLift = new Map<string, SeatLift>();

/**
 * The lift for each of a page's rotations at `modelVersion` (AC-1369), for
 * `segmentKey` and for the page's all segments cell, read before the booking's
 * locks. Model 0, no rotations, or a page with no stats answers `NO_LIFT`.
 */
export async function readPageLift(
  tx: WorkspaceTx,
  input: {
    readonly pageId: string;
    readonly rotationIds: readonly string[];
    readonly segmentKey: string;
    readonly objective: RoutingObjective;
    readonly modelVersion: number;
  },
): Promise<PageLift> {
  if (input.modelVersion <= 0 || input.rotationIds.length === 0) return NO_LIFT;
  // The `?` segment is never warm (AC-1370): its cell is written, so Insights can show it, but the ranking only
  // ever reads the page's all segments cell for a lead whose segment value was missing.
  const keys =
    input.segmentKey === ALL_SEGMENTS || input.segmentKey === UNKNOWN_SEGMENT
      ? [ALL_SEGMENTS]
      : [input.segmentKey, ALL_SEGMENTS];
  const rows = await tx
    .select({
      rotationId: routingStats.rotationId,
      segmentKey: routingStats.segmentKey,
      memberId: routingStats.memberId,
      trials: routingStats.trials,
      successes: routingStats.successes,
      waiting: routingStats.waiting,
    })
    .from(routingStats)
    .where(
      and(
        eq(routingStats.modelVersion, input.modelVersion),
        eq(routingStats.pageId, input.pageId),
        eq(routingStats.objective, input.objective),
        inArray(routingStats.rotationId, [...new Set(input.rotationIds)]),
        inArray(routingStats.segmentKey, keys),
      ),
    );
  if (rows.length === 0) return NO_LIFT;
  const grouped = new Map<string, { segment: typeof rows; all: typeof rows }>();
  for (const row of rows) {
    const held = grouped.get(row.rotationId) ?? { segment: [], all: [] };
    if (row.segmentKey === ALL_SEGMENTS) held.all.push(row);
    if (row.segmentKey === input.segmentKey) held.segment.push(row);
    grouped.set(row.rotationId, held);
  }
  const lifts = new Map<string, SeatLift>();
  for (const [rotationId, held] of grouped) {
    const cell = held.segment.length === 0 ? undefined : cellOf(held.segment);
    const allSegments = held.all.length === 0 ? undefined : cellOf(held.all);
    lifts.set(rotationId, {
      lift: liftsOf(cell, allSegments),
      ...(cell === undefined ? {} : { cell }),
      ...(allSegments === undefined ? {} : { allSegments }),
    });
  }
  return lifts;
}

/** Every cell of a model, for Insights: one read per workspace, in cell order. */
export async function readAllStats(
  tx: WorkspaceTx,
  modelVersion: number,
): Promise<
  readonly {
    readonly pageId: string;
    readonly rotationId: string;
    readonly segmentKey: string;
    readonly objective: string;
    readonly memberId: string;
    readonly trials: number;
    readonly successes: number;
    readonly waiting: number;
  }[]
> {
  if (modelVersion <= 0) return [];
  return tx
    .select({
      pageId: routingStats.pageId,
      rotationId: routingStats.rotationId,
      segmentKey: routingStats.segmentKey,
      objective: routingStats.objective,
      memberId: routingStats.memberId,
      trials: routingStats.trials,
      successes: routingStats.successes,
      waiting: routingStats.waiting,
    })
    .from(routingStats)
    .where(eq(routingStats.modelVersion, modelVersion))
    .orderBy(routingStats.pageId, routingStats.rotationId, routingStats.segmentKey, routingStats.memberId);
}

/** Writes one cell's rows for the model being trained (AC-1381): written beside the live one, never over it. */
export async function writeStats(
  tx: WorkspaceTx,
  workspaceId: string,
  modelVersion: number,
  rows: readonly {
    readonly pageId: string;
    readonly rotationId: string;
    readonly segmentKey: string;
    readonly objective: RoutingObjective;
    readonly memberId: string;
    readonly trials: number;
    readonly successes: number;
    readonly waiting: number;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx
    .insert(routingStats)
    .values(rows.map((row) => ({ workspaceId, modelVersion, ...row })))
    .onConflictDoUpdate({
      target: [
        routingStats.workspaceId,
        routingStats.modelVersion,
        routingStats.pageId,
        routingStats.rotationId,
        routingStats.segmentKey,
        routingStats.objective,
        routingStats.memberId,
      ],
      set: {
        trials: sql`excluded.trials`,
        successes: sql`excluded.successes`,
        waiting: sql`excluded.waiting`,
        trainedAt: sql`now()`,
      },
    });
}

/** Drops every model older than `keep` (AC-1381): the run's last batch keeps the new one and the one before it. */
export async function pruneStats(tx: WorkspaceTx, keep: number): Promise<void> {
  await tx.delete(routingStats).where(sql`${routingStats.modelVersion} < ${keep}`);
}

/** A page's lift as `assign.ts` takes it (AC-1369): rotation id to member id to lift. */
export function liftsFrom(page: PageLift): ReadonlyMap<string, ReadonlyMap<string, number>> {
  return new Map([...page].map(([rotationId, seat]) => [rotationId, seat.lift]));
}

/**
 * A page's cell counts as `assign.ts` takes them (AC-1376): rotation id to
 * member id to their trials and successes, from the cell the lift came from,
 * so the snapshot freezes the numbers that decided the pick and not another
 * cell's. A rotation whose cells are all cold has no row, and the snapshot
 * reads 0.
 */
export function countsFrom(
  page: PageLift,
): ReadonlyMap<string, ReadonlyMap<string, { readonly trials: number; readonly successes: number }>> {
  const all = new Map<string, ReadonlyMap<string, { trials: number; successes: number }>>();
  for (const [rotationId, seat] of page) {
    const read =
      seat.cell?.isWarm === true ? seat.cell : seat.allSegments?.isWarm === true ? seat.allSegments : seat.cell;
    if (read === undefined) continue;
    all.set(
      rotationId,
      new Map(read.rows.map((row) => [row.memberId, { trials: row.trials, successes: row.successes }])),
    );
  }
  return all;
}
