// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BIO_MAX, handleProblem } from './booking/handles.ts';
import { WALLET_KINDS } from './brand.ts';
import {
  ProfileBlock,
  ProfileCounts,
  ProfileFormChoice,
  ProfileItem,
  ProfileItems,
  ProfileLinkImportResult,
  ProfilePageChoice,
} from './booking/link-page.ts';
import { PageTheme } from './booking/page-theme.ts';
import { TimeZoneName } from './booking/settings.ts';
import { Uuid } from './values/ids.ts';
import { checkSocialLink, socialLinkProblem } from './values/social.ts';
import { SOCIAL_LINK_NAMES, SOCIAL_LINK_NETWORKS, SOCIAL_LINKS_MAX } from './values/social-networks.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** A member's name in a workspace: 1 to 80 characters, trimmed (AC-821). */
export const MemberName = z.string().trim().min(1, 'Enter your name.').max(80, 'Use at most 80 characters.');
/** A member's name in a workspace. */
export type MemberName = z.infer<typeof MemberName>;

/** The most characters a job title takes (spec 0037, AC-1441). */
export const JOB_TITLE_MAX = 60;

/**
 * A member's job title in a workspace (spec 0037, AC-1441): one line, up to 60 characters; empty clears it. A label
 * on the Team day and the order it can take, never read by any access check.
 */
export const JobTitle = z
  .string()
  .trim()
  .max(JOB_TITLE_MAX, `Keep the job title to ${String(JOB_TITLE_MAX)} characters.`)
  .regex(/^[^\r\n]*$/, { error: 'Keep the job title to one line.' });
/** A member's job title. */
export type JobTitle = z.infer<typeof JobTitle>;

/**
 * A person's handle (22 Oct 2026): their public profile at `/<handle>`, each booking page at `/<handle>/<slug>`.
 * Lowercase letters, numbers and single hyphens, 3 to 40, and not a word kept for the app; unique everywhere.
 */
export const PublicHandle = z
  .string()
  .trim()
  .toLowerCase()
  .check((ctx) => {
    const problem = handleProblem(ctx.value);
    if (problem !== undefined) ctx.issues.push({ code: 'custom', message: problem, input: ctx.value });
  });
/** A person's handle. */
export type PublicHandle = z.infer<typeof PublicHandle>;

/** A person's one line bio on their public profile: at most 160 characters, no line breaks. */
export const PublicBio = z
  .string()
  .trim()
  .max(BIO_MAX, `Keep your bio to ${String(BIO_MAX)} characters.`)
  .regex(/^[^\r\n]*$/, { error: 'Keep your bio to one line.' });
/** A person's one line bio. */
export type PublicBio = z.infer<typeof PublicBio>;

/** A network a person's social link names, or their website. */
export const SocialLinkNetwork = z.enum(SOCIAL_LINK_NETWORKS, { error: 'Pick one of the networks.' });
/** A network a person's social link names, or their website. */
export type SocialLinkNetwork = z.infer<typeof SocialLinkNetwork>;

/**
 * One of a person's own social links (booking socials, 25 Oct 2026): the network and its one canonical link. A
 * handle or a pasted link is turned into that link here (`checkSocialLink`), refused in plain words; a canonical
 * link checks as itself, so the stored shape parses through it unchanged.
 */
export const SocialLink = z
  .object({ network: SocialLinkNetwork, href: z.string().max(2_048, { error: 'That link is too long.' }) })
  .transform((link, ctx) => {
    const checked = checkSocialLink(link.network, link.href);
    if (checked.ok) return { network: link.network, href: checked.value };
    ctx.issues.push({ code: 'custom', message: socialLinkProblem(link.network, checked), input: link, path: ['href'] });
    return z.NEVER;
  });
/** One of a person's social links. */
export type SocialLink = z.infer<typeof SocialLink>;

