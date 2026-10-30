// Brief
// Purpose: one import's page: its progress while it runs, then what it did, kept for its 7 day undo window.
// Main task: see how many rows were created, updated and not imported, and why; undo the import if it was wrong.
// Leaves out: editing the import's settings, running it again, and the imported records themselves (View records
// opens the table on today's new records, newest first, as a draft).
import {
  isDataError,
  type DataLayer,
  type ImportRowRefusal,
  type ImportView,
  type JobView,
  type ObjectSummary,
} from '@crm/data';
import { CSV_BOM, csvLine } from '@crm/data/imports';
import { useJob } from '@crm/data/react';
import {
  Button,
  Callout,
  Card,
  DescriptionList,
  Modal,
  PageColumn,
  ProgressBar,
  RelativeTime,
  sharedStrings,
  Table,
  type TableColumn,
  TopBar,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { focusTitle } from '../navigation/focus-title.ts';
import { createView } from '../views/query.ts';
import { objectHref, viewHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { saveCsv } from './download.ts';
import { n, strings } from './strings.ts';

/** Props for an import's summary: what its route loaded through the data layer. */
export interface ImportSummaryProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly initial: ImportView;
  /** The first page of rows not imported, or imported with a note. */
  readonly refused: readonly ImportRowRefusal[];
  readonly nextCursor: number | undefined;
}

const FINISHED: readonly string[] = ['succeeded', 'failed', 'cancelled'];
const isOver = (job: JobView | undefined): boolean => job !== undefined && FINISHED.includes(job.status);

const REFUSED_COLUMNS: readonly TableColumn[] = [
  { id: 'row', label: strings.rowColumn, isRowHeader: true, align: 'end' },
  { id: 'reason', label: strings.reasonColumn },
];

/** A job's progress bar: rows handled of its total, or a sliding bar before it has counted (or arrived). */
function JobProgress({ job, label }: { readonly job: JobView | undefined; readonly label: string }) {
  const handled = job === undefined ? 0 : job.done + job.refused + job.skipped;
  if (job?.total === undefined || job.total === 0) return <ProgressBar label={label} isIndeterminate />;
  return (
    <ProgressBar label={`${label}: ${strings.progress(handled, job.total)}`} value={handled} maxValue={job.total} />
  );
}

/** How the import ended, as the summary's title says it. */
function outcomeTitle(view: ImportView, job: JobView | undefined, undoJob: JobView | undefined): string {
  if (view.status === 'staging') return strings.notStarted;
  // The import reads `undone` from the moment its undo starts (late trap #21): an undo that failed or was
  // cancelled part way says so, and Undo stays open to finish it.
  if (view.status === 'undone' && (undoJob?.status === 'failed' || undoJob?.status === 'cancelled')) {
    return strings.undoStopped;
  }
  if (view.status === 'undone') return strings.undone;
  if (job?.status === 'failed') return strings.failed;
  if (job?.status === 'cancelled') return strings.cancelled;
  return strings.finished;
}

/** One import's page (AC-1125, AC-1127 to AC-1129): live progress, the counts, the rows not imported, and Undo. */
export function ImportSummary({ data, slug, object, initial, refused: firstRefused, nextCursor }: ImportSummaryProps) {
  const navigate = useNavigate();
  const [view, setView] = useState(initial);
  const [refused, setRefused] = useState(firstRefused);
  const [cursor, setCursor] = useState(nextCursor);
  const [isMoreLoading, setMoreLoading] = useState(false);
  const [isDownloading, setDownloading] = useState(false);
  const [isConfirmingUndo, setConfirmingUndo] = useState(false);
  const [isConfirmingCancel, setConfirmingCancel] = useState(false);
  const [isUndoing, setUndoing] = useState(false);
  const [isCancelling, setCancelling] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const job = useJob(data.jobs, slug, view.jobId);
  const undoJob = useJob(data.jobs, slug, view.undoJobId);
  // Running until its job says it ended: a started import still holding pending rows, before its job is in, too.
  const isRunning =
    view.status === 'started' &&
    view.jobId !== undefined &&
    !isOver(job) &&
    (job !== undefined || view.counts.pending > 0);
  const isUndoRunning =
    view.undoJobId !== undefined && view.status === 'undone' && undoJob !== undefined && !isOver(undoJob);
  const fail = () => {
    setFailure(sharedStrings.couldntDoThat);
  };

  // A job ending reads the import again: its counts by outcome, its rows not imported, and whether undo is open.
  // A view read while its job ran, shown after the job ended (it ended before the page drew), counts as running.
  const wasRunning = useRef(isRunning || isUndoRunning || (view.status === 'started' && view.counts.pending > 0));
  // The route read the import again (coming back to the page): show what it read, as this render draws.
  const [readByRoute, setReadByRoute] = useState(initial);
  if (readByRoute !== initial) {
    setReadByRoute(initial);
    setView(initial);
    setRefused(firstRefused);
    setCursor(nextCursor);
  }
  useEffect(() => {
    const running = isRunning || isUndoRunning;
    if (wasRunning.current && !running) {
      Promise.all([data.imports.get(slug, view.id), data.imports.rows(slug, view.id)]).then(([fresh, page]) => {
        setView(fresh);
        setRefused(page.rows);
        setCursor(page.nextCursor);
        focusTitle();
      }, fail);
    }
    wasRunning.current = running;
  }, [data, slug, view.id, isRunning, isUndoRunning]);

  const showMore = () => {
    if (cursor === undefined || isMoreLoading) return;
    setMoreLoading(true);
    data.imports.rows(slug, view.id, cursor).then(
      (page) => {
        setRefused((current) => [...current, ...page.rows]);
        setCursor(page.nextCursor);
        setMoreLoading(false);
      },
      () => {
        setMoreLoading(false);
        fail();
      },
    );
  };

  // Every row not imported, read page by page, as a CSV of row numbers and reasons.
  const downloadRefused = async () => {
    if (isDownloading) return;
    setDownloading(true);
    try {
      const all = [...refused];
      let next = cursor;
      while (next !== undefined) {
        const page = await data.imports.rows(slug, view.id, next);
        all.push(...page.rows);
        next = page.nextCursor;
      }
      const lines = all.map((row) => csvLine([row.rowNumber, row.message]));
      saveCsv(
        strings.refusedFile(view.fileName),
        `${CSV_BOM}${csvLine([strings.rowColumn, strings.reasonColumn])}${lines.join('')}`,
      );
    } catch {
      fail();
    } finally {
      setDownloading(false);
    }
  };

  const undo = () => {
    setConfirmingUndo(false);
    setUndoing(true);
    setFailure(undefined);
    data.imports.undo(slug, view.id).then(
      (next) => {
        setView(next);
        setUndoing(false);
        focusTitle();
      },
      (error: unknown) => {
        setUndoing(false);
        setFailure(isDataError(error) ? error.message : sharedStrings.couldntDoThat);
      },
    );
  };

  const cancel = () => {
    setConfirmingCancel(false);
    if (view.jobId === undefined) return;
    setCancelling(true);
    data.jobs.cancel(slug, view.jobId).then(
      (landed) => {
        setCancelling(false);
        if (!landed) fail();
      },
      () => {
        setCancelling(false);
        fail();
      },
    );
  };

  /**
   * View records: the object's table on the records made today, newest
   * first, as an unsaved draft of its table view (no filter by import
   * exists), so the rows just imported lead. The object's page when that
   * can't be built.
   */
  const viewRecords = async () => {
    const fallback = objectHref(slug, object);
    try {
      const views = data.views.list(slug, object.id);
      const [, attributes] = await Promise.all([views.ready(), data.attributes.list(slug, object.id)]);
      const list = views.getSnapshot();
      const viewId = list.status === 'ready' ? createView(list) : undefined;
      const created = attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === 'created_at');
      const draft =
        created === undefined
          ? undefined
          : data.views.draftParam({
              filter: {
                conjunction: 'and',
                conditions: [{ attributeId: created.id, operator: 'within', range: 'today' }],
              },
              sorts: [{ attributeId: created.id, direction: 'descending' }],
            });
      void navigate({
        href:
          viewId === undefined
            ? fallback
            : `${viewHref(slug, object.apiSlug, viewId)}${draft === undefined ? '' : `?draft=${draft}`}`,
      });
    } catch {
      void navigate({ href: fallback });
    }
  };

  const { counts } = view;
  // Only what happened: a count of none says nothing. Rows skipped, refused or left out for errors are one figure.
  const summary = [
    { term: strings.counts.created, value: counts.created },
    { term: strings.counts.updated, value: counts.updated },
    { term: strings.counts.refused, value: counts.skipped + counts.refused + view.errorRows },
    { term: strings.counts.undone, value: counts.undone },
  ]
    .filter((each) => each.value > 0)
    .map((each) => ({ term: each.term, description: n(each.value) }));
  const items = [
    ...summary,
    ...(view.canUndo && view.undoUntil !== undefined
      ? [{ term: strings.undoCloses, description: <RelativeTime value={view.undoUntil} /> }]
      : []),
  ];

  const topBar = (
    <TopBar
      title={strings.summaryTitle(view.fileName)}
      icon={object.icon}
      hue={object.hue}
      crumbs={[{ id: 'object', label: object.pluralName, href: objectHref(slug, object) }]}
    />
  );

  const failed =
    failure === undefined ? undefined : (
      <Callout tone="danger" isAnnounced>
        {failure}
      </Callout>
    );

  const body = (
    <PageColumn>
      {isRunning ? (
        <Card
          title={job?.status === 'queued' ? strings.queued : strings.running}
          footer={
            job?.cancellable === true ? (
              <Button isPending={isCancelling} onPress={() => setConfirmingCancel(true)}>
                {strings.cancel}
              </Button>
            ) : undefined
          }
        >
          <JobProgress job={job} label={strings.running} />
          {failed}
        </Card>
      ) : (
        <Card
          title={isUndoRunning ? strings.undoing : outcomeTitle(view, job, undoJob)}
          footer={
            <>
              {view.canUndo && (
                <Button variant="danger" isPending={isUndoing} onPress={() => setConfirmingUndo(true)}>
                  {strings.undo}
                </Button>
              )}
              <Button variant="primary" onPress={() => void viewRecords()}>
                {strings.viewRecords(object.pluralName)}
              </Button>
            </>
          }
        >
          {isUndoRunning && <JobProgress job={undoJob} label={strings.undoing} />}
          {failed}
          {job?.error !== undefined && <Callout tone="danger">{job.error.message}</Callout>}
          {items.length > 0 && <DescriptionList items={items} />}
        </Card>
      )}
      {refused.length > 0 && (
        <Card
          title={strings.refusedTitle}
          actions={
            <Button variant="ghost" icon="download" isPending={isDownloading} onPress={() => void downloadRefused()}>
              {strings.downloadRefused}
            </Button>
          }
          {...(cursor === undefined
            ? {}
            : {
                footer: (
                  <Button isPending={isMoreLoading} onPress={showMore}>
                    {strings.showMore}
                  </Button>
                ),
              })}
        >
          <Table
            label={strings.refusedLabel}
            columns={REFUSED_COLUMNS}
            rows={refused}
            getRowId={(row) => `row-${String(row.rowNumber)}`}
            renderCell={(row, columnId) => (columnId === 'row' ? n(row.rowNumber) : row.message)}
          />
        </Card>
      )}
      <Modal
        title={strings.undoTitle}
        variant="confirm"
        tone="danger"
        isOpen={isConfirmingUndo}
        onOpenChange={setConfirmingUndo}
        actions={
          <>
            <Button slot="close">{strings.keepImport}</Button>
            <Button variant="danger-solid" onPress={undo}>
              {strings.undo}
            </Button>
          </>
        }
      >
        {strings.undoText(counts.created, counts.updated)}
      </Modal>
      <Modal
        title={strings.cancelTitle}
        variant="confirm"
        tone="danger"
        isOpen={isConfirmingCancel}
        onOpenChange={setConfirmingCancel}
        actions={
          <>
            <Button slot="close">{strings.dontCancel}</Button>
            <Button variant="danger-solid" onPress={cancel}>
              {strings.cancel}
            </Button>
          </>
        }
      >
        {strings.cancelText}
      </Modal>
    </PageColumn>
  );

  return <WorkspacePage currentObject={object.apiSlug} page={{ topBar, body }} />;
}
