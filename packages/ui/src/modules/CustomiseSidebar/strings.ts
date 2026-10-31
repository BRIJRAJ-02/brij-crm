/** CustomiseSidebar's built in copy. */
export const strings = {
  title: 'Customise sidebar',
  /** A row's switch, for screen readers: "Show Deals in the sidebar". */
  show: (name: string) => `Show ${name} in the sidebar`,
  reset: 'Reset to default',
  /** The reset's confirm: the question, what it does, Cancel, then the verb. */
  resetQuestion: 'Reset your sidebar?',
  resetText: 'Back to the default sidebar.',
  resetConfirm: 'Reset sidebar',
  resetting: 'Resetting',
  resetFailed: 'Your sidebar wasn’t reset. Try again.',
  cancel: 'Cancel',
  done: 'Done',
  empty: 'Nothing here can be hidden.',
} as const;
