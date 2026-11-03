// Insights' rollup (spec 0067, AC-6730): the crontab line `crm_cron_page_rollup`, every five minutes with five
// minutes of fill on the light runner, reads the workspaces holding a stale visit day on the worker's login
// (`crm_page_rollup_workspaces`, ids only) and rolls each one up as the system (`rollUpPageVisits`), within a time
// budget; what it doesn't reach waits for the next line, and a read meanwhile takes those days from the raw visits.
import { rollUpPageVisits } from '@crm/core';
import type { systemScope } from '@crm/core/system';
import type { QueueConnection } from '@crm/db';

type EngineScope = ReturnType<typeof systemScope>;

/** The task's name on Graphile's queue. */
export const PAGE_ROLLUP_TASK = 'crm_cron_page_rollup';

/** The crontab line: every five minutes, five minutes of fill (a missed run runs once on waking), 3 tries. */
export const PAGE_ROLLUP_CRONTAB = `*/5 * * * * ${PAGE_ROLLUP_TASK} ?fill=5m&id=page_rollup&max=3`;

/** How many workspaces one run lists, and how long it spends at most. */
const WORKSPACES_A_RUN = 200;
const RUN_BUDGET_MS = 20_000;

/** What a run needs. */
export interface PageRollupDeps {
  readonly sweep: Pick<QueueConnection, 'pageRollupWorkspaces'>;
  readonly systemScope: (workspaceId: string) => EngineScope;
  readonly log: { info(message: string, fields?: Record<string, unknown>): void };
  readonly now?: () => number;
}

/** One run: each listed workspace rolled up until it has no stale day or the budget runs out. */
export async function runPageRollup(
  deps: PageRollupDeps,
): Promise<{ readonly workspaces: number; readonly days: number }> {
  const now = deps.now ?? Date.now;
  const until = now() + RUN_BUDGET_MS;
  const listed = await deps.sweep.pageRollupWorkspaces(WORKSPACES_A_RUN);
  let days = 0;
  let workspaces = 0;
  for (const workspaceId of listed) {
    if (now() >= until) break;
    workspaces += 1;
    for (;;) {
      const done = await rollUpPageVisits(deps.systemScope(workspaceId));
      days += done.days;
      if (done.days === 0 || now() >= until) break;
    }
  }
  if (days > 0) deps.log.info('insights.rollup', { workspaces, days, listed: listed.length });
  return { workspaces, days };
}
