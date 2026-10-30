// Brief
// Purpose: one list's entries (spec 0048, AC-4806 to AC-4821), as a table or a board, under the list's name and tile.
// Main task: add records, edit the list's fields in place, move cards between stages, take entries out with Undo.
// Leaves out: filters and saved sorts (the object's Toolbar), bulk Edit (milestone 3), settings, archive and import
// (milestone 4).
import {
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type EntriesLayer,
  type ListRow,
  type ListView,
  type MemberSummary,
  type NameState,
  type ObjectSummary,
  type RecordRef,
  type RecordRefDisplay,
  type SavedViewSource,
  type View,
  type ViewsListSource,
} from '@crm/data';
import { useEntries, useListBoard, useSavedView, useViewsList } from '@crm/data/react';
import {
  Badge,
  Board,
  BulkActionBar,
  Button,
  EmptyState,
  Modal,
  TopBar,
  ViewBar,
  arraySource,
  type BoardCard,
  type BoardColumn,
  type Toasts,
} from '@crm/ui';
import { columnWidthFor, DataGrid, noRows, type GridColumn, type GridSelection } from '@crm/ui/grid';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { refsOf } from '../records/details.ts';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { AddEntryModal } from './AddEntryModal.tsx';
import { strings } from './strings.ts';

/** Props for the list screen: what the list's route loaded through the data layer. */
export interface ListScreenProps {
  readonly data: DataLayer;
  readonly toasts: Toasts;
  readonly slug: string;
  readonly list: ListView;
  readonly object: ObjectSummary;
  /** The list's own fields, Added and Added by first. */
  readonly fields: readonly AttributeDefinition[];
  /** The object's live fields. */
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly entries: EntriesLayer;
  /** The open view as the loader read it, and its source, which a layout change (Table or Board) moves at once. */
  readonly view: View;
  readonly viewSource: SavedViewSource;
  readonly viewsSource: ViewsListSource;
}

/** How a linked record shows while its name loads, or when it can't be read (as the object's table shows it). */
function displayOf(ref: RecordRef, state: NameState): RecordRefDisplay {
  if (state === 'loading') return { ...ref, name: '', kind: 'other' };
  if (state === 'unknown') return { ...ref, name: workspaceStrings.unavailableRecord, kind: 'other' };
  return state;
}

/** A field as the field set draws it here: a reference that can't link says why, and its object names the field. */
const fieldOf = (definition: AttributeDefinition, object: ObjectSummary) =>
  toFieldAttribute(definition, workspaceStrings.referenceReadOnly, object.standardKey ?? object.apiSlug);

/** The kinds a board groups a list by (decision 10): a status or a single select, of the list or of its object. */
const groupable = (field: AttributeDefinition) =>
  !field.isArchived && !field.isSystem && (field.type === 'status' || (field.type === 'select' && !field.isMulti));

