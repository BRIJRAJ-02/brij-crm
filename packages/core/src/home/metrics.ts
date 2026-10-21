// Home's metrics row (spec 0041): this week so far against all of last week,
// for meetings booked, new people, new deals, the value of deals won and form
// submissions. Each count is one indexed range read over two weeks, never a
// scan of the workspace: records by `records_created`, won deals among the
// deals touched since last week began (`records_updated`, since moving a
// deal's stage moves its `updated_at`) by their current Stage (`values_current`),
// submissions by `form_submissions_by_form`, and bookings by `bookings_by_host`.
// The workspace's figures are kept for a minute per workspace and week
// (`createHomeMetricsCache`, one per process), then each reader is shown only
// the tiles they may see: an object they can't read, or read through a record
// rule, is absent rather than counted, and so is a hidden Stage or Value.
import { sql } from 'drizzle-orm';
import type { HomeMetricsView, WeekCount } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { can, fieldLevel, objectLevel, recordRule } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { inputInvalid } from '../engine/refusals.ts';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** An object the row counts, and for Deals the attributes the won value reads. */
interface Counted {
  readonly objectId: string;
  readonly thisWeek: number;
  readonly lastWeek: number;
}

/** The workspace's figures, before any reader's access is applied. */
export interface WorkspaceFigures {
  readonly people?: Counted;
  readonly deals?: Counted & {
    readonly won?: {
      readonly stageId: string;
      readonly valueId: string;
      readonly currency: string;
      readonly thisWeek: string;
      readonly lastWeek: string;
      readonly others: boolean;
    };
  };
  readonly submissions: WeekCount;
  /** Everyone's bookings, for a reader with `booking.admin`. */
  readonly meetings: WeekCount;
}

/** Keeps each workspace's figures for a while: `get` answers the kept ones or works them out once. */
export interface HomeMetricsCache {
  readonly get: (key: string, work: () => Promise<WorkspaceFigures>) => Promise<WorkspaceFigures>;
}

/**
 * A cache of each workspace's figures for `ttlMs` (a minute), at most `max`
 * workspaces and weeks, the oldest dropped first. Two readers asking at once
 * share one read; a failed read is never kept.
 */
export function createHomeMetricsCache(
  options: { readonly ttlMs?: number; readonly max?: number; readonly now?: () => number } = {},
): HomeMetricsCache {
  const ttlMs = options.ttlMs ?? 60_000;
  const max = options.max ?? 1_000;
  const now = options.now ?? Date.now;
  const kept = new Map<string, { readonly at: number; readonly figures: Promise<WorkspaceFigures> }>();
  return {
    get(key, work) {
      const hit = kept.get(key);
      if (hit !== undefined && now() - hit.at < ttlMs) return hit.figures;
      const figures = work();
      kept.delete(key);
      kept.set(key, { at: now(), figures });
      figures.catch(() => {
        if (kept.get(key)?.figures === figures) kept.delete(key);
      });
      while (kept.size > max) {
        const oldest = kept.keys().next();
        if (oldest.done === true) break;
        kept.delete(oldest.value);
      }
      return figures;
    },
  };
}

/** No cache: every read works the figures out (tests, and a caller without one). */
const NO_CACHE: HomeMetricsCache = { get: (_key, work) => work() };

/** The week's bounds: the reader's Monday, the Monday before, and the Monday after. */
interface Weeks {
  readonly last: Date;
  readonly start: Date;
  readonly end: Date;
  readonly now: Date;
}

