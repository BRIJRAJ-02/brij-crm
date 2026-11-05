/** The Captures page's copy. */
export const strings = {
  title: 'Captures',
  /** The tab strip's name, read by screen readers. */
  tabsLabel: 'Captures',
  linksTab: 'Links',
  formsTab: 'Forms',
  /** What the TopBar's count counts, for screen readers: "3 booking pages", "2 forms". */
  linksCount: (count: number) => (count === 1 ? 'booking page' : 'booking pages'),
  formsCount: (count: number) => (count === 1 ? 'form' : 'forms'),
  /** The editors' shared header (22 Oct 2026): one set of words for a booking page and a form. */
  copyLink: 'Copy link',
  /** Opens the live booking page in a new tab. */
  viewPage: 'View page',
  insights: 'Insights',
  linkCopied: 'Link copied',
  moreActions: 'More actions',
  pause: 'Pause',
  resume: 'Resume',
  duplicate: 'Duplicate',
  undo: 'Undo',
  pausedToast: (name: string) => `Paused “${name}”.`,
  resumedToast: (name: string) => `“${name}” is live again.`,
  /** The status beside an editor's name: Live (green) or Paused (grey). */
  live: 'Live',
  paused: 'Paused',
  /** The editors' Appearance tab's Brand card (T21): the workspace's kit, as every page wears it. */
  brandTitle: 'Brand',
  brandText: 'Every booking page and form wears these.',
  brandFailed: 'Couldn’t load your brand',
  editBrand: 'Edit brand',
} as const;
