/** Sidebar's built in copy. */
export const strings = {
  /** The workspace's place in the sidebar while its name loads, for screen readers. */
  loadingWorkspace: 'Loading workspace',
  navigation: 'Main navigation',
  quickActions: 'Quick actions',
  /** The shortcut that opens Quick actions, written once with Mac symbols. */
  quickActionsKey: '⌘K',
  collapse: 'Collapse the sidebar',
  expand: 'Expand the sidebar',
  /** The workspace button's name: it opens the workspace's menu (switching, settings, sign out). */
  workspaceMenu: (name: string) => `${name}, workspace menu`,
  loading: 'Loading',
} as const;
