/** SocialLinksEditor's built in copy. */
export const strings = {
  add: 'Add social link',
  networks: 'Networks',
  emptyTitle: 'No social links yet',
  emptyText: 'Add LinkedIn, X, your website and more.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  remove: 'Remove',
  /** A row's menu, named by its network. */
  rowMenu: (name: string) => `${name} options`,
  /** A loading row's title: none, its mark and field stand in. */
  loadingRow: '',
} as const;
