// Routing › Insights (spec 0037, AC-1376, AC-1386, AC-1389): what the nightly
// run learned, per team page and segment, with the holdout comparison and
// each member's numbers. Holders of `routing.manage` only, which is the whole
// access story: Insights is the workspace's own routing, not any one person's
// time, so nothing here reads a booking's guest, its answers or its notes.
//
// Everything on the page comes from `routing_stats` at the live model, except
// the comparison and the marking rates, which are counted from the ranked
// decisions and their bookings in the window: the stats hold per cell counts,
// and the comparison's three arms cut the same bookings a different way.
import { sql } from 'drizzle-orm';
import {
  ALL_SEGMENTS,
  LEARN_WINDOW_DAYS,
  objectiveOf,
  UNKNOWN_SEGMENT,
  WARM_TRIALS,
  type InsightsArm,
  type InsightsCell,
  type RoutingInsights,
  type RoutingObjective,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { cellOf, interval, isCertain, smoothedRate } from './learning.ts';
import { readSegmentNames } from './segment-names.ts';
import { readAllStats } from './stats.ts';

/**
 * The longest any one of Insights' statements may run, as Routing › Decisions
 * bounds its own read: the comparison counts over every ranked decision in the
 * window, so a deal heavy workspace asking for a year must not be able to pin
 * a connection (and through it the pool) for seconds at a time.
 */
const INSIGHTS_STATEMENT_TIMEOUT = '3s';

/** One arm of the comparison from its counts (AC-1389). */
function armOf(successes: number, trials: number): InsightsArm {
  const bounds = interval(successes, trials);
  return { trials, successes, rate: trials === 0 ? 0 : successes / trials, ...bounds };
}

/** One ranked decision as the comparison reads it. */
interface ArmRow extends Record<string, unknown> {
  readonly page_id: string;
  readonly page_name: string;
  readonly objective: string | null;
  readonly holdout: boolean | null;
  /** The snapshot said the pick was the rotation's own (`fair_share`) or the ranking's (`track_record`). */
  readonly moved: boolean;
  readonly met: boolean;
  readonly settled: boolean;
  /** The day this booking's outcome window closes, `YYYY-MM-DD`: what "ready from" reads. */
  readonly settles_on: string;
}

/**
 * The ranked decisions of every team page in the window, cut into the three
 * arms (AC-1389). The outcome read here is the page's objective, decided the
 * same way the run decides it, so Insights and the cells can never disagree:
 * Held is "confirmed and not marked", and the deal objectives read whether a
 * deal the booking claims exists, which the run already stamped as the
 * booking's own success in `routing_stats`. Rather than joining deals again,
 * the arms read Held for Meetings held and, for the deal objectives, whether
 * a live deal is linked to the booking's person or company at all — the same
 * question at a coarser grain, which is all a comparison of three arms needs.
 */
async function armsOf(tx: WorkspaceTx, days: number): Promise<readonly ArmRow[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const found = await tx.execute<ArmRow>(sql`
    with deals as (select id from objects where standard_key = 'deals' and archived_at is null limit 1)
    select p.id::text as page_id, p.title as page_name, p.routing_objective as objective,
      d.holdout,
      coalesce(d.snapshot @> '[{"by":"track_record"}]'::jsonb, false) as moved,
      case
        when coalesce(p.routing_objective, 'deal') = 'held'
          then b.status <> 'cancelled' and b.no_show_at is null
        else exists (
          select 1 from record_links l
          join records r on r.id = case when l.from_record_id in (b.person_record_id, b.company_record_id)
            then l.to_record_id else l.from_record_id end
          where l.active_until is null
            and (l.from_record_id in (b.person_record_id, b.company_record_id)
              or l.to_record_id in (b.person_record_id, b.company_record_id))
            and r.deleted_at is null and r.object_id = (select id from deals)
            and r.created_at >= b.starts_at and r.created_at <= b.ends_at + interval '30 days'
        )
      end as met,
      now() >= b.ends_at + (coalesce(p.routing_objective, 'deal') = 'held')::int * interval '7 days'
        + (coalesce(p.routing_objective, 'deal') = 'deal')::int * interval '30 days'
        + (coalesce(p.routing_objective, 'deal') = 'won')::int * interval '90 days' as settled,
      to_char((b.ends_at + (coalesce(p.routing_objective, 'deal') = 'held')::int * interval '7 days'
        + (coalesce(p.routing_objective, 'deal') = 'deal')::int * interval '30 days'
        + (coalesce(p.routing_objective, 'deal') = 'won')::int * interval '90 days') at time zone 'UTC',
        'YYYY-MM-DD') as settles_on
    from routing_decisions d
    join bookings b on b.workspace_id = d.workspace_id and b.id = d.booking_id
    join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
    where d.snapshot is not null and d.decided_at >= ${since}::timestamptz
    -- Ordered, so a workspace past the cap always reads the same newest slice: an unordered limit would make the
    -- comparison (and "not yet certain") a different random sample on every call.
    order by d.decided_at desc, d.id desc
    limit 50000
  `);
  return found.rows;
}

/** Each host's no show marking rate over the window (AC-1376): marks they made over their finished meetings. */
async function markingRates(
  tx: WorkspaceTx,
  days: number,
): Promise<{ readonly team?: number; readonly perMember: ReadonlyMap<string, number> }> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const found = await tx.execute<{ member_id: string; finished: string; marked: string }>(sql`
    select b.host_member_id::text as member_id,
      count(*)::text as finished,
      count(b.no_show_at)::text as marked
    from bookings b
    join booking_pages p on p.workspace_id = b.workspace_id and p.id = b.page_id
    -- Team pages only: this is read on a routing screen beside a rep's routing numbers, so counting their personal
    -- meetings would mix their own diary into it and mislead.
    where b.host_member_id is not null and b.status <> 'cancelled' and p.kind = 'round_robin'
      and b.ends_at < now() and b.ends_at >= ${since}::timestamptz
    group by b.host_member_id
  `);
  let finished = 0;
  let marked = 0;
  const perMember = new Map<string, number>();
  for (const row of found.rows) {
    const theirs = Number(row.finished);
    const mine = Number(row.marked);
    if (!Number.isFinite(theirs) || theirs <= 0) continue;
    finished += theirs;
    marked += Number.isFinite(mine) ? mine : 0;
    perMember.set(row.member_id, (Number.isFinite(mine) ? mine : 0) / theirs);
  }
  return { ...(finished === 0 ? {} : { team: marked / finished }), perMember };
}

