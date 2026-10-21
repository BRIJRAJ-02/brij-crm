/** CommentThread's built in copy. */
export const strings = {
  /** The thread's name for screen readers: "Thread started by Ada Lovelace". */
  thread: (author: string) => `Thread started by ${author}`,
  /** A deleted comment's place while its thread still reads. */
  deleted: 'This comment was deleted.',
  sending: 'Sending',
  edited: 'edited',
  /** The "edited" popover's name and its states. */
  earlierVersions: 'Earlier versions',
  loadingVersions: 'Loading earlier versions',
  versionsFailed: 'Earlier versions didn’t load.',
  reply: 'Reply',
  moreActions: 'More actions',
  edit: 'Edit',
  delete: 'Delete',
  resolve: 'Resolve thread',
  reopen: 'Reopen thread',
  addReaction: 'Add reaction',
  /** The resolved line: "Resolved by Ada Lovelace", then the time. */
  resolvedBy: (name: string) => `Resolved by ${name}`,
  /** "Show 3 earlier replies". */
  earlierReplies: (count: number) => (count === 1 ? 'Show 1 earlier reply' : `Show ${String(count)} earlier replies`),
  /** Who reacted: "Ada", "Ada and Bea", "Ada, Bea and 3 others". */
  reactedBy: (names: readonly string[], count: number) => {
    const others = count - names.slice(0, 2).length;
    const shown = names.slice(0, 2);
    if (others <= 0) return shown.length === 2 ? `${shown[0] ?? ''} and ${shown[1] ?? ''}` : (shown[0] ?? '');
    return `${shown.join(', ')} and ${String(others)} ${others === 1 ? 'other' : 'others'}`;
  },
  /** A reaction's name for screen readers: "👍, 2". */
  reaction: (emoji: string, count: number) => `${emoji} ${String(count)}`,
  /** Between the author and the time. */
  separator: '·',
} as const;
