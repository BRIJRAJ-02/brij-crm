// The document's title (WCAG 2.4.2): the page's h1, then the product, so
// every tab, history entry and bookmark says which page it is. It follows
// the h1 as it changes (a route change, a pending page resolving, a page
// that loads lazily), checked at most once a frame.

/** The product's name, after the page's in every title. */
export const PRODUCT = 'CRM';

/** "<page title> · CRM", or "CRM" alone while the page has no title. */
export function documentTitle(pageTitle: string | undefined): string {
  const title = pageTitle?.replaceAll(/\s+/g, ' ').trim() ?? '';
  return title === '' ? PRODUCT : `${title} · ${PRODUCT}`;
}

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
    const next = documentTitle(doc.querySelector('main h1')?.textContent ?? undefined);
    if (doc.title !== next) doc.title = next;
  };
  update();
  return observe(() => {
    if (isQueued) return;
    isQueued = true;
    nextFrame(update);
  });
}
