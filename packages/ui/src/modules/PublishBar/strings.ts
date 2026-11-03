/** PublishBar's built in copy. */
export const strings = {
  label: 'Publish',
  /** After the count, which NumberPop draws: "3 changes not published". */
  notPublished: (count: number) => (count === 1 ? 'change not published' : 'changes not published'),
  live: 'Live: guests see this page',
  published: 'Published',
  publish: 'Publish',
  tryAgain: 'Try again',
  changes: 'Changes',
  versions: 'Versions',
  versionsLoading: 'Loading versions…',
  versionsNone: 'No versions yet',
  version: (version: number) => `Version ${String(version)}`,
  current: 'Live',
  restore: 'Restore',
  preview: 'Preview',
  discard: 'Discard',
  /** Discard's confirm: the question, then what stays. */
  discardTitle: 'Discard the changes not published?',
  discardText: 'Guests keep seeing the page as it is now.',
  keep: 'Keep them',
  discardChanges: 'Discard changes',
} as const;
