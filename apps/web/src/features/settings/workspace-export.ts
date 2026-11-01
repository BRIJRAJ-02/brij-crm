// Where the owner's newest full workspace export stands (lane wip/crm-dataio), from the member's own jobs: the one
// place Settings' Your data reads it. Pure, so it is tested in Node.
import type { JobView } from '@crm/data';

/** The full export's job kind (`@crm/core`'s `WORKSPACE_EXPORT`). */
const KIND = 'workspace.export';
/** How long a finished export's file is kept (`WORKSPACE_EXPORT_KEPT_HOURS`). */
const KEPT_HOURS = 24;
/** An hour, in milliseconds. */
export const HOUR_MS = 3_600_000;

/** Where the newest export stands, from its job. */
export type ExportState =
  | { readonly kind: 'none' }
  | { readonly kind: 'running'; readonly job: JobView }
  | { readonly kind: 'ready'; readonly job: JobView; readonly exportId: string; readonly expiresAt: number }
  | { readonly kind: 'failed'; readonly job: JobView };

/** The newest full export among the member's jobs, as the row shows it; one past its 24 hours is none. */
export function exportState(jobs: readonly JobView[], now: number): ExportState {
  const job = jobs.find((each) => each.kind === KIND);
  if (job === undefined || job.status === 'cancelled') return { kind: 'none' };
  if (job.status === 'failed') return { kind: 'failed', job };
  if (job.status !== 'succeeded') return { kind: 'running', job };
  const exportId = typeof job.result?.exportId === 'string' ? job.result.exportId : undefined;
  const expiresAt = Date.parse(job.finishedAt ?? job.createdAt) + KEPT_HOURS * HOUR_MS;
  if (exportId === undefined || expiresAt <= now) return { kind: 'none' };
  return { kind: 'ready', job, exportId, expiresAt };
}
