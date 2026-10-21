// The rail on the first paint (spec 0034, AC-935): the member's choice lives on the server and arrives with the
// workspace's first read, so the sidebar draws it from then on. Only a slow first load paints the frame before
// that read is in; it then takes the choice this browser last saw for the workspace, so the page doesn't jump
// sideways when the member's own arrives. A hint, never the record: blocked storage reads as the open sidebar.

/** Where the hint is kept: one key per workspace. */
const keyOf = (slug: string) => `crm.sidebar.rail.${slug}`;

/** The rail as this browser last saw it in the workspace; false when it never did, or storage is blocked. */
export function readRailHint(slug: string): boolean {
  try {
    return globalThis.localStorage.getItem(keyOf(slug)) === '1';
  } catch {
    return false;
  }
}

/** Keeps the member's rail for the next first paint in this browser. */
export function keepRailHint(slug: string, isRail: boolean): void {
  try {
    if (isRail) globalThis.localStorage.setItem(keyOf(slug), '1');
    else globalThis.localStorage.removeItem(keyOf(slug));
  } catch {
    // Blocked storage: the next slow first load paints the open sidebar first.
  }
}