/** A person's social links, in their order: one per network, at most ten. */
export const SocialLinks = z
  .array(SocialLink)
  .max(SOCIAL_LINKS_MAX, { error: `Add at most ${String(SOCIAL_LINKS_MAX)} social links.` })
  .check((ctx) => {
    const seen = new Set<string>();
    for (const [index, link] of ctx.value.entries()) {
      if (seen.has(link.network)) {
        ctx.issues.push({
          code: 'custom',
          message: `Add ${SOCIAL_LINK_NAMES[link.network]} only once.`,
          input: link,
          path: [index, 'network'],
        });
      }
      seen.add(link.network);
    }
  });
/** A person's social links. */
export type SocialLinks = z.infer<typeof SocialLinks>;

/**
 * The caller's profile in this workspace. `timeZone` is theirs, absent when
 * they follow the workspace's (`workspaceTimeZone`). `image` is the account's
 * picture from Google, absent for an email code account, which shows initials
 * on a colour from `memberId` (owner decision 12).
 */
export const MyProfile = z.object({
  memberId: Uuid,
  name: z.string(),
  email: z.string(),
  timeZone: z.string().optional(),
  /** Their job title in this workspace (spec 0037, AC-1441); absent when they set none. */
  jobTitle: z.string().optional(),
  workspaceTimeZone: z.string(),
  /** Their account's Google picture as our own origin serves it (`/api/me/picture?v=`, 23 Oct 2026), never Google's URL. */
  image: z.string().optional(),
  /**
   * Whether their account has Google linked (23 Oct 2026): Sync Google photo refreshes it when linked, and links it
   * first when not. Absent where Google sign in is off.
   */
  google: z.enum(['linked', 'unlinked']).optional(),
  /** The name of the workspace the profile is read in, for the one line that says whose link page this is (spec 0056). */
  workspaceName: z.string().optional(),
  /** Their handle in this workspace (each workspace has its own, spec 0056); absent until they pick one. */
  handle: z.string().optional(),
  /**
   * The other workspaces they belong to where they already have a link page (spec 0056, AC-5618): only workspaces
   * they are an active member of, as ids. Absent when there are none. The ids are named in the browser, from the
   * workspaces `me.get` already answers: a workspace's name is the directory's, and the member door has no
   * identity to read it through.
   */
  otherLinkPages: z.array(z.object({ workspaceId: Uuid })).optional(),
  /** A free handle from their name, for the field's first value while they have none. */
  suggestedHandle: z.string().optional(),
  /** Their one line bio on their public profile. */
  bio: z.string(),
  /**
   * Their account picture stays off their public pages (owner ask A124, 23 Oct 2026): their booking pages and their
   * profile show initials instead. The person's own, the same in every workspace; false until they turn it on, and
   * absent for a member with no sign in of their own, who has no picture to hide.
   */
  pictureHidden: z.boolean().optional(),
  /**
   * Their social links (booking socials, 25 Oct 2026): the person's own, the same in every workspace, shown on their
   * booking pages and profile. Absent for a member with no sign in of their own.
   */
  socials: z.array(z.object({ network: SocialLinkNetwork, href: z.string() })).optional(),
  /** The look of their link page (spec 0054); the default until they pick one, and absent with no handle. */
  theme: PageTheme.optional(),
  /** Whether search engines may show their link page (spec 0055, AC-5506); absent with no handle. */
  indexable: z.boolean().optional(),
  /**
   * Whether their link page is public yet (27 Oct 2026); absent with no handle. A page made with a membership is
   * private, seen only by its owner, until they first edit it or share its link.
   */
  isPublic: z.boolean().optional(),
  /**
   * The picture a pasted link to their page shows instead of the card we draw (spec 0055, AC-5511): the path our
   * own origin serves it from, absent when they have set none (and with no handle, since there is no page).
   */
  shareImage: z.string().optional(),
});
/** The caller's profile in this workspace. */
export type MyProfile = z.infer<typeof MyProfile>;

/** The picture types a share image may be: the two every social platform draws, and the two satori can embed. */
export const SHARE_IMAGE_TYPES = ['image/png', 'image/jpeg'] as const;

