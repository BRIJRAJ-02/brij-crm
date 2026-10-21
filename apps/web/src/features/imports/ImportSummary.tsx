// Brief
// Purpose: one import's page: its progress while it runs, then what it did, kept for its 7 day undo window.
// Main task: see how many rows were created, updated, skipped and refused, and why; undo the import if it was wrong.
// Leaves out: editing the import's settings, running it again, and the imported records themselves (View records).
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
  EmptyState,
  Modal,
  PageColumn,
  ProgressBar,
  RelativeTime,
  Table,
  TopBar,
  type TableColumn,
} from '@crm/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { objectHref } from '../workspace/objects.ts';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { saveCsv } from './download.ts';
import { importHref } from './paths.ts';
import { n, strings } from './strings.ts';

/** Props for an import's summary: what its route loaded through the data layer. */
export interface ImportSummaryProps {
  readonly data: DataLayer;
  readonly slug: string;
  readonly object: ObjectSummary;
  readonly initial: ImportView;
  /** The first page of refused and noted rows. */
  readonly refused: readonly ImportRowRefusal[];
  readonly nextCursor: number | undefined;
}

const FINISHED: readonly string[] = ['succeeded', 'failed', 'cancelled'];
const isOver = (job: JobView | undefined): boolean => job === undefined || FINISHED.includes(job.status);

const REFUSED_COLUMNS: readonly TableColumn[] = [
  { id: 'row', label: strings.rowColumn, isRowHeader: true, align: 'end' },
  { id: 'reason', label: strings.reasonColumn },
];

/** A job's progress bar: rows handled of its total, or a sliding bar before it has counted. */
function JobProgress({ job, label }: { readonly job: JobView; readonly label: string }) {
  const handled = job.done + job.refused + job.skipped;
  if (job.total === undefined || job.total === 0) return <ProgressBar label={label} isIndeterminate />;
  return (
    <ProgressBar label={`${label}: ${strings.progress(handled, job.total)}`} value={handled} maxValue={job.total} />
  );
}

/** How the import ended, as the summary's title says it. */
function outcomeTitle(view: ImportView, job: JobView | undefined): string {
  if (view.status === 'undone') return strings.undone;
  if (job?.status === 'failed') return strings.failed;
  if (job?.status === 'cancelled') return strings.cancelled;
  return strings.finished;
}

