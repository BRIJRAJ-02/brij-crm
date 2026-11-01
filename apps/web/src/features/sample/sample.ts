// Sample data's two actions, shared by the empty People, Companies and Deals tables and Settings › General: add it
// (the job's end toast says when it is in, `main.tsx`), and remove it with one Undo. Plain functions over the data
// layer and the toast queue, so every place says the same words.
import { isDataError, refusalSummary, type DataLayer } from '@crm/data';
import { sharedStrings, type Toasts } from '@crm/ui';
import { strings } from './strings.ts';

/** What a refusal says, or the shared line for anything else. */
const failureOf = (error: unknown): string =>
  isDataError(error) ? refusalSummary(error) : sharedStrings.couldntDoThat;

/** The standard objects whose empty table offers sample data. */
export const SAMPLE_OBJECTS: ReadonlySet<string> = new Set(['people', 'companies', 'deals']);

/** Starts adding sample data; says it started, or why it couldn't. Answers whether it started. */
export async function addSampleData(data: DataLayer, toasts: Toasts, slug: string): Promise<boolean> {
  try {
    await data.sampleData.add(slug);
    toasts.toast({ tone: 'success', message: strings.adding });
    return true;
  } catch (error) {
    toasts.toast({ tone: 'danger', message: failureOf(error) });
    return false;
  }
}

/** Removes sample data in one action, with Undo in its toast. Answers whether it went. */
export async function removeSampleData(data: DataLayer, toasts: Toasts, slug: string): Promise<boolean> {
  try {
    const { batchId, records } = await data.sampleData.remove(slug);
    toasts.toast({
      tone: 'success',
      message: strings.removed(records),
      action: {
        label: strings.undo,
        onAction: () => {
          data.sampleData.undoRemove(slug, batchId).then(
            () => {
              toasts.toast({ tone: 'success', message: strings.restored });
            },
            (error: unknown) => {
              toasts.toast({ tone: 'danger', message: failureOf(error) });
            },
          );
        },
      },
    });
    return true;
  } catch (error) {
    toasts.toast({ tone: 'danger', message: failureOf(error) });
    return false;
  }
}
