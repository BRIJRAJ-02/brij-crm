// Reading somebody else's link in bio page (spec 0055, AC-5524 to AC-5528). This is the parser alone: HTML in,
// rows out, no network and no database, so what it keeps and what it refuses is a table test rather than a
// description. The fetch that brings the HTML is `createOutsideFetch` in the api, bounded there.
//
// It reads anchors and nothing else. No script is run, no attribute but `href` is read, and the text of a row is
// the words inside its anchor with every tag stripped. A page that changes its markup tomorrow loses rows rather
// than importing wrong ones, which is the right way round: every row lands hidden and a person decides.
import { checkProfileLink, PROFILE_TITLE_MAX } from '@crm/contracts';

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

/**
 * The most rows one import lists as skipped. A page of bare anchors has thousands, and every one of them would be
 * stored and sent back; a person reading the list needs enough to recognise what was left behind, not all of it.
 */
export const LINK_IMPORT_SKIPPED_MAX = 100;

/** The longest address kept on a skipped row, which is the contract's own cap on that field. */
const SKIPPED_URL_MAX = 2048;

/** Whether `url` is a page we will read: one of the seven, or a subdomain of one, and nothing else. */
export function isImportableHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return LINK_IMPORT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Why a row the page had is not a link we can make. */
export type ImportSkip =
  'no-address' | 'not-web' | 'the-page-itself' | 'repeated' | 'past-limit' | 'no-title' | 'not-in-workspace';

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
    // A control character becomes a space before the whitespace is collapsed: `&#1;` is not whitespace, so it
    // would survive, and the database's check refuses a title that carries one. A page that writes them is
    // somebody else's, so the import would fail on markup the person never typed.
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const max = PROFILE_TITLE_MAX.link;
  // By code point, not by UTF-16 unit: an emoji in a link's title is ordinary on these pages, and cutting one in
  // half leaves a lone surrogate that Postgres refuses outright (22P05) rather than a title that is a little
  // short. Code points rather than grapheme clusters because that is what the database counts (`char_length`),
  // so a cluster-wise cut could still be over the limit.
  const letters = Array.from(plain);
  return letters.length > max ? letters.slice(0, max).join('').trimEnd() : plain;
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
  // Kept with whatever it had, bounded: the contract caps a skipped row's address, and a page of bare anchors has
  // thousands of them, every one of which would otherwise be stored and sent back.
  const leaveBehind = (row: SkippedRow) => {
    if (skipped.length >= LINK_IMPORT_SKIPPED_MAX) return;
    const cut = row.url === undefined ? undefined : row.url.slice(0, SKIPPED_URL_MAX);
    skipped.push({ ...row, ...(cut === undefined ? {} : { url: cut }) });
  };
  for (const { href, inner } of anchorsOf(html)) {
    const title = titleOf(inner);
    const named = title === '' ? {} : { title };
    if (href === undefined || href.trim() === '') {
      leaveBehind({ reason: 'no-address', ...named });
      continue;
    }
    if (!URL.canParse(href, source.href)) {
      leaveBehind({ reason: 'not-web', url: href, ...named });
      continue;
    }
    const url = new URL(href, source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      leaveBehind({ reason: 'not-web', url: url.href, ...named });
      continue;
    }
    if (url.hostname.toLowerCase() === source.hostname.toLowerCase()) {
      leaveBehind({ reason: 'the-page-itself', url: url.href, ...named });
      continue;
    }
    // The editor's own rule, so an imported address is one the editor could have saved and the database's check
    // will take: too long, userinfo in the authority, a control character. Without this one such anchor — which
    // is somebody else's page, not something the person typed — refuses the whole import with a sentence about
    // "that block" that they cannot act on.
    const checked = checkProfileLink(url.href);
    if (!checked.ok) {
      leaveBehind({ reason: 'not-web', url: url.href, ...named });
      continue;
    }
    const key = checked.url;
    if (seen.has(key)) {
      leaveBehind({ reason: 'repeated', url: key, ...named });
      continue;
    }
    seen.add(key);
    if (title === '') {
      // An icon only row: we know where it goes and not what to call it, so it is shown rather than guessed at.
      leaveBehind({ reason: 'no-title', url: key });
      continue;
    }
    if (rows.length >= max) {
      leaveBehind({ reason: 'past-limit', title, url: key });
      continue;
    }
    rows.push({ title, url: key });
  }
  return { rows, skipped };
}
