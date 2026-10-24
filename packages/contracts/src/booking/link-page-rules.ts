// The link page's rules with no Zod (spec 0051): the kinds, the limits and their sentences, the icons, and the one
// address check, so the browser's data layer (in the first load) and the editor say exactly what the server refuses
// without loading the schema library. `link-page.ts` builds the Zod schemas on these.
import { HUES } from '../values/hue-list.ts';

/** The kinds this build draws. A read that meets any other kind skips it. */
export const PROFILE_BLOCK_KINDS = ['link', 'page', 'heading'] as const;
/** One of the kinds this build draws. */
export type ProfileBlockKind = (typeof PROFILE_BLOCK_KINDS)[number];

/** How many blocks of each kind one link page holds, and in all (AC-5102). */
export const PROFILE_LIMITS = { items: 60, link: 40, heading: 12, page: 60 } as const;

/** The sentence a full kind is refused and disabled with (AC-5102), the server's and the editor's alike. */
export function profileLimitSentence(kind: ProfileBlockKind | 'items'): string {
  if (kind === 'items') return `A link page holds up to ${String(PROFILE_LIMITS.items)} blocks.`;
  if (kind === 'link') return `A link page holds up to ${String(PROFILE_LIMITS.link)} links.`;
  if (kind === 'heading') return `A link page holds up to ${String(PROFILE_LIMITS.heading)} headings.`;
  return `A link page holds up to ${String(PROFILE_LIMITS.page)} booking pages.`;
}

/** The longest address a link keeps. */
export const PROFILE_LINK_MAX = 2_000;

/**
 * The icons an owner may pick for a link (AC-5110), each a Lucide name the library's Icon draws. A link to a known
 * social network shows that network's own mark instead, and a link with none shows its title's first letter.
 */
export const PROFILE_LINK_ICONS = [
  'link',
  'globe',
  'mail',
  'phone',
  'message-square',
  'calendar',
  'file-text',
  'briefcase',
  'map-pin',
  'music',
  'video',
  'camera',
  'mic',
  'shopping-bag',
  'store',
  'book-open',
  'newspaper',
  'code',
  'rocket',
  'gift',
  'ticket',
  'presentation',
  'star',
  'heart',
] as const;
/** An icon an owner may pick for a link. */
export type ProfileLinkIcon = (typeof PROFILE_LINK_ICONS)[number];

/** The schemes a link may use (AC-5103). */
const LINK_SCHEMES = new Set(['https:', 'http:', 'mailto:', 'tel:', 'sms:']);

// Any ASCII control character, NUL to US, and DEL: browsers strip them while resolving, so `java\tscript:` would
// otherwise read as text and run as script.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** What a typed address becomes: the one address stored, or why it can't be a link. */
export type ProfileLinkChecked =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'empty' | 'too_long' | 'invalid' };

/**
 * A link's address as typed, checked and made canonical (AC-5103), the same rule in the editor and on the server:
 * trimmed; `https://` put before an address typed without a scheme; then only `https:`, `http:`, `mailto:`, `tel:`
 * or `sms:`, at most 2,000 characters, no credentials, no control characters, and a host for a web address.
 * `javascript:`, `data:` and every other scheme are refused. The address is never wrapped or redirected: it stays
 * the network's own canonical link, so a phone opens the network's app (the owner, 25 Oct 2026).
 */
export function checkProfileLink(typed: string): ProfileLinkChecked {
  const value = typed.trim();
  if (value === '') return { ok: false, reason: 'empty' };
  if (value.length > PROFILE_LINK_MAX) return { ok: false, reason: 'too_long' };
  if (CONTROL.test(value)) return { ok: false, reason: 'invalid' };
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^:/]+:\d+(?:[/?#]|$)/.test(value);
  const full = hasScheme ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(full);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!LINK_SCHEMES.has(parsed.protocol)) return { ok: false, reason: 'invalid' };
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'invalid' };
    // A host with a dot (or localhost is never a public link): `https://intro` is a word, not a site.
    if (!parsed.hostname.includes('.') || parsed.hostname.endsWith('.')) return { ok: false, reason: 'invalid' };
    if (!/^\/\//.test(full.slice(parsed.protocol.length))) return { ok: false, reason: 'invalid' };
  } else if (parsed.pathname.trim() === '') {
    return { ok: false, reason: 'invalid' };
  }
  const url = hasScheme ? `${parsed.protocol}${full.slice(full.indexOf(':') + 1)}` : full;
  if (url.length > PROFILE_LINK_MAX) return { ok: false, reason: 'too_long' };
  return { ok: true, url };
}

/** The sentence a refused address is refused with. */
export function profileLinkProblem(reason: 'empty' | 'too_long' | 'invalid'): string {
  if (reason === 'empty') return 'Enter the address.';
  if (reason === 'too_long') return `Keep the address to ${PROFILE_LINK_MAX.toLocaleString('en-US')} characters.`;
  return 'That address can’t be a link.';
}

/** The longest title each kind takes, and a link's note. */
export const PROFILE_TITLE_MAX = { link: 60, heading: 40 } as const;
/** The longest note a link takes. */
export const PROFILE_NOTE_MAX = 120;

/** The hues a link's letter may take. */
export const PROFILE_HUES = HUES;

/** The social networks whose marks a link shows, as the public answer names them. */
export const PUBLIC_LINK_MARKS = [
  'linkedin',
  'x',
  'instagram',
  'github',
  'facebook',
  'youtube',
  'angellist',
  'tiktok',
  'threads',
] as const;

/** The hosts each network's links live on: the same table as `values/social.ts` (a test holds them equal). */
export const LINK_MARK_HOSTS: Readonly<Record<(typeof PUBLIC_LINK_MARKS)[number], readonly string[]>> = {
  linkedin: ['linkedin.com'],
  x: ['x.com', 'twitter.com'],
  instagram: ['instagram.com'],
  github: ['github.com'],
  facebook: ['facebook.com', 'fb.com'],
  youtube: ['youtube.com'],
  angellist: ['wellfound.com', 'angel.co'],
  tiktok: ['tiktok.com'],
  threads: ['threads.com', 'threads.net'],
};

/**
 * The network whose mark a link shows (AC-5110): the one its web address's host is on (`uk.linkedin.com` is
 * LinkedIn's), else none. The server answers it with the page, and the editor's preview draws the same before
 * saving, so the public bundle never parses an address.
 */
export function linkMarkOf(url: string): (typeof PUBLIC_LINK_MARKS)[number] | undefined {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    host = parsed.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, '');
  } catch {
    return undefined;
  }
  return PUBLIC_LINK_MARKS.find((mark) =>
    LINK_MARK_HOSTS[mark].some((own) => host === own || host.endsWith(`.${own}`)),
  );
}
