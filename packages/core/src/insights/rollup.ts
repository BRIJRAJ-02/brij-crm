// The daily rollup (spec 0067, AC-6730): the days a visit changed since they were last rolled up, recomputed from
// the raw visits into `page_visit_days`, one workspace at a time as the system, under row level security. The
// worker's `crm_cron_page_rollup` runs it every five minutes for each workspace `crm_page_rollup_workspaces` names.
//
// A day is taken by deleting its stale mark (`for update skip locked`, so two runs never take the same day) and
// recomputed whole in the same transaction. Today is never taken, nor yesterday in its first ten minutes: a visit
// only writes today's row, so no visit to a day taken can still be uncommitted. A read takes any day still marked,
// and today, from the raw rows, so nothing is ever shown stale.
import { sql } from 'drizzle-orm';
import { FINISH_STEP } from '@crm/contracts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';

/** How many days one call recomputes at most: a backfill of thirteen months takes a few calls. */
export const ROLLUP_DAYS_A_CALL = 60;

/** Recomputes up to `ROLLUP_DAYS_A_CALL` stale days of one workspace; answers how many it took. */
export async function rollUpPageVisits(scope: EngineScope): Promise<{ readonly days: number }> {
  if (scope.actor.type !== 'system') throw new Error('Only the system rolls up page visits.');
  return inWorkspace(scope, async (tx) => {
    const taken = await tx.execute<{ day: string }>(sql`
      delete from page_visit_stale_days
      where workspace_id = ${scope.workspaceId} and day in (
        select day from page_visit_stale_days
        where workspace_id = ${scope.workspaceId}
          -- Never today, nor yesterday in its first ten minutes: a visit only writes today's row, so once a day has
          -- been over ten minutes no visit to it can still be uncommitted, and taking it can't miss one.
          and day < ((now() at time zone 'UTC') - interval '10 minutes')::date
        order by marked_at, day
        limit ${ROLLUP_DAYS_A_CALL}
        for update skip locked
      )
      returning day::text as day
    `);
    const days = taken.rows.map((row) => row.day);
    if (days.length === 0) return { days: 0 };
    const list = `{${days.join(',')}}`;
    await tx.execute(sql`
      delete from page_visit_days where workspace_id = ${scope.workspaceId} and day = any(${list}::date[])
    `);
    await tx.execute(sql`
      insert into page_visit_days (
        workspace_id, page_kind, page_id, day, source, medium, campaign, referrer_host, step,
        visits, finishes, duration_sum_ms, duration_count
      )
      select v.workspace_id, v.page_kind, v.page_id, v.day, v.source, coalesce(v.medium, ''), coalesce(v.campaign, ''),
        case when v.source = 'other' then coalesce(v.referrer_host, '') else '' end,
        case when v.finished_at is not null then ${FINISH_STEP} else v.furthest_step end,
        count(*)::int,
        count(*) filter (where v.finished_at is not null)::int,
        coalesce(sum(v.duration_ms) filter (where v.finished_at is not null), 0)::bigint,
        count(v.duration_ms) filter (where v.finished_at is not null)::int
      from page_visits v
      where v.workspace_id = ${scope.workspaceId} and v.day = any(${list}::date[])
      group by 1, 2, 3, 4, 5, 6, 7, 8, 9
    `);
    return { days: days.length };
  });
}
