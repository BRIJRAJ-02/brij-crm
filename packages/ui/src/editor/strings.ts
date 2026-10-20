/** The rich text editor's built in copy. */
export const strings = {
  /** The note editor's placeholder, when the screen gives none. */
  notePlaceholder: 'Write a note. Type @ to mention someone.',
  /** The format toolbar's name. */
  formatting: 'Formatting',
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  code: 'Code',
  link: 'Link',
  highlight: 'Highlight',
  heading1: 'Heading',
  heading2: 'Subheading',
  bulletList: 'Bulleted list',
  orderedList: 'Numbered list',
  taskList: 'Task list',
  quote: 'Quote',
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
  /** A task checkbox's name: "Mark “Send the deck” as done". */
  markTask: (text: string, isChecked: boolean) =>
    isChecked ? `Mark “${text || 'Empty task'}” as not done` : `Mark “${text || 'Empty task'}” as done`,
  readOnly: 'Read only',
  /** A mention of someone no longer in the workspace. */
  formerMember: 'Former member',
} as const;
