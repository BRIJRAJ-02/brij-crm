// Bulk actions on a table (spec 0022, milestone 1): the words of the bar, the
// delete confirm and their toasts, and the rules the screen applies before
// anything is sent. Pure, so the node tests cover them; BulkDeleteBar does
// the showing.
import type { BulkEditResult, BulkOp, DeleteResult, JobView, UndoResult } from '@crm/data';
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
  tooMany: 'Change at most 500 records in one request; more run as a background change.',
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
  /** The bulk edit (AC-529, AC-530). */
  edit: 'Edit',
  editTitle: (records: string) => `Edit ${records}`,
  field: 'Field',
  fieldPlaceholder: 'Choose a field',
  change: 'Change',
  value: 'Value',
  ops: {
    set: 'Set',
    clear: 'Clear',
    add: 'Add',
    remove: 'Remove',
    replace: 'Replace',
  } satisfies Record<BulkOp, string>,
  checked: 'Checked',
  unchecked: 'Unchecked',
  clearsValue: (title: string, records: string) => `${title} will be emptied on ${records}.`,
  /** AC-529: a unique attribute can't be Set on several records. */
  uniqueRule: (title: string) => `${title} is unique, so several records can’t share one value.`,
  noFields: (pluralName: string) => `${pluralName} have no fields you can change in bulk.`,
  needsField: 'Choose a field to change.',
  needsValue: 'Give a value, or choose Clear.',
  needsChoice: 'Choose Checked or Unchecked.',
  close: 'Close',
  apply: (records: string) => `Apply to ${records}`,
  applying: 'Applying…',
  updated: (records: string) => `Updated ${records}.`,
  updatedSome: (records: string, refused: number) =>
    `Updated ${records}. ${count(refused)} ${refused === 1 ? 'was' : 'were'} refused.`,
  noneUpdated: (refused: number) =>
    refused === 1
      ? '1 record was refused. Its cell says why.'
      : `${count(refused)} records were refused. Each cell says why.`,
  nothingChanged: 'Nothing changed: every record already held that value.',
  undidBulk: (cells: string) => `Undid the edit of ${cells} records.`,
  /** Background changes (spec 0022, milestone 3): the bar, the confirm, the finish toast. */
  counting: 'Counting…',
  nothingToChange: 'Nothing left to change.',
  progress: {
    delete: (done: string, total: string) => `Deleting ${done} of ${total}`,
    edit: (done: string, total: string) => `Updating ${done} of ${total}`,
    restore: (done: string, total: string) => `Restoring ${done} of ${total}`,
    purge: (done: string, total: string) => `Deleting forever ${done} of ${total}`,
  },
  starting: 'Starting…',
  confirmEditTitle: (records: string) => `Update ${records}?`,
  confirmEditText: 'This can’t be undone.',
  /** What a counted edit job will do, restated in its confirm: "Sets Stage on each of them." */
  describeChange: (title: string, op: BulkOp) =>
    op === 'clear'
      ? `Clears ${title} on each of them.`
      : op === 'add'
        ? `Adds to ${title} on each of them.`
        : op === 'remove'
          ? `Removes from ${title} on each of them.`
          : op === 'replace'
            ? `Replaces ${title} on each of them.`
            : `Sets ${title} on each of them.`,
  /** A capped "all matching" (AC-523): the exact number comes with the count. */
  allMatchingRecords: (value: number, names: ObjectNames) =>
    `all ${count(value)}+ matching ${names.pluralName.toLowerCase()}`,
  confirmEditAction: (records: string) => `Update ${records}`,
  tooManyIds: 'Select at most 10,000 records one by one, or select all matching.',
  tooManyExcept: 'You can leave out at most 1,000 records from all matching. Clear and select them one by one instead.',
  stoppedDeleting: (done: string, total: string, plural: string) =>
    `Stopped deleting after ${done} of ${total} ${plural}. They’re in the trash.`,
  stoppedAfter: (label: string, done: string, total: string) => `${label} stopped after ${done} of ${total}.`,
  jobFailed: (label: string) => `${label} stopped before it finished. What it finished is kept.`,
  viewDetails: 'View details',
  refusedCount: (refused: number) => `${count(refused)} ${refused === 1 ? 'was' : 'were'} refused.`,
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
  // A delete past 500 comes back as a job: its own toast says when it is done.
  if (result.kind === 'restoring') {
    return { tone: 'success', message: `Restoring ${result.pluralName.toLowerCase()} in the background.` };
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

/**
 * The toast after a bulk edit lands (AC-530): "Updated 48 people." with Undo;
 * "Updated 46 people. 2 were refused." with Retry, which sends the edit
 * again (records already changed write nothing; the refused cells say why);
 * when the whole edit was refused, the dialog says why, or (a Retry from a
 * toast, no dialog open) this toast does.
 */
export function bulkEditToast(
  result: BulkEditResult,
  names: ObjectNames,
  onUndo: (undoId: string) => void,
  onRetry?: () => void,
  options: { readonly fromToast?: boolean } = {},
): ToastContent | undefined {
  if (result.kind === 'too-many') return { tone: 'danger', message: bulkStrings.tooMany };
  // Refused whole: the dialog that asked says why; a Retry from a toast (no dialog open) says it here.
  if (result.kind === 'failed')
    return options.fromToast === true ? { tone: 'danger', message: result.error.message } : undefined;
  if (result.updated === 0 && result.refused === 0) return { tone: 'success', message: bulkStrings.nothingChanged };
  if (result.updated === 0 && result.refused > 0) {
    return {
      tone: 'danger',
      message:
        result.refused === 1 && result.reason !== undefined ? result.reason : bulkStrings.noneUpdated(result.refused),
    };
  }
  const records = recordsWord(result.updated, names);
  if (result.refused > 0) {
    return {
      tone: 'danger',
      message: bulkStrings.updatedSome(records, result.refused),
      ...(onRetry === undefined ? {} : { action: { label: bulkStrings.retry, onAction: onRetry } }),
    };
  }
  const { undoId } = result;
  return {
    tone: 'success',
    message: bulkStrings.updated(records),
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

/** The most records a selection holds one by one (AC-523). */
export const BULK_IDS_MAX = 10_000;

/** The most records "all matching" may leave out (AC-523). */
export const BULK_EXCEPT_MAX = 1_000;

/** The bulk job kinds by what they do (spec 0022, milestone 3). */
export const BULK_JOB_ACTIONS = {
  'records.bulk_edit': 'edit',
  'records.bulk_delete': 'delete',
  'records.bulk_restore': 'restore',
  'records.purge': 'purge',
} as const;

/** What a bulk job does, or undefined for any other kind. */
export function bulkActionOf(kind: string): (typeof BULK_JOB_ACTIONS)[keyof typeof BULK_JOB_ACTIONS] | undefined {
  return Object.hasOwn(BULK_JOB_ACTIONS, kind) ? BULK_JOB_ACTIONS[kind as keyof typeof BULK_JOB_ACTIONS] : undefined;
}

/**
 * Which path a selection takes (spec 0022, "Choosing the path"): up to 500
 * picked records go in one request, anything bigger, or all matching, as a job.
 */
export function bulkPath(selection: { readonly kind: 'some' | 'all-matching' }, selected: number): 'inline' | 'job' {
  return selection.kind === 'all-matching' || selected > BULK_INLINE_MAX ? 'job' : 'inline';
}

/** The bar's progress while a bulk job counts or runs (AC-528), or undefined when it waits or has ended. */
export function jobProgress(
  job: Pick<JobView, 'kind' | 'status' | 'done' | 'refused' | 'skipped' | 'total'>,
): { readonly label: string; readonly value?: number } | undefined {
  if (job.status === 'preparing') return { label: bulkStrings.counting };
  const action = bulkActionOf(job.kind);
  if (action === undefined) return undefined;
  if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'cancelling') return undefined;
  const done = job.done + job.refused + job.skipped;
  const total = job.total ?? 0;
  return {
    label: bulkStrings.progress[action](count(done), count(total)),
    ...(total === 0 ? {} : { value: Math.min(100, Math.round((done / total) * 100)) }),
  };
}

/**
 * The toast a bulk job raises when it ends (AC-528, AC-531): "Deleted 12,345
 * people." with Undo; "Updated 9,998 people. 2 were refused." with View
 * details; "Restored …"; "Cancelled after 4,500 of 12,345."; a failure says so.
 */
export function bulkJobToast(
  job: Pick<JobView, 'kind' | 'label' | 'status' | 'done' | 'refused' | 'skipped' | 'total'>,
  names: ObjectNames,
  actions: { readonly onUndo?: () => void; readonly onView: () => void },
): ToastContent | undefined {
  const action = bulkActionOf(job.kind);
  if (action === undefined) return undefined;
  const view = { label: bulkStrings.viewDetails, onAction: actions.onView };
  if (job.status === 'failed') return { tone: 'danger', message: bulkStrings.jobFailed(job.label), action: view };
  if (job.status === 'cancelled') {
    const done = count(job.done + job.refused + job.skipped);
    const total = count(job.total ?? 0);
    // A delete stopped part way: what it moved is in the trash, and Undo brings it back as a finished one does.
    if (action === 'delete' && job.done > 0 && actions.onUndo !== undefined) {
      return {
        tone: 'success',
        message: bulkStrings.stoppedDeleting(done, total, names.pluralName.toLowerCase()),
        action: { label: bulkStrings.undo, onAction: actions.onUndo },
      };
    }
    return { tone: 'success', message: bulkStrings.stoppedAfter(job.label, done, total), action: view };
  }
  if (job.status !== 'succeeded') return undefined;
  // A count of zero: the bar that started it says "Nothing left to change." (no second announcement).
  if ((job.total ?? 0) === 0) return undefined;
  const records = recordsWord(job.done, names);
  const what =
    action === 'delete'
      ? bulkStrings.deleted(records)
      : action === 'edit'
        ? bulkStrings.updated(records)
        : action === 'restore'
          ? bulkStrings.restored(records)
          : `Deleted ${records} forever.`;
  if (job.refused > 0) {
    return { tone: 'danger', message: `${what} ${bulkStrings.refusedCount(job.refused)}`, action: view };
  }
  return {
    tone: 'success',
    message: what,
    action:
      action === 'delete' && actions.onUndo !== undefined && job.done > 0
        ? { label: bulkStrings.undo, onAction: actions.onUndo }
        : view,
  };
}
