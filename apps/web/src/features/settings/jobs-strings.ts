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
  /** InfoTips beside the two statuses a new member wouldn't read from the word alone. */
  statusHelp: {
    preparing: 'It’s gathering the records it will work on. Nothing has changed yet.',
    ready:
      'It’s gathered its records and waits for you to press Review and confirm. If it expires first, nothing changes.',
  },
  /** An example for Needs confirm's InfoTip. */
  readyExample: 'A bulk delete of 2,000 people waits here until you confirm it.',
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
  notYet: 'Not yet',
  cancel: 'Cancel',
  /** Cancel's confirm, naming the job: "Cancel “Bulk delete”?". */
  cancelTitle: (label: string) => `Cancel “${label}”?`,
  cancelText: 'It stops before its next batch. What it already did stays done.',
  /** Cancel's confirm keeps the job: its dismiss can't be called Cancel too. */
  keepJob: 'Keep job',
  cancelling: 'Cancelling',
  cancellingNow: 'Cancelling…',
  cancelJob: 'Cancel job',
  /**
   * Confirm asks first, in the words of the change it runs (spec 0022's counted changes, as the table's Review
   * confirm says them): "Delete 12,345 records?". Declining leaves it waiting for its confirm until it expires.
   */
  run: {
    'records.bulk_delete': {
      title: (records: string) => `Delete ${records}?`,
      text: 'They stay in the trash for 30 days.',
      action: (records: string) => `Delete ${records}`,
    },
    'records.purge': {
      title: (records: string) => `Delete ${records} forever?`,
      text: 'This can’t be undone.',
      action: (records: string) => `Delete ${records} forever`,
    },
    'records.bulk_edit': {
      title: (records: string) => `Update ${records}?`,
      text: 'Each one gets the change this job was started with. This can’t be undone.',
      action: (records: string) => `Update ${records}`,
    },
    'records.bulk_restore': {
      title: (records: string) => `Restore ${records}?`,
      text: 'They come back with their links, list entries, notes and history.',
      action: (records: string) => `Restore ${records}`,
    },
  },
  /** A kind the screen has no words for (the test job): its label, and how many items it counted. */
  runOther: {
    title: (label: string) => `Run “${label}”?`,
    text: (items: string) => `It runs on the ${items} items it counted.`,
    action: 'Run job',
  },
  /** An owner or admin asked about another member's job: whose it is. */
  startedByText: (name: string) => `${name} started it.`,
  /** A counted change waiting for its confirm: Review opens the confirm, as the table's bar names the step. */
  review: 'Review',
  /** Confirm's dismiss: the job keeps waiting for its confirm. */
  notNow: 'Not now',
  starting: 'Starting…',
  oneRecord: '1 record',
  records: (count: string) => `${count} records`,
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
