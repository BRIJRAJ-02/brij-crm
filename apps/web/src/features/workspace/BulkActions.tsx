// Brief
// Purpose: act on the rows ticked in an object's table, a few or every one the view matches (spec 0022, milestones 1 to 3).
// Main task: tick rows (or "Select all N matching"), press Edit or Delete; up to 500 go at once, more are counted, confirmed and run in the background.
// Leaves out: Add to list (#51), board cards (#21), several fields in one edit, and relationships (owner decision 3).
import {
  refusalSummary,
  type AttributeDefinition,
  type BulkAction,
  type BulkEditResult,
  type DataError,
  type BulkEdit,
  type BulkTarget,
  type ObjectSummary,
  type RecordsView,
  type ViewQuery,
  type ViewState,
} from '@crm/data';
import { BulkActionBar, Button, Callout, Modal } from '@crm/ui';
import { allMatching, noRows, selectedCount, type GridSelection } from '@crm/ui/grid';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BulkEditDialog, type BulkEditChoice } from './BulkEditDialog.tsx';
import {
  BULK_EXCEPT_MAX,
  BULK_IDS_MAX,
  bulkPath,
  bulkStrings,
  deleteToast,
  editToast,
  needsConfirm,
  recordsWord,
} from './bulk.ts';
import { runUndo } from './useUndoShortcut.ts';
import { useBulkJob } from './useBulkJob.ts';

/** A table's ticked rows, when "all matching" was pressed, and what changes them. */
export interface TableSelection {
  readonly selection: GridSelection;
  /** When "Select all" was pressed (ISO), for all matching: records made after it are never touched (AC-528). */
  readonly asOf: string | undefined;
  /** Sets the rows ticked; a selection past the limits is refused with a toast and the old one stays (AC-523). */
  readonly setSelection: (selection: GridSelection) => void;
  readonly selectAll: () => void;
  readonly clear: () => void;
}

/**
 * The rows ticked in a table (spec 0022, AC-522, AC-523): UI state, held by
 * the screen for the view it shows, so any new view (a sort, a filter,
 * another view, someone else's saved change to it) starts with nothing
 * ticked; rows gone on the server (`gone` from the view's state) leave it.
 * After a reload for changes too many to name, the ticked rows are read again,
 * and the gone ones leave. At most 10,000 one by one and 1,000 left out of all
 * matching: past either, `onRefused` says why and nothing changes.
 */
export function useTableSelection(
  view: RecordsView,
  state: Pick<ViewState, 'gone' | 'reloads'>,
  onRefused: (message: string) => void = () => undefined,
): TableSelection {
  const { gone, reloads } = state;
  const [held, setHeld] = useState<{
    readonly view: RecordsView;
    readonly selection: GridSelection;
    readonly asOf?: string;
  }>(() => ({ view, selection: noRows() }));
  const current = held.view === view ? held.selection : noRows();
  // Rows gone on the server leave the selection as soon as the view says so.
  const selection = useMemo((): GridSelection => {
    if (current.kind !== 'some' || current.ids.size === 0) return current;
    const kept = [...current.ids].filter((id) => !gone.has(id));
    return kept.length === current.ids.size ? current : { kind: 'some', ids: new Set(kept) };
  }, [current, gone]);
  const confirmedAt = useRef(reloads);
  useEffect(() => {
    if (confirmedAt.current === reloads) return;
    confirmedAt.current = reloads;
    if (selection.kind === 'some' && selection.ids.size > 0) view.confirm([...selection.ids]);
  }, [reloads, selection, view]);
  const asOf = held.view === view ? held.asOf : undefined;
  return {
    selection,
    asOf,
    setSelection: (next) => {
      if (next.kind === 'some' && next.ids.size > BULK_IDS_MAX) {
        onRefused(bulkStrings.tooManyIds);
        return;
      }
      if (next.kind === 'all-matching' && next.except.size > BULK_EXCEPT_MAX) {
        onRefused(bulkStrings.tooManyExcept);
        return;
      }
      if (next.kind !== 'all-matching') {
        setHeld({ view, selection: next });
        return;
      }
      // Mod+A in the grid selects all matching too: it counts from the moment it was first pressed.
      setHeld({
        view,
        selection: next,
        asOf: selection.kind === 'all-matching' ? (asOf ?? new Date().toISOString()) : new Date().toISOString(),
      });
    },
    selectAll: () => {
      setHeld({ view, selection: allMatching(), asOf: new Date().toISOString() });
    },
    clear: () => {
      setHeld({ view, selection: noRows() });
    },
  };
}

