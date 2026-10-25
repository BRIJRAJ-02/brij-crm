// The link page at `/<handle>` (spec 0051, built as blocks): a person's one ordered list of blocks, kept with their
// account and not with any workspace. Plain Zod with no oRPC, so the editor, the api and the public page share one
// definition. A block is one kind's fields (`ProfileBlock`, a union on `kind`): adding a kind means a schema here, a
// renderer and an editor on the client, and one line in the database's kind check, never a new table.
import * as z from 'zod';
import { HUES } from '../values/hue-list.ts';
import {
  checkContactCard,
  repeatedContactFields,
  checkProfileLink,
  type ProfileContactField,
  PROFILE_LINK_ICONS,
  PROFILE_NOTE_MAX,
  PROFILE_TITLE_MAX,
  profileLinkProblem,
  PROFILE_CONTROL,
  PROFILE_FAQ_ANSWER_MAX,
  PROFILE_FAQ_BREAKS,
  PROFILE_FAQ_ITEMS,
  PROFILE_FAQ_QUESTION_MAX,
  PROFILE_AUTHOR_MAX,
  PROFILE_HEADING_GROUPS,
  PROFILE_HEADING_GROUP_REFUSAL,
  PROFILE_QUOTE_BREAKS,
  PROFILE_QUOTE_MAX,
  PROFILE_TEXT_BREAKS,
  PROFILE_TEXT_MAX,
  sameQuestion,
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

/**
 * Several lines, trimmed, keeping its line breaks and nothing else: a piece of writing's body and a FAQ answer are
 * the same shape with different numbers. `\r\n` becomes `\n` first so a Windows paste does not spend two breaks on
 * one line, and every other control character, U+2028 and U+2029 among them, is refused.
 */
const manyLines = (max: number, breaks: number, empty: string, long: string, tooMany: string) =>
  z
    .string()
    .transform((typed) => typed.replaceAll('\r\n', '\n').trim())
    .refine((text) => text.length >= 1, { error: empty })
    .refine((text) => text.length <= max, { error: long })
    .refine((text) => (text.match(/\n/g) ?? []).length <= breaks, { error: tooMany })
    .refine((text) => !PROFILE_CONTROL.test(text.replaceAll('\n', '')), {
      error: 'Take out the special characters.',
    });

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
  /**
   * Whether the blocks under it stay shown or fold behind one row a visitor presses (spec 0054, AC-5415). Absent
   * means `open`, so every heading stored before this field reads as the heading the page already drew.
   */
  group: z.enum(PROFILE_HEADING_GROUPS, { error: PROFILE_HEADING_GROUP_REFUSAL }).optional(),
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
export const ProfileContactBlock = z
  .object({
    kind: z.literal('contact'),
    fullName: contactField('fullName'),
    jobTitle: contactField('jobTitle').optional(),
    company: contactField('company').optional(),
    // Three of each way to reach the person (26 October 2026): a card written before them has only the first of
    // each, and is exactly what it was.
    email: contactField('email').optional(),
    email2: contactField('email2').optional(),
    email3: contactField('email3').optional(),
    phone: contactField('phone').optional(),
    phone2: contactField('phone2').optional(),
    phone3: contactField('phone3').optional(),
    website: contactField('website').optional(),
    website2: contactField('website2').optional(),
    website3: contactField('website3').optional(),
    note: contactField('note').optional(),
  })
  .superRefine((card, ctx) => {
    // Each field above is checked on its own, so the one rule that reads the whole card is here: the same address
    // listed twice (26 October 2026). The values compared are the canonical ones, as the database compares what it
    // stores (migration 0111).
    for (const field of repeatedContactFields(card)) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'This is already on the card.' });
    }
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
  body: manyLines(
    PROFILE_TEXT_MAX,
    PROFILE_TEXT_BREAKS,
    'Write something, or leave the block out.',
    'Keep it to 1,000 characters.',
    'Keep it to 20 line breaks. A longer piece reads better somewhere it can be a page.',
  ),
});
/** A text block. */
export type ProfileTextBlock = z.infer<typeof ProfileTextBlock>;

