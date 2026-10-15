// Brief
// Purpose: any live object's records (People, Companies, a custom Projects) as a fast table, under its name and tile.
// Main task: read and edit records in place (a paste or clear is one change, undone with ⌘Z), add a record and a column, live.
// Leaves out: which filter and sorts run and saving them (the view screen, spec 0020, hands them in), and presence.
import {
  isEditableHere,
  queryKey,
  toActorDisplays,
  toFieldAttribute,
  withPendingOptions,
  type AttributeDefinition,
  type MemberSummary,
  type NameState,
  type ObjectSummary,
  type RecordRef,
  type RecordRefDisplay,
  type RecordsView,
  type RecordView,
  type SortRule,
  type ViewQuery,
} from '@crm/data';
import { useLiveStatus, usePendingOptions, useView } from '@crm/data/react';
import { Badge, Button, Callout, EmptyState, isSystemOnly, Spinner, TopBar, useDelayedLoading, ViewBar } from '@crm/ui';
import { columnWidthFor, DataGrid, type GridColumn } from '@crm/ui/grid';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArchiveAttributeDialog } from '../settings/ArchiveAttributeDialog.tsx';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { strings as attributeStrings } from '../settings/attribute-strings.ts';
import { avatarAttribute, listedAttributes } from './columns.ts';
import { NewRecordDialog } from './NewRecordDialog.tsx';
import { strings } from './strings.ts';
import { editToast, isClear } from './undo.ts';
import { runUndo } from './useUndoShortcut.ts';
import { useCan, WorkspacePage } from './WorkspacePage.tsx';

/** Props for the records screen: what the object's route loaded through the data layer. */
export interface RecordsScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  /** The records the loader warmed: the answer to `query`. */
  readonly view: RecordsView;
  /** The question the table runs (spec 0020): the view's effective filter and sorts. */
  readonly query: ViewQuery;
  /** A column menu's Sort ascending or descending (spec 0020: it replaces the draft's sorts). */
  readonly onSort: (rule: SortRule) => void;
  /** A column menu's Filter: the view opens its filter builder on that column. */
  readonly onFilter?: (columnId: string) => void;
  /** The view switcher: the object's views, the one shown, and opening another. */
  readonly views: readonly { readonly id: string; readonly name: string }[];
  readonly currentViewId: string;
  readonly onViewChange?: (viewId: string) => void;
  /** The view's Toolbar (its sorts, filters and Save), and any notice under it. */
  readonly toolbar?: ReactNode;
  /** What the table says when the view's filter matches nothing; the object's own empty state otherwise. */
  readonly filteredEmpty?: ReactNode;
}

/** A reference value's links, as a list: one link, several, or none. */
function refsOf(value: unknown): readonly RecordRef[] {
  const list: readonly unknown[] = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return list.flatMap((each) => {
    if (typeof each !== 'object' || each === null) return [];
    const { objectId, recordId } = each as { readonly objectId?: unknown; readonly recordId?: unknown };
    return typeof objectId === 'string' && typeof recordId === 'string' ? [{ objectId, recordId }] : [];
  });
}

/** How a linked record shows while its name loads (no name: a skeleton chip) or when it can't be read. */
function displayOf(ref: RecordRef, state: NameState): RecordRefDisplay {
  if (state === 'loading') return { ...ref, name: '', kind: 'other' };
  if (state === 'unknown') return { ...ref, name: strings.unavailableRecord, kind: 'other' };
  return state;
}

/** Whether a record holds a column's value yet (a column just shown is read for the loaded rows first). */
const isCellKnown = (row: RecordView, columnId: string) => Object.hasOwn(row.values, columnId);

/**
 * The grid's columns: the ones the person laid out (order and widths), with
 * any new attribute at its type's width before Created at, where it sits
 * when nothing was moved. A standard object opens with its opening columns
 * shown and the rest hidden (`listedAttributes`).
 */
