/** CustomiseSidebar's built in copy. */
export const strings = {
  title: 'Customise sidebar',
  intro: 'Choose what shows in your sidebar. Hidden items stay reachable from their address.',
  /** A row's switch, for screen readers: "Show Deals in the sidebar". */
  show: (name: string) => `Show ${name} in the sidebar`,
  reset: 'Reset to default',
  /** The reset's confirm: the question, what it does, Cancel, then the verb. */
  resetQuestion: 'Reset your sidebar?',
  resetText:
    'This puts back the default order, shows every item and opens every section. The sidebar keeps its width. You can’t undo this.',
  resetConfirm: 'Reset sidebar',
  resetting: 'Resetting',
  resetFailed: 'Your sidebar wasn’t reset. Try again.',
  cancel: 'Cancel',
  done: 'Done',
  empty: 'Nothing here can be hidden.',
} as const;
