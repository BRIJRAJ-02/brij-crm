// The toast a bulk job raises when it ends (spec 0022, AC-528, AC-531), on
// whatever page is open. main.tsx loads it only when a bulk job of this
// browser ends, so the bulk words stay out of the first load.
import { purgeLeftOf, type DataLayer, type JobView } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { bulkJobToast, bulkStrings, type LeftInTrash } from './bulk.ts';
import { lifecycleUndoToast } from './undo.ts';

/** What raising a bulk job's finish toast needs from the app. */
export interface BulkFinishedDeps {
  readonly data: DataLayer;
  readonly toast: (content: ToastContent) => void;
  /** Opens the Background jobs page of the job's workspace. */
  readonly onView: () => void;
}

/** Any object's records, when the job names none (the whole trash) or its object can't be read. */
const RECORDS = { singularName: 'record', pluralName: 'records' } as const;

/**
 * Raises the finish toast of a bulk job, with its object's names: "Deleted
 * 12,345 people." with Undo, which restores that job's batch (its id); a purge
 * says, per object, what it left in the trash because the person may only read
 * it ("12 People records stay in the trash because you can view People but
 * not change them.").
 */
export async function bulkFinished(deps: BulkFinishedDeps, workspace: string, job: JobView): Promise<void> {
  const { data, toast, onView } = deps;
  const objectId = job.subject?.type === 'object' ? job.subject.id : undefined;
  const objects = await data.objects.list(workspace).catch(() => []);
  const byId = new Map(objects.map((object) => [object.id, object]));
  const names = (objectId === undefined ? undefined : byId.get(objectId)) ?? RECORDS;
  const left: readonly LeftInTrash[] = purgeLeftOf(job).map((each) => ({
    names: byId.get(each.objectId) ?? RECORDS,
    count: each.count,
  }));
  const content = bulkJobToast(
    job,
    names,
    {
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
    },
    left,
  );
  if (content !== undefined) toast(content);
}
