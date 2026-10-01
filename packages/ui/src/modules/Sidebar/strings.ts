/** Sidebar's built in copy. */
export const strings = {
  navigation: 'Main navigation',
  quickActions: 'Quick actions',
  /** The shortcut that opens Quick actions, written once with Mac symbols. */
  quickActionsKey: '⌘K',
  collapse: 'Collapse the sidebar',
  expand: 'Expand the sidebar',
  switchWorkspace: (name: string) => `${name}, switch workspace`,
  loading: 'Loading',
} as const;
