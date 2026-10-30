// The command menu's words that show outside it (the shortcut list, a route's
// toast), apart from the menu's own `strings.ts`, which loads with the menu:
// these sit in the first load, so they stay few.
export const strings = {
  /** Create a <object> on an object with only boards, which have no new record dialog. */
  openTableToCreate: (singular: string) => `Open a table view to add a ${singular.toLocaleLowerCase()}`,
  /** Shortcut list entries (AC-1099). */
  openMenu: 'Open the command menu',
  openSearch: 'Search',
} as const;
