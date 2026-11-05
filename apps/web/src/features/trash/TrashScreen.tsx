// Brief
// Purpose: Settings › Data › Trash: each record deleted in the last 30 days that the person may see, newest first.
// Main task: find a record deleted by mistake and restore it from its row (several at once from the bar), seeing why
// one can't come back.
// Leaves out: opening or editing trashed records; Delete forever and Empty trash show only to owners and admins.
import {
  refusalSummary,
  type BulkAction,
  type BulkTarget,
  type MemberSummary,
  type ObjectSummary,
  type TrashRow,
  type TrashView,
} from '@crm/data';
import { useTrash } from '@crm/data/react';
import {
  AttributeDisplay,
  Badge,
  BulkActionBar,
  Button,
  CalloutBar,
  EmptyState,
  focusLater,
  InfoTip,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  PreviewFooter,
  Select,
  sharedStrings,
  Table,
  useFormatSettings,
  VisuallyHidden,
  type TableColumn,
} from '@crm/ui';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { SettingsPage } from '../settings/SettingsPage.tsx';
import { useCan } from '../workspace/WorkspacePage.tsx';
import { BULK_EXCEPT_MAX, BULK_IDS_MAX, bulkPath, bulkStrings, recordsWord } from '../workspace/bulk.ts';
import { useBulkJob, type NotesIn } from '../workspace/useBulkJob.ts';
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
  /** Every object the person may see, archived ones too (for the filter and the Kind column). */
  readonly objects: readonly ObjectSummary[];
  readonly members: readonly MemberSummary[];
  /** The trash of the object in the filter, or of every object. */
  readonly view: TrashView;
  /** The object the list is narrowed to (`?object=`), or undefined for all. */
  readonly objectId: string | undefined;
}

/** The trash's records, named for a count ("48 records"). */
const RECORDS = { singularName: 'Record', pluralName: 'Records' } as const;

/** The value meaning "every kind" in the filter. */
const ALL = 'all';

/** Rows a Show more adds: the trash store's block, so each press reads one block. */
const PAGE = 100;

/**
 * The trash as a settings table (5 November 2026: the records grid's look was clipped in Settings): the record, its
 * kind, who deleted it and when, then Restore. On a phone each row reads as two lines.
 */
const COLUMNS: readonly TableColumn[] = [
  // Inline: a refused restore's words sit beside the name it is about.
  { id: TRASH_COLUMNS.name, label: strings.columns.name, isRowHeader: true, isInline: true, phone: 'title' },
  { id: TRASH_COLUMNS.object, label: strings.columns.kind },
  { id: TRASH_COLUMNS.deletedBy, label: strings.columns.deletedBy },
  { id: TRASH_COLUMNS.deletedAt, label: strings.columns.deletedAt },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end', size: 'fit' },
];

/** Each column's attribute, so its value draws through its type's one display, as the grid drew it. */
const ATTRIBUTES = new Map(TRASH_ATTRIBUTES.map((attribute) => [attribute.id, attribute]));

/**
 * What is ticked: some loaded rows, or every record matching the filter less those unticked (a background change),
 * from the time it was chosen.
 */
type Picked =
  | { readonly kind: 'some'; readonly ids: ReadonlySet<string> }
  | { readonly kind: 'all-matching'; readonly except: ReadonlySet<string>; readonly asOf: string };

const NONE: Picked = { kind: 'some', ids: new Set() };

/** Delete forever waiting for its confirm: picked records, or one row's, named in its words. */
interface Asked {
  readonly ids: readonly string[];
  /** The one record a row's own Delete forever asks about. */
  readonly name?: string;
}

/**
 * The trash while its route loads, in Settings: the bar with its trail and title, the filter's place and the table's
 * loading rows under its columns, so nothing moves when the rows arrive.
 */
export function TrashPending() {
  return (
    <SettingsPage
      title={strings.title}
      // The kind filter's place, as the loaded page draws it (every kind), so the table never moves under it.
      tabBar={{
        end: (
          <Select
            label={strings.kindFilter}
            isLabelHidden
            variant="inline"
            items={[{ id: ALL, label: strings.allKinds }]}
            value={ALL}
            isDisabled
          />
        ),
      }}
    >
      <Table
        label={strings.title}
        columns={COLUMNS}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        phoneLayout="rows"
        isLoading
      />
    </SettingsPage>
  );
}

