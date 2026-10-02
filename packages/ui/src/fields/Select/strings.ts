/** The select field's built in copy. */
export const strings = {
  unknown: 'Deleted option',
  choose: (name: string) => `Set ${name}…`,
  search: (name: string) => `Search ${name}`,
  clear: 'Clear',
  /** Between the chosen options on the menu's button: "Proposal, Won". */
  listJoin: ', ',
} as const;
