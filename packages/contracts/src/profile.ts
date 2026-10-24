// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BIO_MAX, handleProblem } from './booking/handles.ts';
import { TimeZoneName } from './booking/settings.ts';
import { Uuid } from './values/ids.ts';
import { checkSocialLink, socialLinkProblem } from './values/social.ts';
import { SOCIAL_LINK_NAMES, SOCIAL_LINK_NETWORKS, SOCIAL_LINKS_MAX } from './values/social-networks.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** A member's name in a workspace: 1 to 80 characters, trimmed (AC-821). */
export const MemberName = z.string().trim().min(1, 'Enter your name.').max(80, 'Use at most 80 characters.');
/** A member's name in a workspace. */
export type MemberName = z.infer<typeof MemberName>;

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
  .object({ network: SocialLinkNetwork, href: z.string().max(2_048, { error: 'Keep the link to 2,000 characters.' }) })
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
  workspaceTimeZone: z.string(),
  /** Their account's Google picture as our own origin serves it (`/api/me/picture?v=`, 23 Oct 2026), never Google's URL. */
  image: z.string().optional(),
  /**
   * Whether their account has Google linked (23 Oct 2026): Sync Google photo refreshes it when linked, and links it
   * first when not. Absent where Google sign in is off.
   */
  google: z.enum(['linked', 'unlinked']).optional(),
  /** Their handle, the same in every workspace; absent until they pick one. */
  handle: z.string().optional(),
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
});
/** The caller's profile in this workspace. */
export type MyProfile = z.infer<typeof MyProfile>;

/**
 * A change to the caller's own profile: a new name, a time zone (null follows the workspace's), a handle and bio,
 * whether their picture stays off their public pages, or their social links; any of them at once.
 */
export const UpdateMyProfileInput = WorkspaceScoped.extend({
  name: MemberName.optional(),
  timeZone: TimeZoneName.nullable().optional(),
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

/** The profile procedures: any active member, for themself only. */
export const profileContract = {
  get: oc.input(WorkspaceScoped).output(MyProfile),
  update: oc.input(UpdateMyProfileInput).output(MyProfile),
};
