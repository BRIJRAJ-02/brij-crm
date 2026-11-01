// The link page's rules with no Zod (spec 0051): the kinds, the limits and their sentences, the icons, and the one
// address check, so the browser's data layer (in the first load) and the editor say exactly what the server refuses
// without loading the schema library. `link-page.ts` builds the Zod schemas on these.
import { HUES } from '../values/hue-list.ts';

/** The kinds this build draws. A read that meets any other kind skips it. */
export const PROFILE_BLOCK_KINDS = [
  'link',
  'page',
  'heading',
  'contact',
  'text',
  'faq',
  'form',
  'testimonial',
  // Spec 0061: the socials row, media you tap to play, a picture, a gallery, next open times and a banner.
  'socials',
  'media',
  'image',
  'gallery',
  'times',
  'banner',
] as const;
/** One of the kinds this build draws. */
export type ProfileBlockKind = (typeof PROFILE_BLOCK_KINDS)[number];

/**
 * How many blocks of each kind one link page holds, and in all (AC-5102, spec 0061 AC-6115). `featured` is not a
 * kind: it is how many links may be drawn as the larger card. A banner's 1 counts live banners only, as every cap
 * here counts live blocks.
 */
export const PROFILE_LIMITS = {
  items: 60,
  link: 40,
  heading: 12,
  page: 60,
  contact: 3,
  text: 5,
  faq: 2,
  form: 3,
  testimonial: 6,
  socials: 1,
  media: 10,
  image: 10,
  gallery: 3,
  times: 3,
  banner: 1,
  featured: 3,
} as const;

/** The sentence a full kind is refused and disabled with (AC-5102, AC-6115), the server's and the editor's alike. */
export function profileLimitSentence(kind: ProfileBlockKind | 'items' | 'featured'): string {
  const most = (count: number, words: string) => `A link page holds up to ${String(count)} ${words}.`;
  switch (kind) {
    case 'items':
      return most(PROFILE_LIMITS.items, 'blocks');
    case 'link':
      return most(PROFILE_LIMITS.link, 'links');
    case 'heading':
      return most(PROFILE_LIMITS.heading, 'headings');
    case 'contact':
      return most(PROFILE_LIMITS.contact, 'contact cards');
    case 'text':
      return most(PROFILE_LIMITS.text, 'pieces of writing');
    case 'faq':
      return most(PROFILE_LIMITS.faq, 'sets of questions');
    case 'form':
      return most(PROFILE_LIMITS.form, 'forms');
    case 'testimonial':
      return most(PROFILE_LIMITS.testimonial, 'testimonials');
    case 'socials':
      return 'A link page holds one row of social links.';
    case 'media':
      return most(PROFILE_LIMITS.media, 'videos and songs');
    case 'image':
      return most(PROFILE_LIMITS.image, 'pictures');
    case 'gallery':
      return most(PROFILE_LIMITS.gallery, 'galleries');
    case 'times':
      return most(PROFILE_LIMITS.times, 'next times blocks');
    case 'banner':
      return 'A link page shows one banner at a time.';
    case 'featured':
      return most(PROFILE_LIMITS.featured, 'featured links');
    case 'page':
      return most(PROFILE_LIMITS.page, 'booking pages');
  }
}

/** The kinds a "Show from" and "Hide after" window may sit on (AC-6111): every kind but a heading. */
export const PROFILE_WINDOWED_KINDS: readonly ProfileBlockKind[] = PROFILE_BLOCK_KINDS.filter(
  (kind) => kind !== 'heading',
);

/** A block's window as stored: ISO 8601 UTC instants, either or both absent. */
export interface ProfileWindow {
  readonly showFrom?: string;
  readonly hideAfter?: string;
}

/** The sentence a window whose end does not come after its start is refused with (AC-6111). */
export const PROFILE_WINDOW_REFUSAL = '“Hide after” has to come after “Show from”.';

/** Why a window can't be kept, or undefined when it can: an end at or before its start. */
export function profileWindowProblem(window: ProfileWindow): string | undefined {
  if (window.showFrom === undefined || window.hideAfter === undefined) return undefined;
  return Date.parse(window.hideAfter) > Date.parse(window.showFrom) ? undefined : PROFILE_WINDOW_REFUSAL;
}

