// A link block's own icon, served from our own origin (the owner, 26 Oct 2026): a link to a site with no social
// mark can carry that site's favicon, and the public pages' policy (`img-src 'self'`) is unchanged, because the
// api fetches it and answers it itself. Spec 0051 named this as later work "stored in R2 (#32)"; nothing is
// stored. A favicon is a few kilobytes behind an hour of edge cache, so fetching one on a miss is cheaper than a
// bucket, and the product already serves account pictures this way (`./picture.ts`).
//
// This file names what may be fetched and nothing else: the api's fetch goes through the one outside door
// (`apps/api/src/public/outside.ts`, AC-5531), which refuses every private, loopback, link local, unique local,
// multicast and carrier grade NAT address before it connects and again after each redirect. What bounds the set
// of addresses is the route: only a link a page owner saved, on a live page, is ever reachable.
import { createHash } from 'node:crypto';

/** Where a site's icon sits when it declares none: the convention every browser tries first. */
export const FAVICON_PATH = '/favicon.ico';

/** The longest link address an icon is fetched for, which is the link block's own cap on that field. */
const LINK_URL_MAX = 2048;

/** An address that is a bare IPv4 or IPv6 literal rather than a name: no site, no favicon worth a fetch. */
const ADDRESS_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[.*\])$/;

/**
 * Whether a link's address is one we will look for an icon on: https, a host name rather than a bare address, no
 * port and no credentials. The outside door checks where the name resolves to; this only keeps the obvious
 * non-sites from costing a lookup at all.
 */
export function isFaviconSite(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    url.hostname.includes('.') &&
    !ADDRESS_LITERAL.test(url.hostname)
  );
}

/**
 * The two addresses an icon is looked for at, in order: the site's `/favicon.ico`, then the page itself, whose
 * head may declare one somewhere else. Undefined for anything `isFaviconSite` refuses, so a caller cannot turn a
 * stored link into a fetch of something that was never a site.
 */
export function faviconSources(link: string): { readonly guess: URL; readonly page: URL } | undefined {
  if (link.length > LINK_URL_MAX || !URL.canParse(link)) return undefined;
  const url = new URL(link);
  if (!isFaviconSite(url)) return undefined;
  const guess = new URL(FAVICON_PATH, url.origin);
  const page = new URL(url.href);
  page.hash = '';
  return { guess, page };
}

/** How much of a page is read looking for its icon: a head that hasn't declared one by here never will. */
const HEAD_MAX = 64 * 1024;

/** A `<link>` tag, as far as its closing bracket; a quoted value may hold a bracket, so quotes are matched first. */
const LINK_TAG = /<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;

/** One attribute of a tag: `name="value"`, `name='value'` or `name=value`. */
const ATTRIBUTE = /([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** The `rel` values an icon is declared under, best first: a site often gives several sizes. */
const ICON_RELS: readonly string[] = ['icon', 'shortcut icon', 'apple-touch-icon', 'apple-touch-icon-precomposed'];

/** The few HTML entities an address is likely to carry. Nothing is executed, and no tag survives this file. */
function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", '#39': "'" };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const key = body.toLowerCase();
    const known = named[key];
    if (known !== undefined) return known;
    const code = key.startsWith('#x')
      ? Number.parseInt(key.slice(2), 16)
      : key.startsWith('#')
        ? Number.parseInt(key.slice(1), 10)
        : Number.NaN;
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
  });
}

/** A tag's attributes, lowercased names to their values. A repeated name keeps the first, as a browser does. */
function attributesOf(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name !== undefined && found[name] === undefined) found[name] = decodeEntities(value);
  }
  return found;
}

/**
 * The icon a page's head declares, resolved against the page's own address, or undefined. The best `rel` wins
 * (a plain `icon` over an `apple-touch-icon`), and ties go to the one declared first, which is what a browser
 * with no size to go on does. The result is checked by `isFaviconSite` again, so a page cannot point the fetch
 * at a bare address, another scheme or a host with credentials in it.
 */
export function declaredIcon(html: string, page: URL): URL | undefined {
  let best: { readonly rank: number; readonly url: URL } | undefined;
  for (const tag of html.slice(0, HEAD_MAX).matchAll(LINK_TAG)) {
    const attributes = attributesOf(tag[1] ?? '');
    const rel = attributes['rel']?.trim().toLowerCase().replace(/\s+/g, ' ');
    const href = attributes['href'];
    if (rel === undefined || href === undefined || href === '') continue;
    const rank = ICON_RELS.indexOf(rel);
    if (rank === -1 || (best !== undefined && rank >= best.rank)) continue;
    if (!URL.canParse(href, page.href)) continue;
    const url = new URL(href, page.href);
    url.hash = '';
    if (isFaviconSite(url)) best = { rank, url };
  }
  return best?.url;
}

/**
 * An icon's version in our own paths (`?v=`): 12 hex of the block and the address it points at. A link edited to
 * point somewhere else is a new path, so nothing cached under the old one is ever shown for it, and the route
 * answers only the current version, so a made up one costs no fetch.
 */
export function faviconVersion(itemId: string, url: string): string {
  return createHash('sha256').update(`${itemId}\n${url}`).digest('hex').slice(0, 12);
}
