/** The booking page editor's Publish copy (spec 0068, AC-6811, AC-6812). */
export const publishStrings = {
  /** The header (the bookings area, 4 November 2026): one status, Preview, Publish, the rest under ⋯. */
  statusDraft: 'Draft',
  statusChanged: 'Live · edited',
  preview: 'Preview',
  publish: 'Publish',
  publishing: 'Publishing',
  viewPage: 'View page',
  insights: 'Insights',
  versions: 'Versions',
  discard: 'Discard unpublished changes',
  published: (title: string) => `Published ${title}.`,
  /** The first Publish's moment, as a form's: the page's name, live. */
  liveTitle: (title: string) => `${title} is live`,
  done: 'Done',
  putOnSite: 'Put it on your site',
  /** Versions: each published version, the live one marked, any other brought back as the draft. */
  versionsTitle: 'Versions',
  versionsNone: 'No published versions yet',
  versionLive: 'Live',
  restore: 'Restore',
  close: 'Close',
  /** Discard changes asks first. */
  discardTitle: 'Discard unpublished changes?',
  discardText: 'Guests keep seeing the page as it is now.',
  discardKeep: 'Keep my changes',
  discardConfirm: 'Discard changes',
  /** Publish couldn't: the reason and the way to the setting. */
  publishRefused: 'Publish didn’t go through.',
  /** A refused Publish's way to the setting: "Go to Hours". */
  goTo: (tab: string) => `Go to ${tab}`,
  /** A version in the menu: who and when. */
  versionLabel: (who: string | undefined, when: Date) =>
    `${who ?? 'Someone'} · ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
  restored: (version: number) => `Version ${String(version)} is your draft. Publish to put it back.`,
  restoreFailed: 'That version couldn’t be brought back. Try again.',
  versionsFailed: 'The versions couldn’t be read. Try again.',
  publishFailed: 'That didn’t publish. Try again.',
  discardFailed: 'The changes couldn’t be discarded. Try again.',
  /** Save while drafted settings are among the unsaved ones: they wait for Publish. */
  saveDraft: 'Save draft',
  /** On a section whose settings skip the draft (AC-6813): the address, privacy, the profile, hours, hosts. */
  goesLive: 'Goes live when saved.',
  /** The Hours tab: the schedule's own hours are shared, so they skip the draft; which schedule waits for Publish. */
  hoursLive: 'Hours and days off go live when saved. A different schedule waits for Publish.',
  /** Restore over a draft that holds changes asks first. */
  restoreTitle: (version: number) => `Restore version ${String(version)}?`,
  restoreText: 'It replaces the changes you haven’t published. Guests keep seeing the page as it is now.',
  restoreKeep: 'Keep my draft',
  restoreConfirm: 'Restore version',
  /** The preview tab's banner. */
  previewBanner: 'Preview of your draft. Guests don’t see these changes until you publish.',
  previewMissingTitle: 'Nothing to preview',
  previewMissing: 'This page isn’t yours to preview, or it no longer exists.',
} as const;
