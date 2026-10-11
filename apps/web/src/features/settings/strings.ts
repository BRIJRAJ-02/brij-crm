import type { JobStatus } from '@crm/data';

/** Settings, Background jobs: the page's copy (spec 0008, AC-118, AC-119). */
export const strings = {
  /** The page's title, and its sidebar entry. */
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
    ready: 'Waiting for a confirm',
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
  notYet: 'Not yet',
  cancel: 'Cancel',
  cancelTitle: 'Cancel this job?',
  cancelText: 'It stops before its next batch. What it already did stays done.',
  keepRunning: 'Keep it running',
  cancelJob: 'Cancel job',
  showMore: 'Show more',
  emptyTitle: 'No background jobs yet',
  emptyText: 'Long work, such as bulk changes, runs here, with its progress.',
  emptyMineText: 'Jobs you start, such as bulk changes, run here, with their progress.',
  failedTitle: 'Couldn’t load the background jobs',
  failedText: 'Check your connection, then try again.',
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
