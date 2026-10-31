// Brief
// Purpose: see one object's records as a pipeline, a column per option, member or checked state of a field (spec 0021).
// Main task: see where every record stands and drag a card to its next column, live for everyone.
// Leaves out: the stuck badge (milestone 3).
import {
  groupValueOf,
  isDataError,
  toActorDisplays,
  toFieldAttribute,
  type AttributeDefinition,
  type BoardStore,
  type MemberSummary,
  type NameState,
  type ObjectSummary,
  type RecordRef,
  type RecordRefDisplay,
  type RecordsView,
  type RecordView,
  type ViewQuery,
  type ViewState,
} from '@crm/data';
import { useBoard, useLiveStatus, type BoardView } from '@crm/data/react';
import {
  Board,
  Button,
  Callout,
  EmptyState,
  TopBar,
  ViewBar,
  type BoardAddColumn,
  type BoardCard,
  type BoardColumn,
  type ListSource,
  type ViewAction,
  type ViewChoice,
  type ViewLayoutSwitch,
  type ViewSettingsTrigger,
} from '@crm/ui';
import { useNavigate, useRouteContext, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMemberPicker } from '../records/members.ts';
import { loadRowId, stepsAround, type PeekControl, type PeekLoadStep, type PeekSteps } from '../records/params.ts';
import { RecordPeek } from '../records/RecordPeek.tsx';
import { useBoardTotals } from '../workspace/calcs.ts';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { NewRecordDialog } from '../workspace/NewRecordDialog.tsx';
import { createEditors } from '../workspace/create-editors.ts';
import { CREATED_TOAST_MS, createdToast } from '../workspace/created.ts';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { useCollapsedColumns } from './collapsed.ts';
import type { BoardOutcome, BoardPlan } from './plan.ts';
import { strings } from './strings.ts';

/** The column id the Board gets for records with no value: never an option id (those are uuids). */
const NO_VALUE_COLUMN = 'no-value';

/** Props for the board screen: what the view screen worked out, and the bars it shares with the table. */
export interface BoardScreenProps {
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly attributes: readonly AttributeDefinition[];
  readonly members: readonly MemberSummary[];
  readonly outcome: BoardOutcome;
  /** The view's effective filter and sorts (spec 0020): every column runs them. */
  readonly query: ViewQuery;
  /** The switcher (spec 0020): the default, the other shared views, then a Private section. */
  readonly views: readonly ViewChoice[];
  readonly currentViewId: string;
  readonly onViewChange: (viewId: string) => void;
  /** The switcher's Create view. */
  readonly onCreateView?: () => void;
  /** The view bar's end before View settings: the lock line. */
  readonly viewActions?: ReactNode;
  /** The view bar's View settings button, which opens the card's fields. */
  readonly viewSettings?: ViewSettingsTrigger;
  /**
   * Add attribute asked from View settings: a new object each time opens the attribute dialog here, which owns
   * it, so a board has a way to add one too.
   */
  readonly addAttributeRequest?: object;
  /** The dialog that request opened has closed. */
  readonly onAddAttributeClosed?: () => void;
  /** The view's own actions, under "This view" in the switcher's menu, and what runs one (spec 0020). */
  readonly viewMenu?: {
    readonly actions: readonly ViewAction[];
    readonly onAction: (id: string) => void;
    readonly onMoveView?: (viewId: string, direction: 'up' | 'down') => void;
  };
  /** The Table and Board switch, at the end of the view bar. */
  readonly layoutSwitch: ViewLayoutSwitch;
  /** The view's Toolbar (sorts, filters, Save) and any notice under it, given what to say to screen readers. */
  readonly toolbar: (announced: string | undefined) => ReactNode;
  /** The command menu asked for a new record: the board opens its New dialog once, as the table does. */
  readonly isCreateRequested?: boolean;
  /** The request was taken, so the address drops it. */
  readonly onCreateRequestTaken?: () => void;
  /** Show empty columns turned on or off: saved with the view's board settings (AC-497). */
  readonly onShowEmptyColumnsChange: (show: boolean) => void;
  /** The record panel (spec 0021, AC-509): a card opens its record beside the board, ↑ and ↓ step its column. */
  readonly peek?: PeekControl;
}

