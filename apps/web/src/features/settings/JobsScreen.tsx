// Brief
// Purpose: Settings, Background jobs: the workspace's long work, with its progress, live.
// Main task: see how a job is doing, confirm a counted change or cancel a job (each asked first); owners and admins see every job, members their own.
// Leaves out: retry controls, settings for the test job, and the daily cleanup's details (milestone 3).
import type { DataLayer, JobsView, JobView, MemberSummary } from '@crm/data';
import { useJobs } from '@crm/data/react';
import {
  Badge,
  Button,
  EmptyState,
  focusLater,
  Modal,
  ProgressBar,
  RelativeTime,
  Table,
  type IconName,
  type TableColumn,
} from '@crm/ui';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMatch } from '@tanstack/react-router';
import { recordsWord, type ObjectNames } from '../workspace/undo.ts';
import { useCan, useMyAccess } from '../workspace/WorkspacePage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { strings } from './jobs-strings.ts';

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

/** The result cell: why it failed, when it retries or expires, or its refusals and skips by code. */
function Result({ job }: { readonly job: JobView }) {
  if (job.error !== undefined) return <>{job.error.message}</>;
  if (job.status === 'ready' && job.expiresAt !== undefined) {
    return (
      <>
        {strings.expires} <RelativeTime value={job.expiresAt} />
      </>
    );
  }
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

/** What a job's confirm asks: to run a counted change waiting for its confirm, or to cancel a job. */
interface JobAsk {
  readonly kind: 'run' | 'cancel';
  readonly job: JobView;
  /** The object its records belong to (its `subject`), when the workspace holds it: "12,345 people". */
  readonly names?: ObjectNames;
  /** Who started it, when that isn't the reader (an owner or admin sees every member's jobs). */
  readonly startedBy?: string;
}

/** Settings, Background jobs (AC-118): a live table of jobs, Confirm and Cancel each with a confirm, and "Show more". */
export function JobsScreen({ data, slug, view, isAll, members: loaded, canRunTest }: JobsScreenProps) {
  const snapshot = useJobs(view);
  const [asking, setAsking] = useState<JobAsk | undefined>(undefined);
  // The workspace's objects, as the frame loaded them, for a counted job's records by name.
  const objects = useMatch({ from: '/w/$slug', shouldThrow: false })?.loaderData?.objects;
  const myId = useMyAccess()?.memberId;
  const ask = (kind: JobAsk['kind'], job: JobView) => {
    const object = job.subject?.type === 'object' ? objects?.find((each) => each.id === job.subject?.id) : undefined;
    const isTheirs = job.startedBy.type === 'member' && job.startedBy.memberId !== myId;
    setAsking({
      kind,
      job,
      ...(object === undefined ? {} : { names: object }),
      ...(isAll && isTheirs ? { startedBy: starterName(job, members) } : {}),
    });
  };
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
        return (
          <>
            {job.status === 'ready' && (
              <Button variant="primary" onPress={() => ask('run', job)}>
                {strings.review}
              </Button>
            )}
            {job.cancellable && (
              <Button variant="ghost" onPress={() => ask('cancel', job)}>
                {strings.cancel}
              </Button>
            )}
          </>
        );
    }
  };

  const body =
    snapshot.status === 'error' ? (
      <EmptyState tone="error" title={strings.failedTitle} onRetry={() => void view.reload()}>
        {snapshot.error?.message ?? strings.failedText}
      </EmptyState>
    ) : (
      <>
        <Table
          label={strings.tableLabel}
          // A member sees only their own jobs, so "Started by" would always name them.
          columns={isAll ? COLUMNS : COLUMNS.filter((column) => column.id !== 'startedBy')}
          rows={snapshot.jobs}
          getRowId={(job) => job.id}
          renderCell={renderCell}
          isLoading={snapshot.status === 'loading'}
          emptyState={
            // The page's description already says what runs here.
            <EmptyState icon="list-checks" title={strings.emptyTitle} />
          }
        />
        {snapshot.hasMore && (
          <Button onPress={() => void view.more()} isPending={snapshot.loadingMore}>
            {strings.showMore}
          </Button>
        )}
        <JobConfirmDialog
          data={data}
          slug={slug}
          ask={asking}
          live={asking === undefined ? undefined : snapshot.jobs.find((job) => job.id === asking.job.id)}
          titleRef={titleRef}
          onClose={() => {
            setAsking(undefined);
          }}
        />
      </>
    );

  return (
    <SettingsPage
      title={strings.title}
      description={isAll ? strings.description : strings.descriptionMine}
      titleRef={titleRef}
      {...(canRunTest
        ? {
            actions: (
              <Button icon="flask-conical" onPress={runTest} isPending={isStarting}>
                {strings.runTest}
              </Button>
            ),
          }
        : {})}
    >
      {body}
    </SettingsPage>
  );
}

/** "1 record", "12,345 records": a counted job's items, which are records for every bulk kind. */
function recordsOf(total: number | undefined): string {
  return total === 1 ? strings.oneRecord : strings.records(format(total ?? 0));
}

/** Each counted kind's commit icon, as the table's Review confirm draws it. */
const RUN_ICONS = {
  'records.bulk_delete': 'trash',
  'records.purge': 'trash',
  'records.bulk_edit': 'pencil',
  'records.bulk_restore': 'archive-restore',
} as const satisfies Record<keyof typeof strings.run, IconName>;

