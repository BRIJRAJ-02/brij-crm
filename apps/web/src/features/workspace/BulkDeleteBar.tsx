// Brief
// Purpose: act on the rows ticked in an object's table: how many, Edit and Delete (spec 0022, milestones 1 and 2).
// Main task: tick rows, press Edit (one field on all of them) or Delete (one at once, several after a confirm), undo from the toast or ⌘Z.
// Leaves out: "Select all matching" and anything over 500 records (background jobs, milestone 3).
import type { AttributeDefinition, ObjectSummary, RecordsView, ViewState } from '@crm/data';
import { BulkActionBar, Button, Callout, Modal } from '@crm/ui';
import { noRows, selectedCount, type GridSelection } from '@crm/ui/grid';
import { useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BulkEditDialog, type BulkEditChoice } from './BulkEditDialog.tsx';
import { bulkStrings, deleteOffer, deleteToast, editToast, needsConfirm, recordsWord } from './bulk.ts';
import { runUndo } from './useUndoShortcut.ts';

/** A table's ticked rows, and what changes them. */
export interface TableSelection {
  readonly selection: GridSelection;
  readonly setSelection: (selection: GridSelection) => void;
  readonly clear: () => void;
}

/**
 * The rows ticked in a table (spec 0022, AC-522): UI state, held by the
 * screen for the view it shows, so any new view (a sort, a filter, another
 * view, someone else's saved change to it) starts with nothing ticked; rows
 * gone on the server (deleted or hidden elsewhere, `gone` from the view's
 * state) leave it. After a reload for changes too many to name (a coarse
 * delete elsewhere), the ticked rows are read again, and the gone ones leave.
 */
export function useTableSelection(view: RecordsView, state: Pick<ViewState, 'gone' | 'reloads'>): TableSelection {
  const { gone, reloads } = state;
  const [held, setHeld] = useState<{ readonly view: RecordsView; readonly selection: GridSelection }>(() => ({
    view,
    selection: noRows(),
  }));
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
  return {
    selection,
    setSelection: (next) => {
      setHeld({ view, selection: next });
    },
    clear: () => {
      setHeld({ view, selection: noRows() });
    },
  };
}

/** What the table's bulk actions hand the screen. */
export interface BulkDelete {
  /** The floating bar while rows are ticked (the DataGrid's `floatingBar`), or nothing. */
  readonly bar: ReactNode;
  /** The delete confirm and the edit dialog: always mounted, so they play their exits. */
  readonly dialog: ReactNode;
}

/** What the table's bulk delete needs. */
export interface BulkDeleteOptions {
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The object's attributes: what the edit dialog offers (AC-529). */
  readonly attributes: readonly AttributeDefinition[];
  readonly selection: GridSelection;
  /** How many records the view holds, for the bar. */
  readonly total: number;
  /** Clear or Esc in the bar: the screen clears the selection and takes focus back to the table. */
  readonly onClear: () => void;
  /** The delete went out: the rows left, so the table takes focus back where the first of them was. */
  readonly onDeleting: (recordIds: readonly string[]) => void;
}

/**
 * The floating bar while rows are ticked: the count, Delete (or why not),
 * and Clear; Delete of several asks first, in a danger confirm, and every
 * delete ends in one toast with Undo.
 */
export function useBulkDelete({
  slug,
  object,
  attributes,
  selection,
  total,
  onClear,
  onDeleting,
}: BulkDeleteOptions): BulkDelete {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // The ids the confirm asks about, kept while it plays its exit.
  const [asking, setAsking] = useState<readonly string[] | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<readonly string[]>([]);
  if (asking !== undefined && asking !== lastAsked) setLastAsked(asking);
  const count = selectedCount(selection, total);
  const ids = selection.kind === 'some' ? [...selection.ids] : [];
  // The one delete toast with Undo this table keeps: a newer delete closes it, so no dead Undo piles up.
  const lastToast = useRef<string | undefined>(undefined);

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
        if (toast === undefined) return;
        if (lastToast.current !== undefined) toasts.dismiss(lastToast.current);
        lastToast.current = toasts.toast(toast);
      },
      // The records layer failed to load; nothing left the table.
      () => {
        toasts.toast({ tone: 'danger', message: bulkStrings.somethingWrong });
      },
    );
  };

  // The ids the edit dialog changes, fixed when it opens, so a row leaving meanwhile doesn't change what Apply says.
  const [editing, setEditing] = useState<readonly string[] | undefined>(undefined);
  const [lastEdited, setLastEdited] = useState<readonly string[]>([]);
  if (editing !== undefined && editing !== lastEdited) setLastEdited(editing);
  const lastEditToast = useRef<string | undefined>(undefined);

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
    if (toast !== undefined) {
      if (lastEditToast.current !== undefined) toasts.dismiss(lastEditToast.current);
      lastEditToast.current = toasts.toast(toast);
    }
    return result;
  };

  const shownAsk = asking ?? lastAsked;
  const words = recordsWord(shownAsk.length, object);
  const bar =
    count === 0 ? undefined : (
      <BulkActionBar placement="floating" count={count} total={total} onClear={onClear}>
        {object.access !== 'write' ? (
          // Spec 0009's words for an object the person may only read; the server refuses them anyway.
          <Callout placement="bar" isAnnounced>
            {bulkStrings.readOnly(object.pluralName)}
          </Callout>
        ) : deleteOffer(count) === 'too-many' ? (
          <Callout placement="bar" isAnnounced>
            {bulkStrings.tooMany}
          </Callout>
        ) : (
          <>
            <Button
              icon="pencil"
              onPress={() => {
                setEditing(ids);
              }}
            >
              {bulkStrings.edit}
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onPress={() => {
                if (needsConfirm(ids.length)) setAsking(ids);
                else remove(ids);
              }}
            >
              {bulkStrings.delete}
            </Button>
          </>
        )}
      </BulkActionBar>
    );
  const editIds = editing ?? lastEdited;
  const dialog = (
    <>
      <BulkEditDialog
        isOpen={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        object={object}
        attributes={attributes}
        count={editIds.length}
        onApply={(choice) => edit(editIds, choice)}
      />
      <Modal
        title={bulkStrings.confirmTitle(words)}
        tone="danger"
        isOpen={asking !== undefined}
        onOpenChange={(open) => {
          if (!open) setAsking(undefined);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {bulkStrings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              icon="trash"
              onPress={() => {
                const confirmed = asking;
                setAsking(undefined);
                if (confirmed !== undefined) remove(confirmed);
              }}
            >
              {bulkStrings.confirmAction(words)}
            </Button>
          </>
        }
      >
        {bulkStrings.confirmText}
      </Modal>
    </>
  );
  return { bar, dialog };
}
