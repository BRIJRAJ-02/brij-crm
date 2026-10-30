// Brief
// Purpose: act on the rows ticked in an object's table, a few or every one the view matches (spec 0022, milestones 1 to 3).
// Main task: tick rows (or "Select all N matching"), press Edit or Delete; up to 500 go at once, more are counted, reviewed and run in the background.
// Leaves out: Add to list (#51), board cards (#21), several fields in one edit, and relationships (owner decision 3).
import {
  refusalSummary,
  toFieldAttribute,
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
import { AttributeDisplay, BulkActionBar, Button, Callout, Modal } from '@crm/ui';
import { allMatching, noRows, selectedCount, type GridSelection } from '@crm/ui/grid';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MemberPicker } from '../records/members.ts';
import { BulkEditDialog, type BulkEditChoice } from './BulkEditDialog.tsx';
import {
  BULK_EXCEPT_MAX,
  BULK_IDS_MAX,
  bulkPath,
  bulkStrings,
  deleteToast,
  bulkEditToast,
  recordsWord,
} from './bulk.ts';
import { runExport } from '../imports/export-run.ts';
import { strings as importStrings } from '../imports/strings.ts';
import { runUndo } from './useUndoShortcut.ts';
import { isFocusLost, useBulkJob } from './useBulkJob.ts';

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
 * What the ticked rows belong to: the view they were ticked on (`key`) and the filter it ran (`filterKey`). A new
 * question with the same of both (only its sorts or columns moved) holds the same rows, so the ticks stay; a new
 * filter on the same view clears them and calls `onFilterCleared` (the old rows can't be known to match it); another
 * view starts with none, quietly.
 */
export interface SelectionScope {
  readonly key: string;
  readonly filterKey: string;
  readonly onFilterCleared?: () => void;
}

/** What a selection is held for, beside the rows themselves. */
export interface HeldSelection {
  readonly view: RecordsView;
  readonly selection: GridSelection;
  readonly asOf?: string;
  readonly key: string;
  readonly filterKey: string;
  /** Counts the times a filter change cleared ticked rows, so the screen hears each once. */
  readonly dropped: number;
}

/** Whether anything is ticked. */
const hasTicks = (selection: GridSelection) => selection.kind === 'all-matching' || selection.ids.size > 0;

/**
 * Where a selection held for one question goes when the view runs another (pure): kept as it is for the same view
 * and filter (a sort is the same set of rows, all matching included), cleared for another filter or view.
 * `dropped` counts up when ticked rows went with a filter change on the same view.
 */
export function carrySelection(held: HeldSelection, view: RecordsView, key: string, filterKey: string): HeldSelection {
  if (held.key === key && held.filterKey === filterKey) return { ...held, view };
  const isFilterChange = held.key === key && hasTicks(held.selection);
  return { view, selection: noRows(), key, filterKey, dropped: held.dropped + (isFilterChange ? 1 : 0) };
}

/**
 * The rows ticked in a table (spec 0022, AC-522, AC-523): UI state, held by
 * the screen. Without a `scope` any new view (a sort, a filter, another view,
 * someone else's saved change to it) starts with nothing ticked; with one, a
 * sort keeps them (the same rows) and a filter change clears them with
 * `onFilterCleared` (see `SelectionScope`). Rows gone on the server (`gone`
 * from the view's state) leave it.
 * After a reload for changes too many to name, the ticked rows are read again
 * (the view merges and paces those reads), and the gone ones leave. At most
 * 10,000 one by one and 1,000 left out of all matching: past either,
 * `onRefused` says why and nothing changes.
 */
export function useTableSelection(
  view: RecordsView,
  state: Pick<ViewState, 'gone' | 'reloads'>,
  onRefused: (message: string) => void = () => undefined,
  scope?: SelectionScope,
): TableSelection {
  const { gone, reloads } = state;
  // Without a scope every view is its own: its object identity is the key.
  const key = scope?.key ?? '';
  const filterKey = scope?.filterKey ?? '';
  const [held, setHeld] = useState<HeldSelection>(() => ({
    view,
    selection: noRows(),
    key,
    filterKey,
    dropped: 0,
  }));
  // Another question's rows arrived: the ticks follow them or go (React's adjust state while rendering).
  if (held.view !== view) {
    setHeld(
      scope === undefined
        ? { view, selection: noRows(), key, filterKey, dropped: held.dropped }
        : carrySelection(held, view, key, filterKey),
    );
  }
  const current = held.view === view ? held.selection : noRows();
  // A filter change cleared ticked rows: say so once.
  const told = useRef(held.dropped);
  const onFilterCleared = scope?.onFilterCleared;
  useEffect(() => {
    if (told.current === held.dropped) return;
    told.current = held.dropped;
    onFilterCleared?.();
  }, [held.dropped, onFilterCleared]);
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
  const hold = (next: GridSelection, at?: string) => {
    const base = { view, selection: next, key, filterKey, dropped: held.dropped };
    setHeld(at === undefined ? base : { ...base, asOf: at });
  };
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
        hold(next);
        return;
      }
      // Mod+A in the grid selects all matching too: it counts from the moment it was first pressed.
      hold(next, selection.kind === 'all-matching' ? (asOf ?? new Date().toISOString()) : new Date().toISOString());
    },
    selectAll: () => {
      hold(allMatching(), new Date().toISOString());
    },
    clear: () => {
      hold(noRows());
    },
  };
}