/**
 * Whether a block with this window is on the public page at `now` (AC-6111): from its start, inclusive, until its
 * end, exclusive. The database's own read (`crm_profile_items_public`) applies the same rule with its own clock;
 * this copy is for the editor's chip and the tests.
 */
export function isInProfileWindow(window: ProfileWindow, now: Date): boolean {
  const at = now.getTime();
  if (window.showFrom !== undefined && Date.parse(window.showFrom) > at) return false;
  return !(window.hideAfter !== undefined && Date.parse(window.hideAfter) <= at);
}

/** Where a window stands at `now`, for the editor's chip ("Starts 3 Nov, 09:00", "Ends 10 Nov", "Ended"). */
export type ProfileWindowState =
  | { readonly state: 'always' }
  | { readonly state: 'starts'; readonly at: string }
  | { readonly state: 'ends'; readonly at: string }
  | { readonly state: 'ended'; readonly at: string };

/** The chip a window shows at `now`: not started yet, running until an end, ended, or always on. */
export function profileWindowState(window: ProfileWindow, now: Date): ProfileWindowState {
  const at = now.getTime();
  if (window.hideAfter !== undefined && Date.parse(window.hideAfter) <= at) {
    return { state: 'ended', at: window.hideAfter };
  }
  if (window.showFrom !== undefined && Date.parse(window.showFrom) > at)
    return { state: 'starts', at: window.showFrom };
  if (window.hideAfter !== undefined) return { state: 'ends', at: window.hideAfter };
  return { state: 'always' };
}

/** How a link draws (AC-6102): the plain row, or the larger card with its picture across the top. */
export const PROFILE_LINK_STYLES = ['row', 'featured'] as const;
/** How a link draws. */
export type ProfileLinkStyle = (typeof PROFILE_LINK_STYLES)[number];

/** A tile's size on a grid page (AC-6103): 1 by 1, 2 by 1, or 2 by 2. Absent is `small`. */
export const PROFILE_TILE_SIZES = ['small', 'wide', 'large'] as const;
/** A tile's size on a grid page. */
export type ProfileTileSize = (typeof PROFILE_TILE_SIZES)[number];

/** The kinds that may take a tile size; every other kind always spans the full row (AC-6103). */
export const PROFILE_SIZED_KINDS = [
  'link',
  'page',
  'media',
  'image',
  'gallery',
] as const satisfies readonly ProfileBlockKind[];

/** Whether a kind always spans the full row of a grid page (AC-6103). */
export function spansFullRow(kind: ProfileBlockKind): boolean {
  return !PROFILE_SIZED_KINDS.some((sized) => sized === kind);
}

/** The notices a link may carry (AC-6113): self declared, as on Linktree, with no identity check. */
export const PROFILE_NOTICES = ['sensitive', '18', '21'] as const;
/** A notice a link may carry. */
export type ProfileNotice = (typeof PROFILE_NOTICES)[number];

/** What the notice sheet says for each notice (AC-6113). */
export function profileNoticeSentence(notice: ProfileNotice): string {
  if (notice === 'sensitive') return 'This link may show sensitive content.';
  return `You need to be ${notice} or older to open this.`;
}

/** The services a media block plays from (AC-6105), in the order the editor names them. */
export const MEDIA_PROVIDERS = ['youtube', 'vimeo', 'spotify', 'soundcloud', 'applemusic'] as const;
/** A service a media block plays from. */
export type MediaProvider = (typeof MEDIA_PROVIDERS)[number];

/** Each service's own name, for "Plays from YouTube" (AC-6106). */
export const MEDIA_PROVIDER_NAMES: Readonly<Record<MediaProvider, string>> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  applemusic: 'Apple Music',
};

/** The sentence a link from anywhere else is refused with (AC-6105). */
export const MEDIA_LINK_REFUSAL = 'Paste a link from YouTube, Vimeo, Spotify, SoundCloud or Apple Music.';

/**
 * A media block's `ref` as stored: the parsed id or canonical path, built by core's `parseMediaLink` and nothing
 * else. Letters, digits and `_ . : % / -` only, never `..`, so a frame address built from it can never leave the
 * provider's path.
 */
