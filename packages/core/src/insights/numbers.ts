// The numbers every Insights view is made of (spec 0067, AC-6711 to AC-6714, AC-6730), over a fixed list of pages:
// shared by a member's read (the pages the door lets them see) and a share link's (the pages it was made with).
//
// Days come from the rollup, `page_visit_days`, except today and any day a visit changed since it was rolled up
// (`page_visit_stale_days`), which come from the raw rows; so a figure is never older than the visits, and a read
// over a year at a million visits touches the rollup's few rows a day rather than every visit. One statement with
// grouping sets answers the totals, the chart, the sources, the funnel's steps and Other's hosts together.
import {
  FINISH_STEP,
  PAGE_STEPS,
  stepRank,
  type InsightBucket,
  type InsightFunnel,
  type InsightNumbers,
  type InsightOtherHost,
  type InsightPeriod,
  type InsightSource,
  type InsightTotals,
  type PageKind,
} from '@crm/contracts';
import { sql, type SQL } from 'drizzle-orm';
import type { WorkspaceTx } from '@crm/db';

/** A page the numbers cover. */
export interface CoveredPage {
  readonly kind: PageKind;
  readonly id: string;
}

/** A period resolved to UTC days, both ends included. */
export interface ResolvedPeriod {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

/** A UTC day `n` days after `day` (before, for a negative `n`). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** How many days `from` to `to` holds, both included. */
export function daysIn(period: ResolvedPeriod): number {
  return Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** The pages as two parallel arrays, for one `unnest` in SQL. */
function pagesFilter(alias: string, pages: readonly CoveredPage[]): SQL {
  const kinds = `{${pages.map((page) => page.kind).join(',')}}`;
  const ids = `{${pages.map((page) => page.id).join(',')}}`;
  return sql`(${sql.raw(alias)}.page_kind, ${sql.raw(alias)}.page_id) in (
    select p.k, p.i from unnest(${kinds}::text[], ${ids}::uuid[]) as p(k, i))`;
}

/**
 * Every visit in the period as rollup shaped rows: the rolled up days that are settled, and the raw rows of today and
 * of any day still marked stale.
 */
function base(workspaceId: string, pages: readonly CoveredPage[], period: ResolvedPeriod): SQL {
  const today = sql`(now() at time zone 'UTC')::date`;
  return sql`
    select d.page_kind, d.day, d.source, d.medium, d.campaign, d.referrer_host, d.step,
      d.visits, d.finishes, d.duration_sum_ms, d.duration_count
    from page_visit_days d
    where d.workspace_id = ${workspaceId} and d.day between ${period.from}::date and ${period.to}::date
      and d.day < ${today} and ${pagesFilter('d', pages)}
      and not exists (
        select 1 from page_visit_stale_days s where s.workspace_id = d.workspace_id and s.day = d.day
      )
    union all
    select v.page_kind, v.day, v.source, coalesce(v.medium, ''), coalesce(v.campaign, ''),
      case when v.source = 'other' then coalesce(v.referrer_host, '') else '' end,
      case when v.finished_at is not null then ${FINISH_STEP} else v.furthest_step end,
      1, (v.finished_at is not null)::int,
      case when v.finished_at is not null then coalesce(v.duration_ms, 0) else 0 end::bigint,
      (v.finished_at is not null and v.duration_ms is not null)::int
    from page_visits v
    where v.workspace_id = ${workspaceId} and v.day between ${period.from}::date and ${period.to}::date
      and ${pagesFilter('v', pages)}
      -- Only today and the stale days, named up front (an init plan), so the read walks page_visits_day for just
      -- those days; a per row test here would scan every raw visit in the period (3 s a year at a million).
      and v.day = any(array(
        select ${today}
        union
        select s.day from page_visit_stale_days s
        where s.workspace_id = ${workspaceId} and s.day between ${period.from}::date and ${period.to}::date
      ))
  `;
}

/** One grouped row of the numbers statement. */
interface GroupedRow extends Record<string, unknown> {
  readonly set: 'total' | 'day' | 'source' | 'step' | 'host';
  readonly day: string | null;
  readonly source: string | null;
  readonly medium: string | null;
  readonly campaign: string | null;
  readonly page_kind: string | null;
  readonly step: string | null;
  readonly referrer_host: string | null;
  readonly visits: number;
  readonly finishes: number;
  readonly dsum: string | number;
  readonly dcount: number;
}

/** A totals row as the contract says it: the average only when somebody finished with a measured time. */
function totalsOf(row: GroupedRow | undefined): InsightTotals {
  if (row === undefined) return { visits: 0, finishes: 0 };
  const sum = Number(row.dsum);
  return {
    visits: row.visits,
    finishes: row.finishes,
    ...(row.dcount > 0 ? { avgMs: Math.round(sum / row.dcount) } : {}),
  };
}

/** The Monday a UTC day's week starts on. */
function mondayOf(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  const back = (at.getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

/** The chart's buckets (AC-6712): every day under 31 days, else every week from its Monday; empty ones as zeros. */
function bucketsOf(period: ResolvedPeriod, byDay: ReadonlyMap<string, { visits: number; finishes: number }>) {
  const grain: 'day' | 'week' = daysIn(period) < 31 ? 'day' : 'week';
  const buckets = new Map<string, { visits: number; finishes: number }>();
  for (let day = period.from; day <= period.to; day = addDays(day, 1)) {
    const key = grain === 'day' ? day : mondayOf(day);
    const found = byDay.get(day);
    const held = buckets.get(key) ?? { visits: 0, finishes: 0 };
    buckets.set(key, { visits: held.visits + (found?.visits ?? 0), finishes: held.finishes + (found?.finishes ?? 0) });
  }
  return {
    grain,
    buckets: [...buckets].map(([start, counts]): InsightBucket => ({ start, ...counts })),
  };
}

/** The funnel of one kind (AC-6713): each step reached by the visits whose furthest step is it or later. */
function funnelOf(kind: PageKind, rows: readonly GroupedRow[]): InsightFunnel {
  const steps = PAGE_STEPS[kind] as readonly string[];
  const stopped = new Array<number>(steps.length).fill(0);
  let finished = 0;
  for (const row of rows) {
    if (row.page_kind !== kind || row.step === null) continue;
    if (row.step === FINISH_STEP) {
      finished += row.visits;
      continue;
    }
    const at = stepRank(kind, row.step) ?? 0;
    stopped[at] = (stopped[at] ?? 0) + row.visits;
  }
  let running = finished;
  const reached = new Array<number>(steps.length).fill(0);
  for (let at = steps.length - 1; at >= 0; at -= 1) {
    running += stopped[at] ?? 0;
    reached[at] = running;
  }
  return { kind, steps: steps.map((step, at) => ({ step, reached: reached[at] ?? 0 })), finished };
}

/** The numbers for `pages` over `period`, with Other's hosts, and the period before for the change line. */
export async function insightNumbers(
  tx: WorkspaceTx,
  workspaceId: string,
  pages: readonly CoveredPage[],
  period: ResolvedPeriod,
  options: { readonly previous: boolean },
): Promise<InsightNumbers & { readonly others: readonly InsightOtherHost[] }> {
  const empty = bucketsOf(period, new Map());
  if (pages.length === 0) {
    return {
      ...period,
      grain: empty.grain,
      totals: { visits: 0, finishes: 0 },
      ...(options.previous ? { previous: { visits: 0, finishes: 0 } } : {}),
      buckets: empty.buckets,
      sources: [],
      others: [],
    };
  }
  const found = await tx.execute<GroupedRow>(sql`
    with base as (${base(workspaceId, pages, period)})
    select
      case
        when grouping(day, source, medium, campaign, page_kind, step, referrer_host) = 127 then 'total'
        when grouping(day) = 0 then 'day'
        when grouping(source, medium, campaign) = 0 then 'source'
        when grouping(page_kind, step) = 0 then 'step'
        else 'host'
      end as set,
      day::text as day, source, medium, campaign, page_kind, step, referrer_host,
      sum(visits)::int as visits, sum(finishes)::int as finishes,
      sum(duration_sum_ms)::bigint as dsum, sum(duration_count)::int as dcount
    from base
    group by grouping sets ((), (day), (source, medium, campaign), (page_kind, step), (referrer_host))
  `);
  const rows = found.rows;
  const totals = totalsOf(rows.find((row) => row.set === 'total'));
  const byDay = new Map(
    rows.flatMap((row) =>
      row.set === 'day' && row.day !== null ? [[row.day, { visits: row.visits, finishes: row.finishes }] as const] : [],
    ),
  );
  const { grain, buckets } = bucketsOf(period, byDay);
  const sources = rows
    .filter((row) => row.set === 'source' && row.source !== null)
    .map((row): InsightSource => ({
      source: row.source ?? '',
      medium: row.medium ?? '',
      campaign: row.campaign ?? '',
      visits: row.visits,
      finishes: row.finishes,
    }))
    .sort((a, b) => b.visits - a.visits || a.source.localeCompare(b.source))
    .slice(0, 100);
  const others = rows
    .filter((row) => row.set === 'host' && row.referrer_host !== null && row.referrer_host !== '')
    .map((row): InsightOtherHost => ({ host: row.referrer_host ?? '', visits: row.visits }))
    .sort((a, b) => b.visits - a.visits || a.host.localeCompare(b.host))
    .slice(0, 50);
  const kinds = [...new Set(pages.map((page) => page.kind))];
  const [only] = kinds;
  const funnel =
    kinds.length === 1 && only !== undefined
      ? funnelOf(
          only,
          rows.filter((row) => row.set === 'step'),
        )
      : undefined;

  let previous: InsightTotals | undefined;
  if (options.previous) {
    const length = daysIn(period);
    const before = { from: addDays(period.from, -length), to: addDays(period.from, -1) };
    const prior = await tx.execute<GroupedRow>(sql`
      with base as (${base(workspaceId, pages, before)})
      select 'total' as set, coalesce(sum(visits), 0)::int as visits, coalesce(sum(finishes), 0)::int as finishes,
        coalesce(sum(duration_sum_ms), 0)::bigint as dsum, coalesce(sum(duration_count), 0)::int as dcount
      from base
    `);
    const row = prior.rows[0];
    previous = totalsOf(row);
  }
  return {
    ...period,
    grain,
    totals,
    ...(previous === undefined ? {} : { previous }),
    buckets,
    ...(funnel === undefined ? {} : { funnel }),
    sources,
    others,
  };
}

/** The first day any of `pages` was visited, or undefined. */
async function firstDay(
  tx: WorkspaceTx,
  workspaceId: string,
  pages: readonly CoveredPage[],
): Promise<string | undefined> {
  if (pages.length === 0) return undefined;
  // One probe a page, each down its own index from the page's oldest day, never a walk of the workspace's history.
  const kinds = `{${pages.map((page) => page.kind).join(',')}}`;
  const ids = `{${pages.map((page) => page.id).join(',')}}`;
  const found = await tx.execute<{ day: string | null }>(sql`
    select min(least(rolled.day, raw.day))::text as day
    from unnest(${kinds}::text[], ${ids}::uuid[]) as p(k, i)
    cross join lateral (
      select min(d.day) as day from page_visit_days d
      where d.workspace_id = ${workspaceId} and d.page_kind = p.k and d.page_id = p.i
    ) rolled
    cross join lateral (
      select min(v.day) as day from page_visits v
      where v.workspace_id = ${workspaceId} and v.page_kind = p.k and v.page_id = p.i
    ) raw
  `);
  return found.rows[0]?.day ?? undefined;
}

/**
 * A period as UTC days: the last 7, 30, 90 or 365 days to today; all time from the first visit (the last 30 days
 * when there is none); or a custom range as given. Whether the period before it is compared: not for all time.
 */
export async function resolvePeriod(
  tx: WorkspaceTx,
  workspaceId: string,
  pages: readonly CoveredPage[],
  period: InsightPeriod,
  now: Date,
): Promise<ResolvedPeriod & { readonly compare: boolean }> {
  const today = now.toISOString().slice(0, 10);
  if ('from' in period) return { from: period.from, to: period.to, compare: true };
  if (period.range === 'all') {
    const first = await firstDay(tx, workspaceId, pages);
    return { from: first === undefined || first > today ? addDays(today, -29) : first, to: today, compare: false };
  }
  return { from: addDays(today, -(Number(period.range) - 1)), to: today, compare: true };
}