/**
 * The largest share image taken, in bytes (spec 0055, AC-5511). It is also what keeps one upload inside the API's
 * 1 MB body limit once it is base64: 500 kB becomes about 667 kB, and the database refuses anything larger.
 */
export const SHARE_IMAGE_MAX_BYTES = 500_000;

/** How many base64 characters `SHARE_IMAGE_MAX_BYTES` can become, so a huge one is refused before it is decoded. */
const SHARE_IMAGE_MAX_BASE64 = Math.ceil(SHARE_IMAGE_MAX_BYTES / 3) * 4;

/**
 * Setting or clearing the caller's own share image (spec 0055, AC-5511). The picture comes as base64, since this is
 * the one JSON procedure that carries bytes; `image` absent clears it. The length is checked here and the bytes are
 * checked again on the server, which is what decides: a client can claim any type it likes.
 */
export const SetShareImageInput = WorkspaceScoped.extend({
  image: z
    .object({
      type: z.enum(SHARE_IMAGE_TYPES, { error: 'A share image has to be a PNG or a JPEG.' }),
      base64: z
        .string()
        .min(1, { error: 'Add a picture.' })
        .max(SHARE_IMAGE_MAX_BASE64, { error: 'That picture is over 500 kB. Use a smaller one.' }),
    })
    .optional(),
  mutationId: Uuid,
});
export type SetShareImageInput = z.infer<typeof SetShareImageInput>;

/**
 * A change to the caller's own profile: a new name, a time zone (null follows the workspace's), a handle and bio,
 * whether their picture stays off their public pages, or their social links; any of them at once.
 */
export const UpdateMyProfileInput = WorkspaceScoped.extend({
  name: MemberName.optional(),
  timeZone: TimeZoneName.nullable().optional(),
  /** Their job title; empty clears it (spec 0037, AC-1441). */
  jobTitle: JobTitle.optional(),
  /** A new handle: the old one keeps working, moving to this one. */
  handle: PublicHandle.optional(),
  bio: PublicBio.optional(),
  /** True keeps their account picture off their booking pages and profile; false shows it again. */
  pictureHidden: z.boolean().optional(),
  /** Their whole set of social links, in order, replacing the one held: an empty list removes them all. */
  socials: SocialLinks.optional(),
  mutationId: Uuid,
});
/** A change to the caller's own profile. */
export type UpdateMyProfileInput = z.infer<typeof UpdateMyProfileInput>;

/**
 * Adds or edits one block of the caller's link page (spec 0051, AC-5107): idempotent on the id the browser minted,
 * so a retry of the same add answers the block already made and adds nothing.
 */
export const SaveProfileItemInput = WorkspaceScoped.extend({
  id: Uuid,
  block: ProfileBlock,
  /** An edit of a block the editor showed: refused as gone when another tab deleted it, never made again. */
  isEdit: z.boolean().optional(),
  mutationId: Uuid,
});
/** Adds or edits one block of the caller's link page. */
export type SaveProfileItemInput = z.infer<typeof SaveProfileItemInput>;

/** The caller's live blocks in their new order: exactly the live blocks, each once (AC-5116). */
export const OrderProfileItemsInput = WorkspaceScoped.extend({
  ids: z.array(Uuid).min(1).max(60),
  mutationId: Uuid,
});
/** The caller's live blocks in their new order. */
export type OrderProfileItemsInput = z.infer<typeof OrderProfileItemsInput>;

/** Archives one block of the caller's link page, or restores it to the end (AC-5106). */
export const ArchiveProfileItemInput = WorkspaceScoped.extend({
  id: Uuid,
  archived: z.boolean(),
  mutationId: Uuid,
});
/** Archives or restores one block. */
export type ArchiveProfileItemInput = z.infer<typeof ArchiveProfileItemInput>;

