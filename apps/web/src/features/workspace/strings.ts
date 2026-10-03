/** The workspace frame's and the object page's copy. */
export const strings = {
  product: 'CRM',
  workspaceMenu: 'Workspace',
  signOut: 'Sign out',
  signOutFailed: 'Couldn’t sign out. Check your connection, then try again.',
  records: 'Records',
  noObjects: 'No objects yet',
  loadingTitle: 'Loading',
  failedTitle: 'Couldn’t load this workspace',
  failedText: 'Check your connection, then try again.',
  workspaceMissingTitle: 'Workspace not found',
  workspaceMissingText: 'That workspace doesn’t exist, or you’re not a member of it.',
  pageMissingTitle: 'Page not found',
  pageMissingText: 'There is nothing at this address.',
  goHome: 'Go home',
  emptyTitle: (pluralName: string) => `No ${pluralName.toLowerCase()} yet`,
  emptyText: (pluralName: string) => `${pluralName} you add show here.`,
} as const;