/** Home's metrics as the reader may see them. `weekStart` must be within the last 8 days. */
export async function readHomeMetrics(
  scope: EngineScope,
  input: { readonly weekStart: string },
  deps: { readonly now?: Date; readonly cache?: HomeMetricsCache } = {},
): Promise<HomeMetricsView> {
  const now = deps.now ?? new Date();
  const start = new Date(input.weekStart);
  const age = now.getTime() - start.getTime();
  if (Number.isNaN(age) || age < 0 || age > WEEK_MS + DAY_MS) {
    throw inputInvalid('weekStart', 'Ask for a week that started in the last 8 days.');
  }
  const weeks: Weeks = {
    last: new Date(start.getTime() - WEEK_MS),
    start,
    end: new Date(start.getTime() + WEEK_MS),
    now,
  };
  const { access } = scope;
  const member = access.principal.kind === 'member' ? access.principal.memberId : undefined;
  const everyone = can(access, 'booking.admin');
  const cache = deps.cache ?? NO_CACHE;
  const figures = await cache.get(`${scope.workspaceId}:${start.toISOString()}`, () =>
    inWorkspace(scope, (tx) => workspaceFigures(tx, weeks)),
  );
  const ownMeetings =
    !everyone && member !== undefined && can(access, 'booking.manage')
      ? await inWorkspace(scope, (tx) => meetingsHosted(tx, weeks, sql`array[${member}]::uuid[]`))
      : undefined;
  const sees = (counted: Counted | undefined): counted is Counted =>
    counted !== undefined &&
    objectLevel(access, counted.objectId) !== 'none' &&
    recordRule(access, counted.objectId) === undefined;
  const { people, deals } = figures;
  const won = sees(deals) ? deals.won : undefined;
  const seesWon =
    won !== undefined &&
    deals !== undefined &&
    fieldLevel(access, { id: won.stageId, objectId: deals.objectId }) !== 'hidden' &&
    fieldLevel(access, { id: won.valueId, objectId: deals.objectId }) !== 'hidden';
  const meetings = everyone ? figures.meetings : ownMeetings;
  return {
    ...(meetings === undefined ? {} : { meetings }),
    ...(sees(people) ? { people: { thisWeek: people.thisWeek, lastWeek: people.lastWeek } } : {}),
    ...(sees(deals) ? { deals: { thisWeek: deals.thisWeek, lastWeek: deals.lastWeek } } : {}),
    ...(seesWon
      ? { won: { currency: won.currency, thisWeek: won.thisWeek, lastWeek: won.lastWeek, others: won.others } }
      : {}),
    ...(can(access, 'forms.manage') ? { submissions: figures.submissions } : {}),
  };
}

/** Counts of rows by whether they fall in this week or last. */
interface CountRow extends Record<string, unknown> {
  readonly this_week: number | string;
  readonly last_week: number | string;
}

const weekCount = (row: CountRow | undefined): WeekCount => ({
  thisWeek: Number(row?.this_week ?? 0),
  lastWeek: Number(row?.last_week ?? 0),
});

/** Confirmed bookings of `hosts` starting this week (all of it) and last. */
async function meetingsHosted(tx: WorkspaceTx, weeks: Weeks, hosts: ReturnType<typeof sql>): Promise<WeekCount> {
  const found = await tx.execute<CountRow>(sql`
    select count(*) filter (where starts_at >= ${weeks.start.toISOString()}::timestamptz) as this_week,
      count(*) filter (where starts_at < ${weeks.start.toISOString()}::timestamptz) as last_week
    from bookings
    where status = 'confirmed' and host_member_id = any(${hosts})
      and starts_at >= ${weeks.last.toISOString()}::timestamptz and starts_at < ${weeks.end.toISOString()}::timestamptz
  `);
  return weekCount(found.rows[0]);
}

