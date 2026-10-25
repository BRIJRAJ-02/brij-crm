// The link page's rules with no Zod (spec 0051): the kinds, the limits and their sentences, the icons, and the one
// address check, so the browser's data layer (in the first load) and the editor say exactly what the server refuses
// without loading the schema library. `link-page.ts` builds the Zod schemas on these.
import { HUES } from '../values/hue-list.ts';

/** The kinds this build draws. A read that meets any other kind skips it. */
export const PROFILE_BLOCK_KINDS = ['link', 'page', 'heading', 'contact', 'text', 'faq', 'form'] as const;
/** One of the kinds this build draws. */
export type ProfileBlockKind = (typeof PROFILE_BLOCK_KINDS)[number];

/** How many blocks of each kind one link page holds, and in all (AC-5102). */
export const PROFILE_LIMITS = {
  items: 60,
  link: 40,
  heading: 12,
  page: 60,
  contact: 1,
  text: 5,
  faq: 2,
  form: 3,
} as const;

/** The sentence a full kind is refused and disabled with (AC-5102), the server's and the editor's alike. */
export function profileLimitSentence(kind: ProfileBlockKind | 'items'): string {
  if (kind === 'items') return `A link page holds up to ${String(PROFILE_LIMITS.items)} blocks.`;
  if (kind === 'link') return `A link page holds up to ${String(PROFILE_LIMITS.link)} links.`;
  if (kind === 'heading') return `A link page holds up to ${String(PROFILE_LIMITS.heading)} headings.`;
  if (kind === 'contact') return 'A link page holds one contact card.';
  if (kind === 'text') return `A link page holds up to ${String(PROFILE_LIMITS.text)} pieces of writing.`;
  if (kind === 'faq') return `A link page holds up to ${String(PROFILE_LIMITS.faq)} sets of questions.`;
  if (kind === 'form') return `A link page holds up to ${String(PROFILE_LIMITS.form)} forms.`;
  return `A link page holds up to ${String(PROFILE_LIMITS.page)} booking pages.`;
}

/**
 * What a heading does with the blocks under it (spec 0054, AC-5415): `open` is the small heading the page draws
 * today, and `folder` folds them behind one row a visitor presses. It is a word, never a level above the list: the
 * blocks under a heading are still the blocks after it, and the order stays one flat sequence.
 */
export const PROFILE_HEADING_GROUPS = ['open', 'folder'] as const;
/** What a heading does with the blocks under it. */
export type ProfileHeadingGroup = (typeof PROFILE_HEADING_GROUPS)[number];

/** A heading's group outside the two words, refused in the owner's own terms. */
export const PROFILE_HEADING_GROUP_REFUSAL = 'Pick whether the section stays open or folds.';

