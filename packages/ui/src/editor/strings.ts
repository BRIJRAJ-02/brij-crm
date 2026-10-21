/** The rich text editor's built in copy. */
export const strings = {
  /** The note editor's placeholder, when the screen gives none. */
  notePlaceholder: 'Write something, press / for commands, or @ to mention someone',
  /** An empty line under the caret, once the note holds something. */
  commandsHint: 'Press / for commands',
  /** An empty heading under the caret: "Heading 1". */
  headingHint: (level: number) => `Heading ${String(level)}`,
  /** The note's title field, for screen readers; its placeholder. */
  title: 'Title',
  titlePlaceholder: 'Untitled',
  /** The format toolbar's name. */
  formatting: 'Formatting',
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
  link: 'Link',
  highlight: 'Highlight',
  /** The link field in the toolbar. */
  linkAddress: 'Link address',
  linkPlaceholder: 'https://',
  applyLink: 'Apply',
  removeLink: 'Remove link',
  cancelLink: 'Cancel',
  unsafeLink: 'Use an address that starts with http, https, mailto or tel.',
  /** The mention list's name. */
  members: 'Members',
  searchingMembers: 'Searching…',
  noMembers: 'No one matches',
  /** The slash menu's name, its words after a bare "/", and its empty state. */
  blocks: 'Blocks',
  slashFilter: 'Type to filter',
  noBlocks: 'No block matches',
  /** The slash menu's blocks. */
  text: 'Text',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bulletList: 'Bulleted list',
  orderedList: 'Numbered list',
  taskList: 'To do list',
  quote: 'Quote',
  divider: 'Divider',
  codeBlock: 'Code block',
  /** A task checkbox's name: "Mark “Send the deck” as done". */
  markTask: (text: string, isChecked: boolean) =>
    isChecked ? `Mark “${text || 'Empty task'}” as not done` : `Mark “${text || 'Empty task'}” as done`,
  readOnly: 'Read only',
  /** A mention of someone no longer in the workspace. */
  formerMember: 'Former member',
} as const;