/** One import's page (AC-1125, AC-1127 to AC-1129): live progress, the counts, the refused rows, and Undo. */
export function ImportSummary({ data, slug, object, initial, refused: firstRefused, nextCursor }: ImportSummaryProps) {
  const navigate = useNavigate();
  const [view, setView] = useState(initial);
  const [refused, setRefused] = useState(firstRefused);
  const [cursor, setCursor] = useState(nextCursor);
  const [isMoreLoading, setMoreLoading] = useState(false);
  const [isConfirmingUndo, setConfirmingUndo] = useState(false);
  const [isConfirmingCancel, setConfirmingCancel] = useState(false);
  const [isUndoing, setUndoing] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const job = useJob(data.jobs, slug, view.jobId);
  const undoJob = useJob(data.jobs, slug, view.undoJobId);
  const isRunning = view.status === 'started' && view.jobId !== undefined && job !== undefined && !isOver(job);
  const isUndoRunning = view.undoJobId !== undefined && undoJob !== undefined && !isOver(undoJob);

  // A job ending reads the import again: its counts by outcome, its refused rows, and whether undo is open.
  const wasRunning = useRef(isRunning || isUndoRunning);
  useEffect(() => {
    const running = isRunning || isUndoRunning;
    if (wasRunning.current && !running) {
      void Promise.all([data.imports.get(slug, view.id), data.imports.rows(slug, view.id)]).then(
        ([fresh, page]) => {
          setView(fresh);
          setRefused(page.rows);
          setCursor(page.nextCursor);
        },
        () => undefined,
      );
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
      () => setMoreLoading(false),
    );
  };

  // Every refused row, read page by page, as a CSV of row numbers and reasons.
  const downloadRefused = async () => {
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
  };

  const undo = () => {
    setConfirmingUndo(false);
    setUndoing(true);
    setFailure(undefined);
    data.imports.undo(slug, view.id).then(
      (next) => {
        setView(next);
        setUndoing(false);
      },
      (error: unknown) => {
        setUndoing(false);
        setFailure(isDataError(error) ? error.message : strings.somethingWrong);
      },
    );
  };

  const { counts } = view;
  const summary = [
    { term: strings.counts.created, description: n(counts.created) },
    { term: strings.counts.updated, description: n(counts.updated) },
    { term: strings.counts.skipped, description: n(counts.skipped) },
    { term: strings.counts.refused, description: n(counts.refused) },
    ...(view.errorRows > 0 ? [{ term: strings.counts.errorRows, description: n(view.errorRows) }] : []),
    ...(view.canUndo && view.undoUntil !== undefined
      ? [{ term: strings.undoUntil, description: <RelativeTime value={view.undoUntil} /> }]
      : []),
  ];

  const topBar = (
    <TopBar
      title={strings.summaryTitle(view.fileName)}
      icon={object.icon}
      hue={object.hue}
      crumbs={[
        { id: 'object', label: object.pluralName, href: objectHref(slug, object) },
        { id: 'import', label: strings.importsCrumb, href: importHref(slug, object) },
        { id: 'file', label: view.fileName },
      ]}
    />
  );

  const body = (
    <PageColumn>
      {isRunning ? (
        <Card
          title={job.status === 'queued' ? strings.queued : strings.running}
          footer={
            job.cancellable ? <Button onPress={() => setConfirmingCancel(true)}>{strings.cancel}</Button> : undefined
          }
        >
          <JobProgress job={job} label={strings.running} />
        </Card>
      ) : (
        <Card
          title={isUndoRunning ? strings.undoing : outcomeTitle(view, job)}
          description={strings.split(counts.created, counts.updated)}
          footer={
            <>
              <Button onPress={() => void navigate({ href: objectHref(slug, object) })}>
                {strings.viewRecords(object.pluralName)}
              </Button>
              {view.canUndo && (
                <Button variant="danger" isPending={isUndoing} onPress={() => setConfirmingUndo(true)}>
                  {strings.undo}
                </Button>
              )}
            </>
          }
        >
          {isUndoRunning && <JobProgress job={undoJob} label={strings.undoing} />}
          {failure !== undefined && (
            <Callout tone="danger" isAnnounced>
              {failure}
            </Callout>
          )}
          {job?.error !== undefined && <Callout tone="danger">{job.error.message}</Callout>}
          <DescriptionList items={summary} />
        </Card>
      )}
      <Card
        title={strings.refusedTitle}
        actions={
          refused.length > 0 ? (
            <Button variant="ghost" icon="download" onPress={() => void downloadRefused()}>
              {strings.downloadRefused}
            </Button>
          ) : undefined
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
          getRowId={(row) => String(row.rowNumber)}
          emptyState={<EmptyState title={strings.noRefused} layout="row" />}
          renderCell={(row, columnId) => (columnId === 'row' ? n(row.rowNumber) : row.message)}
        />
      </Card>
      <Modal
        title={strings.undoTitle}
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
        {strings.undoText(counts.created, counts.updated, object.pluralName, object.singularName)}
      </Modal>
      <Modal
        title={strings.cancelTitle}
        tone="danger"
        isOpen={isConfirmingCancel}
        onOpenChange={setConfirmingCancel}
        actions={
          <>
            <Button slot="close">{strings.dontCancel}</Button>
            <Button
              variant="danger-solid"
              onPress={() => {
                setConfirmingCancel(false);
                if (view.jobId !== undefined) void data.jobs.cancel(slug, view.jobId);
              }}
            >
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