/** The list screen: its TopBar, its views, and the table or board the open view is. */
export function ListScreen(given: ListScreenProps) {
  const saved = useSavedView(given.viewSource).view;
  const views = useViewsList(given.viewsSource).views;
  const props = { ...given, view: saved?.id === given.view.id ? saved : given.view };
  const { data, slug, list, object, fields, attributes, view } = props;
  const navigate = useNavigate();
  const [adding, setAdding] = useState<{ readonly preset?: Readonly<Record<string, unknown>> } | undefined>();
  const [isAddingField, setAddingField] = useState(false);
  const listFields = fields.filter((field) => !field.isArchived);
  const ownIds = new Set(listFields.map((field) => field.id));
  const groupFields = [...listFields.filter(groupable), ...attributes.filter(groupable)];
  const groupBy = view.config.board?.groupByAttributeId ?? groupFields[0]?.id;
  const kind = view.kind;
  const canWrite = list.canWrite;
  const addLabel = strings.add(object.singularName);

  const switchLayout = (next: string) => {
    if (next !== 'table' && next !== 'board') return;
    const board =
      next === 'board' && view.config.board === undefined && groupBy !== undefined
        ? { groupByAttributeId: groupBy, cardFields: [], showEmptyColumns: true }
        : view.config.board;
    data.views.setLayout(slug, view.id, {
      kind: next,
      columns: view.config.columns,
      pinnedCount: view.config.pinnedCount,
      ...(board === undefined ? {} : { board }),
    });
  };

  return (
    <WorkspacePage
      page={{
        topBar: (
          <TopBar title={list.name} icon={list.icon} hue={list.hue} meta={<Badge text={object.pluralName} />}>
            {canWrite && (
              <Button
                variant="primary"
                icon="plus"
                onPress={() => {
                  setAdding({});
                }}
              >
                {addLabel}
              </Button>
            )}
          </TopBar>
        ),
        viewBar: (
          <ViewBar
            views={views.map((each) => ({
              id: each.id,
              name: each.name,
              icon: each.kind === 'board' ? 'kanban' : 'table',
            }))}
            currentViewId={view.id}
            onViewChange={(viewId) => {
              void navigate({
                to: '/w/$slug/lists/$list/views/$viewId',
                params: { slug, list: list.apiSlug, viewId },
              });
            }}
            layout={{
              label: strings.layout,
              segments: [
                { value: 'table', label: strings.table, icon: 'table' },
                { value: 'board', label: strings.board, icon: 'kanban' },
              ],
              value: kind,
              onChange: switchLayout,
            }}
          />
        ),
        body: (
          <>
            {kind === 'board' ? (
              <ListBoardBody
                {...props}
                groupFields={groupFields}
                groupBy={groupBy}
                ownIds={ownIds}
                onAdd={(preset) => {
                  setAdding({ preset });
                }}
                onAddField={() => {
                  setAddingField(true);
                }}
              />
            ) : (
              <ListTable
                {...props}
                listFields={listFields}
                ownIds={ownIds}
                onAdd={() => {
                  setAdding({});
                }}
                onAddField={() => {
                  setAddingField(true);
                }}
              />
            )}
            <AddEntryModal
              data={data}
              entries={props.entries}
              toasts={props.toasts}
              slug={slug}
              list={list}
              object={object}
              fields={listFields}
              preset={adding?.preset}
              isOpen={adding !== undefined}
              onClose={() => {
                setAdding(undefined);
              }}
            />
            {list.canManage && (
              <AttributeDialog
                slug={slug}
                objectId={object.id}
                isOpen={isAddingField}
                members={props.members}
                canManage
                onCreate={(input) => data.lists.createField(slug, list, input)}
                onClose={() => {
                  setAddingField(false);
                }}
                onSaved={(attribute) => {
                  setAddingField(false);
                  props.toasts.toast({ tone: 'success', message: strings.fieldAdded(attribute.title) });
                }}
              />
            )}
          </>
        ),
      }}
    />
  );
}

/** What the table and the board share beyond the screen's props. */
interface BodyProps extends ListScreenProps {
  /** The list's own field ids: a cell of one writes the entry, any other the record. */
  readonly ownIds: ReadonlySet<string>;
  readonly onAddField: () => void;
}

/** Writes one cell of a row: a list field to its entry (AC-4810), an object field to the record. */
function writeCell(props: BodyProps, entryId: string, columnId: string, value: unknown) {
  const { data, entries, slug, list, fields, ownIds } = props;
  if (ownIds.has(columnId)) {
    const field = fields.find((each) => each.id === columnId);
    if (field !== undefined) void entries.setCell(slug, list, entryId, { id: field.id, title: field.title }, value);
    return;
  }
  const recordId = entries.rowOf(entryId)?.recordId;
  if (recordId !== undefined) data.records.setValue(slug, { rowId: recordId, columnId, value });
}

