/** Settings › Profile, Pages on your profile copy (owner ask A102): the order `/<handle>` lists Public pages in. */
export const strings = {
  section: 'Pages on your profile',
  sectionText: 'Visitors see them in this order. Drag a page, or a whole section, to move it; each move saves at once.',
  /** At the section's heading: the public profile, in a new tab, to see the order as visitors do. */
  viewProfile: 'View profile',
  /** The list of sections, for screen readers. */
  sections: 'Sections on your profile',
  /** One section's pages, for screen readers: "Pages under Sales". */
  pagesUnder: (title: string) => `Pages under ${title}`,
  /** The pages when there is one untitled section. */
  pages: 'Your pages',
  /** The heading of the pages with no section, when other sections exist. */
  noSection: 'No section',
  /** A paused page keeps its place but visitors don't see it until it is resumed. */
  paused: 'Paused',
  minutes: (count: number) => `${String(count)} min`,
  /** A page's menu button: "More for Intro call". */
  moreFor: (title: string) => `More for ${title}`,
  /** A section's menu button: "Sales options". */
  sectionOptions: (title: string) => `${title} options`,
  moveUp: 'Move up',
  moveDown: 'Move down',
  /** A page's menu: opens its editor, where its Section is (a page never leaves its section here). */
  changeSection: 'Change section',
  /** Said after a move from a menu: "Intro call, moved to position 2 of 3." */
  moved: (name: string, position: number, count: number) =>
    `${name}, moved to position ${String(position)} of ${String(count)}.`,
  moveFailed: 'The new order didn’t save, so it’s back as it was.',
  tryAgain: 'Try again',
  failed: 'Your pages didn’t load',
  // States.
  noHandle: 'Claim a handle first',
  noHandleText: 'Your profile lists your Public booking pages at your handle. Claim one above.',
  empty: 'No pages on your profile yet',
  emptyText: 'Your Public booking pages show here. Link only pages never do.',
  openLinks: 'Go to Links',
  noAccess: 'You can’t arrange booking pages here',
  noAccessText: 'Your role can’t make booking pages in this workspace. Ask a workspace admin.',
} as const;