/** What the table's bulk actions hand the screen. */
export interface BulkActions {
  /** The floating bar while rows are ticked or a change runs (the DataGrid's `floatingBar`), or nothing. */
  readonly bar: ReactNode;
  /** The confirms and the edit dialog: always mounted, so they play their exits. */
  readonly dialog: ReactNode;
}

/** What the table's bulk actions need. */
export interface BulkActionsOptions {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The object's attributes: what the edit dialog offers (AC-529). */
  readonly attributes: readonly AttributeDefinition[];
  readonly ticked: TableSelection;
  /** How many records the view holds, and whether that is a floor ("10,000+"). */
  readonly total: number;
  readonly isTotalAtLeast: boolean;
  /** The view's filter: what "all matching" means (spec 0020's effective filter). */
  readonly query: ViewQuery;
  /** Clear or Esc in the bar: the screen clears the selection and takes focus back to the table. */
  readonly onClear: () => void;
  /** An inline delete went out: the rows left, so the table takes focus back where the first of them was. */
  readonly onDeleting: (recordIds: readonly string[]) => void;
}

/** What a confirm asks about: an inline delete's ids, or a counted job waiting in `ready`. */
type Asking =
  { readonly kind: 'delete'; readonly ids: readonly string[] } | { readonly kind: 'job'; readonly jobId: string };

/**
 * The floating bar while rows are ticked (AC-522 to AC-531): the count,
 * "Select all N matching", Edit and Delete, and Clear. Up to 500 picked
 * records change in one request (a delete of several asks first); more, or
 * all matching, start a job that counts first ("Counting…"), asks to confirm
 * the exact number, then shows its progress with Cancel. The finish toast
 * comes from the app (`onJobFinished`), so it arrives on any page.
 */