/** Every rotation and member the cells name, by name, for the rows Insights shows. */
async function namesOf(tx: WorkspaceTx): Promise<{
  readonly rotations: ReadonlyMap<string, string>;
  readonly members: ReadonlyMap<string, string>;
  readonly pages: ReadonlyMap<string, string>;
  readonly objectives: ReadonlyMap<string, RoutingObjective>;
}> {
  const rotations = await tx.execute<{ id: string; name: string }>(
    sql`select id::text, name from rotations where deleted_at is null`,
  );
  const members = await tx.execute<{ id: string; name: string }>(sql`select id::text, name from members`);
  const pages = await tx.execute<{ id: string; title: string; objective: string | null }>(
    sql`select id::text, title, routing_objective as objective
        from booking_pages where kind = 'round_robin' and deleted_at is null`,
  );
  return {
    rotations: new Map(rotations.rows.map((row) => [row.id, row.name])),
    members: new Map(members.rows.map((row) => [row.id, row.name])),
    pages: new Map(pages.rows.map((row) => [row.id, row.title])),
    // The page's own objective (AC-1354): read from the page, never from its decisions, so a page that has been
    // trained but has no ranked decision in the window still says what it learns toward.
    objectives: new Map(pages.rows.map((row) => [row.id, objectiveOf(row.objective)])),
  };
}