/** Deletes one block of the caller's link page for good (AC-5106: the editor asks first). */
export const DeleteProfileItemInput = WorkspaceScoped.extend({
  id: Uuid,
  mutationId: Uuid,
});
/** Deletes one block. */
export type DeleteProfileItemInput = z.infer<typeof DeleteProfileItemInput>;

/**
 * Brings one link in bio page across (spec 0055, AC-5524 to AC-5528). `id` is the import's own id, so a retry of
 * the same import adds nothing twice, and `url` is the page to read, which must be one of the services on the
 * allow list. Every row it makes lands hidden; nothing it brings is on the public page until a person turns it on.
 */
export const ImportProfileLinksInput = WorkspaceScoped.extend({
  id: Uuid,
  url: z.string().max(400),
  mutationId: Uuid,
});
/** Brings one link in bio page across. */
export type ImportProfileLinksInput = z.infer<typeof ImportProfileLinksInput>;

/**
 * The profile procedures: any active member, for themself only. The link page's (spec 0051) act on the caller's own
 * account in every workspace: the owner is the session's, never an input, and no role reaches another person's.
 */
export const profileContract = {
  get: oc.input(WorkspaceScoped).output(MyProfile),
  update: oc.input(UpdateMyProfileInput).output(MyProfile),
  items: oc.input(WorkspaceScoped).output(ProfileItems),
  pageChoices: oc.input(WorkspaceScoped).output(z.array(ProfilePageChoice)),
  /** The forms the caller may place on their link page (spec 0052, AC-5213), their own and not placed yet. */
  formChoices: oc.input(WorkspaceScoped).output(z.array(ProfileFormChoice)),
  /** The look of the caller's own link page (spec 0054): read with the profile, saved whole. */
  saveTheme: oc.input(WorkspaceScoped.extend({ theme: PageTheme, mutationId: Uuid })).output(PageTheme),
  /** Whether search engines may show the caller's own link page (spec 0055, AC-5506): read with the profile. */
  setIndexable: oc
    .input(WorkspaceScoped.extend({ indexable: z.boolean(), mutationId: Uuid }))
    .output(z.object({ indexable: z.boolean() })),
  /**
   * The picture a pasted link shows instead of the drawn card (spec 0055, AC-5511). `image` absent clears it back
   * to the drawn one. The answer is the path our origin serves it from, or absent once cleared.
   */
  setShareImage: oc.input(SetShareImageInput).output(z.object({ shareImage: z.string().optional() })),
  /** Brings one link in bio page across (spec 0055, AC-5524): the rows land hidden, and a person turns them on. */
  importLinks: oc.input(ImportProfileLinksInput).output(ProfileLinkImportResult),
  saveItem: oc.input(SaveProfileItemInput).output(ProfileItem),
  orderItems: oc.input(OrderProfileItemsInput).output(ProfileItems),
  archiveItem: oc.input(ArchiveProfileItemInput).output(ProfileItems),
  deleteItem: oc.input(DeleteProfileItemInput).output(z.object({ id: Uuid })),
  /**
   * A link to save the caller's own page to a wallet (26 October 2026): the owner carries their page and shows
   * its code at an event. `url` is Google's save link, signed for the press that follows it, so it is asked for
   * when the button is pressed and never held. `off` when the feature has no credentials in this environment,
   * which is what the editor reads to decide whether to offer the button at all.
   */
  walletLink: oc
    .input(WorkspaceScoped.extend({ wallet: z.enum(WALLET_KINDS) }))
    .output(z.object({ url: z.string() }).or(z.object({ off: z.literal(true) }))),
  /** The link page's figures (spec 0051, AC-5127): views, visitors and each block's presses over 30 days. */
  counts: oc.input(WorkspaceScoped).output(ProfileCounts),
  /**
   * Makes the caller's own link page public (27 Oct 2026), asked as they share its link (copy it, show its code,
   * save it to a wallet). Editing the page shows it too, with no call of its own. Never makes it private again.
   */
  show: oc.input(WorkspaceScoped.extend({ mutationId: Uuid })).output(z.object({ isPublic: z.boolean() })),
};
