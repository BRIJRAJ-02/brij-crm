// Bulk actions on a table (spec 0022): the words of the bar, the dialogs and
// their toasts, and the rules the screen applies before anything is sent. Pure,
// so the node tests cover them; BulkActions, BulkEditDialog, useBulkJob and the
// Trash do the showing. Only the screens that use it load it; the undo of a
// delete is in undo.ts, which the frame loads, and the job kinds in bulk-jobs.ts.
import type { BulkEditResult, BulkOp, DeleteResult, JobView } from '@crm/data';
import type { ToastContent } from '@crm/ui';
import { bulkActionOf } from './bulk-jobs.ts';
import { lifecycleStrings, recordsWord, type ObjectNames } from './undo.ts';

export { BULK_JOB_ACTIONS, bulkActionOf } from './bulk-jobs.ts';
export { lifecycleUndoToast, recordsWord, type ObjectNames } from './undo.ts';

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

/** The bar's, the confirm's and the toasts' copy, with the undo's words from undo.ts. */
export const bulkStrings = {
  ...lifecycleStrings,
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
  /** The bulk edit (AC-529, AC-530). */
  edit: 'Edit',
  editTitle: (records: string) => `Edit ${records}`,
  field: 'Field',
  fieldPlaceholder: 'Choose a field',
  change: 'Change',
  /** Change's InfoTip, for a field that holds several values. */
  changeHelp:
    'Add keeps what each record has and adds yours. Remove takes out only yours. Replace swaps everything for yours, and Clear empties the field.',
  changeExample: 'Add the tag VIP to 40 people and their other tags stay.',
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
  /** A field Clear isn't offered for (a required one): only the value can be asked for. */
  needsValueOnly: 'Give a value.',
  needsChoice: 'Choose Checked or Unchecked.',
  close: 'Close',
  /** The title already names the records ("Edit 48 people"), so the footer has room for its keycaps on a phone. */
  apply: 'Apply',
  applying: 'Applying…',
  updated: (records: string) => `Updated ${records}.`,
  /** Some refused: their cells say why, as a delete's rows do (AC-530). */
  updatedSome: (records: string, refused: number) =>
    refused === 1
      ? `Updated ${records}. 1 was refused; its cell says why.`
      : `Updated ${records}. ${count(refused)} were refused; each cell says why.`,
  noneUpdated: (refused: number) =>
    refused === 1
      ? '1 record was refused. Its cell says why.'
      : `${count(refused)} records were refused. Each cell says why.`,
  nothingChanged: 'Nothing changed: every record already held that value.',
  /** Background changes (spec 0022, milestone 3): the bar, the confirm, the finish toast. */
  counting: 'Counting…',
  /** Counted and waiting for its confirm: the bar's full progress, beside Review. */
  counted: (records: string) => `${records} counted`,
  /** Cancel pressed while it runs: it stops once its current batch is done. */
  stopping: 'Stopping after this batch…',
  nothingToChange: 'Nothing left to change.',
  progress: {
    delete: (done: string, total: string) => `Deleting ${done} of ${total}`,
    edit: (done: string, total: string) => `Updating ${done} of ${total}`,
    restore: (done: string, total: string) => `Restoring ${done} of ${total}`,
    purge: (done: string, total: string) => `Deleting ${done} of ${total} forever`,
  },
  starting: 'Starting…',
  confirmEditTitle: (records: string) => `Update ${records}?`,
  confirmEditText: 'This can’t be undone.',
  /**
   * What a counted edit job will do, restated in its confirm around the value
   * it writes, drawn by its field's display: "Sets Stage to [Won] on each of
   * them." A Clear, or a checkbox, needs no value drawn.
   */
  describeChange: (
    title: string,
    op: BulkOp,
  ): { readonly before: string; readonly after: string } | { readonly whole: string } =>
    op === 'clear'
      ? { whole: `Clears ${title} on each of them.` }
      : op === 'add'
        ? { before: 'Adds', after: `to ${title} on each of them.` }
        : op === 'remove'
          ? { before: 'Removes', after: `from ${title} on each of them.` }
          : op === 'replace'
            ? { before: `Replaces ${title} with`, after: 'on each of them.' }
            : { before: `Sets ${title} to`, after: 'on each of them.' },
  /** A checkbox's change, in words: no box drawn. */
  describeCheck: (title: string, isChecked: boolean) =>
    isChecked ? `Checks ${title} on each of them.` : `Unchecks ${title} on each of them.`,
  /** A capped "all matching" (AC-523): the exact number comes with the count. */
  allMatchingRecords: (value: number, names: ObjectNames) =>
    `all ${count(value)}+ matching ${names.pluralName.toLowerCase()}`,
  confirmEditAction: (records: string) => `Update ${records}`,
  tooManyIds: 'Select at most 10,000 records one by one, or select all matching.',
  tooManyExcept: 'You can leave out at most 1,000 records from all matching. Clear and select them one by one instead.',
  /** A background change that stopped part way (cancelled, or failed): how far it got, in the others' words. */
  stopped: {
    delete: (done: string, total: string, plural: string) => `Stopped deleting after ${done} of ${total} ${plural}.`,
    edit: (done: string, total: string, plural: string) => `Stopped updating after ${done} of ${total} ${plural}.`,
    restore: (done: string, total: string, plural: string) => `Stopped restoring after ${done} of ${total} ${plural}.`,
    purge: (done: string, total: string, plural: string) =>
      `Stopped deleting forever after ${done} of ${total} ${plural}.`,
  },
  /** What a stopped delete moved: still in the trash, and Undo brings it back. */
  inTheTrash: 'They’re in the trash.',
  /** What a failed change finished stays finished. */
  keptDone: 'What it finished is kept.',
  deletedForever: (records: string) => `Deleted ${records} forever.`,
  viewDetails: 'View details',
  /** A job's refusals are listed on the Background jobs page (View details). */
  refusedSeeDetails: (refused: number) =>
    refused === 1 ? '1 was refused; the details say why.' : `${count(refused)} were refused; the details say why.`,
  /** What a purge left in the trash (spec 0022, AC-538 as amended), per object it may only read. */
  leftInTrash: (left: number, names: ObjectNames) =>
    left === 1
      ? `1 ${names.singularName} record stays in the trash because you can view ${names.pluralName} but not change them.`
      : `${count(left)} ${names.pluralName} records stay in the trash because you can view ${names.pluralName} but not change them.`,
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

/**
 * Which path a selection takes (spec 0022, "Choosing the path"): up to 500
 * picked records go in one request, anything bigger, or all matching, as a job.
 */
export function bulkPath(selection: { readonly kind: 'some' | 'all-matching' }, selected: number): 'inline' | 'job' {
  return selection.kind === 'all-matching' || selected > BULK_INLINE_MAX ? 'job' : 'inline';
}

/**
 * The bar's progress while a bulk job counts, waits for its confirm or runs
 * (AC-528): "Counting…"; a full bar labelled with the count ("12,345 people
 * counted") while it waits; "Deleting 4,500 of 12,345"; "Stopping after this
 * batch…" once cancelled while it runs. Undefined once it has ended.
 */
export function jobProgress(
  job: Pick<JobView, 'kind' | 'status' | 'done' | 'refused' | 'skipped' | 'total'>,
  names: ObjectNames,
): { readonly label: string; readonly value?: number } | undefined {
  if (job.status === 'preparing') return { label: bulkStrings.counting };
  const action = bulkActionOf(job.kind);
  if (action === undefined) return undefined;
  const total = job.total ?? 0;
  if (job.status === 'ready') return { label: bulkStrings.counted(recordsWord(total, names)), value: 100 };
  if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'cancelling') return undefined;
  const done = job.done + job.refused + job.skipped;
  const value = total === 0 ? undefined : Math.min(100, Math.round((done / total) * 100));
  return {
    label: job.status === 'cancelling' ? bulkStrings.stopping : bulkStrings.progress[action](count(done), count(total)),
    ...(value === undefined ? {} : { value }),
  };
}