/**
 * Something a customer said (spec 0052, AC-5219): the words, who said them, and what they do. No photo and no logo
 * — the page loads no picture from another origin, and a face would need the file storage that is not built yet.
 * Plain text throughout, like a piece of writing, so there is nothing to sanitise on the way out.
 */
export const ProfileTestimonialBlock = z.object({
  kind: z.literal('testimonial'),
  quote: manyLines(
    PROFILE_QUOTE_MAX,
    PROFILE_QUOTE_BREAKS,
    'Write what they said.',
    'Keep the quote to 400 characters.',
    'Keep the quote to 6 line breaks.',
  ),
  author: oneLine(1, PROFILE_AUTHOR_MAX, 'Say who said it.', 'Keep the name to 80 characters.'),
  /** What they do, under their name: absent where it adds nothing. */
  role: oneLine(0, PROFILE_AUTHOR_MAX, '', 'Keep the role to 80 characters.').optional(),
});
/** Something a customer said. */
export type ProfileTestimonialBlock = z.infer<typeof ProfileTestimonialBlock>;

/** One question and its answer (AC-5209). The question is one line; the answer keeps its breaks, like a piece of writing. */
export const ProfileFaqItem = z.object({
  question: oneLine(1, PROFILE_FAQ_QUESTION_MAX, 'Write the question.', 'Keep the question to 120 characters.'),
  answer: manyLines(
    PROFILE_FAQ_ANSWER_MAX,
    PROFILE_FAQ_BREAKS,
    'Write the answer.',
    'Keep the answer to 600 characters.',
    'Keep the answer to 10 line breaks.',
  ),
});
/** One question and its answer. */
export type ProfileFaqItem = z.infer<typeof ProfileFaqItem>;

/**
 * The questions people ask, answered on the page (spec 0052, AC-5209): an optional title and one to ten questions.
 * Plain text throughout, drawn as the library's disclosure list, so a visitor reads the page before the answers.
 * The same question twice is refused: down the page it reads as a mistake either way.
 */
export const ProfileFaqBlock = z.object({
  kind: z.literal('faq'),
  title: oneLine(0, PROFILE_TITLE_MAX.faq, '', 'Keep the title to 60 characters.').optional(),
  items: z
    .array(ProfileFaqItem)
    .min(1, 'Ask at least one question.')
    .max(PROFILE_FAQ_ITEMS, 'Keep it to 10 questions.')
    .refine(
      (items) =>
        !items.some((item, at) => items.slice(0, at).some((before) => sameQuestion(before.question, item.question))),
      { error: 'You already asked that one.' },
    ),
});
/** A FAQ block. */
export type ProfileFaqBlock = z.infer<typeof ProfileFaqBlock>;

/**
 * One of the person's own hosted forms (spec 0052, AC-5213), by its workspace and its id, with the words its row
 * shows. The label is the owner's own, filled by the editor with the form's name: the form's internal name and the
 * headline on its page both stay out of the public answer, so a block tells a visitor nothing the form itself
 * wouldn't.
 */
export const ProfileFormBlock = z.object({
  kind: z.literal('form'),
  workspaceId: Uuid,
  formId: Uuid,
  label: oneLine(1, PROFILE_TITLE_MAX.form, 'Give the form a label.', 'Keep the label to 60 characters.'),
});
/** A form block. */
export type ProfileFormBlock = z.infer<typeof ProfileFormBlock>;

