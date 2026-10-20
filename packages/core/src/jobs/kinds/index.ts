// The kinds a process runs (spec 0008): one file per kind beside this one.
import type { AppEnvironment } from '@crm/contracts';
import { createRegistry, type AnyKind, type JobRegistry } from '../registry.ts';
import { devSimulate, type Sleep } from './dev-simulate.ts';
import { maintenanceDaily, type QueueRows } from './maintenance-daily.ts';
import { formsExport } from '../../forms/export.ts';
import { formsFile, formsSync } from '../../forms/filing.ts';
import { formsProcess } from '../../forms/process.ts';
import { bulkKinds } from '../../bulk/kinds.ts';

/** What the kinds a process runs depend on: where it runs, and (for the test kind) how it waits. */
export interface JobKindsOptions {
  readonly environment: AppEnvironment;
  /** How `dev.simulate` waits out `batchMillis`; tests pass one that doesn't sleep. */
  readonly sleep?: Sleep;
  /**
   * Which jobs still have a queue row, read on the worker's queue connection:
   * the daily cleanup's requeue phase needs it, so the worker passes it; the
   * api, which never runs a step, doesn't.
   */
  readonly queue?: QueueRows;
  /** Extra kinds: a test setup registers its own. */
  readonly extra?: readonly AnyKind[];
}

/**
 * The kinds the api and the worker run: the daily cleanup (`maintenance.daily`)
 * everywhere, and `dev.simulate` (and its light twin, `dev.simulate_light`)
 * only locally and in previews (AC-123), so production answers NOT_FOUND for
 * it; the bulk changes of spec 0022 everywhere; later features add theirs here.
 */
export function jobKinds(options: JobKindsOptions): JobRegistry {
  const local = options.environment === 'local' || options.environment === 'preview';
  const tests = local ? [devSimulate(options.sleep) as AnyKind, devSimulate(options.sleep, 'light') as AnyKind] : [];
  return createRegistry([
    maintenanceDaily(options.queue),
    formsProcess(),
    formsFile() as AnyKind,
    formsSync() as AnyKind,
    formsExport() as AnyKind,
    ...(bulkKinds() as readonly AnyKind[]),
    ...tests,
    ...(options.extra ?? []),
  ]);
}
