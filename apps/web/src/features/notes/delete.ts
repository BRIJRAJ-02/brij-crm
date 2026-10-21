// Deleting a note (spec 0019, AC-445, and the owner's rule of 21 October
// 2026): a note can't be brought back from the Trash, so "Delete note" asks
// first in a confirm, which waits for the server; once the delete lands, the
// toast still offers Undo for 10 seconds, and focus goes back to the list.
import type { DataError } from '@crm/data';
import type { Toasts } from '@crm/ui';
import { focusList, UNDO_MS } from '../tasks/undo-delete.ts';

/** What the Undo toast after a landed delete needs. */
export interface UndoAfterDelete {
  readonly toasts: Toasts;
  /** Brings the note back exactly as it was; answers the refusal, if any. */
  readonly restore: () => Promise<DataError | undefined>;
  readonly words: {
    readonly deleted: string;
    readonly undo: string;
    readonly notRestored: (reason: string) => string;
  };
  /** The list the note was in, by its accessible name: it takes focus once the windows have closed. */
  readonly listLabel?: string;
}

/** Says the delete landed, with Undo for 10 seconds; a refused Undo says why. */
export function offerUndo({ toasts, restore, words, listLabel }: UndoAfterDelete): void {
  toasts.toast(
    {
      tone: 'success',
      message: words.deleted,
      action: {
        label: words.undo,
        onAction: () => {
          void restore().then((refused) => {
            if (refused !== undefined) toasts.toast({ tone: 'danger', message: words.notRestored(refused.message) });
          });
        },
      },
    },
    { timeout: UNDO_MS },
  );
  if (listLabel !== undefined) focusList(listLabel);
}