/** One block's fields, by kind: what every write is checked against before it is stored. */
export const ProfileBlock = z.discriminatedUnion('kind', [
  ProfileLinkBlock,
  ProfileHeadingBlock,
  ProfilePageBlock,
  ProfileContactBlock,
  ProfileTextBlock,
  ProfileFaqBlock,
  ProfileFormBlock,
  ProfileTestimonialBlock,
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

/**
 * What the editor knows of a form block's form: enough to say whether a visitor sees it, and where it goes. A form
 * the owner archived, or whose workspace they left, has no facts at all, exactly as a booking page does.
 */
export const ProfileFormFacts = z.object({
  /** The form's own name, as its workspace lists it: the editor's, never the public page's. */
  name: z.string(),
  /** Its public address after `/f/`. */
  key: z.string(),
  /** The workspace it is from, named beside it when a person has several. */
  workspaceName: z.string(),
  /** That workspace's address, for the editor's link to the form. */
  workspaceSlug: z.string(),
  /** `live`: a visitor may open it; `paused`: the block stays and comes back when the form is published again. */
  status: z.enum(['live', 'paused']),
});
/** What the editor knows of a form block's form. */
export type ProfileFormFacts = z.infer<typeof ProfileFormFacts>;

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
  ProfileFaqBlock.extend(Stored),
  ProfileFormBlock.extend({ ...Stored, form: ProfileFormFacts.optional() }),
  ProfileTestimonialBlock.extend(Stored),
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

/** Why a row a link in bio page had is not a link we can make (spec 0055, AC-5527). */
export const IMPORT_SKIPS = ['no-address', 'not-web', 'the-page-itself', 'repeated', 'past-limit', 'no-title'] as const;

/**
 * A row the import could not map, kept with whatever it had and why, so nothing is dropped without being shown
 * (AC-5527). The person may still add it by hand from what is here.
 */
export const SkippedImportRow = z.object({
  title: z.string().max(PROFILE_TITLE_MAX.link).optional(),
  url: z.string().max(2048).optional(),
  reason: z.enum(IMPORT_SKIPS),
});
/** A row the import could not map. */
export type SkippedImportRow = z.infer<typeof SkippedImportRow>;

/**
 * One link in bio page brought across (AC-5524 to AC-5528). `made` is how many hidden blocks it holds, and
 * `existed` says the same import was already made, so a retry adds nothing twice.
 */
export const ProfileLinkImport = z.object({
  id: Uuid,
  source: z.string(),
  made: z.number().int().min(0),
  existed: z.boolean(),
  itemIds: z.array(Uuid),
  skipped: z.array(SkippedImportRow),
});
/** One link in bio page brought across. */
export type ProfileLinkImport = z.infer<typeof ProfileLinkImport>;

/** What an import answers: the import itself, and the page's blocks as they now stand. */
export const ProfileLinkImportResult = ProfileItems.extend({ import: ProfileLinkImport });
/** What an import answers. */
export type ProfileLinkImportResult = z.infer<typeof ProfileLinkImportResult>;

/** A form the person may place on their link page, from any of their workspaces (spec 0052, AC-5213). */
export const ProfileFormChoice = z.object({
  workspaceId: Uuid,
  formId: Uuid,
  facts: ProfileFormFacts,
});
/** A form the person may place. */
export type ProfileFormChoice = z.infer<typeof ProfileFormChoice>;

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
  /**
   * A heading, and what it does with the blocks under it. `catch` draws an unfamiliar group open, so a bundle built
   * before a later group still reads a page that uses one (AC-5415).
   */
  z.object({
    kind: z.literal('heading'),
    id: Uuid,
    title: z.string(),
    group: z.enum(PROFILE_HEADING_GROUPS).catch('open').optional(),
  }),
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
  /** The questions, with their answers: a fold a visitor opens, counting nothing (AC-5210, AC-5211). */
  z.object({
    kind: z.literal('faq'),
    id: Uuid,
    title: z.string().optional(),
    items: z.array(ProfileFaqItem).min(1),
  }),
  /**
   * A Timefix form: the owner's own words and the form's address on our own origin (AC-5215, AC-5226). No workspace
   * id, no form id, no question and no count: the same rule a booking page block follows.
   */
  z.object({ kind: z.literal('form'), id: Uuid, title: z.string().min(1), key: z.string().min(1) }),
  /** Something a customer said: words only, with nothing to press and nothing to count (AC-5220). */
  z.object({
    kind: z.literal('testimonial'),
    id: Uuid,
    quote: z.string().min(1),
    author: z.string().min(1),
    role: z.string().optional(),
  }),
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
