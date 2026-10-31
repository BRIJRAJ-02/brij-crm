// Brief
// Purpose: the lists a record is in, in its page's Details sidebar (spec 0048, AC-4822 to AC-4824).
// Main task: see each entry's fields and edit them in place, add the record to a list, take it out of one with Undo.
// Leaves out: the list's own table (Open list goes there), and lists the member can't read (absent, with no gap).
import {
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type EntriesLayer,
  type ListRow,
  type ListView,
  type MemberSummary,
  type ObjectSummary,
  type RecordEntries,
  type RecordRefDisplay,
} from '@crm/data';
import { useRecordEntries } from '@crm/data/react';
import {
  AttributeList,
  Button,
  Disclosure,
  EmptyState,
  Menu,
  MenuItem,
  MenuTrigger,
  Skeleton,
  Tooltip,
  type Toasts,
} from '@crm/ui';
import { useMemo } from 'react';
import { useMemberPicker } from '../records/members.ts';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { AddToListMenu, listsToAddTo } from './AddToListMenu.tsx';
import { listHref } from './paths.ts';
import { strings } from './strings.ts';
import { useListFields } from './useListFields.ts';

/** Props for the record page's Lists section. */
export interface RecordListsProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly recordId: string;
  /** The record's name, for the Toasts. */
  readonly record: RecordRefDisplay | undefined;
  /** The live lists over the object the member may read, in the workspace's order. */
  readonly lists: readonly ListView[];
  readonly layer: EntriesLayer;
  readonly source: RecordEntries;
  readonly members: readonly MemberSummary[];
}

/** The fields a card shows: the list's own, and when the entry was added. */
const cardFields = (fields: readonly AttributeDefinition[]) =>
  fields.filter((field) => !field.isArchived && (!field.isSystem || field.title === 'Added'));

/** One entry's card: the list's fields through the field set, edited in place (AC-4822, AC-4824). */
function EntryCard({
  data,
  toasts,
  slug,
  list,
  row,
  layer,
  members,
  recordName,
}: {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly list: ListView;
  readonly row: ListRow;
  readonly layer: EntriesLayer;
  readonly members: readonly MemberSummary[];
  readonly recordName: string;
}) {
  const fields = useListFields(data, slug, list);
  const memberPicker = useMemberPicker(members);
  const shown = useMemo(() => cardFields(fields ?? []), [fields]);
  const byId = useMemo(() => new Map(shown.map((field) => [field.id, field] as const)), [shown]);
  const remove = () => {
    void layer.remove(slug, list, [row.id]).then((outcome) => {
      if (outcome.removed === 0) {
        toasts.toast({ tone: 'danger', message: outcome.reason ?? strings.removeFailed });
        return;
      }
      const { undoId } = outcome;
      toasts.toast({
        tone: 'success',
        message: strings.removedOne(recordName, list.name),
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
    });
  };
  if (fields === undefined) return <Skeleton lines={2} />;
  const items = shown.map((field) => ({
    attribute: toFieldAttribute(field),
    value: row.values[field.id] ?? null,
    ...(field.type === 'actor_reference' ? { display: memberPicker.displays } : {}),
  }));
  // The list's name heads its entry with the entry's menu at the end of that line, rather than alone under the fields.
  return (
    <Disclosure
      key={row.id}
      title={list.name}
      variant="label"
      defaultExpanded
      actions={
        <MenuTrigger>
          <Button variant="ghost" icon="ellipsis" label={strings.entryActions(list.name)} />
          <Menu
            label={strings.entryActions(list.name)}
            onAction={(key) => {
              if (key === 'remove') remove();
            }}
          >
            <MenuItem id="open" icon="arrow-right" href={listHref(slug, list)}>
              {strings.openList}
            </MenuItem>
            {list.canWrite ? (
              <MenuItem id="remove" icon="minus">
                {strings.removeSelected}
              </MenuItem>
            ) : null}
          </Menu>
        </MenuTrigger>
      }
    >
      <AttributeList
        label={list.name}
        sections={[{ id: row.id, items }]}
        emptyValues="fold"
        editorProps={(attribute) => (byId.get(attribute.id)?.type === 'actor_reference' ? memberPicker.extras : {})}
        {...(list.canWrite
          ? {
              onCommit: (attributeId: string, value: unknown) => {
                const field = byId.get(attributeId);
                if (field !== undefined)
                  void layer.setCell(slug, list, row.id, { id: field.id, title: field.title }, value);
              },
            }
          : {})}
      />
    </Disclosure>
  );
}

/** The Lists section: a ruled section like the related ones, one entry per list, ordered by the server (list name, then Added), and Add to list. */
export function RecordLists({
  data,
  toasts,
  slug,
  object,
  recordId,
  record,
  lists,
  layer,
  source,
  members,
}: RecordListsProps) {
  const state = useRecordEntries(source);
  const byId = useMemo(() => new Map(lists.map((list) => [list.id, list] as const)), [lists]);
  const writable = listsToAddTo(lists, object.id);
  const inLists = useMemo(() => new Set(state.rows.map((row) => row.entry.listId)), [state.rows]);
  const rows = state.rows.filter((row) => byId.has(row.entry.listId));
  // A ruled section like each related object's under it, not a card of its own (one sidebar, one section shape).
  return (
    <Disclosure
      title={strings.listsSection}
      isRuled
      defaultExpanded
      {...(state.status === 'loading' ? {} : { count: rows.length })}
      {...(writable.length === 0
        ? {}
        : {
            actions: (
              <AddToListMenu
                data={data}
                toasts={toasts}
                slug={slug}
                object={object}
                lists={writable}
                recordIds={[recordId]}
                record={record}
                inLists={inLists}
              >
                <Tooltip content={strings.addToListMenu}>
                  <Button variant="ghost" icon="plus" label={strings.addToListMenu} />
                </Tooltip>
              </AddToListMenu>
            ),
          })}
    >
      {state.status === 'loading' ? (
        <Skeleton lines={2} />
      ) : rows.length === 0 ? (
        <EmptyState title={strings.notInAny} layout="row" />
      ) : (
        rows.map((row) => {
          const list = byId.get(row.entry.listId);
          return list === undefined ? null : (
            <EntryCard
              key={row.id}
              data={data}
              toasts={toasts}
              slug={slug}
              list={list}
              row={row}
              layer={layer}
              members={members}
              recordName={record?.name ?? ''}
            />
          );
        })
      )}
    </Disclosure>
  );
}
