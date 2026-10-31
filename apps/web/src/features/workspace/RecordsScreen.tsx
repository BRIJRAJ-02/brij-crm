// Brief
// Purpose: any live object's records (People, Companies, a custom Projects) as a fast table, under its name and tile.
// Main task: read and edit records in place (a paste or clear is one change, undone with ⌘Z), add a record and a column, live.
// Leaves out: which filter, sorts and columns run and saving them (the view screen, spec 0020, hands them in), and presence.
import {
  aggregatesFor,
  queryKey,
  toFieldAttribute,
  withPendingOptions,
  type AttributeDefinition,
  type CellChange,
  type MemberSummary,
  type NameState,
  type ObjectSummary,
  type RecordRef,
  type RecordRefDisplay,
  type RecordsView,
  type RecordView,
  type SortRule,
  type ViewQuery,
  type WindowCount,
} from '@crm/data';
import { useLiveStatus, usePendingOptions, useView } from '@crm/data/react';
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  EmptyState,
  sharedStrings,
  Spinner,
  TopBar,
  useDelayedLoading,
  type ViewAction,
  ViewBar,
  type ViewChoice,
  type ViewLayoutSwitch,
  type ViewSettingsTrigger,
} from '@crm/ui';
import { columnWidthFor, DataGrid, type ColumnCalc, type GridColumn } from '@crm/ui/grid';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArchiveAttributeDialog } from '../settings/ArchiveAttributeDialog.tsx';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { isAtLimit, type LimitCount } from '../settings/AtLimit.tsx';
import { useLinkEditing } from '../records/links.ts';
import { loadRowId, stepsAround, type PeekControl } from '../records/params.ts';
import { RecordPeek } from '../records/RecordPeek.tsx';
import { useRecordForm } from '../records/RecordForm.tsx';
import { useMemberPicker } from '../records/members.ts';
import { importHref } from '../imports/paths.ts';
import { strings as importStrings } from '../imports/strings.ts';
import { strings as attributeStrings } from '../settings/attribute-strings.ts';
import { useBulkActions, useTableSelection } from './BulkActions.tsx';
import type { ShownColumn, ShownLayout } from '../views/layout.ts';
import { avatarAttribute } from './columns.ts';
import { groupingGap, groupPlan, useGroupedRows } from './grouped.ts';
import { useColumnCalcs } from './calcs.ts';
import { CREATED_TOAST_MS, createdToast } from './created.ts';
import { createEditors } from './create-editors.ts';
import { namePreset } from './name-preset.ts';
import { NewRecordDialog } from './NewRecordDialog.tsx';
import { objectHref } from './objects.ts';
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
  /** The records the loader warmed. */
  readonly view: RecordsView;
  /** The question `view` answers (the loader may have warmed another than `query`: the table then asks again). */
  readonly viewQuery: ViewQuery;
  /** The question the table runs (spec 0020): the view's effective filter and sorts. */
  readonly query: ViewQuery;
  /** A column menu's Sort ascending or descending (spec 0020: it replaces the draft's sorts). */
  readonly onSort: (rule: SortRule) => void;
  /** A column menu's Filter: the view opens its filter builder on that column. */
  readonly onFilter?: (columnId: string) => void;
  /** The view switcher: the object's views (grouped, locked ones marked), the one shown, and opening another. */
  readonly views: readonly ViewChoice[];
  readonly currentViewId: string;
  readonly onViewChange?: (viewId: string) => void;
  /** The switcher's Create view. */
  readonly onCreateView?: () => void;
  /** The view bar's end before View settings: the lock line. */
  readonly viewActions?: ReactNode;
  /** The view bar's View settings button, which opens the view's columns. */
  readonly viewSettings?: ViewSettingsTrigger;
  /** The view's own actions, under "This view" in the switcher's menu, and what runs one (spec 0020). */
  readonly viewMenu?: {
    readonly actions: readonly ViewAction[];
    readonly onAction: (id: string) => void;
    readonly onMoveView?: (viewId: string, direction: 'up' | 'down') => void;
  };
  /**
   * Add attribute asked from View settings (it moved there from the view bar, 21 October 2026): a new object
   * each time opens the attribute dialog here, which owns it.
   */
  readonly addAttributeRequest?: object;
  /** The dialog that request opened has closed: `isMade` when an attribute was made (its column takes focus). */
  readonly onAddAttributeClosed?: (isMade: boolean) => void;
  /** The view's columns (spec 0020): their order, widths, which are hidden, and how many are pinned. */
  readonly layout: ShownLayout;
  /** A column moved, resized, pinned, hidden or shown in the grid. */
  readonly onLayoutChange: (next: ShownLayout) => void;
  /** An attribute made here (Add attribute, the grid's "+"): the view shows it (AC-471). */
  readonly onAttributeCreated?: (attributeId: string) => void;
  /** At the end of the view bar: the Table and Board switch (spec 0021). */
  readonly layoutSwitch?: ViewLayoutSwitch;
  /**
   * The view's Toolbar (its sorts, filters and Save), and any notice under it, given what to say to screen
   * readers: `announce`'s words for the count, once the rows for a new question are in (never for the first,
   * nor for others' edits moving the count).
   */
  readonly toolbar?: (announced: string | undefined) => ReactNode;
  readonly announce?: (count: WindowCount) => string | undefined;
  /** The command menu's Create a <object> (spec 0039, AC-1086): open the new record dialog once, as New does. */
  readonly isCreateRequested?: boolean;
  /** The name that dialog starts with (the command menu's Create <object> named …). */
  readonly createName?: string;
  /** The request was taken: the route drops it from the address. */
  readonly onCreateRequestTaken?: () => void;
  /** What the table says when the view's filter matches nothing; the object's own empty state otherwise. */
  readonly filteredEmpty?: ReactNode;
  /**
   * Whether any row is ticked, told as it changes: someone else's saved filter
   * clears the ticks with the view's change, and its toast says so (AC-522).
   */
  readonly onTickedChange?: (isTicked: boolean) => void;
  /**
   * Ticked rows were cleared because the view's filter changed (a sort keeps them): the screen says so. Without it
   * the table says so itself.
   */
  readonly onTicksCleared?: () => void;
  /**
   * The view's grouping (13 Oct reference batch 4): a status or single select
   * attribute's id, and the rows run under a header per option.
   */
  readonly groupBy?: string;
  /** The record panel (spec 0017, AC-384): a row's name opens its record beside the table, ↑ and ↓ step the rows. */
  readonly peek?: PeekControl;
}

