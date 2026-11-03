/** PublishBar's built in copy. */
export const strings = {
  label: 'Publish',
  /** The count of changes guests don't see yet: "3 changes not published". */
  notPublished: (count: number) => (count === 1 ? '1 change not published' : `${String(count)} changes not published`),
  live: 'Live: guests see this page',
  paused: 'Paused: guests can’t book this page',
  published: 'Published',
  publish: 'Publish',
  changes: 'Changes',
  versions: 'Versions',
  versionsLoading: 'Loading versions…',
  versionsNone: 'No versions yet',
  version: (version: number) => `Version ${String(version)}`,
  current: 'Live',
  /** The current version's mark while the page is paused: it is published, but guests can't book it. */
  currentPaused: 'Published',
  restore: 'Restore',
  preview: 'Preview',
  discard: 'Discard draft',
  /** Discard draft's confirm: the question, then what stays. */
  discardTitle: 'Discard the draft?',
  discardText: 'Guests keep seeing the page as it is now.',
  keep: 'Keep the draft',
  discardDraft: 'Discard draft',
} as const;
