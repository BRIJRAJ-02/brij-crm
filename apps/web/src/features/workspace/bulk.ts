// Bulk actions on a table (spec 0022, milestone 1): the words of the bar, the
// delete confirm and their toasts, and the rules the screen applies before
// anything is sent. Pure, so the node tests cover them; BulkDeleteBar does
// the showing.
import type { DeleteResult, UndoResult } from '@crm/data';
import type { ToastContent } from '@crm/ui';

/** The most records one request changes; past it, background jobs (milestone 3) take over. */
export const BULK_INLINE_MAX = 500;

/** Failures that pass on their own (offline, busy): their toast offers Retry. */
const PASSING: ReadonlySet<string> = new Set(['INTERNAL', 'API_UNAVAILABLE', 'RATE_LIMITED', 'TOO_MANY_REQUESTS']);

/** Whether a failed bulk action may simply be sent again. */
export function isPassing(code: string): boolean {
  return PASSING.has(code);
}

/** A count in the browser's language ("1,500"), as the grid writes its own. */
const count = (value: number): string => new Intl.NumberFormat().format(value);

/** An object's names, as a toast counts its records ("1 person", "48 people"). */
export interface ObjectNames {
  readonly singularName: string;
  readonly pluralName: string;
}

/** "1 person", "48 people": a count with the object's name, in lower case. */
export function recordsWord(value: number, names: ObjectNames): string {
  return `${count(value)} ${(value === 1 ? names.singularName : names.pluralName).toLowerCase()}`;
}

/** The bar's, the confirm's and the toasts' copy. */
export const bulkStrings = {
  delete: 'Delete',
  retry: 'Retry',
  deleting: 'Deleting',
  cancel: 'Cancel',
  undo: 'Undo',
  /** An object the person may only read (spec 0009's words). */
  readOnly: (pluralName: string) => `You can view ${pluralName} but not change them.`,
  /** A selection past what one request changes (spec 0022, milestones 1 and 2). */
  tooMany: 'Changes to more than 500 records arrive soon.',
  /** "Delete 48 people?" (AC-525), danger tone. */
  confirmTitle: (records: string) => `Delete ${records}?`,
  confirmText: 'They stay in the trash for 30 days.',
  confirmAction: (records: string) => `Delete ${records}`,
  deletedOne: (name: string) => `Deleted ${name}.`,
  deleted: (records: string) => `Deleted ${records}.`,
  /** Some went, some didn't: their rows say why (AC-525). */
  deletedSome: (records: string, refused: number) =>
    refused === 1
      ? `Deleted ${records}. 1 wasn’t deleted; its row says why.`
      : `Deleted ${records}. ${count(refused)} weren’t deleted; each row says why.`,
  /** None went: one reason, or the count. */
  noneDeleted: (records: string) => `${records} weren’t deleted. Each row says why.`,
  somethingWrong: 'Something went wrong. Try again in a moment.',
  /** After an undo of a delete (AC-526). */
  restoredOne: (name: string) => `Restored ${name}.`,
  restored: (records: string) => `Restored ${records}.`,
  stillInTrash: (kept: number, reason: string) =>
    kept === 1 ? `1 is still in the trash ${reason}.` : `${count(kept)} are still in the trash ${reason}.`,
  becauseUnique: 'because a unique value is now used by another record',
  becauseLimit: 'because the workspace holds as many records as it can',
  becauseGone: 'because it was removed from the trash',
  becauseGoneMany: 'because they were removed from the trash',
  becauseOther: 'because it couldn’t come back',
  becauseOtherMany: 'because they couldn’t come back',
  nothingLeft: 'Nothing from that delete is still in the trash.',
  /** After an undo of a create (AC-541). */
  undidCreate: (name: string) => `Undid the create of ${name}.`,
  couldNotUndoCreate: (name: string) => `Couldn’t undo the create of ${name}.`,
} as const;

/** Whether the bar offers Delete for a selection of `selected` records, or says it is too many. */
export function deleteOffer(selected: number): 'delete' | 'too-many' {
  return selected > BULK_INLINE_MAX ? 'too-many' : 'delete';
}

