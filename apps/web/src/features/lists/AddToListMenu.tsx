// Brief
// Purpose: put one record, or the ticked ones, in a list (spec 0048, AC-4823, AC-4825).
// Main task: press Add to list, pick the list; one record goes in at once, many go in one request with Undo.
// Leaves out: a search box (a menu of the lists the member may write), and "all matching" selections (ticked rows only).
import type {
  AttributeDefinition,
  DataLayer,
  EntriesLayer,
  ListView,
  ObjectSummary,
  RecordRefDisplay,
} from '@crm/data';
import { Menu, MenuItem, MenuTrigger, type Toasts } from '@crm/ui';
import { useState, type ReactElement } from 'react';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { AddEntryModal } from './AddEntryModal.tsx';
import { strings } from './strings.ts';

/** Props for the Add to list menu. */
export interface AddToListMenuProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly object: ObjectSummary;
  /** The live lists over the object the member may write (`listsToAddTo`). */
  readonly lists: readonly ListView[];
  /** The records to add: one, or the ticked rows (up to 10,000). */
  readonly recordIds: readonly string[];
  /** With one record, how it shows in a toast and in the dialog that asks for a required field. */
  readonly record?: RecordRefDisplay | undefined;
  /** The ids of lists that already hold the record (one record only): an "Each record once" one shows disabled. */
  readonly inLists?: ReadonlySet<string> | undefined;
  /** The button that opens the menu (a Button, with its own label). */
  readonly children: ReactElement;
  /** Something was added: a table clears its ticks. */
  readonly onAdded?: (() => void) | undefined;
}

/** The lists over an object a member may add to, in the order the workspace shows them. */
export function listsToAddTo(lists: readonly ListView[], objectId: string): readonly ListView[] {
  return lists.filter((list) => list.objectId === objectId && !list.isArchived && list.canWrite);
}

/** A list's required fields, which a single add must ask for (AC-4823). */
const requiredOf = (fields: readonly AttributeDefinition[]) =>
  fields.filter((field) => field.isRequired && !field.isSystem && !field.isArchived);

/**
 * "Add to list": a Menu of the lists (AC-4823). One record whose list has no required field goes in at once; one
 * whose list has one opens the small dialog that asks for it; several go in one request (500 a call), with a Toast
 * naming how many went in and how many were already there, and Undo for exactly the entries made (AC-4825).
 */
export function AddToListMenu({
  data,
  toasts,
  slug,
  object,
  lists,
  recordIds,
  record,
  inLists,
  children,
  onAdded,
}: AddToListMenuProps) {
  const [asking, setAsking] = useState<
    | {
        readonly list: ListView;
        readonly fields: readonly AttributeDefinition[];
        readonly layer: EntriesLayer;
      }
    | undefined
  >(undefined);

  const addOne = async (list: ListView, recordId: string) => {
    const layer = await data.lists.entries();
    const outcome = await layer.add(slug, list, recordId);
    if (outcome.kind === 'refused') {
      toasts.toast({ tone: 'danger', message: outcome.message });
      return;
    }
    toasts.toast({ tone: 'success', message: strings.added(record?.name ?? '', list.name) });
    onAdded?.();
  };

  const addMany = async (list: ListView) => {
    const layer = await data.lists.entries();
    const outcome = await layer.addMany(slug, list, recordIds);
    if (outcome.added === 0) {
      toasts.toast(
        outcome.alreadyIn > 0 && outcome.refused === 0
          ? { tone: 'info', message: strings.allAlreadyIn(list.name) }
          : {
              tone: 'danger',
              message: outcome.reason === undefined ? strings.addFailed : strings.noneAdded(outcome.reason),
            },
      );
      return;
    }
    const said = strings.addedMany(outcome.added, list.name);
    const { undoId } = outcome;
    toasts.toast({
      tone: 'success',
      message: outcome.alreadyIn > 0 ? strings.addedManyKept(said, outcome.alreadyIn) : said,
      ...(undoId === undefined
        ? {}
        : {
            action: {
              label: strings.undo,
              onAction: () => {
                runUndo(data, toasts, slug, undoId);
              },
            },
          }),
    });
    onAdded?.();
  };

  const choose = async (list: ListView) => {
    const [only] = recordIds;
    if (only === undefined) return;
    if (recordIds.length > 1) {
      await addMany(list);
      return;
    }
    const fields = await data.lists.fields(slug, list).catch(() => [] as readonly AttributeDefinition[]);
    if (requiredOf(fields).length > 0) {
      setAsking({ list, fields, layer: await data.lists.entries() });
      return;
    }
    await addOne(list, only);
  };

  return (
    <>
      <MenuTrigger>
        {children}
        <Menu
          label={strings.addToListMenu}
          onAction={(key) => {
            const list = lists.find((each) => each.id === key);
            if (list !== undefined) void choose(list);
          }}
        >
          {lists.map((list) => {
            const isIn = !list.allowsDuplicates && inLists?.has(list.id) === true;
            return (
              <MenuItem
                key={list.id}
                id={list.id}
                icon={list.icon}
                isDisabled={isIn}
                {...(isIn ? { meta: strings.alreadyInShort } : {})}
              >
                {list.name}
              </MenuItem>
            );
          })}
        </Menu>
      </MenuTrigger>
      {asking !== undefined && (
        <AddEntryModal
          data={data}
          entries={asking.layer}
          toasts={toasts}
          slug={slug}
          list={asking.list}
          object={object}
          fields={asking.fields}
          record={record}
          isOpen
          onClose={() => {
            setAsking(undefined);
          }}
        />
      )}
    </>
  );
}
