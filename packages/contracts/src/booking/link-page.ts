// The link page at `/<handle>` (spec 0051, built as blocks): a person's one ordered list of blocks, kept with their
// account and not with any workspace. Plain Zod with no oRPC, so the editor, the api and the public page share one
// definition. A block is one kind's fields (`ProfileBlock`, a union on `kind`): adding a kind means a schema here, a
// renderer and an editor on the client, and one line in the database's kind check, never a new table.
import * as z from 'zod';
import { HUES } from '../values/hue-list.ts';
import {
  checkContactCard,
  checkProfileLink,
  type ProfileContactField,
  PROFILE_LINK_ICONS,
  PROFILE_NOTE_MAX,
  PROFILE_TITLE_MAX,
  profileLinkProblem,
  PROFILE_CONTROL,
  PROFILE_TEXT_BREAKS,
  PROFILE_TEXT_MAX,
  PUBLIC_LINK_MARKS,
} from './link-page-rules.ts';

import { Uuid } from '../values/ids.ts';
import { BookingDuration } from './settings.ts';

export * from './link-page-rules.ts';

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
    .refine((text) => !PROFILE_CONTROL.test(text), { error: 'Keep it to one line, with no special characters.' });

/** A link: a title, an address, an optional one line note and an optional icon (AC-5101, AC-5103). */
export const ProfileLinkBlock = z.object({
  kind: z.literal('link'),
  title: oneLine(1, PROFILE_TITLE_MAX.link, 'Give the link a title.', 'Keep the title to 60 characters.'),
  url: ProfileLinkUrl,
  note: oneLine(0, PROFILE_NOTE_MAX, '', 'Keep the note to 120 characters.').optional(),
  icon: z.enum(PROFILE_LINK_ICONS, { error: 'Pick one of the icons.' }).optional(),
  /** The letter's colour when there is no mark and no icon; the server picks one when none is given. */
  hue: z.enum(HUES).optional(),
});
/** A link block. */
export type ProfileLinkBlock = z.infer<typeof ProfileLinkBlock>;

/** A heading: the items after it, until the next heading, sit under it (AC-5101, AC-5105). */
export const ProfileHeadingBlock = z.object({
  kind: z.literal('heading'),
  title: oneLine(1, PROFILE_TITLE_MAX.heading, 'Give the heading a title.', 'Keep the heading to 40 characters.'),
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

/** One contact card field: what `checkContactCard` keeps of it, refused in its words. */
const contactField = (field: ProfileContactField) =>
  z.string().transform((typed, ctx) => {
    const checked = checkContactCard({ fullName: 'A', [field]: typed });
    const kept = checked.ok ? checked.card[field] : undefined;
    if (kept !== undefined) return kept;
    const problem = checked.ok ? undefined : checked.problems[field];
    ctx.issues.push({ code: 'custom', message: problem ?? 'Leave it out when it is empty.', input: typed });
    return z.NEVER;
  });

/**
 * The contact card (AC-5113): the fields its owner typed, a full name required and the rest optional, each kept as
 * `checkContactCard` keeps it. Nothing comes from a CRM record. At most one is live (AC-5102); it is saved as a vCard
 * from the page (AC-5114).
 */
export const ProfileContactBlock = z.object({
  kind: z.literal('contact'),
  fullName: contactField('fullName'),
  jobTitle: contactField('jobTitle').optional(),
  company: contactField('company').optional(),
  email: contactField('email').optional(),
  phone: contactField('phone').optional(),
  website: contactField('website').optional(),
  note: contactField('note').optional(),
});
/** A contact card block. */
export type ProfileContactBlock = z.infer<typeof ProfileContactBlock>;

/**
 * A few lines in the person's own words (spec 0052, AC-5205): a title and a body of plain text. There is no markup
 * at all, so there is nothing to sanitise on the way out; a person who wants a link adds a link block. Line breaks
 * are the one thing kept, and `\r\n` becomes `\n` first so a Windows paste does not spend two of them.
 */
export const ProfileTextBlock = z.object({
  kind: z.literal('text'),
  title: oneLine(0, PROFILE_TITLE_MAX.text, '', 'Keep the title to 60 characters.').optional(),
  body: z
    .string()
    .transform((typed) => typed.replaceAll('\r\n', '\n').trim())
    .refine((text) => text.length >= 1, { error: 'Write something, or leave the block out.' })
    .refine((text) => text.length <= PROFILE_TEXT_MAX, { error: 'Keep it to 1,000 characters.' })
    .refine((text) => (text.match(/\n/g) ?? []).length <= PROFILE_TEXT_BREAKS, {
      error: 'Keep it to 20 line breaks. A longer piece reads better somewhere it can be a page.',
    })
    // Line breaks are allowed through; every other control character, U+2028 and U+2029 among them, is not.
    .refine((text) => !PROFILE_CONTROL.test(text.replaceAll('\n', '')), {
      error: 'Take out the special characters.',
    }),
});
/** A text block. */
export type ProfileTextBlock = z.infer<typeof ProfileTextBlock>;

/** One block's fields, by kind: what every write is checked against before it is stored. */
export const ProfileBlock = z.discriminatedUnion('kind', [
  ProfileLinkBlock,
  ProfileHeadingBlock,
  ProfilePageBlock,
  ProfileContactBlock,
  ProfileTextBlock,
]);
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
  /** That workspace's address, for its editor's link (`/w/<slug>/captures/links/<page>`). */
  workspaceSlug: z.string(),
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
  ProfileContactBlock.extend(Stored),
  ProfileTextBlock.extend(Stored),
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
  /** The contact card: its name and the line under it; the rest is in the vCard its Save contact downloads. */
  z.object({
    kind: z.literal('contact'),
    id: Uuid,
    fullName: z.string().min(1),
    jobTitle: z.string().optional(),
    company: z.string().optional(),
  }),
  /** Writing: the words themselves, drawn as text and never as markup (spec 0052, AC-5206). */
  z.object({ kind: z.literal('text'), id: Uuid, title: z.string().optional(), body: z.string().min(1) }),
]);
/** One block as a visitor reads it. */
export type PublicProfileItem = z.infer<typeof PublicProfileItem>;

/** A link page's views and visitors over one period. */
const ProfileTraffic = z.object({
  views: z.number().int().min(0),
  /** One a day: a visitor is the day's HMAC, so the same person on two days is two. */
  visitors: z.number().int().min(0),
});

/**
 * The editor's figures (AC-5127): over the last `days` UTC days (today included), the page's views and visitors,
 * the same for the period before as the comparison, and each live block's presses. A block with none is absent.
 */
export const ProfileCounts = ProfileTraffic.extend({
  days: z.number().int().min(1),
  before: ProfileTraffic,
  presses: z.array(z.object({ id: Uuid, presses: z.number().int().min(1) })),
});
/** The editor's figures. */
export type ProfileCounts = z.infer<typeof ProfileCounts>;