/** One object's view as a board: the bars, then the board or why there is none. */
export function BoardScreen(props: BoardScreenProps) {
  const {
    slug,
    object,
    attributes,
    members,
    outcome,
    views,
    currentViewId,
    onViewChange,
    onCreateView,
    viewActions,
    viewMenu,
    layoutSwitch,
    viewSettings,
    addAttributeRequest,
    onAddAttributeClosed,
    toolbar,
    isCreateRequested = false,
    onCreateRequestTaken,
  } = props;
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const live = useLiveStatus(data.live);
  const canChangeSchema = useCan('schema.manage');
  const [isAdding, setAdding] = useState(false);
  // View settings' Add attribute: each new request opens the dialog once.
  const [handledRequest, setHandledRequest] = useState(addAttributeRequest);
  if (addAttributeRequest !== handledRequest) {
    setHandledRequest(addAttributeRequest);
    if (addAttributeRequest !== undefined) setAdding(true);
  }
  const closeAdding = () => {
    setAdding(false);
    onAddAttributeClosed?.();
  };
  // The archived grouping field, restored from the board itself (late trap #14).
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | undefined>(undefined);
  const restoreGroup = (id: string, title: string) => {
    if (restoringId !== undefined) return;
    setRestoringId(id);
    data.attributes
      .restore(slug, id)
      // Pending until the board is back, so the button never shows enabled beside "restored".
      .then(() => router.invalidate())
      .then(
        () => {
          setRestoringId(undefined);
          toasts.toast({ tone: 'success', message: strings.restoredGroup(title) });
        },
        (error: unknown) => {
          setRestoringId(undefined);
          // As settings says it (a live form or rule can refuse it): never swallowed.
          toasts.toast({
            tone: 'danger',
            message: strings.restoreGroupFailed(title, isDataError(error) ? error.message : strings.tryAgain),
          });
        },
      );
  };
  // What a move says to screen readers ("Moved Acme renewal to Won."), through the Toolbar's status.
  const [announced, setAnnounced] = useState<string | undefined>(undefined);
  // New <record> in the top bar, as on the table: the same dialog, so switching to the board never hides the
  // page's one primary action. The record lands in its column through the board's own live updates.
  const [isCreating, setCreating] = useState(false);
  // A column's "+": the grouping field set to that column's option (or cleared, for "No <field>").
  const [preset, setPreset] = useState<Readonly<Record<string, unknown>> | undefined>(undefined);
  const newRecord = workspaceStrings.newRecord(object.singularName);
  const groupBy = outcome.kind === 'board' ? outcome.groupBy : undefined;
  const { first: firstEditors, more: moreEditors } = useMemo(() => {
    const editors = createEditors(object, attributes);
    // Opened from a column, its field shows with the first ones, so the value it set is in sight.
    if (preset === undefined || groupBy === undefined || !editors.more.some((each) => each.id === groupBy.id)) {
      return editors;
    }
    return {
      first: [...editors.first, ...editors.more.filter((each) => each.id === groupBy.id)],
      more: editors.more.filter((each) => each.id !== groupBy.id),
    };
  }, [object, attributes, preset, groupBy]);
  const addToColumn = (columnId: string) => {
    if (outcome.kind !== 'board' || groupBy === undefined) return;
    const value = groupValueOf(outcome.groupKind, columnId === NO_VALUE_COLUMN ? null : columnId);
    setPreset({ [groupBy.id]: value !== null && groupBy.isMulti ? [value] : value });
    setCreating(true);
  };
  // The dialog's Owner: a Menu of the workspace's members, "Me" first.
  const memberPicker = useMemberPicker(members);
  // Asked for from the command menu: the dialog opens once (a member who may only read gets the board), and
  // the request is handed back after, read through a ref so a new callback each render never hands it back twice.
  const [requestSeen, setRequestSeen] = useState(false);
  if (isCreateRequested !== requestSeen) {
    setRequestSeen(isCreateRequested);
    if (isCreateRequested && object.access === 'write') {
      setPreset(undefined);
      setCreating(true);
    }
  }
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
          <TopBar title={object.pluralName} icon={object.icon} hue={object.hue}>
            {object.access === 'write' && (
              <Button
                variant="primary"
                icon="plus"
                onPress={() => {
                  setPreset(undefined);
                  setCreating(true);
                }}
              >
                {newRecord}
              </Button>
            )}
          </TopBar>
        ),
        viewBar: (
          <ViewBar
            views={views}
            currentViewId={currentViewId}
            onViewChange={onViewChange}
            {...(onCreateView === undefined ? {} : { onCreateView })}
            {...(viewMenu === undefined ? {} : { actions: viewMenu.actions, onAction: viewMenu.onAction })}
            {...(viewMenu?.onMoveView === undefined ? {} : { onMoveView: viewMenu.onMoveView })}
            {...(viewSettings === undefined ? {} : { settings: viewSettings })}
            layout={layoutSwitch}
          >
            {live === 'paused' && (
              <Callout placement="bar" isAnnounced>
                {workspaceStrings.livePaused}
              </Callout>
            )}
            {outcome.kind === 'board' && outcome.isStandIn && (
              <Callout placement="bar">{strings.standIn(outcome.groupBy.title)}</Callout>
            )}
            {viewActions}
          </ViewBar>
        ),
        toolbar: toolbar(announced),
        body: (
          <>
            {outcome.kind === 'board' ? (
              <BoardBody
                {...props}
                plan={outcome}
                onAnnounce={setAnnounced}
                {...(object.access === 'write' ? { onAddCard: addToColumn } : {})}
              />
            ) : outcome.kind === 'nothing-to-group' ? (
              <EmptyState
                icon="kanban"
                title={strings.nothingToGroupTitle(object.pluralName)}
                // Only owners and admins change the schema (spec 0009, AC-136); others see the title alone.
                {...(canChangeSchema
                  ? {
                      actions: (
                        <Button icon="plus" onPress={() => setAdding(true)}>
                          {strings.addAttribute}
                        </Button>
                      ),
                    }
                  : {})}
              />
            ) : outcome.kind === 'group-archived' ? (
              <EmptyState
                icon="archive"
                title={strings.groupArchivedTitle(outcome.title)}
                actions={
                  <>
                    {/* Restored in place, as settings' Archived list does: the board groups by it again. */}
                    {canChangeSchema && (
                      <Button
                        variant="primary"
                        icon="archive-restore"
                        isPending={restoringId === outcome.id}
                        onPress={() => {
                          restoreGroup(outcome.id, outcome.title);
                        }}
                      >
                        {restoringId === outcome.id ? strings.restoringGroup : strings.restoreGroup(outcome.title)}
                      </Button>
                    )}
                    <Button
                      // Readers' one way out, so it leads for them.
                      {...(canChangeSchema ? {} : { variant: 'primary' as const })}
                      icon="table"
                      isDisabled={layoutSwitch.isDisabled === true || restoringId !== undefined}
                      onPress={() => layoutSwitch.onChange('table')}
                    >
                      {strings.showAsTable}
                    </Button>
                  </>
                }
              >
                {/* The buttons say the ways out; a reader also hears who can restore it. */}
                {canChangeSchema ? undefined : strings.groupArchivedTextReader}
              </EmptyState>
            ) : (
              <EmptyState icon="kanban" title={strings.tooManyTitle}>
                {strings.tooManyText(outcome.title, outcome.count.toLocaleString())}
              </EmptyState>
            )}
            <AttributeDialog
              slug={slug}
              objectId={object.id}
              isOpen={isAdding}
              members={members}
              canManage={canChangeSchema}
              objectAttributes={attributes}
              // The board needs a status or select field: the dialog starts on Select.
              initialTypeKey="select"
              onClose={closeAdding}
              onSaved={() => {
                // The route reads the attributes again: a status or select field makes the board.
                closeAdding();
              }}
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
              objectKey={object.standardKey ?? object.apiSlug}
              objectId={object.id}
              objectSlug={object.apiSlug}
              memberPicker={memberPicker}
              {...(preset === undefined ? {} : { preset })}
              onCreated={(record, keepOpen) => {
                if (!keepOpen) setCreating(false);
                // Its column may be scrolled off or hidden while empty: say it was made, with a way to it.
                toasts.toast(
                  createdToast(record, object.singularName, () => {
                    if (props.peek !== undefined) {
                      props.peek.open(record.id);
                      return;
                    }
                    void navigate({
                      to: '/w/$slug/objects/$object/$recordId/$tab',
                      params: { slug, object: object.apiSlug, recordId: record.id, tab: 'overview' },
                    });
                  }),
                  { timeout: CREATED_TOAST_MS },
                );
              }}
            />
          </>
        ),
      }}
    />
  );
}

