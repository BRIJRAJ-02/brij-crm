// Settings › History's address and its tabs (spec 0046): plain values with no imports, so History's route loaders
// (in the first load) can check a tab and send a reader to the right one without pulling in the settings navigation
// and every settings page's words, as object-tabs.ts does for an object's settings.

/** History's tabs, in order: the workspace's changes (owners and admins), then the reader's own sign ins. */
export const HISTORY_TABS = ['changes', 'sign-ins'] as const;
/** One of History's tabs. */
export type HistoryTab = (typeof HISTORY_TABS)[number];

/** True when `tab` names one of History's tabs. */
export const isHistoryTab = (tab: string): tab is HistoryTab => (HISTORY_TABS as readonly string[]).includes(tab);

/**
 * Settings › Workspace › History (spec 0046, AC-4600): with no tab it opens Workspace changes for a holder of
 * `audit.read`, else Your sign ins; each tab has its own address.
 */
export const historyHref = (slug: string, tab?: HistoryTab): string =>
  `/w/${slug}/settings/history${tab === undefined ? '' : `/${tab}`}`;
