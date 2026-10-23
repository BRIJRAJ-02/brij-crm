// Brief
// Purpose: Settings › Workspace › Trash: each record deleted in the last 30 days that the person may see, newest first.
// Main task: find a record deleted by mistake and restore it (several at once), seeing why one can't come back.
// Leaves out: opening or editing trashed records; Delete forever and Empty trash show only to owners and admins.
import {
  refusalSummary,
  TRASH_NAME_COLUMN,
  type BulkAction,
  type BulkTarget,
  type MemberSummary,
  type ObjectSummary,
  type TrashRow,
  type TrashView,
} from '@crm/data';
import { useTrash } from '@crm/data/react';
import {
  Badge,
  BulkActionBar,
  Button,
  Callout,
  EmptyState,
  Modal,
  Select,
  Skeleton,
  Toolbar,
  VisuallyHidden,
  useFormatSettings,
} from '@crm/ui';
import {
  allMatching,
  columnWidthFor,
  DataGrid,
  noRows,
  selectedCount,
  type GridColumn,
  type GridSelection,
  type RowSource,
} from '@crm/ui/grid';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { BULK_EXCEPT_MAX, BULK_IDS_MAX, bulkPath, bulkStrings, recordsWord } from '../workspace/bulk.ts';
import { isFocusLost, useBulkJob, type NotesIn } from '../workspace/useBulkJob.ts';
import { strings } from './strings.ts';
import {
  canRestore,
  canRestoreAll,
  cellValue,
  dayFormatter,
  deletedByOf,
  purgeToast,
  restoreToast,
  TRASH_ATTRIBUTES,
  TRASH_COLUMNS,
} from './trash.ts';

/** Props for the Trash screen: what its route loaded through the data layer. */
export interface TrashScreenProps {
  readonly slug: string;
  /** Every object the person may see, archived ones too (for the filter and the Object column). */
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  /** The trash of the object in the filter, or of every object. */
  readonly view: TrashView;
  /** The object the list is narrowed to (`?object=`), or undefined for all. */
  readonly objectId: string | undefined;
}

/** The trash's records, named for a count ("48 records"). */
const RECORDS = { singularName: 'Record', pluralName: 'Records' } as const;

/** The value meaning "every object" in the filter. */
const ALL = 'all';

/** A text column's width: the narrower tiers (a time, a day) cut their header short beside its read only lock. */
const objectColumn = TRASH_ATTRIBUTES.find((attribute) => attribute.id === TRASH_COLUMNS.object);
const TEXT_WIDTH = objectColumn === undefined ? 0 : columnWidthFor(objectColumn);

const COLUMNS: readonly GridColumn[] = TRASH_ATTRIBUTES.map((attribute) => ({
  id: attribute.id,
  attribute,
  width: Math.max(columnWidthFor(attribute), TEXT_WIDTH),
}));

/** No rows yet: the grid draws its loading rows at the columns' widths. */
const NO_ROWS: RowSource<TrashRow> = { count: 0, getItem: () => undefined, getKey: (row) => row.id };

/**
 * The trash while its route loads, in Settings: the bar with its trail and title, the filter row and the grid's
 * loading rows, each where the loaded page draws it, so nothing moves when the rows arrive.
 */
export function TrashPending() {
  return (
    <SettingsPage title={strings.title} fillsView>
      <Toolbar label={strings.filterLabel}>
        <Skeleton width="short" />
      </Toolbar>
      <DataGrid
        label={strings.title}
        columns={COLUMNS}
        pinnedCount={1}
        rows={NO_ROWS}
        getValue={() => undefined}
        rowHeader={TRASH_NAME_COLUMN}
        hideColumnLocks
        status="loading"
      />
    </SettingsPage>
  );
}

/**
 * The trash, inside Settings (A120): the bar with its trail, the count and Empty trash, the object filter, the read
 * only grid filling the view, and Restore in the bulk bar.
 */