function columnsFor(
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
  laidOut: readonly GridColumn[],
): readonly GridColumn[] {
  const listed = listedAttributes(object, attributes);
  const shown = listed.map((each) => each.definition);
  const fresh = listed.map(({ definition, isHidden }) => {
    const attribute = toFieldAttribute(definition, strings.referenceReadOnly);
    return { id: definition.id, attribute, width: columnWidthFor(attribute), ...(isHidden ? { isHidden } : {}) };
  });
  if (laidOut.length === 0) return fresh;
  const byId = new Map(fresh.map((column) => [column.id, column]));
  const kept = laidOut.flatMap((column) => {
    const current = byId.get(column.id);
    return current === undefined ? [] : [{ ...column, attribute: current.attribute }];
  });
  const placed = new Set(kept.map((column) => column.id));
  const added = fresh.filter((column) => !placed.has(column.id));
  const createdAt = shown.find((definition) => definition.isSystem)?.id;
  const at = kept.findIndex((column) => column.id === createdAt);
  return at === -1 ? [...kept, ...added] : [...kept.slice(0, at), ...added, ...kept.slice(at)];
}

/**
 * The create dialog's editors for an object (spec 0012, AC-240): the primary
 * attribute, then the required ones, then the rest, each by position, and
 * only those the field set edits in a form here (no system values, and no
 * references or members yet, #15).
 */
function createEditors(
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
): { readonly first: readonly AttributeDefinition[]; readonly more: readonly AttributeDefinition[] } {
  const editable = attributes
    .filter(
      (attribute) =>
        isEditableHere(attribute) &&
        !attribute.isArchived &&
        !isSystemOnly(attribute.type) &&
        // Files arrive with #32's uploads.
        attribute.type !== 'file',
    )
    .sort((a, b) => a.position - b.position);
  const isFirst = (attribute: AttributeDefinition) =>
    attribute.id === object.primaryAttributeId || attribute.isRequired;
  const primary = editable.filter((attribute) => attribute.id === object.primaryAttributeId);
  const required = editable.filter((attribute) => attribute.id !== object.primaryAttributeId && attribute.isRequired);
  return { first: [...primary, ...required], more: editable.filter((attribute) => !isFirst(attribute)) };
}

