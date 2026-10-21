// The document's title (WCAG 2.4.2): the page's h1, then the product, so
// every tab, history entry and bookmark says which page it is. It follows
// the h1 as it changes (a route change, a pending page resolving, a page
// that loads lazily), checked at most once a frame. Inside a workspace the
// inbox's unread count leads it, "(3) People · Timefix" (spec 0038, AC-1174):
// the workspace frame keeps the count on the root element's `data-unread`.
import { pageHeading } from './focus.ts';

/** The product's name, after the page's in every title. */
export const PRODUCT = 'Timefix';

/** Past this many unread, the title says "99+", as the sidebar's badge does. */
const UNREAD_SHOWN_MAX = 99;

/**
 * "<page title> · Timefix", or "Timefix" alone while the page has no title, or its title is the product's name;
 * led by "(n) " while `unread` is above zero.
 */
export function documentTitle(pageTitle: string | undefined, unread = 0): string {
  const title = pageTitle?.replaceAll(/\s+/g, ' ').trim() ?? '';
  const named = title === '' || title === PRODUCT ? PRODUCT : `${title} · ${PRODUCT}`;
  if (unread <= 0) return named;
  return `(${unread > UNREAD_SHOWN_MAX ? `${String(UNREAD_SHOWN_MAX)}+` : String(unread)}) ${named}`;
}

/** The unread count the workspace frame keeps on the root element; 0 outside a workspace. */
export function unreadOf(doc: Document): number {
  const count = Number(doc.documentElement.dataset.unread ?? '0');
  return Number.isFinite(count) ? count : 0;
}

/** The title for the page shown now, its h1 and the unread count. */
export const currentTitle = (doc: Document): string =>
  documentTitle(pageHeading(doc)?.textContent ?? undefined, unreadOf(doc));

/** What `followPageTitle` needs from the browser. */
export interface TitleHost {
  readonly doc: Document;
  /** Watches the app's root for changes; returns a function that stops watching. */
  readonly observe: (onChange: () => void) => () => void;
  /** Runs `run` before the next paint. */
  readonly nextFrame: (run: () => void) => void;
}

/** Keeps `document.title` equal to the main landmark's h1 and the product's name, starting now; returns a function that stops it. */
export function followPageTitle({ doc, observe, nextFrame }: TitleHost): () => void {
  let isQueued = false;
  const update = () => {
    isQueued = false;
    const next = currentTitle(doc);
    if (doc.title !== next) doc.title = next;
  };
  update();
  return observe(() => {
    if (isQueued) return;
    isQueued = true;
    nextFrame(update);
  });
}
