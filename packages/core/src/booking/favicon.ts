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

/** Where each `<link>` tag starts. */
const LINK_START = /<link\b/gi;

/**
 * A `<link>` tag from its start, as far as its closing bracket; a quoted value may hold a bracket, so quotes are
 * matched first. Read within `TAG_MAX` of its start only, so a head of unclosed tags costs a page's length, never its
 * square: since spec 0059 any signed in person can have a page read (a company's logo).
 */
const LINK_TAG = /^<link\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i;

/** The longest `<link>` tag read: an icon's is a few hundred characters at most. */
const TAG_MAX = 1024;

/** The inside of each `<link>` tag in `head`, in order. */
function linkTags(head: string): string[] {
  const found: string[] = [];
  for (const start of head.matchAll(LINK_START)) {
    const tag = LINK_TAG.exec(head.slice(start.index, start.index + TAG_MAX));
    if (tag !== null) found.push(tag[1] ?? '');
  }
  return found;
}

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
 * How `declaredIcon` chooses among a head's icons. `rel`, a link block's: the best `rel`, as a browser with no size
 * to go on does. `logo`, a company's logo (spec 0059, AC-5904): by `sizes`, the icon that best fills a logo tile
 * (`LOGO_ENOUGH`), since a 16 pixel favicon is what it falls back to anyway.
 */
export type IconPick = 'rel' | 'logo';

/**
 * The size a logo needs: the largest tile it is drawn in (48 pixels, a record's heading) at twice the density. A
 * larger icon looks no better there and costs every browser more to load and decode, so the smallest icon of at
 * least this size wins, and below it the largest.
 */
const LOGO_ENOUGH = 96;

/** What a touch icon declared without `sizes` is taken as: Apple asks for 180 by 180. */
const TOUCH_ICON_SIZE = 180;

/** One `sizes` entry: `32x32`, `180X180`. */
const SIZE = /(\d{1,5})x(\d{1,5})/gi;

/**
 * How large a declared icon is, by the largest square its `sizes` names (`16x16 32x32` is 32). With none readable
 * (absent, or `any`), a touch icon counts as the size Apple asks for and anything else as 0, below every icon that
 * says its size.
 */
function declaredSize(sizes: string | undefined, rel: string): number {
  let largest = -1;
  for (const match of (sizes ?? '').matchAll(SIZE)) {
    largest = Math.max(largest, Math.min(Number(match[1]), Number(match[2])));
  }
  if (largest >= 0) return largest;
  return rel.startsWith('apple-touch-icon') ? TOUCH_ICON_SIZE : 0;
}

/** Whether an icon of `size` fills a logo better than one of `held`: enough beats too small, then the closer to enough. */
function fillsBetter(size: number, held: number): boolean {
  const enough = size >= LOGO_ENOUGH;
  if (enough !== held >= LOGO_ENOUGH) return enough;
  return enough ? size < held : size > held;
}

/** An icon drawn as SVG, by its declared type or its file name: never answered (`imageTypeOf`), so never worth a fetch. */
function isVectorIcon(type: string | undefined, url: URL): boolean {
  return type?.trim().toLowerCase() === 'image/svg+xml' || url.pathname.toLowerCase().endsWith('.svg');
}

/**
 * The icon a page's head declares, resolved against the page's own address, or undefined. By `rel` (the default),
 * the best `rel` wins (a plain `icon` over an `apple-touch-icon`) and ties go to the one declared first, which is
 * what a browser with no size to go on does. By `logo`, the declared size decides (the smallest of at least
 * `LOGO_ENOUGH`, else the largest), an SVG is passed over, and ties go to the better `rel`, then the first declared.
 * The result is checked by `isFaviconSite` again, so a page cannot point the fetch at a bare address, another scheme
 * or a host with credentials in it.
 */
export function declaredIcon(html: string, page: URL, pick: IconPick = 'rel'): URL | undefined {
  let best: { readonly rank: number; readonly size: number; readonly url: URL } | undefined;
  for (const tag of linkTags(html.slice(0, HEAD_MAX))) {
    const attributes = attributesOf(tag);
    const rel = attributes['rel']?.trim().toLowerCase().replace(/\s+/g, ' ');
    const href = attributes['href'];
    if (rel === undefined || href === undefined || href === '') continue;
    const rank = ICON_RELS.indexOf(rel);
    if (rank === -1) continue;
    // By `rel`, every size reads as the same, so only a better rel replaces the one held.
    const size = pick === 'logo' ? declaredSize(attributes['sizes'], rel) : 0;
    const better = best === undefined || (size === best.size ? rank < best.rank : fillsBetter(size, best.size));
    if (!better) continue;
    if (!URL.canParse(href, page.href)) continue;
    const url = new URL(href, page.href);
    url.hash = '';
    if (pick === 'logo' && isVectorIcon(attributes['type'], url)) continue;
    if (isFaviconSite(url)) best = { rank, size, url };
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