/**
 * The trash, inside Settings (A120): the bar with its trail, the count and Empty trash, the kind filter, then a
 * settings Table of the deleted records, a block at a time, each with Restore; several restore from the bar.
 */
export function TrashScreen({ slug, objects, members, view, objectId }: TrashScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const state = useTrash(view);
  const byId = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  // The member's own zone (Settings › Account › Preferences), else the browser's.
  const { timeZone } = useFormatSettings();
  // Owners and admins delete forever (records.purge, AC-535); the server refuses anyone else anyway.
  const canPurge = useCan('records.purge');
  const filtered = objectId === undefined ? undefined : byId.get(objectId);
  // The records counted in the filtered object's words when the filter names one ("12 deals"), else "records".
  const names = filtered ?? RECORDS;
  // The rows ticked and how many rows show, for this view only: another filter starts afresh.
  const [held, setHeld] = useState<{ readonly view: TrashView; readonly picked: Picked; readonly shown: number }>(
    () => ({ view, picked: NONE, shown: PAGE }),
  );
  const picked = held.view === view ? held.picked : NONE;
  const shown = held.view === view ? held.shown : PAGE;
  const setPicked = (next: Picked) => {
    setHeld((before) => ({ view, picked: next, shown: before.view === view ? before.shown : PAGE }));
  };
  const { source } = state;
  // The rows shown are the first `shown` of the view's windows; the store reads the blocks they need. Its
  // onRangeChange is one function for the view's life, so a new snapshot alone asks for nothing.
  const end = Math.min(shown, source.count);
  const { onRangeChange } = source;
  useEffect(() => {
    onRangeChange({ start: 0, end });
  }, [onRangeChange, end]);
  const rows = Array.from({ length: end }, (_, index) => source.getItem(index)).filter(
    (row): row is TrashRow => row !== undefined,
  );
  const total = state.count.count;
  const loadedIds = rows.map((row) => row.id);
  const ticked: ReadonlySet<string> =
    picked.kind === 'some'
      ? new Set(loadedIds.filter((id) => picked.ids.has(id)))
      : new Set(loadedIds.filter((id) => !picked.except.has(id)));
  const count = picked.kind === 'some' ? ticked.size : Math.max(0, total - picked.except.size);
  const ids = picked.kind === 'some' ? [...ticked] : [];
  const path = bulkPath(picked, count);
  /** Clears the ticks. */
  const untick = () => {
    setPicked(NONE);
  };
  // A change this bar (or Empty trash) started, followed until it ends; a count of zero clears the ticks it was for.
  const bulkJob = useBulkJob(slug, names, untick);
  const clear = () => {
    bulkJob.forget();
    untick();
    // The Clear in use goes with the bar.
    focusTitle();
  };
  /** Keeps these rows ticked (refused ones, back with their reasons), so "2 selected" shows where they are. */
  const keepTicked = (recordIds: readonly string[]) => {
    if (recordIds.length === 0) return;
    setHeld((before) => {
      if (before.view !== view || before.picked.kind === 'all-matching') return before;
      return { ...before, picked: { kind: 'some', ids: new Set([...before.picked.ids, ...recordIds]) } };
    });
  };
  // Delete forever of picked records waiting for its confirm, and the last one asked, so it closes with its words.
  const [asking, setAsking] = useState<Asked | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<Asked>({ ids: [] });
  if (asking !== undefined && asking !== lastAsked) setLastAsked(asking);
  // A counted change's confirm, opened by Review: never by itself.
  const [isReviewing, setReviewing] = useState(false);
  if (isReviewing && !bulkJob.isCounted) setReviewing(false);
  // Empty trash asks in its own words once its job is counted.
  const [isEmptying, setEmptying] = useState(false);
  // Asks the bar to take focus: Empty trash started a change it shows, with Cancel.
  const [barFocus, setBarFocus] = useState<object | undefined>(undefined);
  const waitId = useId();

  /** Sets the rows ticked from the table, within the limits (AC-523); all matching keeps what is left out. */
  const pick = (next: ReadonlySet<string>) => {
    if (picked.kind === 'all-matching') {
      const except = new Set([...picked.except, ...loadedIds.filter((id) => !next.has(id))]);
      for (const id of next) except.delete(id);
      if (except.size > BULK_EXCEPT_MAX) {
        toasts.toast({ tone: 'danger', message: bulkStrings.tooManyExcept });
        return;
      }
      setPicked(except.size >= total ? NONE : { ...picked, except });
      return;
    }
    if (next.size > BULK_IDS_MAX) {
      toasts.toast({ tone: 'danger', message: bulkStrings.tooManyIds });
      return;
    }
    // Ticks on rows not drawn just now (a block reading again after a restore) stay ticked.
    const unseen = [...picked.ids].filter((id) => !loadedIds.includes(id));
    setPicked({ kind: 'some', ids: new Set([...unseen, ...next]) });
  };
  /** The selection as a job's target: the ids, or the trash of the filter less those left out. */
  const target = (): BulkTarget =>
    picked.kind === 'all-matching'
      ? {
          kind: 'trash',
          ...(objectId === undefined ? {} : { objectId }),
          except: [...picked.except],
          asOf: picked.asOf,
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

  /**
   * Restores these records; the toast says what came back, with Retry when the failure passes on its own. The rows
   * leave at once, the control in use with them, so focus goes to the page's title now. From the bar, those refused
   * stay ticked with their reasons; a row's own Restore leaves the ticks alone.
   */
  const restoreIds = (recordIds: readonly string[], onlyName: string | undefined, fromBar = false) => {
    focusTitle();
    data.trash.restore(slug, recordIds).then(
      (summary) => {
        if (fromBar && summary.kind === 'done') keepTicked(summary.refusedIds);
        const toast = restoreToast(summary, onlyName, () => {
          restoreIds(recordIds, onlyName, fromBar);
        });
        if (toast !== undefined) toasts.toast(toast);
      },
      () => {
        toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
      },
    );
  };

  /** Restores what is ticked: at once up to 500, else as a background change. */
  const restore = () => {
    if (path === 'job') {
      setEmptying(false);
      void startJob('restore', target());
      return;
    }
    const [only] = ids.length === 1 ? ids : [];
    const onlyName = only === undefined ? undefined : view.row(only)?.item.display.name;
    setPicked(NONE);
    restoreIds(ids, onlyName, true);
  };

  /**
   * Deletes these records forever; the toast says how many went. From the bar the ticks clear, the refused ones ticked
   * again with why; a row's own Delete forever leaves them alone. Focus goes to the title once the confirm has gone.
   */
  const purgeIds = (recordIds: readonly string[], fromBar: boolean) => {
    if (fromBar) setPicked(NONE);
    // Once the confirm has gone, or its focus return would win.
    focusLater(() => {
      focusTitle();
      return null;
    });
    data.trash.deleteForever(slug, recordIds).then(
      (summary) => {
        if (fromBar && summary.kind === 'done') keepTicked(summary.refusedIds);
        const toast = purgeToast(summary, () => {
          purgeIds(recordIds, fromBar);
        });
        if (toast !== undefined) toasts.toast(toast);
      },
      () => {
        toasts.toast({ tone: 'danger', message: sharedStrings.couldntDoThat });
      },
    );
  };

  const deleteForever = () => {
    if (path === 'job') {
      setEmptying(false);
      void startJob('purge', target());
      return;
    }
    setAsking({ ids });
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
  // all matching, when an object in the list's scope may be (AC-534).
  const canRestoreHere = useMemo(() => canRestoreAll(objectId, objects), [objectId, objects]);
  const isAllowed = picked.kind === 'all-matching' ? canRestoreHere : canRestore(ids, (id) => view.row(id), byId);
  const { job, note, progress, isRunning } = bulkJob;
  // Up while rows are ticked, a change runs or a note shows; then it plays its exit.
  const isWanted = count > 0 || isRunning || note !== undefined;
  const [isBarShown, setBarShown] = useState(isWanted);
  if (isWanted && !isBarShown) setBarShown(true);
  // Empty trash's own start keeps it in place, pending, until the bar takes focus; any other change turns it off.
  const isEmptyStarting = bulkJob.isStarting && isEmptying;
  const isEmptyOff = isRunning && !isEmptyStarting;

  const actions =
    note?.tone === 'info' ? (
      // A count of zero: said for a moment in the actions' place, while the ticks it was for clear.
      <CalloutBar tone="info" isAnnounced>
        {note.text}
      </CalloutBar>
    ) : (
      <>
        {/* A refused start or a failed change says why before the actions, which stay to try again. */}
        {note !== undefined && <CalloutBar tone="danger">{note.text}</CalloutBar>}
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
          <CalloutBar tone="info" isAnnounced>
            {strings.viewOnly}
          </CalloutBar>
        )}
      </>
    );
  const bar = isBarShown ? (
    <BulkActionBar
      placement="footer"
      isOpen={isWanted}
      onLeft={() => {
        setBarShown(false);
      }}
      count={count}
      total={total}
      isTotalAtLeast={state.count.atLeast}
      isAllMatching={picked.kind === 'all-matching'}
      // No action could follow when nothing in the list's scope may be restored, so the offer stays away.
      {...(isRunning || !canRestoreHere
        ? {}
        : {
            onSelectAllMatching: () => {
              setPicked({ kind: 'all-matching', except: new Set(), asOf: new Date().toISOString() });
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

  /** One record's Restore, or why it can't come back (a refused restore's reason, kept while the page shows). */
  const rowActions = (row: TrashRow): ReactNode => {
    const name = row.item.display.name;
    // Only an object the person may change restores (AC-534); otherwise the row says so and offers nothing.
    const mayChange = byId.get(row.item.objectId)?.access === 'write';
    return (
      <>
        {mayChange ? (
          <Button
            size="sm"
            icon="archive-restore"
            label={strings.restoreFor(name)}
            onPress={() => restoreIds([row.id], name)}
          >
            {strings.restore}
          </Button>
        ) : (
          <Badge text={strings.viewOnlyBadge} isWhole />
        )}
        {canPurge && mayChange && (
          <MenuTrigger>
            <Button variant="ghost" icon="ellipsis" label={strings.rowActions(name)} />
            <Menu
              label={strings.rowActions(name)}
              onAction={(key) => {
                if (key === 'purge') setAsking({ ids: [row.id], name });
              }}
            >
              <MenuItem id="purge" icon="trash" isDanger>
                {strings.deleteForever}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        )}
      </>
    );
  };

  const cell = (row: TrashRow, column: string): ReactNode => {
    if (column === 'actions') return rowActions(row);
    if (column === TRASH_COLUMNS.object) {
      // Its kind: the object's one name for one record ("Person"), archived ones said so.
      const object = byId.get(row.item.objectId);
      if (object === undefined) return null;
      return object.isArchived ? strings.archivedKind(object.singularName) : object.singularName;
    }
    const attribute = ATTRIBUTES.get(column);
    if (attribute === undefined) return null;
    const by = column === TRASH_COLUMNS.deletedBy ? deleters(row) : undefined;
    const display = column === TRASH_COLUMNS.name ? row.item.display : by === undefined ? undefined : [by];
    const value = (
      <AttributeDisplay
        attribute={attribute}
        value={cellValue(row, column, byId, dayOf) as never}
        {...(display === undefined ? {} : { display })}
        surface="cell"
      />
    );
    // A refused restore's reason, on the name it is about (kept until the person leaves), so no other column moves.
    const reason = column === TRASH_COLUMNS.name ? state.cellErrors.get(`${row.id}:${TRASH_COLUMNS.name}`) : undefined;
    if (reason === undefined) return value;
    return (
      <>
        {value}
        <Badge text={strings.notRestored} dot="red" isWhole />
        <InfoTip label={strings.notRestoredFor(row.item.display.name)}>{reason}</InfoTip>
      </>
    );
  };

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
      ? // Restoring says it all in its title; the buttons name the count.
        undefined
      : strings.confirmPurgeText;
  const purgeWords = lastAsked.name ?? recordsWord(lastAsked.ids.length, names);
  // Nothing in the trash (or in this kind's): one block EmptyState on the page, as every settings page's empty
  // state reads.
  const isEmpty = state.status === 'ready' && total === 0;
  const empty =
    filtered === undefined ? (
      <EmptyState layout="block" title={strings.emptyTitle} icon="trash">
        {strings.emptyText}
      </EmptyState>
    ) : (
      <EmptyState
        layout="block"
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
    );
  // The kind filter, at the body's top, only while there is something to narrow, or a narrowed list to widen again:
  // the kind as text with its chevron, over the table's first column, rather than a box the body's whole width.
  const filter =
    !isEmpty || filtered !== undefined ? (
      <Select
        label={strings.kindFilter}
        isLabelHidden
        variant="inline"
        items={[
          { id: ALL, label: strings.allKinds },
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
    ) : undefined;
  return (
    <SettingsPage
      title={strings.title}
      // The page's tools open its body (no tab bar here): the kind filter.
      {...(filter === undefined ? {} : { tabBar: { end: filter } })}
      // The count only while something is in the trash: the empty state already says there is nothing.
      {...(state.status === 'ready' && total > 0
        ? {
            meta: (
              <Badge count={total} max={Infinity} isAtLeast={state.count.atLeast} label={strings.countLabel(total)} />
            ),
          }
        : {})}
      actions={
        // Owners and admins only (AC-535); always a job, counted and reviewed first. Quiet: the danger is its confirm's.
        canPurge &&
        state.status === 'ready' &&
        total > 0 && (
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
      {isEmpty ? (
        empty
      ) : state.status === 'error' ? (
        <EmptyState layout="block" tone="error" title={strings.failedTitle} onRetry={view.retry}>
          {state.error?.message ?? sharedStrings.couldntDoThat}
        </EmptyState>
      ) : (
        <Table
          label={strings.title}
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.id}
          renderCell={cell}
          isLoading={state.status === 'loading'}
          // On a phone each row reads as two lines: the record, then its kind, who and when, and Restore.
          phoneLayout="rows"
          selected={ticked}
          onSelectedChange={pick}
          getSelectLabel={(row) => row.item.display.name}
          // While more wait, how many show and the next block; the bar's badge says the whole count.
          {...(rows.length < total
            ? {
                footer: (
                  <>
                    {strings.shownOf(rows.length, total, state.count.atLeast)}
                    {/* Never a cap: one kind can hold thousands, and a record nobody can reach is purged at 30 days. */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        const next = shown + PAGE;
                        setHeld((before) => ({ ...before, view, shown: next }));
                        // Asked outright too: a block that failed is read again even when the range stays the same.
                        onRangeChange({ start: 0, end: Math.min(next, source.count) });
                      }}
                    >
                      {strings.showMore}
                    </Button>
                  </>
                ),
              }
            : {})}
        />
      )}
      {/* At the view's foot however long the list, as a form's Submissions: never a scroll away from the ticks. */}
      {bar !== undefined && <PreviewFooter>{bar}</PreviewFooter>}
      {/* Delete forever of up to 500 picked records asks first (AC-535). */}
      <Modal
        title={strings.confirmPurgeTitle(purgeWords)}
        variant="confirm"
        tone="danger"
        isOpen={asking !== undefined}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAsking(undefined);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant="danger-solid"
              icon="trash"
              onPress={() => {
                const confirmed = asking;
                setAsking(undefined);
                if (confirmed !== undefined) purgeIds(confirmed.ids, confirmed.name === undefined);
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
        A counted change (a restore or Delete forever past 500, all matching, or Empty trash), opened by Review: the
        exact number. Declining cancels it; either way focus goes on to the bar, which keeps it.
      */}
      <Modal
        title={jobTitle}
        variant="confirm"
        tone={isRestoreJob ? 'default' : 'danger'}
        isOpen={isReviewing && bulkJob.isCounted}
        onOpenChange={(isOpen) => {
          if (isOpen) return;
          if (bulkJob.isCounted) bulkJob.cancel();
          setReviewing(false);
        }}
        actions={
          <>
            <Button slot="close">{strings.cancel}</Button>
            <Button
              variant={isRestoreJob ? 'primary' : 'danger-solid'}
              icon={isRestoreJob ? 'archive-restore' : 'trash'}
              onPress={() => {
                setReviewing(false);
                setPicked(NONE);
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
