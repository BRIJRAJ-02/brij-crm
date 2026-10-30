// Brief
// Purpose: one list's entries (spec 0048, AC-4806 to AC-4821), as a table or a board, under the list's name and tile.
// Main task: add records, edit the list's fields in place, move cards between stages, take entries out with Undo.
// Leaves out: a row opening the record panel (rows open the record page), and bulk Edit of the list's own fields (they
// change cell by cell; the bulk bar's Edit changes the records' fields).
import {
  isDataError,
  isSortable,
  refusalSummary,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type DataLayer,
  type DraftQuery,
  type EntriesLayer,
  type EntryTarget,
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
  Callout,
  EmptyState,
  Modal,
  TopBar,
  sharedStrings,
  ViewBar,
  arraySource,
  type BoardCard,
  type BoardColumn,
  type Toasts,
} from '@crm/ui';
import {
  allMatching,
  columnWidthFor,
  DataGrid,
  noRows,
  selectedCount,
  type GridColumn,
  type GridSelection,
} from '@crm/ui/grid';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { refsOf } from '../records/details.ts';
import { useMemberPicker } from '../records/members.ts';
import { copyName } from '../views/edits.ts';
import { useViewMenu } from '../views/ViewMenu.tsx';
import { bulkEditToast, bulkStrings, recordsWord, BULK_INLINE_MAX } from '../workspace/bulk.ts';
import { BulkEditDialog, type BulkEditChoice } from '../workspace/BulkEditDialog.tsx';
import { useBulkJob } from '../workspace/useBulkJob.ts';
import { listImportHref } from './paths.ts';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { CreateViewDialog } from '../views/CreateViewDialog.tsx';
import { strings as viewStrings } from '../views/strings.ts';
import { ViewToolbar } from '../views/ViewToolbar.tsx';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import { runUndo } from '../workspace/useUndoShortcut.ts';
import { useMyAccess, WorkspacePage } from '../workspace/WorkspacePage.tsx';
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
  const viewsList = useViewsList(given.viewsSource);
  const views = viewsList.views;
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

  // The view's filter and sorts as drafted here and not yet saved (AC-4808): Save keeps them, Discard drops them.
  const savedQuery: DraftQuery = {
    ...(view.config.filter === undefined ? {} : { filter: view.config.filter }),
    sorts: view.config.sorts,
  };
  const [drafted, setDrafted] = useState<DraftQuery | undefined>(undefined);
  const isDraft = drafted !== undefined && !data.views.isSameQuery(drafted, savedQuery);
  const query = isDraft ? drafted : savedQuery;
  const [isSaving, setSaving] = useState(false);
  const [createMode, setCreateMode] = useState<'save-as' | undefined>(undefined);
  const memberDisplays = toActorDisplays(props.members);
  const meId = useMyAccess()?.memberId;
  const me = memberDisplays.find((member) => member.id === meId);
  // Filters and sorts take the list's fields and the object's alike (AC-4808), the list's first.
  const queryFields = useMemo(
    () => [...listFields.filter((field) => !field.isArchived), ...attributes.filter((field) => !field.isArchived)],
    [listFields, attributes],
  );
  const sortable = useMemo(() => queryFields.filter((field) => isSortable(field)), [queryFields]);
  const save = () => {
    if (isSaving || !isDraft) return;
    setSaving(true);
    const toSave = query;
    data.views
      .saveQuery(slug, view.id, {
        ...(toSave.filter === undefined ? {} : { filter: toSave.filter }),
        sorts: toSave.sorts,
        baseQueryVersion: view.queryVersion,
      })
      .then(
        (next) => {
          setSaving(false);
          setDrafted(undefined);
          props.toasts.toast({ tone: 'success', message: viewStrings.saved(next.name) });
        },
        (error: unknown) => {
          setSaving(false);
          props.toasts.toast({
            tone: 'danger',
            message: isDataError(error) ? error.message : sharedStrings.couldntDoThat,
          });
        },
      );
  };

  // The view's own actions (AC-4808): Rename, Duplicate, Copy link, who can see it, Set as default and Delete, as an
  // object's views have them, under "This view" in the switcher's menu.
  const openView = (viewId: string) => {
    void navigate({ to: '/w/$slug/lists/$list/views/$viewId', params: { slug, list: list.apiSlug, viewId } });
  };
  const viewMenu = useViewMenu({
    slug,
    object,
    view,
    list: viewsList,
    members: props.members,
    memberId: meId,
    canManage: list.canManage,
    copyLinkReason: undefined,
    listId: list.id,
    onDuplicate: () => {
      const taken = views.filter((each) => each.visibility === 'private').map((each) => each.name);
      data.views
        .create(slug, {
          id: data.views.newId(),
          objectId: object.id,
          listId: list.id,
          name: copyName(view.name, taken),
          kind: view.kind,
          visibility: 'private',
          config: view.config,
        })
        .then(
          (made) => {
            openView(made.id);
          },
          (error: unknown) => {
            props.toasts.toast({
              tone: 'danger',
              message: isDataError(error) ? error.message : viewStrings.actionFailed,
            });
          },
        );
    },
    onDeleting: () => undefined,
    onDeleted: (gone) => {
      props.toasts.toast({ tone: 'success', message: viewStrings.deleted(gone.name) });
      void navigate({ to: '/w/$slug/lists/$list', params: { slug, list: list.apiSlug }, replace: true });
    },
  });

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
            {/* Import (AC-4833): spec 0040's flow, aimed at this list. */}
            {canWrite && (
              <Button
                variant="ghost"
                icon="upload"
                onPress={() => {
                  void navigate({ href: listImportHref(slug, list) });
                }}
              >
                {strings.importAction}
              </Button>
            )}
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
        toolbar: (
          <ViewToolbar
            query={query}
            filter={query.filter}
            attributes={queryFields}
            objectKey={object.standardKey ?? object.apiSlug}
            sortable={sortable}
            members={memberDisplays}
            me={me}
            isDraft={isDraft}
            canSave={!view.isLocked || list.canManage}
            isSaving={isSaving}
            onChange={(next) => {
              setDrafted(next);
            }}
            onDiscard={() => {
              setDrafted(undefined);
            }}
            onSave={save}
            onSaveAsNew={() => {
              setCreateMode('save-as');
            }}
          />
        ),
        viewBar: (
          <ViewBar
            views={views.map((each) => ({
              id: each.id,
              name: each.name,
              icon: each.kind === 'board' ? 'kanban' : 'table',
            }))}
            currentViewId={view.id}
            onViewChange={openView}
            actions={viewMenu.actions}
            onAction={viewMenu.onAction}
            onMoveView={viewMenu.onMoveView}
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
                query={query}
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
                query={query}
                onQueryChange={setDrafted}
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
            <CreateViewDialog
              mode={createMode}
              onClose={() => {
                setCreateMode(undefined);
              }}
              objectId={object.id}
              newId={data.views.newId}
              configFor={(fromThisView) =>
                fromThisView
                  ? {
                      ...view.config,
                      ...(query.filter === undefined ? {} : { filter: query.filter }),
                      sorts: [...query.sorts],
                    }
                  : { columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [] }
              }
              canStartFromView
              currentKind={view.kind}
              boardDefaults={undefined}
              onCreate={(input) => data.views.create(slug, { ...input, listId: list.id })}
              onCreated={(made) => {
                setCreateMode(undefined);
                setDrafted(undefined);
                void navigate({
                  to: '/w/$slug/lists/$list/views/$viewId',
                  params: { slug, list: list.apiSlug, viewId: made.id },
                });
              }}
            />
            {viewMenu.dialogs}
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
  /** The filter and sorts that run: the draft, or the view's own. */
  readonly query: DraftQuery;
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
  props: BodyProps & {
    readonly listFields: readonly AttributeDefinition[];
    readonly onAdd: () => void;
    readonly onQueryChange: (next: DraftQuery) => void;
  },
) {
  const { slug, list, object, attributes, listFields, entries, view, data, toasts, onAdd, onAddField, query } = props;
  const { onQueryChange } = props;
  const navigate = useNavigate();
  const primaryId = object.primaryAttributeId ?? attributes[0]?.id ?? '';
  const sorts = query.sorts;
  const hasFilter = (query.filter?.conditions.length ?? 0) > 0;
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
    () =>
      entries.view(
        slug,
        list,
        { ...(query.filter === undefined ? {} : { filter: query.filter }), sorts },
        recordAttributeIds,
      ),
    [entries, list, recordAttributeIds, slug, sorts, query.filter],
  );
  const state = useEntries(source);
  const [selection, setSelection] = useState<GridSelection>(noRows);
  // When "Select all" was pressed: entries added after it are never taken (spec 0022, AC-528).
  const [asOf, setAsOf] = useState<string | undefined>(undefined);
  const ticked = selection.kind === 'some' ? [...selection.ids] : [];
  const isAllMatching = selection.kind === 'all-matching';
  const selected = selectedCount(selection, state.count.count);
  // More than 500, or all matching, is a counted job (AC-4817): Review shows the exact number, Undo is in its toast.
  const bulkJob = useBulkJob(slug, object, () => {
    setSelection(noRows());
  });
  const [isReviewing, setReviewing] = useState(false);
  if (isReviewing && !bulkJob.isCounted) setReviewing(false);
  const [isEditing, setEditing] = useState(false);
  const memberPicker = useMemberPicker(props.members);
  const entryTarget = (): EntryTarget | undefined => {
    if (selection.kind === 'all-matching') {
      const at = asOf ?? new Date().toISOString();
      return {
        kind: 'matching',
        ...(query.filter === undefined ? {} : { filter: query.filter }),
        except: [...selection.except],
        asOf: at,
        now: at,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    }
    return ticked.length === 0 ? undefined : { kind: 'ids', entryIds: ticked };
  };
  const removeAsJob = () => {
    const on = entryTarget();
    if (on === undefined) return;
    void bulkJob
      .startWith(`remove:${list.id}:${JSON.stringify(on)}`, (id) =>
        data.lists.startJob(slug, { kind: 'remove', id, listId: list.id, target: on }),
      )
      .then((failure) => {
        if (failure !== undefined) bulkJob.say(refusalSummary(failure), 'danger');
      });
  };
  // Bulk Edit (AC-4826): the ticked rows' records, through the object's bulk edit, with its Undo.
  const editRecords = async (choice: BulkEditChoice) => {
    const definition = attributes.find((each) => each.id === choice.attributeId);
    const recordIds = [...new Set(ticked.flatMap((id) => entries.rowOf(id)?.recordId ?? []))];
    if (definition === undefined || recordIds.length === 0) {
      return { kind: 'done', updated: 0, unchanged: 0, refused: 0 } as const;
    }
    const result = await data.records.bulkEdit(slug, object.id, recordIds, {
      attributeId: definition.id,
      type: definition.type,
      isMulti: definition.isMulti,
      op: choice.op,
      ...(Object.hasOwn(choice, 'value') ? { value: choice.value } : {}),
    });
    const toast = bulkEditToast(result, object, (undoId) => {
      runUndo(data, toasts, slug, undoId);
    });
    if (toast !== undefined) toasts.toast(toast);
    if (result.kind === 'done') setEditing(false);
    return result;
  };
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

  const hiddenList = listFields
    .filter(
      (field) => !shownIds.includes(field.id) && !field.isArchived && (!field.isSystem || field.title === 'Added'),
    )
    .map((field) => ({ id: field.id, label: field.title, group: strings.listFieldsGroup(list.name) }));
  const hiddenObject = attributes
    .filter((field) => !shownIds.includes(field.id) && !field.isSystem && !field.isArchived)
    .map((field) => ({ id: field.id, label: field.title, group: strings.objectFieldsGroup(object.pluralName) }));
  const hidden = [...hiddenList, ...hiddenObject];
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
            title={hasFilter ? strings.filteredEmpty(object.pluralName) : strings.empty(object.pluralName)}
            {...(hasFilter
              ? {
                  actions: (
                    <Button
                      onPress={() => {
                        onQueryChange({ sorts });
                      }}
                    >
                      {strings.clearFilters}
                    </Button>
                  ),
                }
              : list.canWrite
                ? {
                    actions: (
                      <>
                        <Button icon="plus" onPress={onAdd}>
                          {strings.add(object.singularName)}
                        </Button>
                        <Button
                          icon="upload"
                          onPress={() => {
                            void navigate({ href: listImportHref(slug, list) });
                          }}
                        >
                          {strings.importAction}
                        </Button>
                      </>
                    ),
                  }
                : {})}
          />
        }
        selection={selection}
        onSelectionChange={setSelection}
        floatingBar={
          list.canWrite && (selected > 0 || bulkJob.isRunning || bulkJob.note !== undefined) ? (
            <BulkActionBar
              placement="floating"
              isOpen
              count={selected}
              total={state.count.count}
              isTotalAtLeast={state.count.atLeast}
              isAllMatching={isAllMatching}
              {...(bulkJob.isRunning
                ? {}
                : {
                    onSelectAllMatching: () => {
                      setAsOf(new Date().toISOString());
                      setSelection(allMatching());
                    },
                  })}
              onClear={() => {
                bulkJob.forget();
                setSelection(noRows());
              }}
              {...(bulkJob.progress === undefined ? {} : { progress: bulkJob.progress })}
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
              {bulkJob.note !== undefined && (
                <Callout placement="bar" tone={bulkJob.note.tone}>
                  {bulkJob.note.text}
                </Callout>
              )}
              {!isAllMatching && ticked.length > 0 && ticked.length <= BULK_INLINE_MAX && (
                <Button
                  icon="pencil"
                  onPress={() => {
                    setEditing(true);
                  }}
                >
                  {bulkStrings.edit}
                </Button>
              )}
              {selected > 0 && (
                <Button
                  icon="minus"
                  onPress={() => {
                    // Up to 500 go at once, with Undo (Undo over a confirm); more, or all matching, are counted first.
                    if (isAllMatching || ticked.length > BULK_INLINE_MAX) removeAsJob();
                    else remove(ticked);
                  }}
                >
                  {strings.removeSelected}
                </Button>
              )}
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
          onQueryChange({
            ...(query.filter === undefined ? {} : { filter: query.filter }),
            sorts: [{ attributeId: columnId, direction }],
          });
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
              addColumnItems: hidden,
              onAddColumnItem: (id: string) => {
                data.views.setLayout(slug, view.id, {
                  columns: [...shownIds, id].map((attributeId) => ({ attributeId })),
                  pinnedCount: view.config.pinnedCount,
                });
              },
            }
          : {})}
      />
      {/* A counted removal (AC-4817), opened by Review: the exact number. Declining cancels it; nothing was removed. */}
      <Modal
        title={strings.removeTitle(bulkJob.job?.total ?? 0, list.name)}
        variant="confirm"
        tone="danger"
        isOpen={isReviewing && bulkJob.isCounted}
        onOpenChange={(open) => {
          if (open) return;
          if (bulkJob.isCounted) bulkJob.cancel();
          setReviewing(false);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              icon="minus"
              onPress={() => {
                setReviewing(false);
                setSelection(noRows());
                bulkJob.confirm();
              }}
            >
              {strings.remove}
            </Button>
          </>
        }
      >
        {strings.removeText}
      </Modal>
      <BulkEditDialog
        isOpen={isEditing}
        onOpenChange={setEditing}
        object={object}
        attributes={attributes}
        memberPicker={memberPicker}
        count={ticked.length}
        records={recordsWord(ticked.length, object)}
        onApply={editRecords}
      />
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
  const { slug, list, object, entries, field, view, fields, attributes, onAdd, query } = props;
  const navigate = useNavigate();
  const options = useMemo(() => (field.options ?? []).filter((option) => !option.isArchived), [field.options]);
  const groupIds = useMemo(() => [...options.map((option) => option.id), null], [options]);
  const cardIds = useMemo(() => view.config.board?.cardFields ?? [], [view.config.board?.cardFields]);
  const recordAttributeIds = useMemo(() => cardIds.filter((id) => !props.ownIds.has(id)), [cardIds, props.ownIds]);
  const board = useMemo(
    () =>
      entries.board(
        slug,
        list,
        {
          groupBy: field.id,
          groupIds,
          ...(query.filter === undefined ? {} : { filter: query.filter }),
          ...(query.sorts.length === 0 ? {} : { sorts: query.sorts }),
        },
        recordAttributeIds,
      ),
    [entries, field.id, groupIds, list, recordAttributeIds, slug, query.filter, query.sorts],
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