/** Whether deleting `selected` records asks first (AC-524, AC-525): one goes at once, since Undo is a click away. */
export function needsConfirm(selected: number): boolean {
  return selected > 1;
}

/**
 * The toast after a delete lands (AC-524, AC-525): "Deleted Ada Lovelace." or
 * "Deleted 48 people.", with Undo; how many were refused when some were; the
 * failure's own words when the whole delete was refused.
 */
export function deleteToast(
  result: DeleteResult,
  names: ObjectNames,
  onUndo: (undoId: string) => void,
  onRetry?: () => void,
): ToastContent | undefined {
  if (result.kind === 'too-many') return { tone: 'danger', message: bulkStrings.tooMany };
  if (result.kind === 'failed') {
    const message = result.error.message || bulkStrings.somethingWrong;
    // A passing failure (offline, busy) offers the same delete again; a refusal (read only) says why.
    return onRetry !== undefined && isPassing(result.error.code)
      ? { tone: 'danger', message, action: { label: bulkStrings.retry, onAction: onRetry } }
      : { tone: 'danger', message };
  }
  if (result.deleted === 0 && result.refused === 0) return undefined;
  if (result.deleted === 0) {
    const message =
      result.refused === 1 && result.reason !== undefined
        ? result.reason
        : bulkStrings.noneDeleted(recordsWord(result.refused, names));
    return { tone: 'danger', message };
  }
  const what =
    result.deleted === 1 && result.recordName !== undefined && result.recordName !== ''
      ? bulkStrings.deletedOne(result.recordName)
      : bulkStrings.deleted(recordsWord(result.deleted, names));
  const message =
    result.refused === 0 ? what : bulkStrings.deletedSome(recordsWord(result.deleted, names), result.refused);
  const { undoId } = result;
  return {
    // Rows left behind need the person's eye: the same tone as a restore that left some in the trash.
    tone: result.refused === 0 ? 'success' : 'danger',
    message,
    ...(undoId === undefined
      ? {}
      : {
          action: {
            label: bulkStrings.undo,
            onAction: () => {
              onUndo(undoId);
            },
          },
        }),
  };
}

/** Why records stayed in the trash, in words, for one or several. */
function reasonWords(reason: Extract<UndoResult, { kind: 'restored' }>['reason'], kept: number): string {
  if (reason === 'unique') return bulkStrings.becauseUnique;
  if (reason === 'limit') return bulkStrings.becauseLimit;
  if (reason === 'gone') return kept === 1 ? bulkStrings.becauseGone : bulkStrings.becauseGoneMany;
  return kept === 1 ? bulkStrings.becauseOther : bulkStrings.becauseOtherMany;
}

/**
 * The toast after an undo of a delete or a create (AC-526, AC-541): "Restored
 * 46 people. 2 are still in the trash because a unique value is now used by
 * another record."; "Undid the create of Ada Lovelace.". Undefined for any
 * other undo (the edit toasts cover those).
 */
export function lifecycleUndoToast(result: UndoResult): ToastContent | undefined {
  if (result.kind === 'uncreated') {
    return result.deleted
      ? { tone: 'success', message: bulkStrings.undidCreate(result.recordName) }
      : { tone: 'danger', message: bulkStrings.couldNotUndoCreate(result.recordName) };
  }
  if (result.kind !== 'restored') return undefined;
  if (result.restored === 0) {
    return {
      tone: 'danger',
      message:
        result.reason === 'gone'
          ? bulkStrings.nothingLeft
          : bulkStrings.stillInTrash(result.kept, reasonWords(result.reason, result.kept)),
    };
  }
  const restored =
    result.restored === 1 && result.kept === 0 && result.recordName !== undefined && result.recordName !== ''
      ? bulkStrings.restoredOne(result.recordName)
      : bulkStrings.restored(recordsWord(result.restored, result));
  const message =
    result.kept === 0
      ? restored
      : `${restored} ${bulkStrings.stillInTrash(result.kept, reasonWords(result.reason, result.kept))}`;
  return { tone: result.kept === 0 ? 'success' : 'danger', message };
}