/** What a column's editor gets when it needs nothing beyond its value (not a relation cell). */
const NO_EDITOR_EXTRAS = {};

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
 * The grid's columns for a view's layout (spec 0020): each attribute in the
 * view's order, at its kept width or its type's, hidden as the view says.
 * An attribute the layout names that isn't live any more is left out.
 */
function columnsFor(
  attributes: readonly AttributeDefinition[],
  layout: readonly ShownColumn[],
  objectKey: string,
): readonly GridColumn[] {
  const byId = new Map(attributes.filter((each) => !each.isArchived).map((each) => [each.id, each]));
  return layout.flatMap((column) => {
    const definition = byId.get(column.id);
    if (definition === undefined) return [];
    const attribute = toFieldAttribute(definition, strings.referenceReadOnly, objectKey);
    return [
      {
        id: definition.id,
        attribute,
        width: column.width ?? columnWidthFor(attribute),
        ...(column.isHidden ? { isHidden: true } : {}),
      },
    ];
  });
}

/**
 * One object's page: the TopBar with New <singular>, the ViewBar (the switcher, with the view's own actions in
 * its menu, then View settings and the Table and Board switch), and the table. Add attribute is the grid's "+"
 * header and the foot of View settings.
 */
export function RecordsScreen({
  slug,
  object,
  attributes,
  members,
  view: warmed,
  viewQuery,
  query,
  onSort,
  onFilter,
  views,
  currentViewId,
  onViewChange,
  onCreateView,
  viewActions,
  viewMenu,
  addAttributeRequest,
  onAddAttributeClosed,
  layout,
  onLayoutChange,
  onAttributeCreated,
  viewSettings,
  layoutSwitch,
  toolbar,
  announce,
  filteredEmpty,
  onTickedChange,
  onTicksCleared,
  isCreateRequested = false,
  createName,
  onCreateRequestTaken,
  groupBy,
  peek,
}: RecordsScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  // The question asked now, and the records shown: the warmed ones until another question's first rows are in,
  // so the table never blanks while a filter or sort changes.
  const keyOf = (asked: ViewQuery) => queryKey({ ...asked, sorts: asked.sorts ?? [] });
  const wanted = keyOf(query);
  const [shown, setShown] = useState({ key: keyOf(viewQuery), view: warmed, query: viewQuery });
  // The route loaded another view (another view opened, or Retry): it is shown at once.
  const [warmedFor, setWarmedFor] = useState(warmed);
  if (warmed !== warmedFor) {
    setWarmedFor(warmed);
    setShown({ key: keyOf(viewQuery), view: warmed, query: viewQuery });
  }
  // Asks for the wanted records again after their first rows failed to load (the toast's Retry).
  const [attempt, setAttempt] = useState(0);
  const objectKey = object.standardKey ?? object.apiSlug;
  const columns = useMemo(
    () => columnsFor(attributes, layout.columns, objectKey),
    [attributes, layout.columns, objectKey],
  );
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
        // Typed past before it even opened: let it go at once.
        if (!isCurrent) {
          next.abandon();
          return;
        }
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
          message: sharedStrings.couldntDoThat,
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
  // Grouped (13 Oct reference batch 4): the rows through the board's per group windows, folded groups unread.
  const groupingPlan = useMemo(() => groupPlan(attributes, groupBy, members), [attributes, groupBy, members]);
  const ungrouped = useMemo(() => groupingGap(attributes, groupBy, members), [attributes, groupBy, members]);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const grouped = useGroupedRows(slug, object.id, groupingPlan, query, visible, folded);
  // The count spoken after a new question's rows are in (spec 0020, AC-487), once per question.
  const [announced, setAnnounced] = useState<{ readonly key: string; readonly text: string | undefined }>({
    key: wanted,
    text: undefined,
  });
  if (state.status === 'ready' && shown.key === wanted && announced.key !== wanted) {
    setAnnounced({ key: wanted, text: announce?.(state.count) });
  }
  // The rows ticked (spec 0022, AC-522): a sort keeps them (the same rows), a new filter clears them and says so,
  // another view starts with none, and rows gone on the server leave.
  const ticked = useTableSelection(
    view,
    state,
    (message) => {
      toasts.toast({ tone: 'danger', message });
    },
    {
      key: currentViewId,
      filterKey: JSON.stringify(shown.query.filter ?? null),
      onFilterCleared:
        onTicksCleared ??
        (() => {
          toasts.toast({ tone: 'info', message: strings.selectionCleared });
        }),
    },
  );
  // Paused only while the live connection is down; off (previews) shows nothing.
  const live = useLiveStatus(data.live);
  // Owner cells (spec 0003): a Menu of the workspace's members, "Me" first.
  const memberPicker = useMemberPicker(members);
  const memberDisplays = memberPicker.displays;
  const actorColumns = useMemo(
    () => new Set(attributes.filter((attribute) => attribute.type === 'actor_reference').map((each) => each.id)),
    [attributes],
  );
  const referenceColumns = useMemo(
    () => new Set(attributes.filter((attribute) => attribute.type === 'record_reference').map((each) => each.id)),
    [attributes],
  );
  // Relation cells (spec 0014): a picker per cell, and what it commits goes as link deltas, never a whole list.
  // "Create deal…" in a reference cell's picker opens the far object's full form; what it makes is linked.
  const recordForm = useRecordForm(slug);
  const links = useLinkEditing(slug, recordForm.open);
  const references = useMemo(
    () =>
      new Map(
        attributes.flatMap((attribute) => (attribute.type === 'record_reference' ? [[attribute.id, attribute]] : [])),
      ),
    [attributes],
  );
  /** A relation cell's commit: a pick or a removed chip, sent as one link delta each. */
  const commitLink = (change: CellChange): void => {
    const definition = references.get(change.columnId);
    if (definition === undefined) return;
    const at = view.indexOf(change.rowId);
    const row = at === undefined ? undefined : state.source.getItem(at);
    // Clearing a cell that shows only its first 20 links would leave the rest: those go from the record, one by one.
    if (definition.isMulti && refsOf(change.value).length === 0 && row?.linkTotals[definition.id] !== undefined) {
      toasts.toast({ tone: 'danger', message: strings.clearTooMany(definition.title) });
      return;
    }
    void links.commit(definition, change.rowId, change.value);
  };
  const [isCreating, setCreating] = useState(false);
  const [isAdding, setAdding] = useState(false);
  // Add attribute asked from View settings: each new request opens the dialog once, and says when it closes.
  const [handledRequest, setHandledRequest] = useState(addAttributeRequest);
  const [isAddingByRequest, setAddingByRequest] = useState(false);
  if (addAttributeRequest !== handledRequest) {
    setHandledRequest(addAttributeRequest);
    if (addAttributeRequest !== undefined) {
      setAdding(true);
      setAddingByRequest(true);
    }
  }
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
  // Rows tick only for someone who can act on them: edit, delete, add to a list, or export. A guest viewing a shared
  // object can do none of these, so the grid offers no ticks and no select all (spec 0031, slice 9).
  const canExport = useCan('records.export');
  const canActOnRows = object.access === 'write' || canExport;
  // The object's attributes against its plan limit (the field types pass): the "+" header's New attribute turns off
  // at the limit with the reason, as Settings' New attribute does. Read for schema managers only, again whenever the
  // attributes change; an unread count leaves it on (the server still refuses past it).
  const [attributeCount, setAttributeCount] = useState<LimitCount | undefined>(undefined);
  useEffect(() => {
    if (!canChangeSchema) return;
    let isCurrent = true;
    data.usage.get(slug).then(
      (usage) => {
        if (isCurrent) setAttributeCount(usage.attributes[object.id]);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [data, slug, object.id, canChangeSchema, attributes]);
  const addColumnLock =
    attributeCount !== undefined && isAtLimit(attributeCount)
      ? attributeStrings.atLimit(attributeCount.limit)
      : undefined;
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  // The create dialog (spec 0012, AC-240): the primary attribute, then every required one, then the rest by position.
  const { first: firstEditors, more: moreEditors } = useMemo(
    () => createEditors(object, attributes),
    [object, attributes],
  );
  /** The table takes focus back at the first of these rows (or the first row), as the bar that held it goes. */
  const focusBackAt = (recordIds: readonly string[], leaving: boolean) => {
    const rows = recordIds.flatMap((id) => {
      const at = view.indexOf(id);
      return at === undefined ? [] : [at];
    });
    const last = Math.max(0, state.source.count - 1 - (leaving ? recordIds.length : 0));
    setFocusRow({ index: Math.max(0, Math.min(...rows, last)) });
  };
  // The ticked ids, copied once per selection, not on every render (a selection holds up to 10,000).
  const tickedIds = useMemo(
    () => (ticked.selection.kind === 'some' ? [...ticked.selection.ids] : []),
    [ticked.selection],
  );
  const isTicked = ticked.selection.kind === 'all-matching' || ticked.selection.ids.size > 0;
  useEffect(() => {
    onTickedChange?.(isTicked);
  }, [isTicked, onTickedChange]);
  // The bar while rows are ticked (spec 0022): Delete, its confirm, and Clear; focus comes back to the table.
  const bulk = useBulkActions({
    slug,
    object,
    attributes,
    memberPicker,
    ticked,
    total: state.count.count,
    isTotalAtLeast: state.count.atLeast,
    query: shown.query,
    exportColumns: columns.filter((column) => column.isHidden !== true).map((column) => column.id),
    onClear: () => {
      focusBackAt(tickedIds, false);
      ticked.clear();
    },
    onDeleting: (recordIds) => {
      focusBackAt(recordIds, true);
      ticked.clear();
    },
  });
  const rowHeader = object.primaryAttributeId ?? columns[0]?.id ?? '';
  const newRecord = strings.newRecord(object.singularName);
  // Footer calculations (the CRM flow pass): each shown column but the name offers what its type can work out; the
  // view keeps the choice in its columns, and the whole footer is one read across every matching record, read again
  // by the data layer after changes that may move it.
  const shownColumns = useMemo(() => layout.columns.filter((column) => !column.isHidden), [layout.columns]);
  const calcValues = useColumnCalcs(slug, object.id, shown.query.filter, shownColumns);
  const calculations = useMemo(() => {
    const types = new Map(attributes.map((attribute) => [attribute.id, attribute.type]));
    const choose = (columnId: string, calc: ColumnCalc['chosen']) => {
      onLayoutChange({
        ...layout,
        columns: layout.columns.map((column) => {
          if (column.id !== columnId) return column;
          const { calc: _old, ...rest } = column;
          return calc === undefined ? rest : { ...rest, calc };
        }),
      });
    };
    return Object.fromEntries(
      shownColumns.flatMap((column): [string, ColumnCalc][] => {
        const type = types.get(column.id);
        if (type === undefined || column.id === rowHeader) return [];
        const value = calcValues.get(column.id);
        return [
          [
            column.id,
            {
              choices: aggregatesFor(type),
              ...(column.calc === undefined ? {} : { chosen: column.calc }),
              ...(value === undefined ? {} : { value }),
              onChange: (fn) => {
                choose(column.id, fn);
              },
            },
          ],
        ];
      }),
    );
  }, [attributes, shownColumns, calcValues, rowHeader, layout, onLayoutChange]);

  // The panel's Previous and Next: the rows either side of its record in the table's order. A row the table has
  // but hasn't loaded keeps its step on (the panel loads it and moves on), so Next is off only at the real end.
  const peekRecordId = peek?.recordId;
  const peekIndex = peekRecordId === undefined ? undefined : view.indexOf(peekRecordId);
  const peekSteps =
    peekIndex === undefined || grouped !== undefined
      ? undefined
      : stepsAround(peekIndex, state.source.count, (index) => state.source.getItem(index)?.id);
  const loadPeekStep = useCallback(
    (direction: 'previous' | 'next', signal: AbortSignal) => {
      const at = peekRecordId === undefined ? undefined : view.indexOf(peekRecordId);
      if (at === undefined) return Promise.resolve(undefined);
      return loadRowId(
        {
          // The table's own range change loads the row's block; the id arrives with the view's next frame.
          reach: (index) => {
            view.getSnapshot().source.onRangeChange({ start: index, end: index + 1 });
          },
          idAt: (index) => view.getSnapshot().source.getItem(index)?.id,
          subscribe: view.subscribe,
        },
        direction === 'next' ? at + 1 : at - 1,
        signal,
      );
    },
    [view, peekRecordId],
  );

  // The name the menu's Create <object> named … typed, for the dialog it opened; New starts empty.
  const [createPreset, setCreatePreset] = useState<Readonly<Record<string, unknown>> | undefined>(undefined);
  const openCreate = () => {
    setCreatePreset(undefined);
    setCreating(true);
  };
  // Asked for from the command menu: the same dialog as New, once; a member who may only read gets the table.
  // The dialog opens while rendering (React's adjust state on a prop change), and the request is handed back after.
  const [requestSeen, setRequestSeen] = useState(false);
  if (isCreateRequested !== requestSeen) {
    setRequestSeen(isCreateRequested);
    if (isCreateRequested && object.access === 'write') {
      const primary = attributes.find((attribute) => attribute.id === object.primaryAttributeId);
      setCreatePreset(namePreset(primary, createName));
      setCreating(true);
    }
  }
  // The callback is read through a ref, so a new one each render never hands the request back twice.
  const takeRequest = useRef(onCreateRequestTaken);
  useEffect(() => {
    takeRequest.current = onCreateRequestTaken;
  });
  useEffect(() => {
    if (isCreateRequested) takeRequest.current?.();
  }, [isCreateRequested]);

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
          <ViewBar
            views={views}
            currentViewId={currentViewId}
            onViewChange={onViewChange ?? (() => undefined)}
            {...(onCreateView === undefined ? {} : { onCreateView })}
            {...(viewMenu === undefined ? {} : { actions: viewMenu.actions, onAction: viewMenu.onAction })}
            {...(viewMenu?.onMoveView === undefined ? {} : { onMoveView: viewMenu.onMoveView })}
            {...(viewSettings === undefined ? {} : { settings: viewSettings })}
            {...(layoutSwitch === undefined ? {} : { layout: layoutSwitch })}
          >
            {isReordering && <Spinner label={strings.updating} />}
            {/* In the bar, so the table never moves when the connection drops and comes back. */}
            {live === 'paused' && (
              <Callout placement="bar" isAnnounced>
                {strings.livePaused}
              </Callout>
            )}
            {ungrouped !== undefined && (
              <Callout placement="bar" isAnnounced>
                {ungrouped}
              </Callout>
            )}
            {viewActions}
          </ViewBar>
        ),
        ...(toolbar === undefined ? {} : { toolbar: toolbar(announced.text) }),
        body: (
          <>
            <DataGrid<RecordView>
              label={object.pluralName}
              columns={gridColumns}
              pinnedCount={layout.pinnedCount}
              rows={grouped?.source ?? state.source}
              {...(grouped === undefined
                ? {}
                : {
                    groups: grouped.groups,
                    onGroupToggle: (groupId: string, isCollapsed: boolean) => {
                      setFolded((was) => {
                        const next = new Set(was);
                        if (isCollapsed) next.add(groupId);
                        else next.delete(groupId);
                        return next;
                      });
                    },
                  })}
              getValue={(row, columnId) => row.values[columnId] ?? null}
              isCellKnown={isCellKnown}
              rowNotes={state.rowNotes}
              // The count under the name column, once known ("10,000+ records" past a filtered view's cap). Each
              // other column's calculation is the server's aggregate (`calculations`), never the loaded rows.
              {...(state.status === 'ready'
                ? {
                    footer: {
                      [rowHeader]: strings.recordCount(
                        `${state.count.count.toLocaleString()}${state.count.atLeast ? '+' : ''}`,
                        state.count.count === 1 && !state.count.atLeast,
                      ),
                    },
                  }
                : {})}
              calculations={calculations}
              // A ghost "+ New person" after the last row, for members who may create (Twenty's "+ Add New").
              {...(object.access === 'write' ? { addRow: { label: newRecord, onAdd: openCreate } } : {})}
              floatingBar={bulk.bar}
              selection={ticked.selection}
              onSelectionChange={ticked.setSelection}
              isSelectable={canActOnRows}
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
              // The open record's row is marked and kept in view as the panel steps (a grouped table's rows run under headers).
              {...(peekRecordId === undefined ? {} : { activeId: peekRecordId })}
              {...(peekIndex === undefined || grouped !== undefined ? {} : { activeIndex: peekIndex })}
              commentCount={(row) => row.openThreads}
              // A record's name opens it in the panel beside the table (spec 0017, AC-384), its page one press on.
              onRowOpen={(recordId) => {
                if (peek !== undefined) {
                  peek.open(recordId);
                  return;
                }
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
                // A column's calculation stays with it as it moves, hides or resizes.
                const calcs = new Map(layout.columns.map((column) => [column.id, column.calc]));
                onLayoutChange({
                  columns: next.map((column) => {
                    const calc = calcs.get(column.id);
                    return {
                      id: column.id,
                      isHidden: column.isHidden === true,
                      width: column.width,
                      ...(calc === undefined ? {} : { calc }),
                    };
                  }),
                  pinnedCount,
                });
              }}
              onCellChange={(change) => {
                data.records.setValue(slug, change);
              }}
              onCellsChange={(asked) => {
                const [only] = asked;
                if (asked.length === 1 && only !== undefined && references.has(only.columnId)) {
                  commitLink(only);
                  return;
                }
                // A paste or a range clear leaves sides that hold many alone: they change one link at a time.
                const changes = asked.filter((change) => references.get(change.columnId)?.isMulti !== true);
                if (changes.length === 0) return;
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
                    toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
                  },
                );
              }}
              // The screen confirms a paste once its write lands, with Undo (spec 0006).
              confirmsPaste={false}
              cellErrors={state.cellErrors}
              status={grouped === undefined || grouped.status === 'ready' ? state.status : grouped.status}
              onRetry={grouped?.status === 'error' ? grouped.retry : view.retry}
              // What failed, in the data layer's words: "Can't reach the CRM" only when the network did.
              {...(state.error === undefined ? {} : { errorText: state.error.message })}
              members={memberDisplays}
              editorProps={(column, rowId) => {
                if (actorColumns.has(column.id)) return memberPicker.extras;
                const definition = references.get(column.id);
                return (
                  (definition === undefined || rowId === undefined ? undefined : links.pickerFor(definition, rowId)) ??
                  NO_EDITOR_EXTRAS
                );
              }}
              emptyState={
                filteredEmpty ?? (
                  <EmptyState
                    title={strings.emptyTitle(object.pluralName)}
                    icon={object.icon}
                    // The top bar's New person is the one primary on the page. An empty object is where a list
                    // gets brought in, so Import CSV (otherwise in the view's menu) stands beside it.
                    {...(object.access === 'write'
                      ? {
                          actions: (
                            <>
                              <Button icon="plus" onPress={openCreate}>
                                {newRecord}
                              </Button>
                              {!object.isArchived && (
                                <ButtonLink icon="upload" href={importHref(slug, object)}>
                                  {importStrings.menuItem}
                                </ButtonLink>
                              )}
                            </>
                          ),
                        }
                      : {})}
                  />
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
                    ...(addColumnLock === undefined ? {} : { addColumnLock }),
                    // "+" offers the view's hidden columns first (flow pass, 30 October 2026): a blank create was
                    // the only way, so hidden ones came back as duplicates. One press shows one, focused.
                    addColumnItems: columns
                      .filter((column) => column.isHidden === true)
                      .map((column) => ({ id: column.id, label: column.attribute.name })),
                    onAddColumnItem: (columnId: string) => {
                      onLayoutChange({
                        columns: layout.columns.map((column) =>
                          column.id === columnId ? { ...column, isHidden: false } : column,
                        ),
                        pinnedCount: layout.pinnedCount,
                      });
                      setFocusColumn({ id: columnId });
                    },
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
            {peek?.recordId !== undefined && (
              <RecordPeek
                slug={slug}
                object={object}
                attributes={attributes}
                members={members}
                recordId={peek.recordId}
                tab={peek.tab}
                onTabChange={peek.setTab}
                onOpen={peek.open}
                onClose={peek.close}
                // The rows either side in the table's order; a grouped table's rows run under headers, so it has none.
                {...(peekSteps === undefined ? {} : { steps: peekSteps, onLoadStep: loadPeekStep })}
              />
            )}
            {bulk.dialog}
            {recordForm.dialog}
            <NewRecordDialog
              isOpen={isCreating}
              onOpenChange={setCreating}
              title={newRecord}
              first={firstEditors}
              more={moreEditors}
              newId={data.records.newId}
              onCreate={(id, values) => data.records.create(slug, object.id, id, values)}
              singularName={object.singularName}
              objectKey={objectKey}
              objectId={object.id}
              memberPicker={memberPicker}
              {...(createPreset === undefined ? {} : { preset: createPreset })}
              onCreated={(record, keepOpen) => {
                toasts.toast(
                  createdToast(record, object.singularName, () => {
                    // Beside the table, as a row's name opens it; the full page is one press on from there.
                    if (peek !== undefined) {
                      peek.open(record.id);
                      return;
                    }
                    void navigate({
                      to: '/w/$slug/objects/$object/$recordId/$tab',
                      params: { slug, object: object.apiSlug, recordId: record.id, tab: 'overview' },
                    });
                  }),
                  { timeout: CREATED_TOAST_MS },
                );
                // "Create more" keeps the dialog, and focus in it, for the next record.
                if (keepOpen) return;
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
              tableHref={objectHref(slug, object)}
              onClose={() => {
                setAdding(false);
                setEditing(undefined);
                if (isAddingByRequest) {
                  setAddingByRequest(false);
                  onAddAttributeClosed?.(false);
                }
              }}
              onSaved={(attribute, isNew) => {
                setAdding(false);
                setEditing(undefined);
                if (isAddingByRequest) {
                  setAddingByRequest(false);
                  onAddAttributeClosed?.(true);
                }
                toasts.toast({
                  tone: 'success',
                  message: isNew ? strings.attributeAdded(attribute.title) : attributeStrings.saved(attribute.title),
                });
                // The new column joins the view, and its header takes focus once the reloaded columns draw it.
                if (isNew) {
                  onAttributeCreated?.(attribute.id);
                  setFocusColumn({ id: attribute.id });
                }
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
