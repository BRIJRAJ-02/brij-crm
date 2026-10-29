// The kinds a process runs (spec 0008): one file per kind beside this one.
import type { UploadStore } from '../../forms/uploads.ts';
import type { RecordFileStore } from '../../records/files.ts';
import type { AppEnvironment } from '@crm/contracts';
import type { RuleSource } from '../../access/door.ts';
import { createRegistry, type AnyKind, type JobRegistry } from '../registry.ts';
import { devSimulate, type Sleep } from './dev-simulate.ts';
import { maintenanceDaily, type QueueRows } from './maintenance-daily.ts';
import { formsExport } from '../../forms/export.ts';
import { formsFile, formsSync } from '../../forms/filing.ts';
import { formsProcess } from '../../forms/process.ts';
import { bulkKinds } from '../../bulk/kinds.ts';
import { reassignKind } from '../../members/reassign.ts';
import { recordsImport } from '../../imports/kind.ts';
import { recordsImportUndo } from '../../imports/undo.ts';
import { recordsExport } from '../../exports/records.ts';

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
  /** The blob store the daily cleanup removes orphaned form uploads from (#32); without it that phase waits. */
  readonly uploads?: UploadStore;
  /**
   * The blob store a filed file answer's bytes are copied into, so the record
   * owns them (27 Oct 2026); without it a file answer isn't filed and says so.
   */
  readonly files?: RecordFileStore;
  /**
   * The access rules a member is read with when a job cuts what it tells them (a form's submission notice, an
   * import's result):
   * the api's `APP_RULES`, the same its door and its job runner take. Without them those jobs tell nobody (fail
   * closed), rather than read members with no rules.
   */
  readonly rules?: RuleSource;
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
    maintenanceDaily(options.queue, options.uploads),
    formsProcess(options.files, options.rules),
    formsFile(options.files),
    formsSync(options.files),
    formsExport(),
    ...(bulkKinds() as readonly AnyKind[]),
    reassignKind(),
    recordsImport(options.rules),
    recordsImportUndo(),
    recordsExport(),
    ...tests,
    ...(options.extra ?? []),
  ]);
}
