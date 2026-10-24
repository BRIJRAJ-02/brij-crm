// The link page at `/<handle>` (spec 0051, built as blocks): a person's one ordered list of blocks, kept with their
// account and not with any workspace. Plain Zod with no oRPC, so the editor, the api and the public page share one
// definition. A block is one kind's fields (`ProfileBlock`, a union on `kind`): adding a kind means a schema here, a
// renderer and an editor on the client, and one line in the database's kind check, never a new table.
import * as z from 'zod';
import { HUES } from '../values/hue-list.ts';
import { Uuid } from '../values/ids.ts';
import { BookingDuration } from './settings.ts';

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

/** A link's address: checked and made canonical (`checkProfileLink`). */
export const ProfileLinkUrl = z.string().transform((typed, ctx) => {
  const checked = checkProfileLink(typed);
  if (checked.ok) return checked.url;
  ctx.issues.push({ code: 'custom', message: profileLinkProblem(checked.reason), input: typed });
  return z.NEVER;
});

/** One line, trimmed, with no line breaks. */
const oneLine = (min: number, max: number, empty: string, long: string) =>
  z
    .string()
    .trim()
    .min(min, empty)
    .max(max, long)
    .regex(/^[^\r\n]*$/, { error: 'Keep it to one line.' });

/** A link: a title, an address, an optional one line note and an optional icon (AC-5101, AC-5103). */
export const ProfileLinkBlock = z.object({
  kind: z.literal('link'),
  title: oneLine(1, 60, 'Give the link a title.', 'Keep the title to 60 characters.'),
  url: ProfileLinkUrl,
  note: oneLine(0, 120, '', 'Keep the note to 120 characters.').optional(),
  icon: z.enum(PROFILE_LINK_ICONS, { error: 'Pick one of the icons.' }).optional(),
  /** The letter's colour when there is no mark and no icon; the server picks one when none is given. */
  hue: z.enum(HUES).optional(),
});
/** A link block. */
export type ProfileLinkBlock = z.infer<typeof ProfileLinkBlock>;

/** A heading: the items after it, until the next heading, sit under it (AC-5101, AC-5105). */
export const ProfileHeadingBlock = z.object({
  kind: z.literal('heading'),
  title: oneLine(1, 40, 'Give the heading a title.', 'Keep the heading to 40 characters.'),
});
/** A heading block. */
export type ProfileHeadingBlock = z.infer<typeof ProfileHeadingBlock>;

/** One of the person's booking pages, by its workspace and id (AC-5104). Its own rules decide whether it shows. */
export const ProfilePageBlock = z.object({
  kind: z.literal('page'),
  workspaceId: Uuid,
  pageId: Uuid,
});
/** A booking page block. */
export type ProfilePageBlock = z.infer<typeof ProfilePageBlock>;

/** One block's fields, by kind: what every write is checked against before it is stored. */
export const ProfileBlock = z.discriminatedUnion('kind', [ProfileLinkBlock, ProfileHeadingBlock, ProfilePageBlock]);
/** One block's fields. */
export type ProfileBlock = z.infer<typeof ProfileBlock>;

/** What the editor knows of a booking page block's page: its facts, and whether a visitor sees it now. */
export const ProfilePageFacts = z.object({
  title: z.string(),
  slug: z.string(),
  durations: z.array(BookingDuration),
  isTeam: z.boolean(),
  /** The workspace it is from, named beside it. */
  workspaceName: z.string(),
  /**
   * `live`: on the page; `paused`: kept in place but not shown until it is resumed (AC-5104). A page the owner
   * made Link only, deleted, or left the workspace of has no facts at all.
   */
  status: z.enum(['live', 'paused']),
});
/** What the editor knows of a booking page block's page. */
export type ProfilePageFacts = z.infer<typeof ProfilePageFacts>;

/** What every stored block carries besides its fields. */
const Stored = {
  id: Uuid,
  /** When it was archived; absent while it is on the page. */
  archivedAt: z.string().optional(),
  updatedAt: z.string(),
};

/** One block as the editor reads it: its fields, its id, and for a booking page, the page's facts when it has any. */
export const ProfileItem = z.discriminatedUnion('kind', [
  ProfileLinkBlock.extend({ ...Stored, url: z.string(), hue: z.enum(HUES) }),
  ProfileHeadingBlock.extend(Stored),
  ProfilePageBlock.extend({ ...Stored, page: ProfilePageFacts.optional() }),
]);
/** One block as the editor reads it. */
export type ProfileItem = z.infer<typeof ProfileItem>;

/** The editor's read: the live blocks in order, and the archived ones, newest first. */
export const ProfileItems = z.object({
  items: z.array(ProfileItem),
  archived: z.array(ProfileItem),
});
/** The editor's read. */
export type ProfileItems = z.infer<typeof ProfileItems>;

/** A booking page the person may place on their link page, from any of their workspaces (AC-5117). */
export const ProfilePageChoice = z.object({
  workspaceId: Uuid,
  pageId: Uuid,
  facts: ProfilePageFacts,
});
/** A booking page the person may place. */
export type ProfilePageChoice = z.infer<typeof ProfilePageChoice>;

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

/**
 * One block as a visitor reads it (AC-5108, AC-5109): drawn as text, never markup, and carrying no workspace id, no
 * member id and no email. A link's `mark` is the social network its address is on (matched by the server, so the
 * public bundle never parses addresses), else its picked `icon`, else its title's first letter in `hue`.
 */
export const PublicProfileItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('link'),
    id: Uuid,
    title: z.string(),
    url: z.string(),
    note: z.string().optional(),
    mark: z.enum(PUBLIC_LINK_MARKS).optional(),
    icon: z.enum(PROFILE_LINK_ICONS).optional(),
    hue: z.enum(HUES),
  }),
  z.object({ kind: z.literal('heading'), id: Uuid, title: z.string() }),
  z.object({
    kind: z.literal('page'),
    id: Uuid,
    slug: z.string(),
    title: z.string(),
    description: z.string(),
    durations: z.array(BookingDuration),
    /** A team page books one of several people. */
    isTeam: z.boolean(),
  }),
]);
/** One block as a visitor reads it. */
export type PublicProfileItem = z.infer<typeof PublicProfileItem>;
