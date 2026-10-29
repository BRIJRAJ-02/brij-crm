// Brief
// Purpose: see one object's records as a pipeline, a column per option of a status or select field (spec 0021).
// Main task: see where every record stands and drag a card to its next column, live for everyone.
// Leaves out: the stuck badge (milestone 3), and creating records from the board.
import {
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
  type BoardCard,
  type BoardColumn,
  type ListSource,
  type ViewAction,
  type ViewChoice,
  type ViewLayoutSwitch,
  type ViewSettingsTrigger,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMemberPicker } from '../records/members.ts';
import { AttributeDialog } from '../settings/AttributeDialog.tsx';
import { NewRecordDialog } from '../workspace/NewRecordDialog.tsx';
import { createEditors } from '../workspace/RecordsScreen.tsx';
import { strings as workspaceStrings } from '../workspace/strings.ts';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
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
  readonly viewMenu?: { readonly actions: readonly ViewAction[]; readonly onAction: (id: string) => void };
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
  // What a move says to screen readers ("Moved Acme renewal to Won."), through the Toolbar's status.
  const [announced, setAnnounced] = useState<string | undefined>(undefined);
  // New <record> in the top bar, as on the table: the same dialog, so switching to the board never hides the
  // page's one primary action. The record lands in its column through the board's own live updates.
  const [isCreating, setCreating] = useState(false);
  const newRecord = workspaceStrings.newRecord(object.singularName);
  const { first: firstEditors, more: moreEditors } = useMemo(
    () => createEditors(object, attributes),
    [object, attributes],
  );
  // The dialog's Owner: a Menu of the workspace's members, "Me" first.
  const memberPicker = useMemberPicker(members);
  // Asked for from the command menu: the dialog opens once (a member who may only read gets the board), and
  // the request is handed back after, read through a ref so a new callback each render never hands it back twice.
  const [requestSeen, setRequestSeen] = useState(false);
  if (isCreateRequested !== requestSeen) {
    setRequestSeen(isCreateRequested);
    if (isCreateRequested && object.access === 'write') setCreating(true);
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
              <BoardBody {...props} plan={outcome} onAnnounce={setAnnounced} />
            ) : outcome.kind === 'nothing-to-group' ? (
              <EmptyState
                icon="kanban"
                title={strings.nothingToGroupTitle(object.pluralName)}
                // Only owners and admins change the schema (spec 0009, AC-136); others see the sentence alone.
                {...(canChangeSchema
                  ? {
                      actions: (
                        <Button icon="plus" onPress={() => setAdding(true)}>
                          {strings.addAttribute}
                        </Button>
                      ),
                    }
                  : {})}
              >
                {strings.nothingToGroupText}
              </EmptyState>
            ) : outcome.kind === 'group-archived' ? (
              <EmptyState icon="archive" title={strings.groupArchivedTitle(outcome.title)}>
                {strings.groupArchivedText}
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
              memberPicker={memberPicker}
              onCreated={(record) => {
                setCreating(false);
                // Its column may be scrolled off or hidden while empty: say it was made, with a way to it.
                const name =
                  record.display.name === '' ? workspaceStrings.unnamed(object.singularName) : record.display.name;
                toasts.toast({
                  tone: 'success',
                  message: strings.created(name),
                  action: {
                    label: strings.open,
                    onAction: () => {
                      void navigate({
                        to: '/w/$slug/objects/$object/$recordId/$tab',
                        params: { slug, object: object.apiSlug, recordId: record.id, tab: 'overview' },
                      });
                    },
                  },
                });
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
      columnIds: plan.columnIds,
      archivedIds: plan.archivedIds,
      ...(query.filter === undefined ? {} : { filter: query.filter }),
      ...(query.sorts === undefined ? {} : { sorts: query.sorts }),
    }),
    [plan.groupBy.id, plan.columnIds, plan.archivedIds, query.filter, query.sorts],
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
  members,
  plan,
  query,
  onShowEmptyColumnsChange,
  onAnnounce,
}: BoardScreenProps & { readonly plan: BoardPlan; readonly onAnnounce: (text: string) => void }) {
  const navigate = useNavigate();
  const attributeIds = useMemo(
    () => [...plan.cardFields.map((field) => field.id), plan.groupBy.id],
    [plan.cardFields, plan.groupBy.id],
  );
  const store = useBoardStore(slug, object.id, plan, query, attributeIds);
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
      onOpen={(card) => {
        void navigate({
          to: '/w/$slug/objects/$object/$recordId/$tab',
          params: { slug, object: object.apiSlug, recordId: card.id, tab: 'overview' },
        });
      }}
    />
  );
}

interface LoadedBoardProps {
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
}

function LoadedBoard({
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
}: LoadedBoardProps) {
  const board: BoardView = useBoard(store, attributeIds);
  const memberDisplays = useMemo(() => toActorDisplays(members), [members]);
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
  return (
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
      showEmptyColumns={showEmpty}
      onShowEmptyColumnsChange={onShowEmptyChange}
      onOpen={onOpen}
      status={board.status}
      onRetry={store.retry}
    />
  );
}