/** What a purge left in the trash for one object, with that object's names (spec 0022, AC-538 as amended). */
export interface LeftInTrash {
  readonly names: ObjectNames;
  readonly count: number;
}

/**
 * The toast a bulk job raises when it ends (AC-528, AC-531): "Deleted 12,345
 * people." with Undo; "Updated 9,998 people. 2 were refused; the details say
 * why." with View details; "Restored …"; "Deleted 1,200 records forever.",
 * with what a purge left in the trash per object; "Stopped deleting after
 * 4,500 of 12,345 people. They're in the trash." with Undo. Nothing for a job
 * that ended before it touched anything: a declined confirm or Cancel while
 * counting says nothing, and a failure or a count of zero is said in the bar
 * that started it (AC-539).
 */
export function bulkJobToast(
  job: Pick<JobView, 'kind' | 'label' | 'status' | 'done' | 'refused' | 'skipped' | 'total' | 'error'>,
  names: ObjectNames,
  actions: { readonly onUndo?: () => void; readonly onView: () => void },
  left: readonly LeftInTrash[] = [],
): ToastContent | undefined {
  const action = bulkActionOf(job.kind);
  if (action === undefined) return undefined;
  const view = { label: bulkStrings.viewDetails, onAction: actions.onView };
  // What it touched, whichever way: changed, refused or skipped.
  const handled = job.done + job.refused + job.skipped;
  // A delete that moved any records to the trash brings them back from the toast, however it ended.
  const undo =
    action === 'delete' && job.done > 0 && actions.onUndo !== undefined
      ? { label: bulkStrings.undo, onAction: actions.onUndo }
      : undefined;
  const stayed = left.map((each) => bulkStrings.leftInTrash(each.count, each.names));
  const said = (...sentences: readonly string[]) => [...sentences, ...stayed].filter((each) => each !== '').join(' ');
  if (job.status === 'failed' || job.status === 'cancelled') {
    if (handled === 0) return undefined;
    const stopped = bulkStrings.stopped[action](count(handled), count(job.total ?? 0), names.pluralName.toLowerCase());
    const kept = action === 'delete' ? bulkStrings.inTheTrash : job.status === 'failed' ? bulkStrings.keptDone : '';
    return {
      tone: job.status === 'failed' ? 'danger' : 'success',
      message: said(stopped, job.status === 'failed' ? (job.error?.message ?? '') : '', kept),
      action: undo ?? view,
    };
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
          : bulkStrings.deletedForever(records);
  if (job.refused > 0)
    return { tone: 'danger', message: said(what, bulkStrings.refusedSeeDetails(job.refused)), action: view };
  // Records left in the trash need the person's eye, as rows left behind do.
  if (stayed.length > 0) return { tone: 'danger', message: said(what), action: view };
  return { tone: 'success', message: what, action: undo ?? view };
}
