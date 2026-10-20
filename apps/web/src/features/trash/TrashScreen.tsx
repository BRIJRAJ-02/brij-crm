// Brief
// Purpose: the workspace's trash: every record deleted in the last 30 days that the person may see, newest first.
// Main task: find a record deleted by mistake and restore it (several at once), seeing why one can't come back.
// Leaves out: opening or editing trashed records; Delete forever and Empty trash show only to owners and admins.
import {
  refusalSummary,
  TRASH_NAME_COLUMN,
  type BulkAction,
  type BulkTarget,
  type MemberSummary,
  type ObjectSummary,
  type TrashView,
} from '@crm/data';
import { useTrash } from '@crm/data/react';
import { Badge, BulkActionBar, Button, Callout, EmptyState, Modal, Select, Toolbar, TopBar } from '@crm/ui';
import {
  allMatching,
  columnWidthFor,
  DataGrid,
  noRows,
  selectedCount,
  type GridColumn,
  type GridSelection,
} from '@crm/ui/grid';
import { useNavigate, useRouteContext } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useCan, WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { BULK_EXCEPT_MAX, BULK_IDS_MAX, bulkPath, bulkStrings, recordsWord } from '../workspace/bulk.ts';
import { useBulkJob } from '../workspace/useBulkJob.ts';
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

/** What a confirm asks about: Delete forever of picked records, or a counted job (a restore, a purge, Empty trash). */
type Asking = { readonly kind: 'purge'; readonly ids: readonly string[] } | { readonly kind: 'job' };

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