export const MEDIA_REF = /^(?!.*\.\.)[A-Za-z0-9_.:%/-]{1,240}$/;

/** The longest a media block's title may be. */
export const PROFILE_MEDIA_TITLE_MAX = 100;
/** The longest a banner's line may be (AC-6112). */
export const PROFILE_BANNER_MAX = 80;
/** The longest a picture's caption may be (AC-6108). */
export const PROFILE_CAPTION_MAX = 120;
/** The longest a picture's alt text may be. */
export const PROFILE_ALT_MAX = 200;
/** The sentence a picture with no alt text is refused with (AC-6108). */
export const PROFILE_ALT_REFUSAL = 'Describe the picture for people who can’t see it.';
/** How many pictures a gallery holds (AC-6109). */
export const PROFILE_GALLERY_MIN = 2;
/** The most pictures a gallery holds. */
export const PROFILE_GALLERY_MAX = 12;
/** How a gallery draws (AC-6109): a swipe row or a grid. */
export const PROFILE_GALLERY_DISPLAYS = ['row', 'grid'] as const;
/** How a gallery draws. */
export type ProfileGalleryDisplay = (typeof PROFILE_GALLERY_DISPLAYS)[number];

/** The picture types a link page stores (AC-6108, AC-6128): never SVG, never GIF. */
export const PROFILE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** A picture type a link page stores. */
export type ProfileImageType = (typeof PROFILE_IMAGE_TYPES)[number];
/** What a link page stores a picture as: an upload, a link's thumbnail, or a media block's poster. */
export const PROFILE_IMAGE_KINDS = ['upload', 'thumb', 'poster'] as const;
/** What a link page stores a picture as. */
export type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];
/** The largest picture a person may pick, before the browser makes it smaller (AC-6108). */
export const PROFILE_IMAGE_PICK_MAX_BYTES = 10 * 1024 * 1024;
/** The largest picture stored (AC-6108): the database's own check alike. */
export const PROFILE_IMAGE_MAX_BYTES = 1_572_864;
/** The longest side the browser makes a picture before upload (AC-6108). */
export const PROFILE_IMAGE_EDGE = 1600;

/** Where a link page's picture is served from: our own origin, under its handle (AC-6101). The id never changes. */
export function profileImagePath(handle: string, imageId: string): string {
  return `/api/public/profiles/${encodeURIComponent(handle)}/images/${imageId}`;
}

/** How many next open times a times block shows (AC-6110), over how many days ahead. */
export const PROFILE_TIMES_SHOWN = 6;
/** How many days ahead a times block looks. */
export const PROFILE_TIMES_DAYS = 14;

/** The periods Insights shows (AC-6118). */
export const PROFILE_INSIGHT_DAYS = [7, 30, 90] as const;
/** A period Insights shows. */
export type ProfileInsightDays = (typeof PROFILE_INSIGHT_DAYS)[number];
/** The longest range the CSV download covers (AC-6120). */
export const PROFILE_CSV_MAX_DAYS = 365;

/** The four facts a counted view carries (AC-6116), and nothing else. */
export const PROFILE_VIEW_FACTS = ['referrer', 'source', 'country', 'device'] as const;
/** One of the four facts a counted view carries. */
export type ProfileViewFact = (typeof PROFILE_VIEW_FACTS)[number];
/** A device class (AC-6116). */
export const PROFILE_DEVICES = ['mobile', 'tablet', 'desktop'] as const;
/** The value every visit with no referring site, or from our own origin, is filed under (AC-6116). */
export const PROFILE_DIRECT = 'Direct';
/** The value past the top 50 of a fact in a day folds into (AC-6117). */
export const PROFILE_OTHER = 'Other';
/** How many values of one fact a day keeps before the rest fold into `PROFILE_OTHER` (AC-6117). */
export const PROFILE_FACT_VALUES_PER_DAY = 50;
/** The longest referring host kept (AC-6116). */
export const PROFILE_REFERRER_MAX = 120;
/** The longest `utm_source` kept (AC-6116). */
export const PROFILE_SOURCE_MAX = 60;

