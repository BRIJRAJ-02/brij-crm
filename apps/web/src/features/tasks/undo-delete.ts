// Deleting a task or a note (spec 0019, AC-445): it goes at once, with no
// confirm, and "Undo" stays for 10 seconds (paused while the toast is hovered
// or focused). The toast shows before the server answers; a refusal takes it
// back and says why. Focus goes back to the list the item was in, never to
// the page's body.
import type { DataError } from '@crm/data';
import type { Toasts } from '@crm/ui';

/** How long a delete's Undo stays (AC-445). */
export const UNDO_MS = 10_000;

/** What a delete with Undo needs. */
export interface DeleteWithUndo {
  readonly toasts: Toasts;
  /** Takes the item away (optimistic); answers the refusal, if any. */
  readonly remove: () => Promise<DataError | undefined>;
  /** Brings it back exactly as it was; answers the refusal, if any. */
  readonly restore: () => Promise<DataError | undefined>;
  readonly words: {
    readonly deleted: string;
    readonly undo: string;
    readonly notDeleted: (reason: string) => string;
    readonly notRestored: (reason: string) => string;
  };
  /** The list the item was in, by its accessible name: it takes focus once the dialog has closed. */
  readonly listLabel?: string;
}

/** Puts focus on the list with this name, once the dialog that held it has gone. */
export function focusList(label: string): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const list = document.querySelector<HTMLElement>(`[role="grid"][aria-label="${CSS.escape(label)}"]`);
      list?.focus();
    });
  });
}

/** Deletes at once with an Undo toast for 10 seconds; a refusal takes the toast back and says why. */
export function deleteWithUndo({ toasts, remove, restore, words, listLabel }: DeleteWithUndo): void {
  const removing = remove();
  const key = toasts.toast(
    {
      tone: 'success',
      message: words.deleted,
      action: {
        label: words.undo,
        onAction: () => {
          // Undo after the delete landed, so the restore never races it.
          void removing
            .then((failure) => (failure === undefined ? restore() : undefined))
            .then((refused) => {
              if (refused !== undefined) toasts.toast({ tone: 'danger', message: words.notRestored(refused.message) });
            });
        },
      },
    },
    { timeout: UNDO_MS },
  );
  void removing.then((failure) => {
    if (failure === undefined) return;
    toasts.dismiss(key);
    toasts.toast({ tone: 'danger', message: words.notDeleted(failure.message) });
  });
  if (listLabel !== undefined) focusList(listLabel);
}