/** What the table's bulk actions hand the screen. */
export interface BulkActions {
  /**
   * The floating bar (the DataGrid's `floatingBar`) while rows are ticked, a
   * change runs or a note shows, and while it plays its exit after; nothing
   * once it has gone, so the grid gives its room back.
   */
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
  /** The screen's member picker: an Owner's value in the edit dialog, and the member's name in its confirm. */
  readonly memberPicker: MemberPicker;
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
  /** The columns the view shows, in order: what Export N selected writes (spec 0040). */
  readonly exportColumns: readonly string[];
}

/**
 * The floating bar while rows are ticked (AC-522 to AC-531): the count,
 * "Select all N matching", Edit and Delete, and Clear. Up to 500 picked
 * records change in one request (a delete of several asks first); more, or
 * all matching, start a job that counts first ("Counting…"), then shows the
 * count with Review, whose confirm states the exact number (and, for an edit,
 * the value it writes), then its progress with Cancel. Nothing opens by
 * itself, so a count arriving never takes focus from a cell. The finish toast
 * comes from the app (`onJobFinished`), so it arrives on any page.
 */
export function useBulkActions({
  slug,
  object,
  attributes,
  memberPicker,
  ticked,
  total,
  isTotalAtLeast,
  query,
  onClear,
  onDeleting,
  exportColumns,
}: BulkActionsOptions): BulkActions {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const { selection, asOf } = ticked;
  const count = selectedCount(selection, total);
  // The ticked ids, copied once per selection, not on every render (a selection holds up to 10,000).
  const ids = useMemo(() => (selection.kind === 'some' ? [...selection.ids] : []), [selection]);
  const path = bulkPath(selection, count);
  const canWrite = object.access === 'write';
  // The one toast with Undo per kind this table keeps: a newer one closes it, so no dead Undo piles up.
  const lastToast = useRef<string | undefined>(undefined);
  const raise = (toast: Parameters<typeof toasts.toast>[0]) => {
    if (lastToast.current !== undefined) toasts.dismiss(lastToast.current);
    lastToast.current = toasts.toast(toast);
  };

  // A background change this bar started, followed until it ends. A count of zero clears the selection it was for;
  // focus that went with the bar's Cancel comes back to the table, as Clear brings it, and stays anywhere else.
  const bulkJob = useBulkJob(slug, object, () => {
    if (isFocusLost()) onClear();
    else ticked.clear();
  });
  // The counted change's confirm, opened by Review: never by itself.
  const [isReviewing, setReviewing] = useState(false);
  if (isReviewing && !bulkJob.isCounted) setReviewing(false);

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
  const definitionOf = (attributeId: string) => attributes.find((each) => each.id === attributeId);

  const edit = async (recordIds: readonly string[], choice: BulkEditChoice, fromToast = false) => {
    const definition = definitionOf(choice.attributeId);
    // The field was archived or hidden while the dialog was open: nothing is sent.
    if (definition === undefined) {
      return { kind: 'done', updated: 0, unchanged: 0, refused: 0 } satisfies BulkEditResult;
    }
    const result = await data.records.bulkEdit(slug, object.id, recordIds, {
      attributeId: definition.id,
      type: definition.type,
      isMulti: definition.isMulti,
      op: choice.op,
      ...(Object.hasOwn(choice, 'value') ? { value: choice.value } : {}),
    });
    const toast = bulkEditToast(
      result,
      object,
      (undoId) => {
        runUndo(data, toasts, slug, undoId);
      },
      () => {
        void edit(recordIds, choice, true);
      },
      { fromToast },
    );
    if (toast !== undefined) raise(toast);
    return result;
  };

  // The change a counted edit job will make, restated in its confirm (the dialog is gone by then): the field by id,
  // the change and the value, the field read from the attributes when it shows.
  const [jobChange, setJobChange] = useState<BulkEditChoice | undefined>(undefined);

  /** An edit too big for one request starts a job; a refusal to start shows in the dialog that asked. */
  const editAsJob = async (choice: BulkEditChoice): Promise<BulkEditResult> => {
    setJobChange(choice);
    const failure = await start('edit', {
      attributeId: choice.attributeId,
      op: choice.op,
      ...(Object.hasOwn(choice, 'value') ? { value: choice.value } : {}),
    });
    return failure === undefined
      ? { kind: 'done', updated: 0, unchanged: 0, refused: 0 }
      : { kind: 'failed', error: failure };
  };

  // Export N selected (spec 0040): the ticked rows' shown columns as a CSV, read as the member, with the export's
  // one toast. Reading is enough, so it shows on an object the person may only read too. One export per press.
  const exporting = useRef(false);
  const exportButton =
    selection.kind === 'some' && ids.length > 0 && exportColumns.length > 0 ? (
      <Button
        icon="download"
        onPress={() => {
          if (exporting.current) return;
          exporting.current = true;
          void runExport(
            {
              data,
              toasts,
              download: (path) => {
                window.location.assign(path);
              },
            },
            slug,
            recordsWord(ids.length, object),
            { objectId: object.id, attributeIds: exportColumns, recordIds: ids },
          ).finally(() => {
            exporting.current = false;
          });
        }}
      >
        {importStrings.exportSelected(ids.length)}
      </Button>
    ) : undefined;

  const { note, progress, isRunning } = bulkJob;
  // Up while rows are ticked, a change runs or a note shows; then it plays its exit before the grid gives back its room.
  const isWanted = count > 0 || isRunning || note !== undefined;
  const [isBarShown, setBarShown] = useState(isWanted);
  if (isWanted && !isBarShown) setBarShown(true);
  const actions = !canWrite ? (
    // Spec 0009's words for an object the person may only read; the server refuses them anyway.
    <>
      <Callout placement="bar" isAnnounced>
        {bulkStrings.readOnly(object.pluralName)}
      </Callout>
      {exportButton}
    </>
  ) : note?.tone === 'info' ? (
    // A count of zero: said for a moment in the actions' place, while the selection it was for clears.
    <Callout placement="bar" isAnnounced>
      {note.text}
    </Callout>
  ) : (
    <>
      {/* A refused start or a failed change says why before the actions, which stay to try again. */}
      {note !== undefined && (
        <Callout placement="bar" tone="danger">
          {note.text}
        </Callout>
      )}
      <Button
        icon="pencil"
        onPress={() => {
          setEditing({ ids, count });
        }}
      >
        {bulkStrings.edit}
      </Button>
      {exportButton}
      <Button
        variant="danger"
        icon="trash"
        onPress={() => {
          if (path === 'job') {
            void start('delete').then((failure) => {
              if (failure !== undefined) bulkJob.say(refusalSummary(failure), 'danger');
            });
            return;
          }
          // Up to 500 go at once, with Undo in the toast: an undoable delete never asks (30 October 2026).
          remove(ids);
        }}
      >
        {bulkStrings.delete}
      </Button>
    </>
  );
  const bar = isBarShown ? (
    <BulkActionBar
      placement="floating"
      isOpen={isWanted}
      onLeft={() => {
        setBarShown(false);
      }}
      count={count}
      total={total}
      isTotalAtLeast={isTotalAtLeast}
      isAllMatching={selection.kind === 'all-matching'}
      // No action could follow on an object the person may only read, so the offer stays away.
      {...(isRunning || !canWrite ? {} : { onSelectAllMatching: ticked.selectAll })}
      onClear={() => {
        bulkJob.forget();
        onClear();
      }}
      {...(progress === undefined ? {} : { progress })}
      {...(bulkJob.canCancel ? { onCancel: bulkJob.cancel } : {})}
      {...(bulkJob.isCancelling ? { isCancelling: true } : {})}
      {...(bulkJob.isCounted
        ? {
            onReview: () => {
              setReviewing(true);
            },
          }
        : {})}
    >
      {actions}
    </BulkActionBar>
  ) : undefined;

  // The counted job's words, kept while its confirm closes.
  const counted = bulkJob.job?.total ?? 0;
  const [lastCounted, setLastCounted] = useState(counted);
  if (bulkJob.isCounted && counted !== lastCounted) setLastCounted(counted);
  const jobWords = recordsWord(lastCounted, object);
  const isEditJob = bulkJob.action === 'edit';
  const changed = jobChange === undefined ? undefined : definitionOf(jobChange.attributeId);
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
        memberPicker={memberPicker}
        count={editShown.count}
        records={
          selection.kind === 'all-matching' && isTotalAtLeast
            ? bulkStrings.allMatchingRecords(editShown.count, object)
            : recordsWord(editShown.count, object)
        }
        onApply={(choice) =>
          editShown.ids.length > 0 && editShown.ids.length === editShown.count && path === 'inline'
            ? edit(editShown.ids, choice)
            : editAsJob(choice)
        }
      />
      {/*
        A counted background change, opened by Review (AC-528, AC-531): the exact number, and for an edit the value
        it writes. Declining cancels it (nothing was changed); either way focus goes on to the bar, which keeps it.
      */}
      <Modal
        title={isEditJob ? bulkStrings.confirmEditTitle(jobWords) : bulkStrings.confirmTitle(jobWords)}
        variant="confirm"
        tone="danger"
        isOpen={isReviewing && bulkJob.isCounted}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          if (bulkJob.isCounted) bulkJob.cancel();
          setReviewing(false);
        }}
        actions={
          <>
            <Button slot="close">{bulkStrings.cancel}</Button>
            <Button
              variant="danger-solid"
              icon={isEditJob ? 'pencil' : 'trash'}
              onPress={() => {
                setReviewing(false);
                // The selection clears once the job runs on its snapshot; the bar stays with its progress.
                ticked.clear();
                bulkJob.confirm();
              }}
            >
              {isEditJob ? bulkStrings.confirmEditAction(jobWords) : bulkStrings.confirmAction(jobWords)}
            </Button>
          </>
        }
      >
        {isEditJob ? (
          <>
            {jobChange !== undefined && changed !== undefined && (
              <EditChange definition={changed} change={jobChange} members={memberPicker.displays} />
            )}{' '}
            {bulkStrings.confirmEditText}
          </>
        ) : (
          bulkStrings.confirmText
        )}
      </Modal>
    </>
  );
  return { bar, dialog };
}

/**
 * What a counted edit job will write, in words around the value drawn by its
 * field's one display (AC-529): "Sets Stage to [Won] on each of them."
 */
function EditChange({
  definition,
  change,
  members,
}: {
  readonly definition: AttributeDefinition;
  readonly change: BulkEditChoice;
  /** The workspace's members, so a member value shows by name ("Set Owner to Ada Lovelace"). */
  readonly members: MemberPicker['displays'];
}) {
  if (definition.type === 'checkbox') return <>{bulkStrings.describeCheck(definition.title, change.value === true)}</>;
  const words = bulkStrings.describeChange(definition.title, change.op);
  if ('whole' in words) return <>{words.whole}</>;
  return (
    <>
      {words.before}{' '}
      <AttributeDisplay
        attribute={toFieldAttribute(definition)}
        value={change.value ?? null}
        {...(definition.type === 'actor_reference' ? { display: members } : {})}
        surface="panel"
      />{' '}
      {words.after}
    </>
  );
}
