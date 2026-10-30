// One export from press to file (spec 0040, AC-1130, AC-1131): a busy toast
// while the `records.export` job writes, which gives way to Download when it
// succeeds, or to what went wrong with Try again. The job is watched through
// the data layer's job store, the one the Background jobs page reads, so the
// toast keeps going when the screen that started it is left.
import { isDataError, type DataLayer, type JobView, type RecordsExportView } from '@crm/data';
import { TRANSFER_LIMITS } from '@crm/data/imports';
import type { ToastContent, Toasts } from '@crm/ui';
import { strings } from './strings.ts';
import { exportToast } from './toast.ts';

/** What an export runs: the view as it stands (its filter and sorts, saved or not, and its visible columns). */
export type ExportRequest = Omit<Parameters<DataLayer['exports']['start']>[1], 'id'>;

/** Where a job stands, for the export's toast. */
export type ExportOutcome = 'working' | 'ready' | 'changed' | 'failed';

/** How an export's job stands: still writing, written (exactly, or with records changing under it), or not. */
export function exportOutcome(job: Pick<JobView, 'status' | 'result'> | undefined): ExportOutcome {
  if (job === undefined) return 'working';
  if (job.status === 'succeeded') return job.result?.changedWhileWritten === true ? 'changed' : 'ready';
  if (job.status === 'failed' || job.status === 'cancelled') return 'failed';
  return 'working';
}

/**
 * Whether a view holds more records than one export writes (100,000), from
 * the count its table shows. A floor ("10,000+", a filtered view's capped
 * count) can't say, so it never blocks: the server refuses with the count.
 */
export function isOverExportLimit(count: { readonly count: number; readonly atLeast: boolean } | undefined): boolean {
  return count !== undefined && !count.atLeast && count.count > TRANSFER_LIMITS.exportRows;
}

/** What `runExport` needs from the app. */
export interface ExportDeps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  /** Hands the browser a URL to download (the page leaves nothing: the server answers with an attachment). */
  readonly download: (path: string) => void;
}

/**
 * Starts an export named `name` (a view's name, or "3 people"), saying so in a busy toast that turns into its
 * ending. A press while the start is out is the caller's to ignore.
 */
export function runExport(deps: ExportDeps, slug: string, name: string, request: ExportRequest): Promise<void> {
  const { data, toasts, download } = deps;
  const busy = toasts.toast({ tone: 'info', message: strings.exporting(name), isBusy: true });
  const again = () => {
    void runExport(deps, slug, name, request);
  };
  const failed = (why: string | undefined): ToastContent => ({
    tone: 'danger',
    message: strings.exportFailed(name, why),
    action: { label: strings.tryAgain, onAction: again },
  });
  const ended = (job: JobView, view: RecordsExportView): ToastContent => {
    const outcome = exportOutcome(job);
    if (outcome === 'failed') return failed(job.error?.message);
    const exportId = typeof job.result?.exportId === 'string' ? job.result.exportId : view.id;
    return {
      tone: outcome === 'changed' ? 'info' : 'success',
      message: (outcome === 'changed' ? exportToast.readyChanged : exportToast.ready)(view.fileName),
      action: { label: exportToast.download, onAction: () => download(data.exports.downloadPath(slug, exportId)) },
    };
  };
  return data.exports.start(slug, { id: data.exports.newId(), ...request }).then(
    (view) => {
      let stop = (): void => undefined;
      let isDone = false;
      const check = () => {
        const job = data.jobs.get(slug, view.jobId);
        if (isDone || job === undefined || exportOutcome(job) === 'working') return;
        isDone = true;
        stop();
        toasts.dismiss(busy);
        toasts.toast(ended(job, view));
      };
      stop = data.jobs.follow(check);
      // A small export may have ended before anything was followed.
      check();
    },
    (error: unknown) => {
      toasts.dismiss(busy);
      toasts.toast(failed(isDataError(error) ? error.message : undefined));
    },
  );
}