/** One object's page: the TopBar with New <singular>, the ViewBar with Add attribute, and the table. */
export function RecordsScreen({
  slug,
  object,
  attributes,
  members,
  view: warmed,
  query,
  onSort,
  onFilter,
  views,
  currentViewId,
  onViewChange,
  toolbar,
  filteredEmpty,
}: RecordsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // The question asked now, and the records shown: the warmed ones until another question's first rows are in,
  // so the table never blanks while a filter or sort changes.
  const wanted = queryKey({ ...query, sorts: query.sorts ?? [] });
  const [shown, setShown] = useState({ key: wanted, view: warmed, query });
  // The route loaded another view (another view opened, or Retry): it is shown at once.
  const [warmedFor, setWarmedFor] = useState(warmed);
  if (warmed !== warmedFor) {
    setWarmedFor(warmed);
    setShown({ key: wanted, view: warmed, query });
  }
  // Asks for the wanted records again after their first rows failed to load (the toast's Retry).
  const [attempt, setAttempt] = useState(0);
  const [layout, setLayout] = useState<{ readonly columns: readonly GridColumn[]; readonly pinnedCount: number }>({
    columns: [],
    pinnedCount: 1,
  });
  const columns = useMemo(() => columnsFor(object, attributes, layout.columns), [object, attributes, layout.columns]);
  // Options a cell just made (spec 0012, AC-238) show by their label until the attribute lists them.
  const pendingOptions = usePendingOptions(data.options.pending);
  const gridColumns = useMemo(
    () =>
      pendingOptions.size === 0
        ? columns
        : columns.map((column) => {
            const attribute = withPendingOptions(column.attribute, slug, pendingOptions);
            return attribute === column.attribute ? column : { ...column, attribute };
          }),
    [columns, pendingOptions, slug],
  );
  // The row's picture (People's Avatar) sits in the Name cell, so it is read even while its column is hidden.
  const avatar = useMemo(() => avatarAttribute(object, attributes), [object, attributes]);
  // Only the columns on screen are read (spec 0006, AC-55); showing a hidden one reads it for the loaded rows.
  const visible = useMemo(() => {
    const shownIds = columns.filter((column) => column.isHidden !== true).map((column) => column.id);
    return avatar === undefined || shownIds.includes(avatar.id) ? shownIds : [...shownIds, avatar.id];
  }, [columns, avatar]);
  // An order that arrived while a cell was being edited waits until the editor closes, so the draft keeps its row.
  const isEditing = useRef(false);
  const waiting = useRef<typeof shown | undefined>(undefined);
  useEffect(() => {
    if (shown.key === wanted) return;
    let isCurrent = true;
    let opened: RecordsView | undefined;
    let isTaken = false;
    const asked = query;
    data.records.open(slug, object.id, asked, visible).then(
      (next) => {
        opened = next;
        return next.ready().then(() => {
          if (!isCurrent) return;
          isTaken = true;
          // A view that failed shows its own error state with Retry, under the bars.
          const arrived = { key: wanted, view: next, query: asked };
          if (isEditing.current) waiting.current = arrived;
          else setShown(arrived);
        });
      },
      () => {
        if (!isCurrent) return;
        // The records layer itself didn't load (offline): the rows on screen stay; Retry asks again.
        toasts.toast({
          tone: 'danger',
          message: strings.somethingWrong,
          action: {
            label: strings.retry,
            onAction: () => {
              setAttempt((count) => count + 1);
            },
          },
        });
      },
    );
    return () => {
      isCurrent = false;
      // Typed past before it was shown (spec 0020, AC-464): its reads in flight are aborted.
      if (!isTaken) opened?.abandon();
    };
    // `visible` and `query` are read when the question changes; a column shown later reaches the view through useView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, shown.key, data, slug, object.id, attempt]);
  const view = shown.view;
  // Another order's first rows are on their way: the old ones stay, and the view bar says it is working.
  const isReordering = useDelayedLoading(shown.key !== wanted);
  const state = useView(view, visible);
  // Paused only while the live connection is down; off (previews) shows nothing.
  const live = useLiveStatus(data.live);
  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
  const actorColumns = useMemo(
    () => new Set(attributes.filter((attribute) => attribute.type === 'actor_reference').map((each) => each.id)),
    [attributes],
  );
  const referenceColumns = useMemo(
    () => new Set(attributes.filter((attribute) => attribute.type === 'record_reference').map((each) => each.id)),
    [attributes],
  );
  const [isCreating, setCreating] = useState(false);
  const [isAdding, setAdding] = useState(false);
  // The column menu's schema items (spec 0012): the attribute whose dialog or archive confirm is open.
  // By id, read from the live attributes: an attribute changed or archived elsewhere shows as it is, or closes.
  const [editingId, setEditing] = useState<string | undefined>(undefined);
  const [archivingId, setArchiving] = useState<string | undefined>(undefined);
  const editing = attributes.find((attribute) => attribute.id === editingId);
  const archiving = attributes.find((attribute) => attribute.id === archivingId);
  // The column a create from the table just made: its header takes focus once it is drawn.
  const [focusColumn, setFocusColumn] = useState<{ readonly id: string } | undefined>(undefined);
  // Only owners and admins change the schema (spec 0009, AC-136); the server refuses anyone else on its own.
  const canChangeSchema = useCan('schema.manage');
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  // The create dialog (spec 0012, AC-240): the primary attribute, then every required one, then the rest by position.
  const { first: firstEditors, more: moreEditors } = useMemo(
    () => createEditors(object, attributes),
    [object, attributes],
  );
  const rowHeader = object.primaryAttributeId ?? columns[0]?.id ?? '';
  const newRecord = strings.newRecord(object.singularName);

  const openCreate = () => {
    setCreating(true);
  };

  return (
    <WorkspacePage
      currentObject={object.apiSlug}
      page={{
        topBar: (
          <TopBar
            title={object.pluralName}
            icon={object.icon}
            hue={object.hue}
            // The total count (AC-34), once it is known: "10,000+" past a filtered view's cap (spec 0006, AC-53).
            {...(state.status === 'ready'
              ? {
                  meta: (
                    <Badge
                      count={state.count.count}
                      max={Infinity}
                      isAtLeast={state.count.atLeast}
                      label={object.pluralName.toLowerCase()}
                    />
                  ),
                }
              : {})}
          >
            {/* Only where the person may change records (spec 0009, AC-142); the server refuses anyone else. */}
            {object.access === 'write' && (
              <Button variant="primary" icon="plus" onPress={openCreate}>
                {newRecord}
              </Button>
            )}
          </TopBar>
        ),
        viewBar: (
          <ViewBar views={views} currentViewId={currentViewId} onViewChange={onViewChange ?? (() => undefined)}>
            {isReordering && <Spinner label={strings.sorting} />}
            {/* In the bar, so the table never moves when the connection drops and comes back. */}
            {live === 'paused' && (
              <Callout placement="bar" isAnnounced>
                {strings.livePaused}
              </Callout>
            )}
            {canChangeSchema && (
              <Button variant="ghost" icon="plus" onPress={() => setAdding(true)}>
                {strings.addAttribute}
              </Button>
            )}
          </ViewBar>
        ),
        toolbar,
        body: (
          <>
            <DataGrid<RecordView>
              label={object.pluralName}
              columns={gridColumns}
              pinnedCount={layout.pinnedCount}
              rows={state.source}
              getValue={(row, columnId) => row.values[columnId] ?? null}
              isCellKnown={isCellKnown}
              rowNotes={state.rowNotes}
              onEditingChange={(isOpen) => {
                view.holdSettle(isOpen);
                isEditing.current = isOpen;
                const arrived = waiting.current;
                if (!isOpen && arrived !== undefined) {
                  waiting.current = undefined;
                  if (arrived.key === wanted) setShown(arrived);
                }
              }}
              onSort={(columnId, direction) => {
                onSort({ attributeId: columnId, direction });
              }}
              {...(onFilter === undefined ? {} : { onFilter })}
              {...(shown.query.sorts?.[0] === undefined
                ? {}
                : { sort: { columnId: shown.query.sorts[0].attributeId, direction: shown.query.sorts[0].direction } })}
              getDisplay={(row, columnId) => {
                if (actorColumns.has(columnId)) return memberDisplays;
                if (!referenceColumns.has(columnId)) return undefined;
                // The linked records' names, read by the data layer (a person's Company), never "Unknown".
                const refs = refsOf(row.values[columnId]);
                if (refs.length === 0) return undefined;
                const names = state.referenceDisplays(refs);
                return refs.map((ref, index) => displayOf(ref, names[index] ?? 'loading'));
              }}
              rowHeader={rowHeader}
              // A record's name opens its page (spec 0017); milestone 4 opens the side panel here instead.
              onRowOpen={(recordId) => {
                void navigate({
                  to: '/w/$slug/objects/$object/$recordId/$tab',
                  params: { slug, object: object.apiSlug, recordId, tab: 'overview' },
                });
              }}
              untitled={strings.unnamed(object.singularName)}
              {...(avatar === undefined
                ? {}
                : {
                    rowAvatar: (row: RecordView) => {
                      const src = row.values[avatar.id];
                      return typeof src === 'string' && src !== '' ? src : undefined;
                    },
                  })}
              onColumnsChange={(next, pinnedCount) => {
                setLayout({ columns: next, pinnedCount });
              }}
              onCellChange={(change) => {
                data.records.setValue(slug, change);
              }}
              onCellsChange={(changes) => {
                // One action, one write (spec 0006, AC-50); a paste or clear of several cells says so, with Undo.
                const kind =
                  changes.length === 1 ? 'cell' : isClear(changes.map((change) => change.value)) ? 'clear' : 'paste';
                data.records.setValues(slug, changes, kind).then(
                  (outcome) => {
                    const toast = editToast(outcome, kind, (undoId) => {
                      runUndo(data, toasts, slug, undoId);
                    });
                    if (toast !== undefined) toasts.toast(toast);
                  },
                  // The records layer failed to load; the edit never showed.
                  () => {
                    toasts.toast({ tone: 'danger', message: strings.somethingWrong });
                  },
                );
              }}
              // The screen confirms a paste once its write lands, with Undo (spec 0006).
              confirmsPaste={false}
              cellErrors={state.cellErrors}
              status={state.status}
              onRetry={view.retry}
              // What failed, in the data layer's words: "Can't reach the CRM" only when the network did.
              {...(state.error === undefined ? {} : { errorText: state.error.message })}
              members={memberDisplays}
              emptyState={
                filteredEmpty ?? (
                  <EmptyState
                    title={strings.emptyTitle(object.pluralName)}
                    icon={object.icon}
                    // The top bar's New person is the one primary on the page.
                    {...(object.access === 'write'
                      ? {
                          actions: (
                            <Button icon="plus" onPress={openCreate}>
                              {newRecord}
                            </Button>
                          ),
                        }
                      : {})}
                  >
                    {strings.emptyText(object.pluralName)}
                  </EmptyState>
                )
              }
              {...(focusRow === undefined ? {} : { focusRow })}
              {...(focusColumn === undefined ? {} : { focusColumn })}
              // The schema's entry points, for owners and admins only (spec 0012, AC-242): the "+" header and a
              // column's Edit attribute and Archive attribute. System columns have none; the name never archives.
              {...(canChangeSchema
                ? {
                    // "Create" in a select or status cell (AC-238): one optimistic write that makes and sets it.
                    onCreateOption: (recordId: string, attributeId: string, label: string) => {
                      void data.records.createOption(slug, { objectId: object.id, recordId, attributeId, label });
                    },
                    onAddColumn: () => {
                      setAdding(true);
                    },
                    addColumnLabel: attributeStrings.addAttribute,
                    columnActions: (columnId: string) => {
                      const attribute = attributes.find((each) => each.id === columnId);
                      if (attribute === undefined || attribute.isSystem) return [];
                      return [
                        {
                          id: 'edit',
                          label: attributeStrings.editAttribute,
                          icon: 'pencil' as const,
                          onAction: () => {
                            setEditing(attribute.id);
                          },
                        },
                        ...(attribute.isPrimary
                          ? []
                          : [
                              {
                                id: 'archive',
                                label: attributeStrings.archiveAttribute,
                                icon: 'archive' as const,
                                isDanger: true,
                                onAction: () => {
                                  setArchiving(attribute.id);
                                },
                              },
                            ]),
                      ];
                    },
                  }
                : {})}
            />
            <NewRecordDialog
              isOpen={isCreating}
              onOpenChange={setCreating}
              title={newRecord}
              first={firstEditors}
              more={moreEditors}
              newId={data.records.newId}
              onCreate={(id, values) => data.records.create(slug, object.id, id, values)}
              singularName={object.singularName}
              onCreated={(record) => {
                setCreating(false);
                // A record made here sits first (spec 0006, AC-56).
                const index = view.indexOf(record.id) ?? 0;
                setFocusRow({ index });
              }}
            />
            {/* Add attribute, the "+" header and a column's Edit attribute: AttributeSettings (spec 0012). */}
            <AttributeDialog
              slug={slug}
              objectId={object.id}
              isOpen={isAdding || editing !== undefined}
              attribute={isAdding ? undefined : editing}
              members={members}
              canManage={canChangeSchema}
              objectAttributes={attributes}
              onClose={() => {
                setAdding(false);
                setEditing(undefined);
              }}
              onSaved={(attribute, isNew) => {
                setAdding(false);
                setEditing(undefined);
                toasts.toast({
                  tone: 'success',
                  message: isNew ? strings.attributeAdded(attribute.title) : attributeStrings.saved(attribute.title),
                });
                // The new column's header takes focus once the reloaded columns draw it.
                if (isNew) setFocusColumn({ id: attribute.id });
              }}
            />
            <ArchiveAttributeDialog
              slug={slug}
              attribute={archiving}
              onClose={() => {
                setArchiving(undefined);
              }}
              onArchived={(ends) => {
                setArchiving(undefined);
                const [first, second] = ends;
                const titles =
                  first === undefined
                    ? ''
                    : second === undefined
                      ? first.title
                      : attributeStrings.both(first.title, second.title);
                toasts.toast({ tone: 'success', message: attributeStrings.archivedToast(titles) });
                // The chevron that opened the confirm left with its column: focus goes to the name's header.
                setFocusColumn({ id: rowHeader });
              }}
            />
          </>
        ),
      }}
    />
  );
}
