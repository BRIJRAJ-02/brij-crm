// Brief
// Purpose: Settings, Background jobs: the workspace's long work, with its progress, live.
// Main task: see how a job is doing, and cancel it (with a confirm); owners and admins see every job, members their own.
// Leaves out: confirming a prepared job and retry controls (milestone 2), and the daily cleanup's details (milestone 3).
import type { DataLayer, JobsView, JobView, MemberSummary } from '@crm/data';
import { useJobs } from '@crm/data/react';
import { Badge, Button, EmptyState, Modal, ProgressBar, RelativeTime, Table, TopBar, type TableColumn } from '@crm/ui';
import { useEffect, useRef, useState } from 'react';
import { WorkspacePage } from '../workspace/WorkspacePage.tsx';
import { strings } from './strings.ts';

/** Props for the Background jobs screen: what its route loaded through the data layer. */
export interface JobsScreenProps {
  readonly data: DataLayer;
  readonly slug: string;
  /** The view of the jobs the person may see: every job for `jobs.manage`, else their own. */
  readonly view: JobsView;
  /** Whether the view is every job in the workspace (`all`), or the person's own. */
  readonly isAll: boolean;
  /** The workspace's active members, for "Started by". */
  readonly members: readonly MemberSummary[];
  /** Whether "Run a test job" shows: `jobs.manage`, locally and in previews (AC-123). */
  readonly canRunTest: boolean;
}

/** The test job "Run a test job" starts: 20,000 synthetic items, every 50th refused, so progress and the refusal summary show. */
const TEST_JOB = { items: 20_000, batchSize: 500, batchMillis: 200, refuseEvery: 50 } as const;

const COLUMNS: readonly TableColumn[] = [
  { id: 'job', label: strings.columns.job, isRowHeader: true },
  { id: 'startedBy', label: strings.columns.startedBy },
  { id: 'status', label: strings.columns.status },
  { id: 'progress', label: strings.columns.progress },
  { id: 'started', label: strings.columns.started },
  { id: 'finished', label: strings.columns.finished },
  { id: 'result', label: strings.columns.result },
  { id: 'actions', label: strings.columns.actions, isLabelHidden: true, align: 'end' },
];

const number = new Intl.NumberFormat();
const format = (value: number) => number.format(value);

/** Who started a job, as the page says it: the member's name, "A removed member", or "System". */
function starterName(job: JobView, members: readonly MemberSummary[]): string {
  if (job.startedBy.type === 'system') return strings.system;
  return members.find((member) => member.id === job.startedBy.memberId)?.name ?? strings.removedMember;
}

/**
 * The progress cell: the bar and "done of total". Without a total, a running
 * job's bar is indeterminate, and any other job says only how many so far
 * (a sliding bar would say work is going on).
 */
function Progress({ job }: { readonly job: JobView }) {
  const handled = job.done + job.refused + job.skipped;
  if (job.total === undefined || job.total === 0) {
    const label = strings.progressUnknown(format(handled));
    return job.status === 'running' ? <ProgressBar label={label} /> : <>{label}</>;
  }
  return (
    <ProgressBar label={strings.progress(format(handled), format(job.total))} value={handled} maxValue={job.total} />
  );
}

/** The result cell: why it failed, when it retries, or its refusals and skips by code. */
function Result({ job }: { readonly job: JobView }) {
  if (job.error !== undefined) return <>{job.error.message}</>;
  if (job.retryAt !== undefined) {
    return (
      <>
        {strings.retrying} <RelativeTime value={job.retryAt} />
      </>
    );
  }
  const groups = job.result?.refusals ?? [];
  const parts = [
    ...(groups.length > 0
      ? groups.map((group) => strings.refusalGroup(format(group.count), group.code))
      : job.refused > 0
        ? [strings.refused(format(job.refused))]
        : []),
    ...(job.skipped > 0 ? [strings.skipped(format(job.skipped))] : []),
  ];
  return <>{parts.join(', ')}</>;
}

