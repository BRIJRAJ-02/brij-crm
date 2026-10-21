// The toast a bulk job raises when it ends (spec 0022, AC-528, AC-531), on
// whatever page is open. main.tsx loads it only when a bulk job of this
// browser ends, so the bulk words stay out of the first load.
import type { DataLayer, JobView } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { bulkJobToast, bulkStrings } from './bulk.ts';
import { lifecycleUndoToast } from './undo.ts';

/** What raising a bulk job's finish toast needs from the app. */
export interface BulkFinishedDeps {
  readonly data: DataLayer;
  readonly toast: (content: ToastContent) => void;
  /** Opens the Background jobs page of the job's workspace. */
  readonly onView: () => void;
}

/**
 * Raises the finish toast of a bulk job, with its object's names: "Deleted
 * 12,345 people." with Undo, which restores that job's batch (its id).
 */
export async function bulkFinished(deps: BulkFinishedDeps, workspace: string, job: JobView): Promise<void> {
  const { data, toast, onView } = deps;
  const objectId = job.subject?.type === 'object' ? job.subject.id : undefined;
  const object = (await data.objects.list(workspace).catch(() => [])).find((each) => each.id === objectId);
  const names = object ?? { singularName: 'record', pluralName: 'records' };
  const content = bulkJobToast(job, names, {
    onView,
    ...(objectId === undefined
      ? {}
      : {
          onUndo: () => {
            void data.records.restoreDeleted(workspace, objectId, job.id, job.done).then(
              (result) => {
                const undone = lifecycleUndoToast(result);
                if (undone !== undefined) toast(undone);
              },
              () => {
                toast({ tone: 'danger', message: bulkStrings.somethingWrong });
              },
            );
          },
        }),
  });
  if (content !== undefined) toast(content);
}
