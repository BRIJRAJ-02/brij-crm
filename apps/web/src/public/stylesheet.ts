// A public page's own stylesheet (spec 0060, AC-4, AC-14, AC-20): a link page's `look.css` and a booking page's or
// form's `brand.css`, both on our own api, so the policy's `style-src 'self'` holds and nothing inline is written.
// The handle shell links a link page's in its head already (`withLook` in handle-shell.ts); a booking page and a
// form are static files on the edge, so their page links its brand once its read names the version, and waits a
// moment for it, so the first draw is already in the brand's colour. One link with one id: a later version
// replaces the first, and a page that has none any more removes it.

/** The link's id, as `handle-shell.ts` writes it (`LOOK_LINK_ID`). */
export const LOOK_LINK_ID = 'crm-look';

/** The longest a page waits for its stylesheet before drawing anyway: a slow one then arrives over the drawn page. */
export const STYLESHEET_WAIT_MS = 600;

/** The parts the path takes, as the api makes them (`brandStylesheetPath` in contracts). */
const VERSION = /^[0-9a-f]{12}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{16}$/;

/** A booking page's or form's brand stylesheet, or undefined when it wears the product's own accent. */
export function brandHref(
  kind: 'booking' | 'forms',
  publicKey: string,
  version: string | undefined,
): string | undefined {
  if (version === undefined || !VERSION.test(version) || !PUBLIC_KEY.test(publicKey)) return undefined;
  return `/api/public/${kind}/${publicKey}/brand.css?v=${version}`;
}

/** What linking needs from the document: its head, a lookup by id, and a new element. */
export type StylesheetDocument = Pick<Document, 'head' | 'getElementById' | 'createElement'>;

/**
 * Links `href` as the page's own stylesheet, and resolves once it has loaded, failed, or `waitMs` has passed. The
 * same address already linked resolves at once; undefined removes any link, since the page wears no look of its own.
 */
export function wearStylesheet(
  document: StylesheetDocument,
  href: string | undefined,
  waitMs: number = STYLESHEET_WAIT_MS,
): Promise<void> {
  const existing = document.getElementById(LOOK_LINK_ID);
  if (href === undefined) {
    existing?.remove();
    return Promise.resolve();
  }
  if (existing?.getAttribute('href') === href) return Promise.resolve();
  const link = document.createElement('link');
  link.id = LOOK_LINK_ID;
  link.rel = 'stylesheet';
  link.href = href;
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, waitMs);
    const done = () => {
      globalThis.clearTimeout(timer);
      resolve();
    };
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    if (existing === null) document.head.append(link);
    else existing.replaceWith(link);
  });
}
