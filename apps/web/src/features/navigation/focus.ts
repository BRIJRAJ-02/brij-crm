// Focus after a route change (spec 0005, every screen): the new page's title,
// its one h1 inside the main landmark (TopBar's in the app, the page card's
// before it), which takes focus by script and stays out of the tab order.
// The pages whose whole task is one field (the email on /sign-in, the code
// on /verify) put focus in that field instead, so a phone's keyboard and its
// code suggestion come up at once; the field's label and the page's heading
// are read with it.

/** The one field each one field page focuses, by path. */
const FIRST_FIELD: Readonly<Record<string, string>> = {
  '/sign-in': 'main input[name="email"]',
  '/verify': 'main input[autocomplete="one-time-code"]',
};

/**
 * On the first load: the one field page's field, so the phone's keyboard and
 * code suggestion come up as they do after a route change. Anywhere else,
 * nothing: the browser starts at the top of the page, which is where focus on
 * the title would put a screen reader anyway. Never takes focus the person
 * already moved.
 */
export function focusFirstLoad(doc: Document, pathname: string): void {
  const field = FIRST_FIELD[pathname];
  if (field === undefined) return;
  if (doc.activeElement !== null && doc.activeElement !== doc.body) return;
  doc.querySelector<HTMLElement>(field)?.focus();
}

/** True when focus sits in a tab list: tabs that are pages (an object's settings tabs) moved it there themselves. */
function isInTabList(doc: Document): boolean {
  const active: unknown = doc.activeElement;
  if (typeof active !== 'object' || active === null || !('closest' in active)) return false;
  return (active as Element).closest('[role="tablist"]') !== null;
}

/**
 * Moves focus to the page's one field on a one field page, else to its title,
 * if the page has one. Focus already in a tab list stays: the arrow keys there
 * choose a tab that is its own address (spec 0012), and the next press must
 * reach the next tab, not the title.
 */
export function focusPage(doc: Document, pathname: string): void {
  if (isInTabList(doc)) return;
  const field = FIRST_FIELD[pathname];
  const target =
    (field === undefined ? null : doc.querySelector<HTMLElement>(field)) ?? doc.querySelector<HTMLElement>('main h1');
  target?.focus();
}
