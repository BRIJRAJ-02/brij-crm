// The daily cleanup's fan out (spec 0008, Cron; milestone 3, AC-112,
// AC-121): what the worker's `crm_cron_daily` task does once a day at 03:00
// UTC. First what reaches across every workspace, which only the worker's
// login (crm_worker) may do: it prunes the outbox through spec 0007's
// `crm_outbox_prune` until a batch comes back short, and deletes the queue's
// dead rows. Then it pages the workspaces (`crm_workspace_ids`, ids only) and
// starts one `maintenance.daily` in each, as the system, with the once key
// `maintenance:<day>`, so a workspace never gets two cleanups for one day
// however often this runs. A call keeps within a time budget (each task call
// returns well inside 30 seconds): one that runs out answers where it got to,
// and the worker queues the rest as a continuation.
import { PRUNE_BATCH } from '@crm/db';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { MAINTENANCE_DAILY } from './kinds/maintenance-daily.ts';
import type { JobRegistry } from './registry.ts';
import { startJob } from './service.ts';

/** What only the worker's crm_worker connection may do for the cleanup. */
export interface DailySweep {
  /** One outbox prune batch: how many rows went (at most `PRUNE_BATCH`). */
  pruneOutbox(): Promise<number>;
  /** Deletes the queue's dead rows; how many went. */
  deleteDead(): Promise<number>;
  /** Workspaces not deleted, after `after`, in id order, at most `max` (`crm_workspace_ids`). */
  workspaceIds(after: string | undefined, max: number): Promise<readonly string[]>;
}

/** Where the fan out logs: ids, counts and times only. */
export interface DailyLog {
  info(message: string, fields: Record<string, unknown>): void;
  error(message: string, fields: Record<string, unknown>): void;
}

/** What the fan out needs, all passed in (the worker builds them). */
export interface DailyCleanupDeps {
  readonly registry: JobRegistry;
  /** `systemScope` from `@crm/core/system`: each workspace's start runs as the system. */
  readonly systemScope: (workspaceId: string) => EngineScope;
  /** The write hooks every start stores its `jobs` event through (the api's composer). */
  readonly hooks: () => readonly AfterWrite[];
  readonly sweep: DailySweep;
  readonly log: DailyLog;
  /** Told after a start stored its event (the worker wakes its relay). */
  readonly onStored?: () => void;
  /** The clock, in milliseconds; tests pass one they move. */
  readonly now?: () => number;
}

/** One call's input: the UTC day, where a continuation picks up, and the call's time budget. */
export interface DailyCleanupInput {
  /** `YYYY-MM-DD`, the day the cron fired for (UTC). */
  readonly day: string;
  /** The last workspace a call before this one reached; the outbox and dead rows were done then. */
  readonly after?: string;
  /** How long this call may take before it hands the rest on (15 seconds). */
  readonly budgetMs?: number;
}

/** What one call did, and, when its budget ran out, where the next call picks up. */
export interface DailyCleanupReport {
  readonly pruned: number;
  readonly dead: number;
  readonly workspaces: number;
  readonly failed: number;
  readonly next?: string;
}

/** The id before every workspace id, where a continuation starts when the first call reached none. */
const NIL_ID = '00000000-0000-0000-0000-000000000000';

/** How many workspaces one page names (`crm_workspace_ids` caps it at 500). */
const PAGE = 500;

/** A call's default budget: half of the 30 seconds any task call must return within. */
export const DAILY_BUDGET_MS = 15_000;

/** The once key of a workspace's cleanup for `day`: one a day, however often the fan out runs. */
export function maintenanceKey(day: string): string {
  return `maintenance:${day}`;
}

/**
 * Runs the fan out for `day` (or the rest of it, after `after`). A start
 * that fails in one workspace is logged with its id and counted; the others
 * still get theirs, and tomorrow's run starts a new one.
 */
export async function runDailyCleanup(deps: DailyCleanupDeps, input: DailyCleanupInput): Promise<DailyCleanupReport> {
  const now = deps.now ?? Date.now;
  const started = now();
  const budget = input.budgetMs ?? DAILY_BUDGET_MS;
  const left = () => budget - (now() - started);
  let pruned = 0;
  let dead = 0;
  if (input.after === undefined) {
    // The outbox for every workspace at once (the function works across them), a batch at a time, with half the
    // budget at most: what is left waits for the relay's own rounds while awake, or tomorrow.
    for (;;) {
      const batch = await deps.sweep.pruneOutbox();
      pruned += batch;
      if (batch < PRUNE_BATCH || left() < budget / 2) break;
    }
    dead = await deps.sweep.deleteDead();
  }
  let after = input.after;
  let workspaces = 0;
  let failed = 0;
  for (;;) {
    const page = await deps.sweep.workspaceIds(after, PAGE);
    for (const workspaceId of page) {
      if (left() <= 0) {
        deps.log.info('daily.cleanup.continues', { day: input.day, workspaces, after });
        // Before every id when none was reached yet: the next call skips the outbox and dead rows either way.
        return { pruned, dead, workspaces, failed, next: after ?? NIL_ID };
      }
      try {
        await runWrite(
          deps.systemScope(workspaceId),
          (context) =>
            startJob(context, deps.registry, {
              kind: MAINTENANCE_DAILY,
              params: { day: input.day },
              onceKey: maintenanceKey(input.day),
            }),
          deps.hooks(),
        );
        deps.onStored?.();
      } catch (error) {
        failed += 1;
        // The error's class only: a message may quote a value.
        deps.log.error('daily.cleanup.start.failed', {
          workspaceId,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      workspaces += 1;
      after = workspaceId;
    }
    if (page.length < PAGE) break;
  }
  deps.log.info('daily.cleanup', { day: input.day, pruned, dead, workspaces, failed });
  return { pruned, dead, workspaces, failed };
}
