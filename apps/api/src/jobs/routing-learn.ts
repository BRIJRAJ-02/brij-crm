// The nightly learning run's hourly fan out (spec 0037, AC-1381):
// `crm_cron_routing_learn`, a crontab line on the light runner every hour
// with an hour of fill.
//
// Where a worker runs, it fires on the hour; on Vercel there is no worker, so
// it fires in the first job drain turn after each hour (Timefix's Vercel Cron,
// brij-crm's hourly scheduled turn plus the turn every request starts), and
// Graphile's known crontab row keeps one run per slot however many turns
// start. The spread inside the hour is the fan out's own
// (`learnMinute`), so a workspace lands in the same slot whichever host runs
// it; a workspace whose slot minute hasn't come yet is started by a later turn
// in the same hour, and the once key makes a second start a no op.
//
// The sweep reads, on the worker's own login, the workspaces whose local time
// is inside the 03:00 hour and where something the run reads changed
// (`crm_routing_learn_workspaces`: ids, the local day and the local minute
// only), and `queueRoutingLearn` starts one `routing.learn` in each as the
// system.
import { queueRoutingLearn, type LearnFanoutDeps, type LearnFanoutReport } from '@crm/core/system';

/** The fan out's task on Graphile's queue: the crontab line's. */
export const ROUTING_LEARN_TASK = 'crm_cron_routing_learn';

/**
 * The crontab line: every hour on the hour, with an hour of fill (a missed hour runs once in the next turn), its
 * own identifier, and 3 tries. A run that fails is simply tried next hour: the once key is the local day's.
 */
export const ROUTING_LEARN_CRONTAB = `0 * * * * ${ROUTING_LEARN_TASK} ?fill=1h&id=routing_learn&max=3`;

/** One hour's fan out; a failure throws for Graphile's retry. */
export async function runRoutingLearnTask(deps: LearnFanoutDeps): Promise<LearnFanoutReport> {
  return queueRoutingLearn(deps);
}