/** The workspace's figures, read through the caller's transaction: five indexed range reads. */
async function workspaceFigures(tx: WorkspaceTx, weeks: Weeks): Promise<WorkspaceFigures> {
  const last = weeks.last.toISOString();
  const start = weeks.start.toISOString();
  const now = weeks.now.toISOString();
  const standard = (
    await tx.execute<{ id: string; key: string }>(sql`
      select id::text as id, standard_key as key from objects
      where standard_key in ('people', 'deals') and archived_at is null
    `)
  ).rows;
  const objectOf = (key: string) => standard.find((row) => row.key === key)?.id;
  const peopleId = objectOf('people');
  const dealsId = objectOf('deals');
  const counted =
    standard.length === 0
      ? []
      : (
          await tx.execute<CountRow & { object_id: string }>(sql`
      select object_id::text as object_id,
        count(*) filter (where created_at >= ${start}::timestamptz) as this_week,
        count(*) filter (where created_at < ${start}::timestamptz) as last_week
      from records
      where object_id = any(${sql`array[${sql.join(
        standard.map((row) => sql`${row.id}`),
        sql`, `,
      )}]::uuid[]`})
        and deleted_at is null and created_at >= ${last}::timestamptz and created_at < ${now}::timestamptz
      group by object_id
    `)
        ).rows;
  const countOf = (objectId: string | undefined): Counted | undefined =>
    objectId === undefined ? undefined : { objectId, ...weekCount(counted.find((row) => row.object_id === objectId)) };
  const submissions = weekCount(
    (
      await tx.execute<CountRow>(sql`
        select count(*) filter (where received_at >= ${start}::timestamptz) as this_week,
          count(*) filter (where received_at < ${start}::timestamptz) as last_week
        from form_submissions
        where form_id in (select id from forms)
          and received_at >= ${last}::timestamptz and received_at < ${now}::timestamptz
      `)
    ).rows[0],
  );
  const meetings = await meetingsHosted(tx, weeks, sql`array(select id from members)`);
  const people = countOf(peopleId);
  const deals = countOf(dealsId);
  const won = dealsId === undefined ? undefined : await wonValue(tx, dealsId, weeks);
  return {
    ...(people === undefined ? {} : { people }),
    ...(deals === undefined ? {} : { deals: { ...deals, ...(won === undefined ? {} : { won }) } }),
    submissions,
    meetings,
  };
}

/**
 * The value of deals that moved to a won stage this week and last and are
 * still won, in the Value attribute's currency. Read among the deals touched
 * since last week began, never every won deal.
 */
async function wonValue(tx: WorkspaceTx, dealsId: string, weeks: Weeks) {
  const attributes = (
    await tx.execute<{ id: string; slug: string; currency: string | null }>(sql`
      select id::text as id, api_slug as slug, config->>'defaultCurrency' as currency from attributes
      where object_id = ${dealsId}::uuid and api_slug in ('stage', 'value') and archived_at is null
    `)
  ).rows;
  const stage = attributes.find((row) => row.slug === 'stage');
  const value = attributes.find((row) => row.slug === 'value');
  if (stage === undefined || value === undefined) return undefined;
  const rows = (
    await tx.execute<{ this_week: boolean; currency: string | null; amount: string | null }>(sql`
      select s.active_from >= ${weeks.start.toISOString()}::timestamptz as this_week, v.text_value as currency,
        sum(v.number_value)::text as amount
      from records r
      join values s on s.workspace_id = r.workspace_id and s.owner_id = r.id and s.attribute_id = ${stage.id}::uuid
        and s.position = 0 and s.active_until is null
      join attribute_options o on o.workspace_id = s.workspace_id and o.attribute_id = s.attribute_id
        and o.id = s.option_id and o.outcome = 'won'
      left join values v on v.workspace_id = r.workspace_id and v.owner_id = r.id and v.attribute_id = ${value.id}::uuid
        and v.position = 0 and v.active_until is null and not v.is_cleared
      where r.object_id = ${dealsId}::uuid and r.deleted_at is null
        and r.updated_at >= ${weeks.last.toISOString()}::timestamptz
        and s.active_from >= ${weeks.last.toISOString()}::timestamptz
        and s.active_from < ${weeks.now.toISOString()}::timestamptz
      group by 1, 2
    `)
  ).rows;
  const priced = rows.filter((row) => row.currency !== null && row.amount !== null);
  const currency = value.currency ?? priced[0]?.currency ?? 'USD';
  const total = (thisWeek: boolean) =>
    priced.find((row) => row.this_week === thisWeek && row.currency === currency)?.amount ?? '0';
  return {
    stageId: stage.id,
    valueId: value.id,
    currency,
    thisWeek: total(true),
    lastWeek: total(false),
    others: priced.some((row) => row.currency !== currency),
  };
}
