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
  /** An item's grip (spec 0034): "Move Deals". */
  moveItem: (name: string) => `Move ${name}`,
  /** A section's grip: "Move the Records section". */
  moveSection: (title: string) => `Move the ${title} section`,
  /** An item's menu button: "More for Deals". */
  moreFor: (name: string) => `More for ${name}`,
  /** A section's menu button: "Records options". */
  sectionMenu: (title: string) => `${title} options`,
  /** How to move with the keyboard, read with a grip. */
  reorderHelp:
    'Press Space or Enter to pick it up, the arrow keys to move it, Space or Enter to drop it, or Escape to put it back.',
  reorderLifted: (name: string, position: number, count: number) =>
    `${name} picked up, at position ${String(position)} of ${String(count)}.`,
  reorderPosition: (name: string, position: number, count: number) =>
    `${name}, position ${String(position)} of ${String(count)}.`,
  /** The drop (AC-932): "Deals, moved to position 2 of 5". */
  reorderMoved: (name: string, position: number, count: number) =>
    `${name}, moved to position ${String(position)} of ${String(count)}.`,
  reorderStayed: (name: string, position: number, count: number) =>
    `${name}, dropped where it was, at position ${String(position)} of ${String(count)}.`,
  reorderCancelled: (name: string, position: number, count: number) =>
    `${name}, put back at position ${String(position)} of ${String(count)}.`,
} as const;
