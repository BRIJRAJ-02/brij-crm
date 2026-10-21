// Settings, Background jobs: the page's copy, apart from the objects pages' own (strings.ts).
import type { JobStatus } from '@crm/data';

/** Settings, Background jobs: the page's copy (spec 0008, AC-118, AC-119). */
export const strings = {
  /** The page's title, and its entry in the settings navigation. */
  title: 'Background jobs',
  tableLabel: 'Background jobs',
  columns: {
    job: 'Job',
    startedBy: 'Started by',
    status: 'Status',
    progress: 'Progress',
    started: 'Started',
    finished: 'Finished',
    result: 'Result',
    actions: 'Actions',
  },
  status: {
    preparing: 'Preparing',
    ready: 'Needs confirm',
    queued: 'Queued',
    running: 'Running',
    cancelling: 'Cancelling',
    succeeded: 'Done',
    failed: 'Failed',
    cancelled: 'Cancelled',
  } satisfies Record<JobStatus, string>,
  system: 'System',
  removedMember: 'A removed member',
  /** "250 of 1,000", the counts formatted in the browser's language. */
  progress: (done: string, total: string) => `${done} of ${total}`,
  /** A job whose size isn't known yet. */
  progressUnknown: (done: string) => `${done} so far`,
  refused: (count: string) => `${count} refused`,
  skipped: (count: string) => `${count} skipped`,
  /** One refusal group: "100 refused: SIMULATED_REFUSAL". */
  refusalGroup: (count: string, code: string) => `${count} refused: ${code}`,
  retrying: 'Retrying',
  /** A prepared job waiting for its confirm: "Expires in 59 minutes" (AC-109). */
  expires: 'Expires',
  /** Runs a prepared job (`ready`) on exactly the items it counted. */
  confirm: 'Confirm',
  notYet: 'Not yet',
  cancel: 'Cancel',
  cancelTitle: 'Cancel this job?',
  /** The confirm's body, naming the job ("Test job"). */
  cancelText: (label: string) => `${label} stops before its next batch. What it already did stays done.`,
  dontCancel: 'Don’t cancel',
  cancelling: 'Cancelling',
  cancelJob: 'Cancel job',
  showMore: 'Show more',
  emptyTitle: 'No background jobs yet',
  /** Under the empty title: what shows here, every job for owners and admins, the person's own for everyone else. */
  emptyText: 'Long work in this workspace, such as bulk changes, shows here as it runs.',
  emptyTextMine: 'Long work you start, such as bulk changes, shows here as it runs.',
  /** Beside the title for members, who see only the jobs they started (the page had no description after 21 October 2026). */
  mineBadge: 'Only yours',
  failedTitle: 'Couldn’t load the background jobs',
  failedText: 'Something went wrong. Try again in a moment.',
  /** Local and previews only (AC-123). */
  runTest: 'Run a test job',
  /** The toast when a job this browser started ends (AC-119): "Test job: Done, 6 refused". */
  finished: (label: string, how: string) => `${label}: ${how}`,
  finishedDone: 'Done',
  finishedRefused: (count: string) => `Done, ${count} refused`,
  finishedFailed: 'Failed',
  finishedCancelled: 'Cancelled',
  view: 'View',
} as const;
