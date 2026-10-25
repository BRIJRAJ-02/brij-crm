// Reading somebody else's link in bio page (spec 0055, AC-5524 to AC-5528). This is the parser alone: HTML in,
// rows out, no network and no database, so what it keeps and what it refuses is a table test rather than a
// description. The fetch that brings the HTML is `createOutsideFetch` in the api, bounded there.
//
// It reads anchors and nothing else. No script is run, no attribute but `href` is read, and the text of a row is
// the words inside its anchor with every tag stripped. A page that changes its markup tomorrow loses rows rather
// than importing wrong ones, which is the right way round: every row lands hidden and a person decides.
import { PROFILE_TITLE_MAX } from '@crm/contracts';

/** The link in bio services a page may be brought across from (AC-5524). Nothing else is ever fetched. */
export const LINK_IMPORT_HOSTS: readonly string[] = [
  'linktr.ee',
  'bio.link',
  'lnk.bio',
  'linktw.in',
  'liinks.co',
  'solo.to',
  'beacons.ai',
];

/** The most rows one import brings (AC-5528). */
export const LINK_IMPORT_MAX = 40;

/** Whether `url` is a page we will read: one of the seven, or a subdomain of one, and nothing else. */
export function isImportableHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return LINK_IMPORT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Why a row the page had is not a link we can make. */
export type ImportSkip = 'no-address' | 'not-web' | 'the-page-itself' | 'repeated' | 'past-limit' | 'no-title';

/** A row we can make: a title and where it goes. */
export interface ImportedRow {
  readonly title: string;
  readonly url: string;
}

/** A row we cannot make, kept with whatever it had and why, so nothing is dropped without being shown (AC-5527). */
export interface SkippedRow {
  readonly title?: string;
  readonly url?: string;
  readonly reason: ImportSkip;
}

/** What one page gave: the rows to offer, and the ones to list with their reason. */
export interface ImportedPage {
  readonly rows: readonly ImportedRow[];
  readonly skipped: readonly SkippedRow[];
}

/** The few HTML entities a title is likely to carry, plus numeric ones. Nothing is executed and no tag survives. */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const key = body.toLowerCase();
    const known = named[key];
    if (known !== undefined) return known;
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

/**
 * An anchor's words: script and style taken out with their contents, every other tag taken out and its words
 * kept, entities read, whitespace collapsed, and the result cut to a link block's title length. A tag becomes a
 * space rather than nothing, so `<b>My</b><i>shop</i>` reads as two words and not as one.
 */
function titleOf(inner: string): string {
  const withoutCode = inner.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const plain = decodeEntities(withoutCode.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  const max = PROFILE_TITLE_MAX.link;
  return plain.length > max ? plain.slice(0, max).trimEnd() : plain;
}

/** Every anchor in the page, in the order it appears, as its `href` and the words inside it. */
function anchorsOf(html: string): readonly { readonly href: string | undefined; readonly inner: string }[] {
  const found: { href: string | undefined; inner: string }[] = [];
  // Opening tag, then everything up to the matching close. A nested anchor is not legal HTML and is not handled.
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(anchor)) {
    const attributes = match[1] ?? '';
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i.exec(attributes);
    found.push({
      href: href === null ? undefined : decodeEntities(href[2] ?? href[3] ?? href[4] ?? ''),
      inner: match[2] ?? '',
    });
  }
  return found;
}

/**
 * The rows one link in bio page offers (AC-5525, AC-5526, AC-5527). Every anchor is read; what cannot become a
 * link is listed with its reason rather than dropped. A row that points back at the page itself is the page's
 * own navigation, not somebody's link, and the first `max` rows are kept with the rest listed as past the limit.
 *
 * Nothing here decides what is published: the caller lands every row hidden, and a person turns them on.
 */
export function readImportedPage(html: string, source: URL, max: number = LINK_IMPORT_MAX): ImportedPage {
  const rows: ImportedRow[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();
  for (const { href, inner } of anchorsOf(html)) {
    const title = titleOf(inner);
    if (href === undefined || href.trim() === '') {
      skipped.push({ reason: 'no-address', ...(title === '' ? {} : { title }) });
      continue;
    }
    if (!URL.canParse(href, source.href)) {
      skipped.push({ reason: 'not-web', url: href, ...(title === '' ? {} : { title }) });
      continue;
    }
    const url = new URL(href, source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      skipped.push({ reason: 'not-web', url: url.href, ...(title === '' ? {} : { title }) });
      continue;
    }
    if (url.hostname.toLowerCase() === source.hostname.toLowerCase()) {
      skipped.push({ reason: 'the-page-itself', url: url.href, ...(title === '' ? {} : { title }) });
      continue;
    }
    const key = url.href;
    if (seen.has(key)) {
      skipped.push({ reason: 'repeated', url: key, ...(title === '' ? {} : { title }) });
      continue;
    }
    seen.add(key);
    if (title === '') {
      // An icon only row: we know where it goes and not what to call it, so it is shown rather than guessed at.
      skipped.push({ reason: 'no-title', url: key });
      continue;
    }
    if (rows.length >= max) {
      skipped.push({ reason: 'past-limit', title, url: key });
      continue;
    }
    rows.push({ title, url: key });
  }
  return { rows, skipped };
}
