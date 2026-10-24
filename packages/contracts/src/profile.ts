// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { BIO_MAX, handleProblem } from './booking/handles.ts';
import { ProfileBlock, ProfileItem, ProfileItems, ProfilePageChoice } from './booking/link-page.ts';
import { TimeZoneName } from './booking/settings.ts';
import { Uuid } from './values/ids.ts';
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
});
/** The caller's profile in this workspace. */
export type MyProfile = z.infer<typeof MyProfile>;

/**
 * A change to the caller's own profile: a new name, a time zone (null follows the workspace's), a handle and bio, or
 * whether their picture stays off their public pages; any of them at once.
 */
export const UpdateMyProfileInput = WorkspaceScoped.extend({
  name: MemberName.optional(),
  timeZone: TimeZoneName.nullable().optional(),
  /** A new handle: the old one keeps working, moving to this one. */
  handle: PublicHandle.optional(),
  bio: PublicBio.optional(),
  /** True keeps their account picture off their booking pages and profile; false shows it again. */
  pictureHidden: z.boolean().optional(),
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
 * The profile procedures: any active member, for themself only. The link page's (spec 0051) act on the caller's own
 * account in every workspace: the owner is the session's, never an input, and no role reaches another person's.
 */
export const profileContract = {
  get: oc.input(WorkspaceScoped).output(MyProfile),
  update: oc.input(UpdateMyProfileInput).output(MyProfile),
  items: oc.input(WorkspaceScoped).output(ProfileItems),
  pageChoices: oc.input(WorkspaceScoped).output(z.array(ProfilePageChoice)),
  saveItem: oc.input(SaveProfileItemInput).output(ProfileItem),
  orderItems: oc.input(OrderProfileItemsInput).output(ProfileItems),
  archiveItem: oc.input(ArchiveProfileItemInput).output(ProfileItems),
  deleteItem: oc.input(DeleteProfileItemInput).output(z.object({ id: Uuid })),
};
