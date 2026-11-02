// The learning run's hourly fan out (spec 0037, AC-1381): every hour, the
// workspaces whose own local time has reached 03:00 get one `routing.learn`
// job for their local day, spread over 30 minutes by a hash of the workspace,
// and keyed by workspace and date so however many times the hour's sweep runs
// a workspace gets exactly one run a day.
//
// Why local time: a sales team's "last night" is their night, and a run that
// counted a day boundary in UTC would move the window under a team in UTC+10.
// `workspaces.time_zone` (spec 0031 slice 7) is the zone.
//
// Two reads, deliberately: the **sweep** names the workspaces that have a
// ranked decision the last run didn't count, on the worker's own login, which
// is the only connection that may look across workspaces; then each
// candidate's **own local hour** is read inside its own transaction under row
// level security. The zone is not read in the sweep because migration 0034's
// closing check holds `crm_sweep` to `workspaces.id` and
// `workspaces.deleted_at`, and widening the one role that reaches every
// workspace for one feature is the wrong trade. The extra read is one small
// query per candidate, and only candidates have anything new to count.
import { sql } from 'drizzle-orm';
import { inWorkspace } from '../access/run.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { startJob } from '../jobs/service.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { ROUTING_LEARN } from './learn.ts';

/** How long the hour's starts are spread over (AC-1381), in minutes. */
export const LEARN_SPREAD_MINUTES = 30;

/** The local hour a workspace's run is for (AC-1381). */
export const LEARN_HOUR = 3;

/** One run's once key: one job per workspace per local day, however often the sweep runs. */
export function learnKey(day: string): string {
  return `routing-learn:${day}`;
}

/**
 * The minute within the hour a workspace's run starts (AC-1381), 0 to 29,
 * from a stable hash of its id: the same workspace always lands in the same
 * slot, so the spread is even and a replay agrees.
 */
export function learnMinute(workspaceId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < workspaceId.length; index += 1) {
    hash ^= workspaceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % LEARN_SPREAD_MINUTES;
}

/** One workspace's own clock: the local day the run would be for, and the hour and minute it is there now. */
export interface LocalNow {
  /** The workspace's own day, `YYYY-MM-DD`. */
  readonly day: string;
  /** The hour of its own day, 0 to 23. */
  readonly hour: number;
  /** The minute within that hour, 0 to 59. */
  readonly minute: number;
}

/** What only the worker's crm_worker connection may do for the fan out. */
export interface LearnSweep {
  /**
   * The ids of live workspaces that have a ranked decision the last run
   * didn't count, at most `max`, in id order. Whether each has reached its own
   * 03:00 hour is decided afterwards, per workspace.
   */
  due(max: number): Promise<readonly string[]>;
}

/** Where the fan out logs: ids and counts only. */
export interface LearnLog {
  info(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

/** What the fan out needs, all passed in (the worker builds them). */
export interface LearnFanoutDeps {
  readonly registry: JobRegistry;
  readonly systemScope: (workspaceId: string) => EngineScope;
  readonly hooks: () => readonly AfterWrite[];
  readonly sweep: LearnSweep;
  /**
   * One workspace's own clock, read in its own transaction under row level
   * security (`readLocalNow`). A workspace whose stored zone is damaged
   * answers undefined and is simply never due, rather than raising in the
   * sweep and holding up every other workspace.
   */
  readonly localNow: (workspaceId: string) => Promise<LocalNow | undefined>;
  readonly log: LearnLog;
  readonly onStored?: () => void;
}

/** How many workspaces one sweep looks at. */
export const LEARN_PAGE = 500;

/** What one sweep did. */
export interface LearnFanoutReport {
  /** Workspaces whose slot had come and got a job (or already had one). */
  readonly started: number;
  /** Workspaces due this hour whose slot minute hasn't come yet: a later turn in the same hour starts them. */
  readonly waiting: number;
  /** Candidates whose own clock isn't in the 03:00 hour yet (most of them, every hour). */
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Starts the hour's runs (AC-1381). A workspace whose slot minute hasn't
 * arrived is left for a later turn in the same hour; one that already has
 * today's job is a no op, since the once key is the same.
 */
export async function queueRoutingLearn(deps: LearnFanoutDeps): Promise<LearnFanoutReport> {
  const due = await deps.sweep.due(LEARN_PAGE);
  let started = 0;
  let waiting = 0;
  let skipped = 0;
  let failed = 0;
  for (const workspaceId of due) {
    try {
      const now = await deps.localNow(workspaceId);
      if (now === undefined || now.hour !== LEARN_HOUR) {
        skipped += 1;
        continue;
      }
      // Its slot inside the hour hasn't come: a later turn in the same hour starts it, under the same once key.
      if (now.minute < learnMinute(workspaceId)) {
        waiting += 1;
        continue;
      }
      await runWrite(
        deps.systemScope(workspaceId),
        (context) =>
          startJob(context, deps.registry, {
            kind: ROUTING_LEARN,
            params: { day: now.day },
            onceKey: learnKey(now.day),
          }),
        deps.hooks(),
      );
      deps.onStored?.();
      started += 1;
    } catch (error) {
      failed += 1;
      // The error's class only: a message may quote a value.
      deps.log.error('routing.learn.start.failed', {
        workspaceId,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  deps.log.info('routing.learn.fanout', { due: due.length, started, waiting, skipped, failed });
  return { started, waiting, skipped, failed };
}

/**
 * One workspace's own clock (AC-1381), read in its own transaction under row
 * level security: its stored zone, or nothing when that zone is damaged, so
 * such a workspace is never due rather than raising.
 */
export async function readLocalNow(scope: EngineScope): Promise<LocalNow | undefined> {
  const rows = await inWorkspace(scope, (tx) =>
    tx.execute<{ day: string; hour: number; minute: number }>(sql`
      select to_char(timezone(w.time_zone, now()), 'YYYY-MM-DD') as day,
        date_part('hour', timezone(w.time_zone, now()))::int as hour,
        date_part('minute', timezone(w.time_zone, now()))::int as minute
      from workspaces w
    `),
  ).catch(() => undefined);
  const row = rows?.rows[0];
  return row === undefined ? undefined : { day: row.day, hour: row.hour, minute: row.minute };
}
