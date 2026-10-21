// Focus after a route change (spec 0005, every screen): the new page's title,
// its one h1 inside the main landmark (TopBar's in the app, the page card's
// before it), which takes focus by script and stays out of the tab order.
// The pages whose whole task is a form (the email on /sign-in, the code on
// /verify, your name on /welcome) put focus in its first field instead, so a
// phone's keyboard and its code suggestion come up at once; the field's label
// and the page's heading are read with it.

/** The first field each form page focuses, by path. */
const FIRST_FIELD: Readonly<Record<string, string>> = {
  '/sign-in': 'main input[name="email"]',
  '/verify': 'main input[autocomplete="one-time-code"]',
  // First run (spec 0036): About you's name, or Your workspace's name after a reload on that step.
  '/welcome': 'main input[name="memberName"], main input[name="name"]',
};

/**
 * On the first load: a form page's first field, so the phone's keyboard and
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

/**
 * True when focus sits in a tab list, or in a navigation the arrow keys move
 * through (the settings sidebar, spec 0026, AC-687): their entries are pages,
 * and the person moved focus there themselves, so it keeps its place.
 */
function isInTabList(doc: Document): boolean {
  const active: unknown = doc.activeElement;
  if (typeof active !== 'object' || active === null || !('closest' in active)) return false;
  return (active as Element).closest('[role="tablist"], nav[data-keyboard="arrows"]') !== null;
}

/**
 * Moves focus to a form page's first field, else to the page's title,
 * if the page has one. Focus already in a tab list stays: the arrow keys there
 * choose a tab that is its own address (spec 0012), and the next press must
 * reach the next tab, not the title. So does focus in the settings sidebar.
 */
export function focusPage(doc: Document, pathname: string): void {
  if (isInTabList(doc)) return;
  const field = FIRST_FIELD[pathname];
  const target = (field === undefined ? null : doc.querySelector<HTMLElement>(field)) ?? pageHeading(doc);
  target?.focus();
}

/** Whether an element is drawn: `checkVisibility` where the browser has it, else taken as drawn. */
function isDrawn(element: Element): boolean {
  return !('checkVisibility' in element) || typeof element.checkVisibility !== 'function' || element.checkVisibility();
}

/**
 * The page's title: the first h1 in a main landmark that is drawn, else the
 * first at all. While a slow route change resolves, the old page can stay in
 * the document, hidden, ahead of the new one; its h1 is never the title.
 */
export function pageHeading(doc: Document): HTMLElement | null {
  const headings = [...doc.querySelectorAll<HTMLElement>('main h1')];
  return headings.find(isDrawn) ?? headings[0] ?? null;
}

/**
 * Notices focus lost with the content it sat in: a Retry that leaves with
 * its error state, a button whose page loaded again in place. It remembers
 * the element that last took focus; `recover`, run after the page renders
 * again, moves focus to the page's title when that element has left the
 * document and focus fell to the body. Focus the person put anywhere else
 * (a click on the page's background included) stays where it is.
 */
export function createFocusRecovery(doc: Document): { readonly recover: (pathname: string) => void } {
  // Only whether it is still in the document matters (a Node's `isConnected`).
  let last: { readonly isConnected: boolean } | undefined;
  doc.addEventListener('focusin', (event) => {
    const { target } = event;
    last = typeof target === 'object' && target !== null && 'isConnected' in target ? (target as Node) : undefined;
  });
  // A press anywhere is the person choosing where they are: an older focus that left is no longer theirs to lose.
  doc.addEventListener('pointerdown', () => {
    last = undefined;
  });
  return {
    recover: (pathname) => {
      const active = doc.activeElement;
      if (last === undefined || last.isConnected || (active !== null && active !== doc.body)) return;
      last = undefined;
      focusPage(doc, pathname);
    },
  };
}

/** A record page's address: its tab is the last segment (spec 0017). */
const RECORD_PAGE = /^(\/w\/[^/]+\/objects\/[^/]+\/[^/]+)\/[^/]+\/?$/;

/**
 * Whether a route change is the same page showing another of its tabs (a
 * record page's Overview to Activity), where focus stays on the tab the
 * person chose rather than going back to the title.
 */
export function isSamePage(fromPath: string, toPath: string): boolean {
  const from = RECORD_PAGE.exec(fromPath)?.[1];
  return from !== undefined && from === RECORD_PAGE.exec(toPath)?.[1];
}