/**
 * A share QR's style (AC-6124): a module colour against the fixed light background, an optional centre picture,
 * and an optional frame label. The background never changes, because not every scanner reads an inverted code.
 */
export const QR_BACKGROUND = '#ffffff';
/** The least contrast a module colour must keep against `QR_BACKGROUND` (AC-6124). */
export const QR_CONTRAST_MIN = 4.5;
/** The longest a QR frame's label may be (AC-6124). */
export const QR_LABEL_MAX = 20;
/** The sentence a module colour too light to scan is refused with (AC-6124). */
export const QR_CONTRAST_REFUSAL = 'Pick a darker colour, so every phone can read the code.';

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

/** What a testimonial's parts may run to (spec 0052, AC-5219): no photo and no logo, so these are all of it. */
export const PROFILE_QUOTE_MAX = 400;
/** How many line breaks a quote keeps. */
export const PROFILE_QUOTE_BREAKS = 6;
/** The longest an author's name, and their role, may be. */
export const PROFILE_AUTHOR_MAX = 80;

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

/**
 * The contact card's fields (AC-5113), in the order the editor asks for them and the vCard writes them. A person
 * may be reached three ways of each kind (26 October 2026): a work address and a personal one, a mobile and a
 * desk number, a company site and a portfolio. Several of each is the vCard's own shape, since EMAIL, TEL and URL
 * all repeat in RFC 6350, so the page still holds one card and still downloads as one person.
 */
export const PROFILE_CONTACT_FIELDS = [
  'fullName',
  'jobTitle',
  'company',
  'email',
  'email2',
  'email3',
  'phone',
  'phone2',
  'phone3',
  'website',
  'website2',
  'website3',
  'note',
] as const;
/** One of the contact card's fields. */
export type ProfileContactField = (typeof PROFILE_CONTACT_FIELDS)[number];

/** How many of each repeatable field a card may carry, the `2` and `3` above. */
export const PROFILE_CONTACT_EACH = 3;

/** The repeatable fields, each named by the word its keys begin with. */
export const PROFILE_CONTACT_REPEATED = ['email', 'phone', 'website'] as const;
/** One of the repeatable fields. */
export type ProfileContactRepeated = (typeof PROFILE_CONTACT_REPEATED)[number];

/**
 * A field's kind: `email2` is an email and is held to an email's rule, here and in the database alike. A field
 * that repeats is checked by its word, never by its full name, so a second one can never be checked less.
 */
export function contactFieldKind(field: ProfileContactField): ProfileContactField {
  const word = PROFILE_CONTACT_REPEATED.find((each) => field.startsWith(each));
  return word ?? field;
}

/** Every field of one repeatable kind, in order: `email`, `email2`, `email3`. */
export function contactFieldsOf(word: ProfileContactRepeated): readonly ProfileContactField[] {
  return PROFILE_CONTACT_FIELDS.filter((field) => contactFieldKind(field) === word);
}

/** The longest each contact card field may be, the database's check alike. */
export const PROFILE_CONTACT_MAX = Object.fromEntries(
  PROFILE_CONTACT_FIELDS.map((field) => {
    const kind = contactFieldKind(field);
    if (kind === 'fullName') return [field, 80];
    if (kind === 'phone') return [field, 32];
    if (kind === 'website') return [field, PROFILE_LINK_MAX];
    return [field, 120];
  }),
) as Readonly<Record<ProfileContactField, number>>;

/** A contact card's email: something, an at sign, a host with a dot, no spaces (the database's check alike). */
export const PROFILE_CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A contact card's phone: a plus, digits, and the spaces, dots, dashes and brackets people put in. */
export const PROFILE_CONTACT_PHONE = /^\+?[\d ().-]+$/;

/** A contact card as stored: a full name, and the rest only when given, up to three of each repeatable field. */
export interface ProfileContactCard {
  readonly fullName: string;
  readonly jobTitle?: string;
  readonly company?: string;
  readonly email?: string;
  readonly email2?: string;
  readonly email3?: string;
  readonly phone?: string;
  readonly phone2?: string;
  readonly phone3?: string;
  readonly website?: string;
  readonly website2?: string;
  readonly website3?: string;
  readonly note?: string;
}