/** The trash: TopBar with the count, the object filter, the read only grid, and Restore in the bulk bar. */
export function TrashScreen({ slug, objects, members, view, objectId }: TrashScreenProps) {
  const { data, toasts } = useRouteContext({ from: '__root__' });
  const navigate = useNavigate();
  const state = useTrash(view);
  const byId = useMemo(() => new Map(objects.map((object) => [object.id, object])), [objects]);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
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
  const bulkJob = useBulkJob(slug);
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [lastAsked, setLastAsked] = useState<Asking | undefined>(undefined);
  // Empty trash asks in its own words once its job is counted.
  const [isEmptying, setEmptying] = useState(false);
  const open: Asking | undefined = asking ?? (bulkJob.awaiting === undefined ? undefined : { kind: 'job' });
  if (open !== undefined && open !== lastAsked && open.kind !== lastAsked?.kind) setLastAsked(open);
  const [focusRow, setFocusRow] = useState<{ readonly index: number } | undefined>(undefined);
  const count = selectedCount(selection, state.count.count);
  const ids = selection.kind === 'some' ? [...selection.ids] : [];
  const path = bulkPath(selection, count);
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
  /** Starts a job; a refusal to start says why in the bar. */
  const startJob = (action: BulkAction, on: BulkTarget) => {
    void bulkJob.start(action, on).then((failure) => {
      if (failure !== undefined) bulkJob.say(refusalSummary(failure));
    });
  };
  const filtered = objectId === undefined ? undefined : byId.get(objectId);
  // Names and days are worked out once per member list and zone, not per cell.
  const deleters = useMemo(() => deletedByOf(members), [members]);
  const dayOf = useMemo(() => dayFormatter(timeZone), [timeZone]);
  /** The grid takes focus back at the first of these rows (or the first row), as the bar that held it goes. */
  const focusBackAt = (recordIds: readonly string[], leaving: boolean) => {
    const rows = recordIds.flatMap((id) => {
      const at = view.indexOf(id);
      return at === undefined ? [] : [at];
    });
    const last = Math.max(0, state.source.count - 1 - (leaving ? recordIds.length : 0));
    setFocusRow({ index: Math.max(0, Math.min(...rows, last)) });
  };
  const clear = () => {
    focusBackAt(ids, false);
    setHeld({ view, selection: noRows() });
  };

  const restore = () => {
    if (path === 'job') {
      setEmptying(false);
      startJob('restore', target());
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

  /** Deletes these records forever; the toast says how many went. */
  const purgeIds = (recordIds: readonly string[]) => {
    focusBackAt(recordIds, true);
    setHeld({ view, selection: noRows() });
    data.trash.deleteForever(slug, recordIds).then(
      (summary) => {
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
      startJob('purge', target());
      return;
    }
    setAsking({ kind: 'purge', ids });
  };

  const emptyTrash = () => {
    setEmptying(true);
    startJob('purge', {
      kind: 'trash',
      ...(objectId === undefined ? {} : { objectId }),
      except: [],
      asOf: new Date().toISOString(),
    });
  };

  const isAllowed =
    selection.kind === 'all-matching'
      ? canRestoreAll(objectId, objects)
      : canRestore(
          ids.map((id) => view.row(id)),
          byId,
        );
  const { job, note, progress, isRunning } = bulkJob;
  const shownAsk = open ?? lastAsked;
  const askedCount =
    shownAsk === undefined ? 0 : shownAsk.kind === 'purge' ? shownAsk.ids.length : (bulkJob.awaiting?.total ?? 0);
  const words = recordsWord(askedCount, RECORDS);
  const isRestoreJob = shownAsk?.kind === 'job' && bulkJob.action === 'restore';
  const title =
    shownAsk?.kind === 'job' && isEmptying
      ? strings.confirmEmptyTitle
      : isRestoreJob
        ? strings.confirmRestoreTitle(words)
        : strings.confirmPurgeTitle(words);
  const text =
    shownAsk?.kind === 'job' && isEmptying
      ? strings.confirmEmptyText(words)
      : isRestoreJob
        ? strings.confirmRestoreText
        : strings.confirmPurgeText;
  return (
    <WorkspacePage
      currentPage="trash"
      page={{
        topBar: (
          <TopBar
            title={strings.title}
            icon="trash"
            {...(state.status === 'ready'
              ? {
                  meta: (
                    <Badge
                      count={state.count.count}
                      max={Infinity}
                      isAtLeast={state.count.atLeast}
                      label={strings.countLabel}
                    />
                  ),
                }
              : {})}
          >
            {/* Owners and admins only (AC-535); always a job, counted and confirmed first. */}
            {canPurge && state.status === 'ready' && state.count.count > 0 && (
              <Button variant="ghost" icon="trash" isDisabled={isRunning} onPress={emptyTrash}>
                {strings.emptyTrash}
              </Button>
            )}
          </TopBar>
        ),
        viewBar: (
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
                  to: '/w/$slug/trash',
                  params: { slug },
                  search: id === null || id === ALL ? {} : { object: id },
                });
              }}
            />
          </Toolbar>
        ),
        body: (
          <>
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
                          void navigate({ to: '/w/$slug/trash', params: { slug }, search: {} });
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
              floatingBar={
                (count > 0 || isRunning || note !== undefined) && (
                  <BulkActionBar
                    placement="floating"
                    count={count === 0 ? (job?.total ?? 0) : count}
                    total={state.count.count}
                    isTotalAtLeast={state.count.atLeast}
                    isAllMatching={selection.kind === 'all-matching'}
                    {...(isRunning
                      ? {}
                      : {
                          onSelectAllMatching: () => {
                            setHeld({ view, selection: allMatching(), asOf: new Date().toISOString() });
                          },
                        })}
                    onClear={clear}
                    {...(progress === undefined ? {} : { progress })}
                    {...(job?.cancellable === true ? { onCancel: bulkJob.cancel } : {})}
                  >
                    {note !== undefined ? (
                      <Callout placement="bar" isAnnounced>
                        {note}
                      </Callout>
                    ) : (
                      <>
                        <Button variant="primary" icon="archive-restore" isDisabled={!isAllowed} onPress={restore}>
                          {strings.restore}
                        </Button>
                        {canPurge && (
                          <Button variant="danger" icon="trash" onPress={deleteForever}>
                            {strings.deleteForever}
                          </Button>
                        )}
                        {/* Said when it appears: the ticked rows are all of objects the person may only read. */}
                        {!isAllowed && (
                          <Callout placement="bar" isAnnounced>
                            {strings.cannotRestore}
                          </Callout>
                        )}
                      </>
                    )}
                  </BulkActionBar>
                )
              }
            />
            <Modal
              title={title}
              tone={isRestoreJob ? 'default' : 'danger'}
              isOpen={open !== undefined}
              onOpenChange={(isOpen) => {
                if (isOpen) return;
                // Closing a counted job's confirm without confirming cancels it: nothing was changed.
                if (open?.kind === 'job') bulkJob.cancel();
                setAsking(undefined);
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
                      const confirmed = open;
                      setAsking(undefined);
                      if (confirmed?.kind === 'purge') purgeIds(confirmed.ids);
                      if (confirmed?.kind === 'job') {
                        setHeld({ view, selection: noRows() });
                        bulkJob.confirm();
                      }
                    }}
                  >
                    {isRestoreJob ? strings.restore : strings.deleteForever}
                  </Button>
                </>
              }
            >
              {text}
            </Modal>
          </>
        ),
      }}
    />
  );
}