/** A segment key in words: "All leads", "No value", else "Enterprise · EMEA" from the options' labels. */
function labelOf(segmentKey: string, options: ReadonlyMap<string, string>): string {
  if (segmentKey === ALL_SEGMENTS) return 'All leads';
  if (segmentKey === UNKNOWN_SEGMENT) return 'No value';
  return segmentKey
    .split(';')
    .map((part) => options.get(part.split('=')[1] ?? '') ?? '—')
    .join(' · ');
}

/**
 * Routing › Insights (AC-1376): `routing.manage`. `weeks` cuts the window the
 * comparison and the marking rates count over; the cells themselves are
 * whatever the last run wrote, so a shorter window never rewrites them.
 */
export async function routingInsights(
  scope: EngineScope,
  input: { readonly weeks?: number } = {},
): Promise<RoutingInsights> {
  requirePermission(scope, 'routing.manage');
  const days = input.weeks === undefined ? LEARN_WINDOW_DAYS : Math.min(364, Math.max(7, input.weeks * 7));
  return inWorkspace(scope, async (tx) => {
    // Every statement below is bounded (must-fix, state-performance review): the comparison joins three tables
    // over the whole window, and no screen is worth a pinned connection.
    await tx.execute(sql`select set_config('statement_timeout', ${INSIGHTS_STATEMENT_TIMEOUT}, true)`);
    const found = await tx.execute<{
      model_version: number;
      model_trained_at: string | null;
      learn_since: string | null;
      segment_attribute_ids: string[] | null;
    }>(sql`
      select model_version,
        to_char(model_trained_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as model_trained_at,
        learn_since::text, segment_attribute_ids
      from routing_settings
    `);
    const settings = found.rows[0];
    const modelVersion = Math.max(0, settings?.model_version ?? 0);
    const segmentAttributeIds = settings?.segment_attribute_ids ?? [];
    // Nothing has been learned, so the screen shows its "never ran" state: the comparison and the marking rates
    // would count every ranked decision in the window to fill numbers nobody sees.
    if (modelVersion === 0) {
      const none = await readSegmentNames(tx, segmentAttributeIds);
      return {
        modelVersion: 0,
        ...(settings?.learn_since === null || settings?.learn_since === undefined
          ? {}
          : { learnSince: settings.learn_since }),
        segmentAttributes: none.attributes,
        segmentsRestarted: false,
        pages: [],
      };
    }
    const stats = await readAllStats(tx, modelVersion);
    const names = await namesOf(tx);
    const segments = await readSegmentNames(tx, segmentAttributeIds);
    const marking = await markingRates(tx, days);
    const arms = await armsOf(tx, days);

    // The cells, grouped by page then rotation then segment, in the order the stats came back.
    const perPage = new Map<string, Map<string, typeof stats>>();
    for (const row of stats) {
      const cells = perPage.get(row.pageId) ?? new Map<string, typeof stats>();
      const key = `${row.rotationId}\u0000${row.segmentKey}`;
      cells.set(key, [...(cells.get(key) ?? []), row]);
      perPage.set(row.pageId, cells);
    }
    // Every page with cells, and every page the window's ranked decisions name, so a page trained but quiet still shows.
    const pageIds = [...new Set([...perPage.keys(), ...arms.map((row) => row.page_id)])].sort();
    const pages = pageIds.map((pageId) => {
      const mine = arms.filter((row) => row.page_id === pageId);
      const objective: RoutingObjective = names.objectives.get(pageId) ?? objectiveOf(mine[0]?.objective);
      const arm = (kept: readonly ArmRow[]): InsightsArm => {
        const settled = kept.filter((row) => row.settled);
        return armOf(settled.filter((row) => row.met).length, settled.length);
      };
      const changed = arm(mine.filter((row) => row.holdout !== true && row.moved));
      const leftAlone = arm(mine.filter((row) => row.holdout !== true && !row.moved));
      const holdout = arm(mine.filter((row) => row.holdout === true));
      // When this page's learning could be ready (AC-1376): the day the last booking still inside its outcome
      // window settles. Noted for /architect: AC-1376 reads the date per cell, and the bookings a page's cells
      // share make it one date a page, so every cold cell of a page shows the same day.
      const readyFrom = mine
        .filter((row) => !row.settled)
        .map((row) => row.settles_on)
        .sort()
        .at(-1);
      const cells: InsightsCell[] = [...(perPage.get(pageId) ?? new Map<string, typeof stats>())]
        .map(([key, rows]) => {
          const [rotationId = '', segmentKey = ALL_SEGMENTS] = key.split('\u0000');
          const cell = cellOf(rows.map((row) => ({ ...row })));
          const equal = cell.rows.length === 0 ? 0 : 1 / cell.rows.length;
          return {
            rotationId,
            rotationName: names.rotations.get(rotationId) ?? '',
            segmentKey,
            label: labelOf(segmentKey, segments.options),
            trials: cell.trials,
            successes: cell.successes,
            waiting: cell.waiting,
            teamRate: cell.teamRate,
            // The `?` cell is never warm, however many trials it holds (AC-1370).
            isWarm: segmentKey !== UNKNOWN_SEGMENT && cell.isWarm,
            ...(readyFrom === undefined || (segmentKey !== UNKNOWN_SEGMENT && cell.isWarm) ? {} : { readyFrom }),
            members: cell.rows.map((row) => {
              const rate = smoothedRate(row, cell.teamRate);
              return {
                memberId: row.memberId,
                name: names.members.get(row.memberId) ?? '',
                trials: row.trials,
                successes: row.successes,
                rate,
                // The gap to the team's rate, in rate units; absent while the cell isn't warm, so the screen can
                // say "—" rather than print a 0 that reads as "this rep adds nothing".
                ...(segmentKey === UNKNOWN_SEGMENT || !cell.isWarm ? {} : { lift: rate - cell.teamRate }),
                share: cell.trials === 0 ? 0 : row.trials / cell.trials,
                fairShare: equal,
                ...(marking.perMember.has(row.memberId)
                  ? { markingRate: marking.perMember.get(row.memberId) ?? 0 }
                  : {}),
              };
            }),
          };
        })
        // The all segments cell first, then the named ones by the words a reader sees, then "No value": a sort by
        // the key would order the named cells by option id, which is arbitrary to a reader.
        .sort((a, b) => rank(a.segmentKey) - rank(b.segmentKey) || a.label.localeCompare(b.label));
      return {
        pageId,
        name: names.pages.get(pageId) ?? mine[0]?.page_name ?? '',
        objective,
        ranked: mine.length,
        cells,
        changed,
        leftAlone,
        holdout,
        isCertain: isCertain(changed, holdout),
      };
    });
    return {
      modelVersion,
      ...(settings?.model_trained_at === null || settings?.model_trained_at === undefined
        ? {}
        : { modelTrainedAt: settings.model_trained_at }),
      ...(settings?.learn_since === null || settings?.learn_since === undefined
        ? {}
        : { learnSince: settings.learn_since }),
      segmentAttributes: segments.attributes,
      // The run wrote its cells under whatever the attributes then were; a change restarts segment learning (AC-1370).
      segmentsRestarted: segments.restarted(stats.map((row) => row.segmentKey)),
      ...(marking.team === undefined ? {} : { teamMarkingRate: marking.team }),
      pages,
    };
  });
}

/** Where a segment key sits in the cells' order: all segments first, named ones next, "No value" last. */
function rank(segmentKey: string): number {
  return segmentKey === ALL_SEGMENTS ? 0 : segmentKey === UNKNOWN_SEGMENT ? 2 : 1;
}

/** How many trials a cell needs before its lift is read, for the screen's sentence. */
export const INSIGHTS_WARM_TRIALS = WARM_TRIALS;
