// The words of the toast a job this browser started raises when it ends (spec 0008, AC-119), apart from the
// Background jobs page's (jobs-strings.ts): main.tsx raises it, so these ride in the first load and the page's
// words don't.

/** The toast when a job this browser started ends (AC-119): "Test job: Done, 6 refused". */
export const strings = {
  finished: (label: string, how: string) => `${label}: ${how}`,
  finishedDone: 'Done',
  finishedRefused: (count: string) => `Done, ${count} refused`,
  finishedFailed: 'Failed',
  finishedCancelled: 'Cancelled',
  view: 'View',
} as const;