/** The words a job's confirm asks with: what it does, to how many, whether it can be undone, and its commit. */
function jobConfirmWords(ask: JobAsk): {
  readonly title: string;
  readonly text: string;
  readonly action: string;
  readonly icon: IconName;
  readonly isDanger: boolean;
} {
  const { job } = ask;
  const whose = ask.startedBy === undefined ? '' : ` ${strings.startedByText(ask.startedBy)}`;
  if (ask.kind === 'cancel') {
    return {
      title: strings.cancelTitle(job.label),
      text: `${strings.cancelText}${whose}`,
      action: strings.cancelJob,
      icon: 'circle-x',
      isDanger: true,
    };
  }
  if (!Object.hasOwn(strings.run, job.kind)) {
    return {
      title: strings.runOther.title(job.label),
      text: `${strings.runOther.text(format(job.total ?? 0))}${whose}`,
      action: strings.runOther.action,
      icon: 'play',
      isDanger: false,
    };
  }
  const kind = job.kind as keyof typeof strings.run;
  const known = strings.run[kind];
  const records = ask.names === undefined ? recordsOf(job.total) : recordsWord(job.total ?? 0, ask.names);
  // A restore brings records back; every other counted change ends something.
  return {
    title: known.title(records),
    text: `${known.text}${whose}`,
    action: known.action(records),
    icon: RUN_ICONS[kind],
    isDanger: kind !== 'records.bulk_restore',
  };
}

/**
 * Confirm or Cancel on a job, asked first (the house rule in Modal's README). The commit waits for the server;
 * the jobs store shows the change at once and says a refusal itself (a toast, the row put back), so the dialog
 * closes either way. Its trigger goes with the change (Confirm leaves a queued row, Cancel a cancelled one), so
 * focus that would fall to the page goes to the title.
 */
function JobConfirmDialog({
  ask,
  ...rest
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly ask: JobAsk | undefined;
  /** The job as the store holds it now: once it no longer waits on this question, the dialog closes. */
  readonly live: JobView | undefined;
  readonly titleRef: RefObject<HTMLHeadingElement | null>;
  readonly onClose: () => void;
}) {
  // The last question stays while the Modal plays its exit; each one mounts afresh.
  const [last, setLast] = useState(ask);
  if (ask !== undefined && ask !== last) setLast(ask);
  const shown = ask ?? last;
  return shown === undefined ? null : (
    <JobConfirm key={`${shown.kind}:${shown.job.id}`} ask={shown} isOpen={ask !== undefined} {...rest} />
  );
}

/** The open confirm for one job. */
function JobConfirm({
  data,
  slug,
  ask,
  live,
  isOpen,
  titleRef,
  onClose,
}: {
  readonly data: DataLayer;
  readonly slug: string;
  readonly ask: JobAsk;
  readonly live: JobView | undefined;
  readonly isOpen: boolean;
  readonly titleRef: RefObject<HTMLHeadingElement | null>;
  readonly onClose: () => void;
}) {
  const [isBusy, setBusy] = useState(false);
  const words = jobConfirmWords(ask);
  // Confirmed, cancelled or expired elsewhere while it was open: the question is gone, so the dialog goes too.
  const isStale = live !== undefined && (ask.kind === 'run' ? live.status !== 'ready' : !live.cancellable);
  useEffect(() => {
    if (isOpen && isStale && !isBusy) onClose();
  }, [isOpen, isStale, isBusy, onClose]);
  const commit = () => {
    if (isBusy) return;
    setBusy(true);
    const answer = ask.kind === 'run' ? data.jobs.confirm(slug, ask.job.id) : data.jobs.cancel(slug, ask.job.id);
    const settle = () => {
      setBusy(false);
      onClose();
      focusLater(() => (document.activeElement === document.body ? titleRef.current : undefined));
    };
    answer.then(settle, settle);
  };
  return (
    <Modal
      title={words.title}
      tone={words.isDanger ? 'danger' : 'default'}
      isOpen={isOpen}
      isBusy={isBusy}
      onOpenChange={(open) => {
        if (!open && !isBusy) onClose();
      }}
      actions={
        <>
          <Button slot="close" isDisabled={isBusy} kbd="ESC">
            {ask.kind === 'run' ? strings.notNow : strings.keepJob}
          </Button>
          <Button
            variant={words.isDanger ? 'danger-solid' : 'primary'}
            icon={words.icon}
            isPending={isBusy}
            onPress={commit}
          >
            {isBusy ? (ask.kind === 'run' ? strings.starting : strings.cancellingNow) : words.action}
          </Button>
        </>
      }
    >
      {words.text}
    </Modal>
  );
}

/** Settings, Background jobs while it loads: the frame, the header and skeleton rows in their places. */
export function JobsPending() {
  // The description the page arrives with, so the table doesn't move down when it does.
  const isAll = useCan('jobs.manage');
  return (
    <SettingsPage title={strings.title} description={isAll ? strings.description : strings.descriptionMine}>
      <Table
        label={strings.tableLabel}
        columns={isAll ? COLUMNS : COLUMNS.filter((column) => column.id !== 'startedBy')}
        rows={[]}
        getRowId={() => ''}
        renderCell={() => null}
        isLoading
      />
    </SettingsPage>
  );
}