/** A read that meets a group this build does not know draws it open, so an older page never breaks on a newer one. */
export function headingGroupOf(given: string | undefined): ProfileHeadingGroup {
  return given === 'folder' ? 'folder' : 'open';
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

// Any control character, C0, DEL and C1, and the line and paragraph separators (U+2028, U+2029, which address
// books read as line breaks and a UTF-8 database may count as control characters): browsers strip them while resolving, so `java\tscript:` would otherwise
// read as text and run as script, and the database refuses them in every field (`[[:cntrl:]]`).
// eslint-disable-next-line no-control-regex
export const PROFILE_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** What the database stores (crm_check_profile_item): a web address with a host, or mailto, tel or sms, no spaces. */
const STORED_SHAPE = /^(https?:\/\/[^/?#@\s]+([/?#]\S*)?|mailto:\S+|tel:\S+|sms:\S+)$/i;

/** An email address typed on its own, with no scheme. */
const BARE_EMAIL = /^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/;

/** A phone number typed on its own: a plus, digits, and the spaces, dots, dashes and brackets people put in. */
const BARE_PHONE = /^\+?[\d\s().-]+$/;

/** What a typed address becomes: the one address stored, or why it can't be a link. */
export type ProfileLinkChecked =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: 'empty' | 'too_long' | 'invalid' };

/** A phone number with what people type around the digits taken out: `+44 20 (7946) 0958` is `+442079460958`. */
function digitsOf(number: string): string {
  return number.replace(/[\s().-]/g, '');
}

/**
 * A link's address as typed, checked and made canonical (AC-5103), the same rule in the editor and on the server:
 * trimmed; an email typed on its own becomes `mailto:`, a phone number `tel:` (its spaces, dots, dashes and brackets
 * taken out), and anything else without a scheme gets `https://`; then only `https:`, `http:`, `mailto:`, `tel:` or
 * `sms:`, at most 2,000 characters, no credentials, no control characters, a host for a web address, and no spaces
 * (a web address with spaces or backslashes is stored as the browser resolves it, spaces encoded). `javascript:`,
 * `data:` and every other scheme are refused. What it answers is exactly what the database's own check accepts. The
 * address is never wrapped or redirected: it stays the network's own canonical link, so a phone opens the network's
 * app (the owner, 25 Oct 2026).
 */
export function checkProfileLink(typed: string): ProfileLinkChecked {
  const value = typed.trim();
  if (value === '') return { ok: false, reason: 'empty' };
  if (value.length > PROFILE_LINK_MAX) return { ok: false, reason: 'too_long' };
  if (PROFILE_CONTROL.test(value)) return { ok: false, reason: 'invalid' };
  let full: string;
  if (BARE_EMAIL.test(value)) full = `mailto:${value}`;
  else if (BARE_PHONE.test(value) && digitsOf(value).replace('+', '').length >= 6) full = `tel:${digitsOf(value)}`;
  else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^:/]+:\d+(?:[/?#]|$)/.test(value)) full = value;
  else full = `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(full);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!LINK_SCHEMES.has(parsed.protocol)) return { ok: false, reason: 'invalid' };
  // The scheme as the browser reads it, lowercased; the rest as typed.
  let url = `${parsed.protocol}${full.slice(full.indexOf(':') + 1)}`;
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
    if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'invalid' };
    // A host with a dot (or localhost is never a public link): `https://intro` is a word, not a site.
    if (!parsed.hostname.includes('.') || parsed.hostname.endsWith('.')) return { ok: false, reason: 'invalid' };
    if (!/^\/\//.test(full.slice(parsed.protocol.length))) return { ok: false, reason: 'invalid' };
    if (/[\s\\]/.test(url)) url = parsed.href;
  } else if (parsed.protocol === 'tel:' || parsed.protocol === 'sms:') {
    // The number's own spaces and brackets go; what follows it (`?body=`) keeps its words, encoded.
    const rest = url.slice(parsed.protocol.length);
    const at = rest.search(/[?;]/);
    const number = digitsOf(at === -1 ? rest : rest.slice(0, at));
    if (!/^\+?\d{3,}$/.test(number)) return { ok: false, reason: 'invalid' };
    url = `${parsed.protocol}${number}${at === -1 ? '' : rest.slice(at).replace(/\s/g, '%20')}`;
  } else {
    if (parsed.pathname.trim() === '' || !parsed.pathname.includes('@')) return { ok: false, reason: 'invalid' };
    url = url.replace(/\s/g, '%20');
  }
  if (url.length > PROFILE_LINK_MAX) return { ok: false, reason: 'too_long' };
  if (!STORED_SHAPE.test(url)) return { ok: false, reason: 'invalid' };
  return { ok: true, url };
}

/** The sentence a refused address is refused with. */
export function profileLinkProblem(reason: 'empty' | 'too_long' | 'invalid'): string {
  if (reason === 'empty') return 'Enter the address.';
  if (reason === 'too_long') return `Keep the address to ${PROFILE_LINK_MAX.toLocaleString('en-US')} characters.`;
  return 'Use a web address, an email or a phone number.';
}

/** The longest title each kind takes, and a link's note. */
export const PROFILE_TITLE_MAX = { link: 60, heading: 40, text: 60, faq: 60, form: 60 } as const;

/** The longest piece of writing a text block holds, and how many line breaks it may have (spec 0052, AC-5205). */
export const PROFILE_TEXT_MAX = 1_000;
/** How many line breaks a text block's body may hold: enough for a few short paragraphs, not a document. */
export const PROFILE_TEXT_BREAKS = 20;
/** How many questions one FAQ block holds, and how long each half of one may be (spec 0052, AC-5209). */
export const PROFILE_FAQ_ITEMS = 10;
/** The longest a question may be: one line, the length of a link's title and half again. */
export const PROFILE_FAQ_QUESTION_MAX = 120;
/** The longest an answer may be, and how many line breaks it may hold: shorter than a piece of writing. */
export const PROFILE_FAQ_ANSWER_MAX = 600;
/** How many line breaks one answer may hold. */
export const PROFILE_FAQ_BREAKS = 10;
/**
 * Whether two questions are the same one asked twice (AC-5209): case and the spaces around them don't count, since
 * a visitor reading them down the page sees two of the same question either way.
 */
export function sameQuestion(one: string, other: string): boolean {
  return one.trim().toLocaleLowerCase('en-US') === other.trim().toLocaleLowerCase('en-US');
}

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

/** The contact card's fields (AC-5113), in the order the editor asks for them and the vCard writes them. */
export const PROFILE_CONTACT_FIELDS = ['fullName', 'jobTitle', 'company', 'email', 'phone', 'website', 'note'] as const;
/** One of the contact card's fields. */
export type ProfileContactField = (typeof PROFILE_CONTACT_FIELDS)[number];

/** The longest each contact card field may be, the database's check alike. */
export const PROFILE_CONTACT_MAX = {
  fullName: 80,
  jobTitle: 120,
  company: 120,
  email: 120,
  phone: 32,
  website: PROFILE_LINK_MAX,
  note: 120,
} as const satisfies Record<ProfileContactField, number>;

/** A contact card's email: something, an at sign, a host with a dot, no spaces (the database's check alike). */
export const PROFILE_CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A contact card's phone: a plus, digits, and the spaces, dots, dashes and brackets people put in. */
export const PROFILE_CONTACT_PHONE = /^\+?[\d ().-]+$/;

/** A contact card as stored: a full name, and the rest only when given. */
export interface ProfileContactCard {
  readonly fullName: string;
  readonly jobTitle?: string;
  readonly company?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly website?: string;
  readonly note?: string;
}

/** What a typed contact card becomes: the card stored, or each field's problem. */
export type ProfileContactChecked =
  | { readonly ok: true; readonly card: ProfileContactCard }
  | { readonly ok: false; readonly problems: Readonly<Partial<Record<ProfileContactField, string>>> };

/** The words each field's name takes in a refusal. */
const CONTACT_WORDS: Readonly<Record<ProfileContactField, string>> = {
  fullName: 'name',
  jobTitle: 'job title',
  company: 'company',
  email: 'email',
  phone: 'phone',
  website: 'website',
  note: 'note',
};

/**
 * A contact card as typed (AC-5113), checked the same way in the editor and on the server: each field trimmed, an
 * empty one left out, a full name required; one line each with no control characters; an email with an at sign and a
 * host, a phone of digits (at least 3, at most 20) and what people put around them, and a website made canonical as
 * a link's address is (`checkProfileLink`) but only a web one. What it answers is what the database's check accepts.
 */
export function checkContactCard(typed: Readonly<Partial<Record<ProfileContactField, string>>>): ProfileContactChecked {
  const problems: Partial<Record<ProfileContactField, string>> = {};
  const card: Partial<Record<ProfileContactField, string>> = {};
  for (const field of PROFILE_CONTACT_FIELDS) {
    const value = (typed[field] ?? '').trim();
    if (value === '') {
      if (field === 'fullName') problems.fullName = 'Enter your name.';
      continue;
    }
    if (PROFILE_CONTROL.test(value)) {
      problems[field] = 'Keep it to one line, with no special characters.';
      continue;
    }
    if (field === 'website') {
      const checked = checkProfileLink(value);
      if (!checked.ok && checked.reason === 'too_long') problems.website = profileLinkProblem('too_long');
      else if (!checked.ok || !/^https?:/.test(checked.url)) problems.website = 'Use a web address, like timefix.com.';
      else card.website = checked.url;
      continue;
    }
    if (value.length > PROFILE_CONTACT_MAX[field]) {
      problems[field] = `Keep the ${CONTACT_WORDS[field]} to ${String(PROFILE_CONTACT_MAX[field])} characters.`;
      continue;
    }
    if (field === 'email' && !PROFILE_CONTACT_EMAIL.test(value)) {
      problems.email = 'Enter an email address, like ana@example.com.';
      continue;
    }
    if (field === 'phone') {
      const digits = value.replace(/\D/g, '').length;
      if (!PROFILE_CONTACT_PHONE.test(value) || digits < 3 || digits > 20) {
        problems.phone = 'Enter the number with its country code.';
        continue;
      }
    }
    card[field] = value;
  }
  if (Object.keys(problems).length > 0 || card.fullName === undefined) return { ok: false, problems };
  return { ok: true, card: { ...card, fullName: card.fullName } };
}

/** How many days the editor's figures cover (AC-5127), and the period before them is the comparison. */
export const PROFILE_COUNT_DAYS = 30;
