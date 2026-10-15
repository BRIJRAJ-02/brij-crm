// Brief
// Purpose: act on the rows ticked in an object's table: how many, and Delete (spec 0022, milestone 1).
// Main task: tick rows, press Delete (one goes at once, several after a confirm), and undo it from the toast or ⌘Z.
// Leaves out: Edit (milestone 2), "Select all matching" and anything over 500 records (background jobs, milestone 3).
import type { ObjectSummary, RecordsView } from '@crm/data';
import { BulkActionBar, Button, Callout, Modal } from '@crm/ui';
import { noRows, selectedCount, type GridSelection } from '@crm/ui/grid';
import { useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { bulkStrings, deleteOffer, deleteToast, needsConfirm, recordsWord } from './bulk.ts';
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
 * state) leave it.
 */
export function useTableSelection(view: RecordsView, gone: ReadonlySet<string>): TableSelection {
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

/** Props for the table's bulk bar. */
export interface BulkDeleteBarProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly selection: GridSelection;
  /** How many records the view holds, for the bar. */
  readonly total: number;
  readonly onClear: () => void;
  /** The delete went out: the rows left, so the table takes focus back at the first of them (`index`). */
  readonly onDeleting: (recordIds: readonly string[]) => void;
}

/**
 * The floating bar while rows are ticked: the count, Delete (or why not),
 * and Clear; Delete of several asks first, in a danger confirm, and every
 * delete ends in one toast with Undo.
 */
export function BulkDeleteBar({ slug, object, selection, total, onClear, onDeleting }: BulkDeleteBarProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  // The ids the confirm asks about, kept while it plays its exit.
  const [asking, setAsking] = useState<readonly string[] | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<readonly string[]>([]);
  if (asking !== undefined && asking !== lastAsked) setLastAsked(asking);
  const count = selectedCount(selection, total);
  const ids = selection.kind === 'some' ? [...selection.ids] : [];

  const remove = (recordIds: readonly string[]) => {
    onDeleting(recordIds);
    onClear();
    data.records.deleteMany(slug, object.id, recordIds).then(
      (result) => {
        const toast = deleteToast(result, object, (undoId) => {
          runUndo(data, toasts, slug, undoId);
        });
        if (toast !== undefined) toasts.toast(toast);
      },
      // The records layer failed to load; nothing left the table.
      () => {
        toasts.toast({ tone: 'danger', message: bulkStrings.somethingWrong });
      },
    );
  };

  const shownAsk = asking ?? lastAsked;
  const words = recordsWord(shownAsk.length, object);
  return (
    <>
      {count > 0 && (
        <BulkActionBar placement="floating" count={count} total={total} onClear={onClear}>
          {object.access !== 'write' ? (
            // Spec 0009's words for an object the person may only read; the server refuses them anyway.
            <Callout placement="bar">{bulkStrings.readOnly(object.pluralName)}</Callout>
          ) : deleteOffer(count) === 'too-many' ? (
            <Callout placement="bar">{bulkStrings.tooMany}</Callout>
          ) : (
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
          )}
        </BulkActionBar>
      )}
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
              variant="danger"
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
}
