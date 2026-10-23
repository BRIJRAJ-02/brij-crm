// Where Settings' back link goes (spec 0026, AC-681): the page Settings was
// opened from, else the workspace's home. main.tsx remembers each workspace
// page the person reaches outside Settings, in this tab's sessionStorage
// (a per tab convenience: it survives a reload, and a missing or blocked
// store only means the back link goes home). Pure, with the store passed in.

/** The part of `Storage` the back link uses. */
export type BackStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The sessionStorage key holding the last page outside Settings. */
export const SETTINGS_BACK_KEY = 'crm.settings.from';

/** Whether an address is inside a workspace's Settings. */
export function isSettingsPath(pathname: string): boolean {
  return /^\/w\/[^/]+\/settings(\/|$)/.test(pathname);
}

/**
 * Whether an address opens Settings: one inside it, or the trash's old address, which redirects into Settings ›
 * Trash (A120). The back link never goes to either, or it would land back in Settings.
 */
function opensSettings(pathname: string): boolean {
  return isSettingsPath(pathname) || /^\/w\/[^/]+\/trash\/?$/.test(pathname);
}

/** The workspace an address belongs to (`/w/<slug>/…`), if any. */
function workspaceOf(href: string): string | undefined {
  return /^\/w\/([^/?#]+)/.exec(href)?.[1];
}

/** An address's path, without its search or hash. */
const pathOf = (href: string): string => href.split(/[?#]/)[0] ?? '';

/** Remembers `href` (a path with its search) as the place to go back to, when it is a workspace page outside Settings. */
export function rememberPlace(storage: BackStorage | undefined, href: string): void {
  if (workspaceOf(href) === undefined || opensSettings(pathOf(href))) return;
  try {
    storage?.setItem(SETTINGS_BACK_KEY, href);
  } catch {
    // Storage is full or blocked: the back link goes to the workspace's home.
  }
}

/** Where Settings' back link goes in workspace `slug`: the remembered page when it is in this workspace, else its home. */
export function backHref(storage: BackStorage | undefined, slug: string): string {
  const home = `/w/${slug}`;
  try {
    const place = storage?.getItem(SETTINGS_BACK_KEY) ?? undefined;
    if (place === undefined || workspaceOf(place) !== slug) return home;
    return opensSettings(pathOf(place)) ? home : place;
  } catch {
    return home;
  }
}

/** `sessionStorage`, or `undefined` when the browser blocks it (reading the property can throw). */
export function safeSessionStorage(win: { readonly sessionStorage: Storage }): BackStorage | undefined {
  try {
    return win.sessionStorage;
  } catch {
    return undefined;
  }
}