/** The table (AC-4807 to AC-4812, AC-4817): the record first and pinned, then the list's fields and Added. */
function ListTable(
  props: BodyProps & { readonly listFields: readonly AttributeDefinition[]; readonly onAdd: () => void },
) {
  const { slug, list, object, attributes, listFields, entries, view, data, toasts, onAdd, onAddField } = props;
  const navigate = useNavigate();
  const primaryId = object.primaryAttributeId ?? attributes[0]?.id ?? '';
  const [sorts, setSorts] = useState(view.config.sorts);
  const shownIds = useMemo(() => {
    const own = listFields.filter((field) => !field.isSystem || field.title === 'Added').map((field) => field.id);
    const stored = view.config.columns.map((column) => column.attributeId);
    const known = new Set([primaryId, ...listFields.map((field) => field.id), ...attributes.map((field) => field.id)]);
    const base = stored.length === 0 ? [primaryId, ...own] : stored.filter((id) => known.has(id));
    const missing = view.config.showNewAttributes ? own.filter((id) => !base.includes(id)) : [];
    return [...new Set([primaryId, ...base, ...missing])];
  }, [attributes, listFields, primaryId, view.config.columns, view.config.showNewAttributes]);
  const definitions = useMemo(
    () => new Map([...attributes, ...listFields].map((field) => [field.id, field] as const)),
    [attributes, listFields],
  );
  const columns = useMemo(
    () =>
      shownIds.flatMap((id): GridColumn[] => {
        const definition = definitions.get(id);
        if (definition === undefined) return [];
        const attribute = fieldOf(definition, object);
        const stored = view.config.columns.find((column) => column.attributeId === id);
        return [
          {
            id,
            attribute,
            width: stored?.width ?? columnWidthFor(attribute),
            ...(stored?.isHidden === true ? { isHidden: true } : {}),
          },
        ];
      }),
    [definitions, object, shownIds, view.config.columns],
  );
  const recordAttributeIds = useMemo(() => shownIds.filter((id) => !props.ownIds.has(id)), [props.ownIds, shownIds]);
  const source = useMemo(
    () => entries.view(slug, list, { sorts }, recordAttributeIds),
    [entries, list, recordAttributeIds, slug, sorts],
  );
  const state = useEntries(source);
  const [selection, setSelection] = useState<GridSelection>(noRows);
  const [confirming, setConfirming] = useState<readonly string[] | undefined>();
  const ticked = selection.kind === 'some' ? [...selection.ids] : [];
  const memberDisplays = useMemo(() => toActorDisplays(props.members), [props.members]);
  const actorIds = useMemo(
    () =>
      new Set([...definitions.values()].filter((field) => field.type === 'actor_reference').map((field) => field.id)),
    [definitions],
  );
  const referenceIds = useMemo(
    () =>
      new Set([...definitions.values()].filter((field) => field.type === 'record_reference').map((field) => field.id)),
    [definitions],
  );

  const remove = (entryIds: readonly string[]) => {
    setSelection(noRows());
    void entries.remove(slug, list, entryIds).then((outcome) => {
      if (outcome.removed === 0) {
        toasts.toast({ tone: 'danger', message: outcome.reason ?? strings.removeFailed });
        return;
      }
      const first = entryIds.length === 1 ? entries.rowOf(entryIds[0] ?? '')?.display?.name : undefined;
      const said =
        first === undefined ? strings.removedMany(outcome.removed, list.name) : strings.removedOne(first, list.name);
      const undoId = outcome.undoId;
      toasts.toast({
        tone: outcome.kept === 0 ? 'success' : 'danger',
        message: outcome.kept === 0 ? said : strings.keptSome(said, outcome.kept, outcome.reason ?? ''),
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

  const hidden = attributes.filter((field) => !shownIds.includes(field.id) && !field.isSystem && !field.isArchived);
  return (
    <>
      <DataGrid<ListRow>
        label={list.name}
        columns={columns}
        pinnedCount={Math.max(1, view.config.pinnedCount)}
        rows={state.source}
        status={state.status}
        onRetry={source.retry}
        errorText={strings.failed}
        getValue={(row, columnId) => row.values[columnId] ?? null}
        getDisplay={(row, columnId) => {
          if (actorIds.has(columnId)) return memberDisplays;
          if (!referenceIds.has(columnId)) return undefined;
          // The linked records' names, read by the data layer, as the object's table shows them.
          const refs = refsOf(row.values[columnId]);
          if (refs.length === 0) return undefined;
          const names = state.referenceDisplays(refs);
          return refs.map((ref, index) => displayOf(ref, names[index] ?? 'loading'));
        }}
        rowHeader={primaryId}
        untitled={strings.unnamed(object.singularName)}
        rowNotes={state.rowNotes}
        cellErrors={state.cellErrors}
        footer={{
          [primaryId]: strings.count(
            `${state.count.count.toLocaleString('en')}${state.count.atLeast ? '+' : ''}`,
            state.count.count === 1 && !state.count.atLeast,
          ),
        }}
        {...(list.canWrite ? { addRow: { label: strings.add(object.singularName), onAdd } } : {})}
        emptyState={
          <EmptyState
            icon={list.icon}
            title={strings.empty(object.pluralName)}
            {...(list.canWrite
              ? {
                  actions: (
                    <Button icon="plus" onPress={onAdd}>
                      {strings.add(object.singularName)}
                    </Button>
                  ),
                }
              : {})}
          />
        }
        selection={selection}
        onSelectionChange={setSelection}
        floatingBar={
          list.canWrite && ticked.length > 0 ? (
            <BulkActionBar
              placement="floating"
              isOpen
              count={ticked.length}
              total={state.count.count}
              onClear={() => {
                setSelection(noRows());
              }}
            >
              <Button
                icon="minus"
                onPress={() => {
                  // One entry goes at once, with Undo; two or more ask first (decision 9).
                  if (ticked.length === 1) remove(ticked);
                  else setConfirming(ticked);
                }}
              >
                {strings.removeSelected}
              </Button>
            </BulkActionBar>
          ) : undefined
        }
        onRowOpen={(entryId) => {
          const recordId = entries.rowOf(entryId)?.recordId;
          if (recordId === undefined) return;
          void navigate({
            to: '/w/$slug/objects/$object/$recordId/$tab',
            params: { slug, object: object.apiSlug, recordId, tab: 'overview' },
          });
        }}
        onSort={(columnId, direction) => {
          setSorts([{ attributeId: columnId, direction }]);
        }}
        {...(sorts[0] === undefined ? {} : { sort: { columnId: sorts[0].attributeId, direction: sorts[0].direction } })}
        onColumnsChange={(next, pinnedCount) => {
          data.views.setLayout(slug, view.id, {
            columns: next.map((column) => ({
              attributeId: column.id,
              width: column.width,
              ...(column.isHidden === true ? { isHidden: true } : {}),
            })),
            pinnedCount,
          });
        }}
        onCellChange={(change) => {
          writeCell(props, change.rowId, change.columnId, change.value);
        }}
        onCellsChange={(changes) => {
          for (const change of changes) writeCell(props, change.rowId, change.columnId, change.value);
        }}
        {...(list.canManage
          ? {
              onAddColumn: onAddField,
              addColumnLabel: strings.addField,
              addColumnItems: hidden.map((field) => ({ id: field.id, label: field.title })),
              onAddColumnItem: (id: string) => {
                data.views.setLayout(slug, view.id, {
                  columns: [...shownIds, id].map((attributeId) => ({ attributeId })),
                  pinnedCount: view.config.pinnedCount,
                });
              },
            }
          : {})}
      />
      <Modal
        title={strings.removeTitle(confirming?.length ?? 0, list.name)}
        isOpen={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                const ids = confirming ?? [];
                setConfirming(undefined);
                remove(ids);
              }}
            >
              {strings.remove}
            </Button>
          </>
        }
      >
        {strings.removeText}
      </Modal>
    </>
  );
}

/** The board (AC-4815, AC-4820, AC-4821): a column per option of the grouping field, cards moved between them. */
function ListBoardBody(
  props: BodyProps & {
    readonly groupFields: readonly AttributeDefinition[];
    readonly groupBy: string | undefined;
    readonly onAdd: (preset: Readonly<Record<string, unknown>>) => void;
  },
) {
  const { list, groupFields, groupBy, onAddField } = props;
  const field = groupFields.find((each) => each.id === groupBy);
  if (field === undefined) {
    return (
      <EmptyState
        icon="kanban"
        title={strings.noGroupField(list.name)}
        {...(list.canManage
          ? {
              actions: (
                <Button icon="plus" onPress={onAddField}>
                  {strings.addField}
                </Button>
              ),
            }
          : {})}
      />
    );
  }
  return <ListBoardColumns {...props} field={field} />;
}

/** The board's columns once it has a field to group by. */
function ListBoardColumns(
  props: BodyProps & {
    readonly field: AttributeDefinition;
    readonly onAdd: (preset: Readonly<Record<string, unknown>>) => void;
  },
) {
  const { slug, list, object, entries, field, view, fields, attributes, onAdd } = props;
  const navigate = useNavigate();
  const options = useMemo(() => (field.options ?? []).filter((option) => !option.isArchived), [field.options]);
  const groupIds = useMemo(() => [...options.map((option) => option.id), null], [options]);
  const cardIds = useMemo(() => view.config.board?.cardFields ?? [], [view.config.board?.cardFields]);
  const recordAttributeIds = useMemo(() => cardIds.filter((id) => !props.ownIds.has(id)), [cardIds, props.ownIds]);
  const board = useMemo(
    () => entries.board(slug, list, { groupBy: field.id, groupIds }, recordAttributeIds),
    [entries, field.id, groupIds, list, recordAttributeIds, slug],
  );
  const state = useListBoard(board);
  // A card shows in its new column at once, until the board's next read places it (AC-4820): moves made since the
  // board state they were made on.
  const [moves, setMoves] = useState<{
    readonly on: typeof state.columns;
    readonly to: ReadonlyMap<string, string>;
  }>({ on: state.columns, to: new Map() });
  const moved = moves.on === state.columns ? moves.to : new Map<string, string>();
  const definitions = new Map([...fields, ...attributes].map((each) => [each.id, each] as const));
  const cardFields = cardIds.flatMap((id) => {
    const definition = definitions.get(id);
    return definition === undefined ? [] : [fieldOf(definition, object)];
  });
  const memberDisplays = toActorDisplays(props.members);
  const readOnlyReason = list.canWrite ? undefined : strings.readOnly(list.name);
  const cardOf = (entryId: string): BoardCard | undefined => {
    const row = state.rowOf(entryId);
    if (row?.display === undefined) return undefined;
    // Members and linked records show by name on a card as in a cell (one field design).
    const displays: Record<string, unknown> = {};
    for (const id of cardIds) {
      const type = definitions.get(id)?.type;
      if (type === 'actor_reference') displays[id] = memberDisplays;
      if (type !== 'record_reference') continue;
      const refs = refsOf(row.values[id]);
      if (refs.length === 0) continue;
      const names = state.referenceDisplays(refs);
      displays[id] = refs.map((ref, index) => displayOf(ref, names[index] ?? 'loading'));
    }
    return {
      id: row.id,
      record: row.display.name === '' ? { ...row.display, name: strings.unnamed(object.singularName) } : row.display,
      values: row.values,
      displays,
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
    };
  };
  const columnOf = (id: string | null) => state.columns.find((column) => column.id === id);
  const columns: BoardColumn[] = groupIds.map((id) => {
    const key = id ?? '';
    const held = columnOf(id);
    const kept = (held?.entryIds ?? []).filter((entryId) => (moved.get(entryId) ?? key) === key);
    const arrived = [...moved].flatMap(([entryId, to]) => (to === key && !kept.includes(entryId) ? [entryId] : []));
    const cards = [...arrived, ...kept].flatMap((entryId) => {
      const card = cardOf(entryId);
      return card === undefined ? [] : [card];
    });
    const option = options.find((each) => each.id === id);
    return {
      id: key,
      title: option?.label ?? strings.noValue(field.title),
      ...(option === undefined ? { isCollapsedWhenEmpty: true } : { hue: option.hue }),
      count: Math.max(0, (held?.count ?? 0) + arrived.length - ((held?.entryIds.length ?? 0) - kept.length)),
      ...(held?.atLeast === true ? { isCountAtLeast: true } : {}),
      cards: arraySource(cards, (card) => card.id),
    };
  });
  return (
    <Board
      label={strings.boardOf(list.name, field.title)}
      columns={columns}
      cardFields={cardFields}
      status={state.status}
      onRetry={board.retry}
      isReadOnly={!list.canWrite}
      showEmptyColumns
      onMove={(move) => {
        setMoves({ on: state.columns, to: new Map([...moved, [move.cardId, move.toColumnId]]) });
        writeCell(props, move.cardId, field.id, move.toColumnId === '' ? null : move.toColumnId);
      }}
      {...(list.canWrite
        ? {
            onAddCard: (columnId: string) => {
              onAdd(columnId === '' ? {} : { [field.id]: columnId });
            },
          }
        : {})}
      onOpen={(card) => {
        void navigate({
          to: '/w/$slug/objects/$object/$recordId/$tab',
          params: { slug, object: object.apiSlug, recordId: card.record.recordId, tab: 'overview' },
        });
      }}
    />
  );
}