export function TrashScreen({ slug, objects, members, view, objectId }: TrashScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const state = useTrash(view);
  const byId = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  // The member's own zone (Settings › Account › Preferences), else the browser's.
  const { timeZone } = useFormatSettings();
  // The rows ticked, for this view only: another object filter starts with none.
  const [held, setHeld] = useState<{
    readonly view: TrashView;
    readonly selection: GridSelection;
    readonly asOf?: string;
  }>(() => ({ view, selection: noRows() }));
  const selection = held.view === view ? held.selection : noRows();
  const asOf = held.view === view ? held.asOf : undefined;
  // Owners and admins delete forever (records.purge, AC-535); the server refuses anyone else anyway.
  const canPurge = useCan('records.purge');
  const filtered = objectId === undefined ? undefined : byId.get(objectId);
  // The records counted in the filtered object's words when the filter names one ("12 deals"), else "records".
  const names = filtered ?? RECORDS;
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  const count = selectedCount(selection, state.count.count);
  // The ticked ids, copied once per selection, not on every render (a selection holds up to 10,000).
  const ids = useMemo(() => (selection.kind === 'some' ? [...selection.ids] : []), [selection]);
  const path = bulkPath(selection, count);
  /** The grid takes focus back at the first of these rows (or the first row), as the bar that held it goes. */
  const focusBackAt = (recordIds: readonly string[], leaving: boolean) => {
    const rows = recordIds.flatMap((id) => {
      const at = view.indexOf(id);
      return at === undefined ? [] : [at];
    });
    const last = Math.max(0, state.source.count - 1 - (leaving ? recordIds.length : 0));
    setFocusRow({ index: Math.max(0, Math.min(...rows, last)) });
  };
  /** Clears the ticks, focus back to the grid where the first of them was. */
  const untick = () => {
    focusBackAt(ids, false);
    setHeld({ view, selection: noRows() });
  };
  // A change this bar (or Empty trash) started, followed until it ends. A count of zero clears the ticks it was
  // for; focus that went with the bar's Cancel comes back to the grid, and stays anywhere else.
  const bulkJob = useBulkJob(slug, names, () => {
    if (isFocusLost()) untick();
    else setHeld({ view, selection: noRows() });
  });
  const clear = () => {
    bulkJob.forget();
    untick();
  };
  /** Keeps these rows ticked (refused ones, back with their reasons), so "2 selected" shows where they are. */
  const keepTicked = (recordIds: readonly string[]) => {
    if (recordIds.length === 0) return;
    setHeld((before) => {
      if (before.view !== view || before.selection.kind === 'all-matching') return before;
      return { view, selection: { kind: 'some', ids: new Set([...before.selection.ids, ...recordIds]) } };
    });
  };
  // Delete forever of picked records waiting for its confirm, and the last one asked, so it closes with its words.
  const [asking, setAsking] = useState<readonly string[] | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<readonly string[]>([]);
  if (asking !== undefined && asking !== lastAsked) setLastAsked(asking);
  // A counted change's confirm, opened by Review: never by itself.
  const [isReviewing, setReviewing] = useState(false);
  if (isReviewing && !bulkJob.isCounted) setReviewing(false);
  // Empty trash asks in its own words once its job is counted.
  const [isEmptying, setEmptying] = useState(false);
  // Asks the bar to take focus: Empty trash started a change it shows, with Cancel.
  const [barFocus, setBarFocus] = useState<object | undefined>(undefined);
  const waitId = useId();

  /** Sets the rows ticked, within the limits (AC-523); "all matching" counts from when it was first chosen. */
  const select = (next: GridSelection) => {
    if (next.kind === 'some' && next.ids.size > BULK_IDS_MAX) {
      toasts.toast({ tone: 'danger', message: bulkStrings.tooManyIds });
      return;
    }
    if (next.kind === 'all-matching' && next.except.size > BULK_EXCEPT_MAX) {
      toasts.toast({ tone: 'danger', message: bulkStrings.tooManyExcept });
      return;
    }
    if (next.kind === 'some') setHeld({ view, selection: next });
    else
      setHeld({
        view,
        selection: next,
        asOf: selection.kind === 'all-matching' ? (asOf ?? new Date().toISOString()) : new Date().toISOString(),
      });
  };
  /** The selection as a job's target: the ids, or the trash of the filter less those left out. */
  const target = (): BulkTarget =>
    selection.kind === 'all-matching'
      ? {
          kind: 'trash',
          ...(objectId === undefined ? {} : { objectId }),
          except: [...selection.except],
          asOf: asOf ?? new Date().toISOString(),
        }
      : { kind: 'ids', recordIds: ids };
  /** Starts a job; a refusal to start says why where it was asked: in the bar, or (Empty trash) in a toast. */
  const startJob = (action: BulkAction, on: BulkTarget, notesIn: NotesIn = 'bar'): Promise<boolean> =>
    bulkJob.start(action, on, undefined, notesIn).then((failure) => {
      if (failure === undefined) return true;
      if (notesIn === 'toast') toasts.toast({ tone: 'danger', message: refusalSummary(failure) });
      else bulkJob.say(refusalSummary(failure), 'danger');
      return false;
    });
  const filteredLabel = filtered === undefined ? undefined : filtered.pluralName;
  // Names and days are worked out once per member list and zone, not per cell.
  const deleters = useMemo(() => deletedByOf(members), [members]);
  const dayOf = useMemo(() => dayFormatter(timeZone), [timeZone]);

  const restore = () => {
    if (path === 'job') {
      setEmptying(false);
      void startJob('restore', target());
      return;
    }
    const [only] = ids.length === 1 ? ids : [];
    const onlyName = only === undefined ? undefined : view.row(only)?.item.display.name;
    // The grid takes focus back where the first restored row was, so the keyboard carries on there.
    focusBackAt(ids, true);
    setHeld({ view, selection: noRows() });
    restoreIds(ids, onlyName);
  };

  /** Restores these records; the toast says what came back, with Retry when the failure passes on its own. */
  const restoreIds = (recordIds: readonly string[], onlyName: string | undefined) => {
    data.trash.restore(slug, recordIds).then(
      (summary) => {
        // The ones kept in the trash stay ticked, each with its reason on its Name cell.
        if (summary.kind === 'done') keepTicked(summary.refusedIds);
        const toast = restoreToast(summary, onlyName, () => {
          restoreIds(recordIds, onlyName);
        });
        if (toast !== undefined) toasts.toast(toast);
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.somethingWrong });
      },
    );
  };

  /** Deletes these records forever; the toast says how many went, and the refused ones stay ticked with why. */
  const purgeIds = (recordIds: readonly string[]) => {
    focusBackAt(recordIds, true);
    setHeld({ view, selection: noRows() });
    data.trash.deleteForever(slug, recordIds).then(
      (summary) => {
        if (summary.kind === 'done') keepTicked(summary.refusedIds);
        const toast = purgeToast(summary, () => {
          purgeIds(recordIds);
        });
        if (toast !== undefined) toasts.toast(toast);
      },
      () => {
        toasts.toast({ tone: 'danger', message: strings.somethingWrong });
      },
    );
  };

  const deleteForever = () => {
    if (path === 'job') {
      setEmptying(false);
      void startJob('purge', target());
      return;
    }
    setAsking(ids);
  };

  const emptyTrash = () => {
    if (bulkJob.isRunning) return;
    setEmptying(true);
    void startJob(
      'purge',
      { kind: 'trash', ...(objectId === undefined ? {} : { objectId }), except: [], asOf: new Date().toISOString() },
      // Its own ending (nothing to delete, a failure) is said in a toast: its button isn't in the bar.
      'toast',
    ).then((isStarted) => {
      if (!isStarted) {
        setEmptying(false);
        return;
      }
      // Focus goes on to the bar, which shows the change and its Cancel, before Empty trash waits for it.
      setBarFocus({});
    });
  };

  // Restore (and Delete forever, which fails closed alike) may act when a ticked row's object may be changed; for
  // all matching, when an object in the list's scope may be (AC-534). Worked out once per selection and rows.
  const canRestoreHere = useMemo(() => canRestoreAll(objectId, objects), [objectId, objects]);
  const isAllowed = useMemo(
    () => (selection.kind === 'all-matching' ? canRestoreHere : canRestore(ids, (id) => view.row(id), byId)),
    // The rows loaded (the source) decide what a ticked id's object is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection.kind, canRestoreHere, ids, view, byId, state.source],
  );
  const { job, note, progress, isRunning } = bulkJob;
  // Up while rows are ticked, a change runs or a note shows; then it plays its exit before the grid gives back its room.
  const isWanted = count > 0 || isRunning || note !== undefined;
  const [isBarShown, setBarShown] = useState(isWanted);
  if (isWanted && !isBarShown) setBarShown(true);
  // Empty trash's own start keeps it in place, pending, until the bar takes focus; any other change turns it off.
  const isEmptyStarting = bulkJob.isStarting && isEmptying;
  const isEmptyOff = isRunning && !isEmptyStarting;

  const actions =
    note?.tone === 'info' ? (
      // A count of zero: said for a moment in the actions' place, while the ticks it was for clear.
      <Callout placement="bar" isAnnounced>
        {note.text}
      </Callout>
    ) : (
      <>
        {/* A refused start or a failed change says why before the actions, which stay to try again. */}
        {note !== undefined && (
          <Callout placement="bar" tone="danger">
            {note.text}
          </Callout>
        )}
        <Button variant="primary" icon="archive-restore" isDisabled={!isAllowed} onPress={restore}>
          {strings.restore}
        </Button>
        {canPurge && (
          <Button variant="danger" icon="trash" isDisabled={!isAllowed} onPress={deleteForever}>
            {strings.deleteForever}
          </Button>
        )}
        {/* Said when it appears: the ticked rows are all of objects the person may only read. */}
        {!isAllowed && (
          <Callout placement="bar" isAnnounced>
            {canPurge ? strings.cannotChange : strings.cannotRestore}
          </Callout>
        )}
      </>
    );
  const bar = isBarShown ? (
    <BulkActionBar
      placement="floating"
      isOpen={isWanted}
      onLeft={() => {
        setBarShown(false);
      }}
      count={count}
      total={state.count.count}
      isTotalAtLeast={state.count.atLeast}
      isAllMatching={selection.kind === 'all-matching'}
      // No action could follow when nothing in the list's scope may be restored, so the offer stays away.
      {...(isRunning || !canRestoreHere
        ? {}
        : {
            onSelectAllMatching: () => {
              setHeld({ view, selection: allMatching(), asOf: new Date().toISOString() });
            },
          })}
      onClear={clear}
      {...(progress === undefined ? {} : { progress })}
      {...(bulkJob.canCancel ? { onCancel: bulkJob.cancel } : {})}
      {...(bulkJob.isCancelling ? { isCancelling: true } : {})}
      {...(bulkJob.isCounted
        ? {
            onReview: () => {
              setReviewing(true);
            },
          }
        : {})}
      {...(barFocus === undefined ? {} : { focusRequest: barFocus })}
    >
      {actions}
    </BulkActionBar>
  ) : undefined;

  // The counted change's words, kept while its confirm closes; in the filtered object's names when there is one.
  const counted = job?.total ?? 0;
  const [lastCounted, setLastCounted] = useState(counted);
  if (bulkJob.isCounted && counted !== lastCounted) setLastCounted(counted);
  const jobWords = recordsWord(lastCounted, names);
  const isRestoreJob = bulkJob.action === 'restore';
  const jobTitle = isEmptying
    ? filteredLabel === undefined
      ? strings.confirmEmptyTitle
      : strings.confirmEmptyObjectTitle(filteredLabel)
    : isRestoreJob
      ? strings.confirmRestoreTitle(jobWords)
      : strings.confirmPurgeTitle(jobWords);
  const jobText = isEmptying
    ? strings.confirmEmptyText(jobWords)
    : isRestoreJob
      ? strings.confirmRestoreText
      : strings.confirmPurgeText;
  const purgeWords = recordsWord(lastAsked.length, names);
  return (
    <SettingsPage
      title={strings.title}
      fillsView
      // The count only while something is in the trash: the empty state already says there is nothing.
      {...(state.status === 'ready' && state.count.count > 0
        ? {
            meta: (
              <Badge
                count={state.count.count}
                max={Infinity}
                isAtLeast={state.count.atLeast}
                label={strings.countLabel(state.count.count)}
              />
            ),
          }
        : {})}
      actions={
        // Owners and admins only (AC-535); always a job, counted and reviewed first. Quiet: the danger is its confirm's.
        canPurge &&
        state.status === 'ready' &&
        state.count.count > 0 && (
          <>
            <Button
              variant="ghost"
              icon="trash"
              isPending={isEmptyStarting}
              isDisabled={isEmptyOff}
              {...(isEmptyOff ? { 'aria-describedby': waitId } : {})}
              onPress={emptyTrash}
            >
              {filteredLabel === undefined ? strings.emptyTrash : strings.emptyObjectTrash(filteredLabel)}
            </Button>
            {/* Why it is off, to screen readers: the bar shows the change it waits for. */}
            {isEmptyOff && <VisuallyHidden id={waitId}>{strings.waitForChange}</VisuallyHidden>}
          </>
        )
      }
    >
      <Toolbar label={strings.filterLabel}>
        <Select
          label={strings.objectFilter}
          isLabelHidden
          size="sm"
          items={[
            { id: ALL, label: strings.allObjects },
            ...objects.map((object) => ({
              id: object.id,
              label: object.isArchived ? strings.archived(object.pluralName) : object.pluralName,
              icon: object.icon,
              hue: object.hue,
            })),
          ]}
          value={objectId ?? ALL}
          onChange={(id) => {
            void navigate({
              to: '/w/$slug/settings/trash',
              params: { slug },
              search: id === null || id === ALL ? {} : { object: id },
            });
          }}
        />
      </Toolbar>
      <DataGrid
        label={strings.title}
        columns={COLUMNS}
        pinnedCount={1}
        rows={state.source}
        getValue={(row, columnId) => cellValue(row, columnId, byId, dayOf)}
        getDisplay={(row, columnId) => {
          if (columnId === TRASH_COLUMNS.name) return row.item.display;
          if (columnId === TRASH_COLUMNS.deletedBy) {
            const by = deleters(row);
            return by === undefined ? undefined : [by];
          }
          return undefined;
        }}
        rowHeader={TRASH_NAME_COLUMN}
        hideColumnLocks
        selection={selection}
        onSelectionChange={select}
        cellErrors={state.cellErrors}
        status={state.status}
        onRetry={view.retry}
        {...(state.error === undefined ? {} : { errorText: state.error.message })}
        emptyState={
          filtered === undefined ? (
            <EmptyState title={strings.emptyTitle} icon="trash">
              {strings.emptyText}
            </EmptyState>
          ) : (
            <EmptyState
              title={strings.emptyObject(filtered.pluralName)}
              icon={filtered.icon}
              actions={
                <Button
                  onPress={() => {
                    void navigate({ to: '/w/$slug/settings/trash', params: { slug }, search: {} });
                  }}
                >
                  {strings.showAll}
                </Button>
              }
            >
              {strings.emptyObjectText(filtered.pluralName)}
            </EmptyState>
          )
        }
        {...(focusRow === undefined ? {} : { focusRow })}
        {...(bar === undefined ? {} : { floatingBar: bar })}
      />
      {/* Delete forever of up to 500 picked records asks first (AC-535). */}
      <Modal
        title={strings.confirmPurgeTitle(purgeWords)}
        tone="danger"
        isOpen={asking !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAsking(undefined);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {strings.cancel}
            </Button>
            <Button
              variant="danger-solid"
              icon="trash"
              onPress={() => {
                const confirmed = asking;
                setAsking(undefined);
                if (confirmed !== undefined) purgeIds(confirmed);
              }}
            >
              {strings.deleteRecordsForever(purgeWords)}
            </Button>
          </>
        }
      >
        {strings.confirmPurgeText}
      </Modal>
      {/*
              A counted change (a restore or Delete forever past 500, all matching, or Empty trash), opened by Review:
              the exact number. Declining cancels it; either way focus goes on to the bar, which keeps it.
            */}
      <Modal
        title={jobTitle}
        tone={isRestoreJob ? 'default' : 'danger'}
        isOpen={isReviewing && bulkJob.isCounted}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          if (bulkJob.isCounted) bulkJob.cancel();
          setReviewing(false);
        }}
        actions={
          <>
            <Button slot="close" kbd="ESC">
              {strings.cancel}
            </Button>
            <Button
              variant={isRestoreJob ? 'primary' : 'danger-solid'}
              icon={isRestoreJob ? 'archive-restore' : 'trash'}
              onPress={() => {
                setReviewing(false);
                setHeld({ view, selection: noRows() });
                bulkJob.confirm();
              }}
            >
              {isRestoreJob ? strings.restoreRecords(jobWords) : strings.deleteRecordsForever(jobWords)}
            </Button>
          </>
        }
      >
        {jobText}
      </Modal>
    </SettingsPage>
  );
}
