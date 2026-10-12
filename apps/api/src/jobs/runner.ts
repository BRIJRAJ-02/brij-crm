// The core job runner as the worker wires it (spec 0008): each slice on the
// pooled app login, as the job's member (entered again at every slice through
// `enterAsActor`) or the system (`systemScope`), with the write hooks every
// background write stores its events through. The worker entry and the
// restart tests' worker build it here, so both run the same wiring.
import { createRunner, type JobRegistry, type Runner, type RunnerDeps } from '@crm/core';
import { enterAsActor, systemScope } from '@crm/core/system';
import type { Database } from '@crm/db';
import { backgroundHooks } from '../hooks.ts';
import type { log as appLog } from '../log.ts';

/** What the worker's runner is made from: the pool, the kinds, the log, and who to tell when an event was stored. */
export interface JobRunnerOptions {
  readonly db: Database;
  readonly registry: JobRegistry;
  readonly log: typeof appLog;
  /** A batch stored a change event: the relay publishes it, even if it had gone dormant. */
  readonly onStored?: () => void;
  /** The slice budget and the lease, shortened by the restart tests only. */
  readonly timings?: Pick<RunnerDeps, 'sliceMs' | 'leaseMs'>;
}

/** The core runner with the worker's wiring. */
export function createJobRunner(options: JobRunnerOptions): Runner {
  const { db, log } = options;
  return createRunner({
    db,
    registry: options.registry,
    enterAsActor: (input) => enterAsActor({ db, log }, input),
    systemScope: (workspaceId) => systemScope(db, workspaceId),
    hooks: backgroundHooks,
    log,
    ...(options.onStored === undefined ? {} : { onStored: options.onStored }),
    ...options.timings,
  });
}
