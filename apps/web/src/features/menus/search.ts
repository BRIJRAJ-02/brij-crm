// The Menus screen's address (spec 0065, H1): which menu and tab, the preview's day and time, and whether the preview
// shows. Its own small module, so the route's search check never pulls the whole editor into the first load (the build
// test's first load budget): only the route's component imports MenusScreen.
import { parsePreviewAt } from './preview-at.ts';

/** The tabs of one menu, after checklabs' Structure and Items, its modifier groups and its Settings page. */
export const MENU_TABS = ['structure', 'dishes', 'options', 'settings'] as const;
/** One tab of a menu. */
export type MenuTab = (typeof MENU_TABS)[number];

/** Where the screen stands, kept in the address (`?menu=&tab=&at=&preview=`), so a reload or a link opens it there. */
export interface MenusView {
  readonly menu?: string;
  readonly tab?: MenuTab;
  /** `sat-11:00`: the preview read on Saturday at 11:00 at the place (`preview-at.ts`). */
  readonly at?: string;
  readonly preview?: 'off';
}

/** The address's search as the screen reads it: anything unknown is dropped. */
export function menusSearch(search: Record<string, unknown>): MenusView {
  const tab = search.tab;
  return {
    ...(typeof search.menu === 'string' && /^[0-9a-f-]{36}$/i.test(search.menu) ? { menu: search.menu } : {}),
    ...(typeof tab === 'string' && (MENU_TABS as readonly string[]).includes(tab) ? { tab: tab as MenuTab } : {}),
    ...(parsePreviewAt(search.at) === undefined ? {} : { at: search.at as string }),
    ...(search.preview === 'off' ? { preview: 'off' as const } : {}),
  };
}