/** Settings, Background jobs (AC-118): a live table of jobs, Cancel with a confirm, and "Show more". */
export function JobsScreen({ data, slug, view, isAll, members: loaded, canRunTest }: JobsScreenProps) {
  const snapshot = useJobs(view);
  const [confirming, setConfirming] = useState<JobView | undefined>(undefined);
  const [isStarting, setStarting] = useState(false);
  const [members, setMembers] = useState(loaded);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // A starter the member list doesn't hold may have joined since it loaded: read it again (the layer keeps it
  // fresh on members events) before calling them "A removed member". Once per set of unknown starters.
  const unknown = snapshot.jobs
    .flatMap((job) =>
      job.startedBy.memberId !== undefined && !members.some((member) => member.id === job.startedBy.memberId)
        ? [job.startedBy.memberId]
        : [],
    )
    .sort()
    .join(',');
  useEffect(() => {
    if (unknown === '') return;
    let isCurrent = true;
    data.members.list(slug).then(
      (fresh) => {
        if (isCurrent && fresh.length !== members.length) setMembers(fresh);
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
    // Only a new set of unknown starters asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unknown]);
  // Each click mints its own id; the layer says why when the start is refused.
  const runTest = () => {
    if (isStarting) return;
    setStarting(true);
    data.jobs.startTest(slug, data.jobs.newId(), TEST_JOB).then(
      () => setStarting(false),
      () => setStarting(false),
    );
  };
  const cancel = (job: JobView) => {
    setConfirming(undefined);
    void data.jobs.cancel(slug, job.id);
    // A job not yet running is cancelled at once and its Cancel goes: focus moves to the page's title rather
    // than being lost. A running one keeps a pending button in its row (below) to come back to.
    if (job.status !== 'running') requestAnimationFrame(() => titleRef.current?.focus());
  };

  const renderCell = (job: JobView, column: string) => {
    switch (column) {
      case 'job':
        return job.label;
      case 'startedBy':
        return starterName(job, members);
      case 'status':
        return <Badge text={strings.status[job.status]} />;
      case 'progress':
        return <Progress job={job} />;
      case 'started':
        return job.startedAt === undefined ? strings.notYet : <RelativeTime value={job.startedAt} />;
      case 'finished':
        return job.finishedAt === undefined ? '' : <RelativeTime value={job.finishedAt} />;
      case 'result':
        return <Result job={job} />;
      default:
        if (job.status === 'cancelling') {
          return (
            <Button variant="ghost" isPending>
              {strings.cancelling}
            </Button>
          );
        }
        return job.cancellable ? (
          <Button variant="ghost" onPress={() => setConfirming(job)}>
            {strings.cancel}
          </Button>
        ) : null;
    }
  };

  const body =
    snapshot.status === 'error' ? (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void view.reload()}>
        {strings.failedText}
      </EmptyState>
    ) : (
      <>
        <Table
          label={strings.tableLabel}
          columns={COLUMNS}
          rows={snapshot.jobs}
          getRowId={(job) => job.id}
          renderCell={renderCell}
          isLoading={snapshot.status === 'loading'}
          emptyState={
            <EmptyState icon="list-checks" title={strings.emptyTitle}>
              {isAll ? strings.emptyText : strings.emptyMineText}
            </EmptyState>
          }
        />
        {snapshot.hasMore && (
          <Button onPress={() => void view.more()} isPending={snapshot.loadingMore}>
            {strings.showMore}
          </Button>
        )}
        <Modal
          title={strings.cancelTitle}
          tone="danger"
          isOpen={confirming !== undefined}
          onOpenChange={(isOpen) => {
            if (!isOpen) setConfirming(undefined);
          }}
          actions={
            <>
              <Button slot="close">{strings.dontCancel}</Button>
              <Button
                variant="danger"
                onPress={() => {
                  if (confirming !== undefined) cancel(confirming);
                }}
              >
                {strings.cancelJob}
              </Button>
            </>
          }
        >
          {strings.cancelText(confirming?.label ?? '')}
        </Modal>
      </>
    );

  return (
    <WorkspacePage
      currentPage="jobs"
      page={{
        topBar: (
          <TopBar title={strings.title} icon="list-checks" titleRef={titleRef}>
            {canRunTest && (
              <Button icon="flask-conical" onPress={runTest} isPending={isStarting}>
                {strings.runTest}
              </Button>
            )}
          </TopBar>
        ),
        body,
      }}
    />
  );
}
