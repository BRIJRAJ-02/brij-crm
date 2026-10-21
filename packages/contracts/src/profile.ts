// Settings › Account › Profile (spec 0031, slice 7, AC-821): the caller's own
// member profile in one workspace, their name there and their time zone.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { TimeZoneName } from './booking/settings.ts';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** A member's name in a workspace: 1 to 80 characters, trimmed (AC-821). */
export const MemberName = z.string().trim().min(1, 'Enter your name.').max(80, 'Use at most 80 characters.');
/** A member's name in a workspace. */
export type MemberName = z.infer<typeof MemberName>;

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
  image: z.url().optional(),
});
/** The caller's profile in this workspace. */
export type MyProfile = z.infer<typeof MyProfile>;

/** A change to the caller's own profile: a new name, a time zone (null follows the workspace's), or both. */
export const UpdateMyProfileInput = WorkspaceScoped.extend({
  name: MemberName.optional(),
  timeZone: TimeZoneName.nullable().optional(),
  mutationId: Uuid,
});
/** A change to the caller's own profile. */
export type UpdateMyProfileInput = z.infer<typeof UpdateMyProfileInput>;

/** The profile procedures: any active member, for themself only. */
export const profileContract = {
  get: oc.input(WorkspaceScoped).output(MyProfile),
  update: oc.input(UpdateMyProfileInput).output(MyProfile),
};