/**
 * Every value of one repeatable kind a card carries, in order, the gaps closed: a card whose second email was
 * cleared but whose third was not still reads as two emails. The vCard and the editor both walk a card this way.
 */
export function contactValuesOf(card: ProfileContactCard, word: ProfileContactRepeated): readonly string[] {
  return contactFieldsOf(word).flatMap((field) => {
    const value = card[field];
    return value === undefined || value === '' ? [] : [value];
  });
}

/** What a typed contact card becomes: the card stored, or each field's problem. */
export type ProfileContactChecked =
  | { readonly ok: true; readonly card: ProfileContactCard }
  | { readonly ok: false; readonly problems: Readonly<Partial<Record<ProfileContactField, string>>> };

/** The words each field's name takes in a refusal. */
const CONTACT_KIND_WORDS: Readonly<Record<string, string>> = {
  fullName: 'name',
  jobTitle: 'job title',
  company: 'company',
  email: 'email',
  phone: 'phone',
  website: 'website',
  note: 'note',
};

/** The words a field's name takes in a refusal: a second email is still called an email. */
const CONTACT_WORDS = (field: ProfileContactField): string => CONTACT_KIND_WORDS[contactFieldKind(field)] ?? field;

/**
 * The fields of a card that list something it already lists, however it was typed: the same address twice is one
 * address, which the vCard would otherwise carry as two identical lines (26 October 2026). The later field is the
 * one named, so the one the person typed first stays where they put it. The database refuses the same pair
 * (migration 0111), comparing the values it stores, which are the canonical ones this answers about.
 */
export function repeatedContactFields(
  card: Readonly<Partial<Record<ProfileContactField, string>>>,
): readonly ProfileContactField[] {
  const repeated: ProfileContactField[] = [];
  for (const word of PROFILE_CONTACT_REPEATED) {
    const seen = new Set<string>();
    for (const field of contactFieldsOf(word)) {
      const value = card[field];
      if (value === undefined || value === '') continue;
      const same = word === 'phone' ? value.replace(/\D/g, '') : value.toLowerCase();
      if (seen.has(same)) repeated.push(field);
      else seen.add(same);
    }
  }
  return repeated;
}

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
    // A second email is an email: every rule below is the kind's, never the field's own name, so `email3` can
    // never be checked less than `email` (the database reads its keys the same way, migration 0111).
    const kind = contactFieldKind(field);
    const value = (typed[field] ?? '').trim();
    if (value === '') {
      if (field === 'fullName') problems.fullName = 'Enter your name.';
      continue;
    }
    if (PROFILE_CONTROL.test(value)) {
      problems[field] = 'Keep it to one line, with no special characters.';
      continue;
    }
    if (kind === 'website') {
      const checked = checkProfileLink(value);
      if (!checked.ok && checked.reason === 'too_long') problems[field] = profileLinkProblem('too_long');
      else if (!checked.ok || !/^https?:/.test(checked.url)) problems[field] = 'Use a web address, like timefix.com.';
      else card[field] = checked.url;
      continue;
    }
    if (value.length > PROFILE_CONTACT_MAX[field]) {
      problems[field] = `Keep the ${CONTACT_WORDS(field)} to ${String(PROFILE_CONTACT_MAX[field])} characters.`;
      continue;
    }
    if (kind === 'email' && !PROFILE_CONTACT_EMAIL.test(value)) {
      problems[field] = 'Enter an email address, like ana@example.com.';
      continue;
    }
    if (kind === 'phone') {
      const digits = value.replace(/\D/g, '').length;
      if (!PROFILE_CONTACT_PHONE.test(value) || digits < 3 || digits > 20) {
        problems[field] = 'Enter the number with its country code.';
        continue;
      }
    }
    card[field] = value;
  }
  for (const field of repeatedContactFields(card)) {
    problems[field] = `This ${CONTACT_WORDS(field)} is already on the card.`;
  }
  if (Object.keys(problems).length > 0 || card.fullName === undefined) return { ok: false, problems };
  return { ok: true, card: { ...card, fullName: card.fullName } };
}

/** How many days the editor's figures cover (AC-5127), and the period before them is the comparison. */
export const PROFILE_COUNT_DAYS = 30;