export function useBulkActions({
  slug,
  object,
  attributes,
  ticked,
  total,
  isTotalAtLeast,
  query,
  onClear,
  onDeleting,
}: BulkActionsOptions): BulkActions {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { selection, asOf } = ticked;
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<Asking | undefined>(undefined);
  const count = selectedCount(selection, total);
  const ids = selection.kind === 'some' ? [...selection.ids] : [];
  const path = bulkPath(selection, count);
  // The one toast with Undo per kind this table keeps: a newer one closes it, so no dead Undo piles up.
  const lastToast = useRef<string | undefined>(undefined);
  const raise = (toast: Parameters<typeof toasts.toast>[0]) => {
    if (lastToast.current !== undefined) toasts.dismiss(lastToast.current);
    lastToast.current = toasts.toast(toast);
  };

  // A background change this bar started, followed until it ends; its confirm opens once it is counted.
  const bulkJob = useBulkJob(slug);
  const jobAsking: Asking | undefined =
    bulkJob.awaiting === undefined ? undefined : { kind: 'job', jobId: bulkJob.awaiting.id };
  const open = asking ?? jobAsking;
  if (open !== undefined && open !== lastAsked && (open.kind !== 'job' || lastAsked?.kind !== 'job'))
    setLastAsked(open);

  const target = (): BulkTarget | undefined => {
    if (selection.kind === 'all-matching') {
      return {
        kind: 'matching',
        objectId: object.id,
        ...(query.filter === undefined ? {} : { filter: query.filter }),
        except: [...selection.except],
        asOf: asOf ?? new Date().toISOString(),
        now: asOf ?? new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    return ids.length === 0 ? undefined : { kind: 'ids', objectId: object.id, recordIds: ids };
  };

  /** Starts a job for the selection; answers why it was refused, if it was. */
  const start = async (action: BulkAction, edit?: BulkEdit): Promise<DataError | undefined> => {
    const on = target();
    return on === undefined ? undefined : bulkJob.start(action, on, edit);
  };

  const remove = (recordIds: readonly string[]) => {
    onDeleting(recordIds);
    data.records.deleteMany(slug, object.id, recordIds).then(
      (result) => {
        const toast = deleteToast(
          result,
          object,
          (undoId) => {
            runUndo(data, toasts, slug, undoId);
          },
          () => {
            remove(recordIds);
          },
        );
        if (toast !== undefined) raise(toast);
      },
      // The records layer failed to load; nothing left the table.
      () => {
        toasts.toast({ tone: 'danger', message: bulkStrings.somethingWrong });
      },
    );
  };

  // The ids the edit dialog changes, fixed when it opens; with a job, the selection as it was.
  const [editing, setEditing] = useState<{ readonly ids: readonly string[]; readonly count: number } | undefined>(
    undefined,
  );
  const [lastEdited, setLastEdited] = useState<{ readonly ids: readonly string[]; readonly count: number }>({
    ids: [],
    count: 0,
  });
  if (editing !== undefined && editing !== lastEdited) setLastEdited(editing);

  const edit = async (recordIds: readonly string[], choice: BulkEditChoice) => {
    const result = await data.records.bulkEdit(slug, object.id, recordIds, {
      attributeId: choice.definition.id,
      type: choice.definition.type,
      isMulti: choice.definition.isMulti,
      op: choice.op,
      ...(Object.hasOwn(choice, 'value') ? { value: choice.value } : {}),
    });
    const toast = editToast(
      result,
      object,
      (undoId) => {
        runUndo(data, toasts, slug, undoId);
      },
      () => {
        void edit(recordIds, choice);
      },
    );
    if (toast !== undefined) raise(toast);
    return result;
  };

  /** An edit too big for one request starts a job; a refusal to start shows in the dialog that asked. */
  const editAsJob = async (choice: BulkEditChoice): Promise<BulkEditResult> => {
    const failure = await start('edit', {
      attributeId: choice.definition.id,
      op: choice.op,
      ...(Object.hasOwn(choice, 'value') ? { value: choice.value } : {}),
    });
    return failure === undefined
      ? { kind: 'done', updated: 0, unchanged: 0, refused: 0 }
      : { kind: 'failed', error: failure };
  };

  const { job, note, progress, isRunning } = bulkJob;
  const shownCount = job?.total ?? count;
  const bar =
    count === 0 && !isRunning && note === undefined ? undefined : (
      <BulkActionBar
        placement="floating"
        count={isRunning && count === 0 ? shownCount : count}
        total={total}
        isTotalAtLeast={isTotalAtLeast}
        isAllMatching={selection.kind === 'all-matching'}
        {...(isRunning ? {} : { onSelectAllMatching: ticked.selectAll })}
        onClear={onClear}
        {...(progress === undefined ? {} : { progress })}
        {...(job?.cancellable !== true ? {} : { onCancel: bulkJob.cancel })}
      >
        {note !== undefined ? (
          <Callout placement="bar" isAnnounced>
            {note}
          </Callout>
        ) : object.access !== 'write' ? (
          // Spec 0009's words for an object the person may only read; the server refuses them anyway.
          <Callout placement="bar" isAnnounced>
            {bulkStrings.readOnly(object.pluralName)}
          </Callout>
        ) : (
          <>
            <Button
              icon="pencil"
              onPress={() => {
                setEditing({ ids, count });
              }}
            >
              {bulkStrings.edit}
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onPress={() => {
                if (path === 'job') {
                  void start('delete').then((failure) => {
                    if (failure !== undefined) bulkJob.say(refusalSummary(failure));
                  });
                  return;
                }
                if (needsConfirm(ids.length)) setAsking({ kind: 'delete', ids });
                else remove(ids);
              }}
            >
              {bulkStrings.delete}
            </Button>
          </>
        )}
      </BulkActionBar>
    );

  const shownAsk = open ?? lastAsked;
  const askedJob = shownAsk?.kind === 'job' ? data.jobs.get(slug, shownAsk.jobId) : undefined;
  const askedAction = bulkJob.action ?? 'delete';
  const askedCount =
    shownAsk === undefined ? 0 : shownAsk.kind === 'delete' ? shownAsk.ids.length : (askedJob?.total ?? 0);
  const words = recordsWord(askedCount, object);
  const isEditJob = shownAsk?.kind === 'job' && askedAction === 'edit';
  const editShown = editing ?? lastEdited;
  const dialog = (
    <>
      <BulkEditDialog
        isOpen={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        object={object}
        attributes={attributes}
        count={editShown.count}
        onApply={(choice) =>
          editShown.ids.length > 0 && editShown.ids.length === editShown.count && path === 'inline'
            ? edit(editShown.ids, choice)
            : editAsJob(choice)
        }
      />
      <Modal
        title={isEditJob ? bulkStrings.confirmEditTitle(words) : bulkStrings.confirmTitle(words)}
        tone="danger"
        isOpen={open !== undefined}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          // Closing a counted job's confirm without confirming cancels it: nothing was changed.
          if (open?.kind === 'job') bulkJob.cancel();
          setAsking(undefined);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {bulkStrings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              icon={isEditJob ? 'pencil' : 'trash'}
              onPress={() => {
                const confirmed = open;
                setAsking(undefined);
                if (confirmed?.kind === 'delete') remove(confirmed.ids);
                if (confirmed?.kind === 'job') {
                  // The selection clears once the job runs on its snapshot; the bar stays with its progress.
                  ticked.clear();
                  bulkJob.confirm();
                }
              }}
            >
              {isEditJob ? bulkStrings.confirmEditAction(words) : bulkStrings.confirmAction(words)}
            </Button>
          </>
        }
      >
        {isEditJob ? bulkStrings.confirmEditText : bulkStrings.confirmText}
      </Modal>
    </>
  );
  return { bar, dialog };
}
