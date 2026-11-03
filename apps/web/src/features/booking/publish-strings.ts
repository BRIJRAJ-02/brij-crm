/** The booking page editor's Publish copy (spec 0068, AC-6811, AC-6812). */
export const publishStrings = {
  /** A refused Publish's way to the setting: "Go to Hours". */
  goTo: (tab: string) => `Go to ${tab}`,
  /** A version in the menu: who and when. */
  versionLabel: (who: string | undefined, when: Date) =>
    `${who ?? 'Someone'} · ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
  restored: (version: number) => `Version ${String(version)} is your draft. Publish to put it back.`,
  restoreFailed: 'That version couldn’t be brought back. Try again.',
  versionsFailed: 'The versions couldn’t be read. Try again.',
  discardFailed: 'The changes couldn’t be discarded. Try again.',
} as const;