/**
 * The board store for a question, opened through the data layer: the one
 * already shown stays until the next one exists, so the board never blanks
 * while the filter or sorts change.
 */
function useBoardStore(
  slug: string,
  objectId: string,
  plan: BoardPlan,
  query: ViewQuery,
  attributeIds: readonly string[],
): BoardStore<RecordsView> | undefined {
  const { data } = useRouteContext({ from: '__root__' });
  const asked = useMemo(
    () => ({
      groupBy: plan.groupBy.id,
      groupKind: plan.groupKind,
      columnIds: plan.columnIds,
      archivedIds: plan.archivedIds,
      ...(query.filter === undefined ? {} : { filter: query.filter }),
      ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
    }),
    [plan.groupBy.id, plan.groupKind, plan.columnIds, plan.archivedIds, query.filter, query.sorts],
  );
  const key = JSON.stringify([objectId, asked]);
  const [held, setHeld] = useState<{ readonly key: string; readonly store: BoardStore<RecordsView> }>();
  useEffect(() => {
    let isCurrent = true;
    void data.records.board(slug, objectId, asked, attributeIds).then((store) => {
      if (isCurrent) setHeld({ key, store });
    });
    return () => {
      isCurrent = false;
    };
    // The question is `key`; the card fields reach the columns through useBoard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, slug, key]);
  return held?.store;
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

/** How a linked record shows while its name loads, or when it can't be read. */
function displayOf(ref: RecordRef, state: NameState): RecordRefDisplay {
  if (state === 'loading') return { ...ref, name: '', kind: 'other' };
  if (state === 'unknown') return { ...ref, name: workspaceStrings.unavailableRecord, kind: 'other' };
  return state;
}

/** A column still waiting for its first cards: three skeleton cards. */
const LOADING_CARDS: ListSource<BoardCard> = { count: 3, getItem: () => undefined, getKey: (card) => card.id };

/** The board itself: its columns from the store, each column's cards from its window. */
function BoardBody({
  slug,
  object,
  attributes,
  members,
  plan,
  query,
  onShowEmptyColumnsChange,
  onAnnounce,
  onAddCard,
  peek,
  currentViewId,
}: BoardScreenProps & {
  readonly plan: BoardPlan;
  readonly onAnnounce: (text: string) => void;
  readonly onAddCard?: (columnId: string) => void;
}) {
  const navigate = useNavigate();
  const attributeIds = useMemo(
    () => [...plan.cardFields.map((field) => field.id), plan.groupBy.id],
    [plan.cardFields, plan.groupBy.id],
  );
  const store = useBoardStore(slug, object.id, plan, query, attributeIds);
  const peekRecordId = peek?.recordId;
  const { data } = useRouteContext({ from: '__root__' });
  const canChangeSchema = useCan('schema.manage');
  // "+ Add stage" (the CRM flow pass): for whoever may shape the schema, on a board grouped by a status or select
  // they may write. The option is made through the path a Select's "Create" uses; the board gains its column once
  // the attribute is read again, as any option change reaches it.
  const addColumn: BoardAddColumn | undefined =
    canChangeSchema && plan.groupKind === 'option' && plan.groupBy.readOnly === undefined
      ? {
          label: plan.groupBy.type === 'status' ? strings.addStage : strings.addOption,
          onAdd: (title) => {
            const making = data.options.make(slug, object.id, plan.groupBy.id, title);
            if (making === undefined) return Promise.resolve(undefined);
            // A refusal (a name a stage already has, the option limit) is said under the name, which stays.
            return making.made.then(
              () => undefined,
              (error: unknown) => (isDataError(error) ? error.message : strings.tryAgain),
            );
          },
        }
      : undefined;
  const collapsing = useCollapsedColumns(currentViewId);
  const fields = useMemo(
    () =>
      plan.cardFields.map((field) =>
        toFieldAttribute(field, workspaceStrings.referenceReadOnly, object.standardKey ?? object.apiSlug),
      ),
    [plan.cardFields, object.standardKey, object.apiSlug],
  );
  // Show empty columns (AC-497): the view's setting, changed through the view's layout save.
  const showEmpty = plan.settings.showEmptyColumns;
  const label = strings.label(object.pluralName, plan.groupBy.title);
  if (store === undefined) {
    return (
      <Board
        label={label}
        columns={[]}
        cardFields={fields}
        onMove={() => undefined}
        isReadOnly
        showEmptyColumns={showEmpty}
        status="loading"
      />
    );
  }
  return (
    <LoadedBoard
      slug={slug}
      filter={query.filter}
      store={store}
      attributeIds={attributeIds}
      label={label}
      object={object}
      members={members}
      plan={plan}
      fields={fields}
      showEmpty={showEmpty}
      onShowEmptyChange={onShowEmptyColumnsChange}
      onAnnounce={onAnnounce}
      {...(onAddCard === undefined ? {} : { onAddCard })}
      {...(addColumn === undefined ? {} : { addColumn })}
      collapsedIds={collapsing.collapsedIds}
      onCollapsedChange={collapsing.onCollapsedChange}
      // A card opens its record beside the board (AC-509), its full page one press on from the panel.
      onOpen={(card) => {
        if (peek !== undefined) {
          peek.open(card.id);
          return;
        }
        void navigate({
          to: '/w/$slug/objects/$object/$recordId/$tab',
          params: { slug, object: object.apiSlug, recordId: card.id, tab: 'overview' },
        });
      }}
      {...(peek === undefined || peekRecordId === undefined
        ? {}
        : {
            peekId: peekRecordId,
            peekPanel: (steps: PeekSteps | undefined, onLoadStep: PeekLoadStep) => (
              <RecordPeek
                slug={slug}
                object={object}
                attributes={attributes}
                members={members}
                recordId={peekRecordId}
                tab={peek.tab}
                onTabChange={peek.setTab}
                onOpen={peek.open}
                onClose={peek.close}
                {...(steps === undefined ? {} : { steps, onLoadStep })}
              />
            ),
          })}
    />
  );
}

interface LoadedBoardProps {
  readonly slug: string;
  /** The view's filter, which each column's total runs under with the column's own condition. */
  readonly filter: ViewQuery['filter'];
  readonly store: BoardStore<RecordsView>;
  readonly attributeIds: readonly string[];
  readonly label: string;
  readonly object: ObjectSummary;
  readonly members: readonly MemberSummary[];
  readonly plan: BoardPlan;
  readonly fields: ReturnType<typeof toFieldAttribute>[];
  readonly showEmpty: boolean;
  readonly onShowEmptyChange: (show: boolean) => void;
  readonly onAnnounce: (text: string) => void;
  readonly onOpen: (card: BoardCard) => void;
  readonly onAddCard?: (columnId: string) => void;
  /** The record panel, given the cards either side of its record in the record's column. */
  readonly peekPanel?: (steps: PeekSteps | undefined, onLoadStep: PeekLoadStep) => ReactNode;
  /** The record the panel shows, to find its column. */
  readonly peekId?: string;
  readonly addColumn?: BoardAddColumn;
  readonly collapsedIds: ReadonlySet<string>;
  readonly onCollapsedChange: (columnId: string, isCollapsed: boolean) => void;
}

function LoadedBoard({
  slug,
  filter,
  store,
  attributeIds,
  label,
  object,
  members,
  plan,
  fields,
  showEmpty,
  onShowEmptyChange,
  onAnnounce,
  onOpen,
  onAddCard,
  peekPanel,
  peekId,
  addColumn,
  collapsedIds,
  onCollapsedChange,
}: LoadedBoardProps) {
  const board: BoardView = useBoard(store, attributeIds);
  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
  // Column totals (Board settings' Column total, the CRM flow pass): every column's sum in one read grouped by the
  // column's value, read again by the data layer after changes that may move it; never added up from the cards.
  const totalId = plan.total?.id;
  const totalOf = useBoardTotals(
    slug,
    object.id,
    filter,
    plan.groupBy.id,
    board.columns.map((column) => column.id),
    totalId,
  );
  const options = useMemo(
    () => new Map((plan.groupBy.options ?? []).map((option) => [option.id, option])),
    [plan.groupBy.options],
  );
  const kinds = useMemo(() => new Map(plan.cardFields.map((field) => [field.id, field.type])), [plan.cardFields]);
  const unnamed = workspaceStrings.unnamed(object.singularName);
  // Read only (spec 0009, AC-502): a field the member can't write, or an object they may only read. No handles;
  // each card's lock says why. The server refuses a move anyway.
  const readOnlyReason =
    plan.groupBy.readOnly?.reason ?? (object.access === 'write' ? undefined : strings.readOnly(object.pluralName));
  const titleOf = (id: string | null) =>
    id === null ? strings.noValue(plan.groupBy.title) : (options.get(id)?.label ?? '');
  // One card per record body: a body the store keeps the same keeps its card, so a card redraws only when it changed.
  const cards = useRef(new WeakMap<RecordView, BoardCard>());
  const cardOf = (row: RecordView, state: ViewState): BoardCard => {
    const held = cards.current.get(row);
    if (held !== undefined) return held;
    const displays: Record<string, unknown> = {};
    for (const [id, type] of kinds) {
      if (type === 'actor_reference') displays[id] = memberDisplays;
      if (type !== 'record_reference') continue;
      const refs = refsOf(row.values[id]);
      if (refs.length === 0) continue;
      const names = state.referenceDisplays(refs);
      displays[id] = refs.map((ref, index) => displayOf(ref, names[index] ?? 'loading'));
    }
    const card: BoardCard = {
      id: row.id,
      record: row.display.name === '' ? { ...row.display, name: unnamed } : row.display,
      values: row.values,
      displays,
      ...(readOnlyReason === undefined ? {} : { readOnlyReason }),
      // The record's open comment threads: a comment mark and count on its card.
      ...(row.openThreads === undefined || row.openThreads === 0 ? {} : { openThreads: row.openThreads }),
    };
    cards.current.set(row, card);
    return card;
  };
  const columns: readonly BoardColumn[] = board.columns.map((column) => {
    const option = column.id === null ? undefined : options.get(column.id);
    const { state } = column;
    return {
      id: column.id ?? NO_VALUE_COLUMN,
      title: option?.label ?? strings.noValue(plan.groupBy.title),
      ...(option === undefined ? {} : { hue: option.hue }),
      count: state?.count.count ?? 0,
      ...(state?.count.atLeast === true ? { isCountAtLeast: true } : {}),
      ...(totalId === undefined || (state?.count.count ?? 0) === 0
        ? {}
        : { total: totalOf(column.id) ?? workspaceStrings.calcPending }),
      ...(option?.isArchived === true ? { isArchived: true } : {}),
      // The no value column stays a slim strip while it holds nothing (once its count is in, so it never flickers).
      ...(column.id === null && state !== undefined ? { isCollapsedWhenEmpty: true } : {}),
      // A required field's no value column takes no card (AC-502).
      ...(column.id === null && plan.groupBy.isRequired
        ? { refusesDrop: { reason: strings.requiredRefuses(plan.groupBy.title) } }
        : {}),
      cards:
        state === undefined
          ? LOADING_CARDS
          : {
              count: state.source.count,
              getItem: (index: number) => {
                const row = state.source.getItem(index);
                return row === undefined ? undefined : cardOf(row, state);
              },
              getKey: (card: BoardCard) => card.id,
              onRangeChange: state.source.onRangeChange,
            },
    };
  });
  // The panel's Previous and Next: the cards either side of its record in the record's own column. A card the column
  // has but hasn't loaded keeps its step on (the panel loads it and moves on): off only at the column's real end.
  const loadPeekStep = useCallback(
    (direction: 'previous' | 'next', signal: AbortSignal) => {
      if (peekId === undefined) return Promise.resolve(undefined);
      for (const column of store.getSnapshot().columns) {
        const view = column.view;
        const at = view?.indexOf(peekId);
        if (view === undefined || at === undefined) continue;
        return loadRowId(
          {
            reach: (index) => {
              view.getSnapshot().source.onRangeChange({ start: index, end: index + 1 });
            },
            idAt: (index) => view.getSnapshot().source.getItem(index)?.id,
            subscribe: view.subscribe,
          },
          direction === 'next' ? at + 1 : at - 1,
          signal,
        );
      }
      return Promise.resolve(undefined);
    },
    [store, peekId],
  );
  const peekSteps = ((): PeekSteps | undefined => {
    if (peekId === undefined) return undefined;
    // Each column's view knows a record's row by a map lookup, so this costs one lookup per column, not a scan.
    for (const column of store.getSnapshot().columns) {
      const at = column.view?.indexOf(peekId);
      const source = column.view?.getSnapshot().source;
      if (at !== undefined && source !== undefined)
        return stepsAround(at, source.count, (row) => source.getItem(row)?.id);
    }
    return undefined;
  })();
  return (
    <>
      <Board
        label={label}
        columns={columns}
        cardFields={fields}
        isReadOnly={readOnlyReason !== undefined}
        onMove={({ cardId, toColumnId }) => {
          const to = toColumnId === NO_VALUE_COLUMN ? null : toColumnId;
          const name = store.getSnapshot().columns.flatMap((column) => {
            const source = column.view?.getSnapshot().source;
            if (source === undefined) return [];
            for (let index = 0; index < source.count; index += 1) {
              const row = source.getItem(index);
              if (row?.id === cardId) return [row.display.name === '' ? unnamed : row.display.name];
            }
            return [];
          })[0];
          void store.move(cardId, to).then((landed) => {
            if (landed && name !== undefined) onAnnounce(strings.moved(name, titleOf(to)));
          });
        }}
        onMovingChange={store.holdStill}
        collapsedIds={collapsedIds}
        onCollapsedChange={onCollapsedChange}
        {...(addColumn === undefined ? {} : { addColumn })}
        showEmptyColumns={showEmpty}
        onShowEmptyColumnsChange={onShowEmptyChange}
        onOpen={onOpen}
        {...(peekId === undefined ? {} : { activeId: peekId })}
        // Where the grouping field is read only, a "+" would set a value the member can't write.
        {...(onAddCard === undefined || plan.groupBy.readOnly !== undefined ? {} : { onAddCard })}
        status={board.status}
        onRetry={store.retry}
      />
      {peekPanel?.(peekSteps, loadPeekStep)}
    </>
  );
}
