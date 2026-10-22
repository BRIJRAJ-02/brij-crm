// A workspace's members as its screens show them (spec 0005): the Owner
// column and the member picker resolve a member id to a name here; the
// Members page (spec 0031) reads their roles, pictures and time zones, a page
// at a time, and changes their roles and who is in.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { MEMBER_SEARCH_MAX, MEMBERS_PAGE_MAX } from './team-limits.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** One active member: the id actor values carry, their name in this workspace, and their email. */
export const MemberSummary = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string(),
});
/** One active member. */
export type MemberSummary = z.infer<typeof MemberSummary>;

/**
 * One active member as the Members page lists them (spec 0031, AC-810):
 * their role, when they joined, their picture and time zone when they have
 * one.
 */
export const MemberView = MemberSummary.extend({
  role: Role,
  joinedAt: z.iso.datetime({ offset: true }),
  /** A picture on our own origin (a path, never another site's address); absent until #32, so screens show initials. */
  avatarUrl: z
    .string()
    .regex(/^\/(?![/\\])[^\s\\]*$/)
    .optional(),
  /** Their time zone in this workspace (an IANA name); absent means the browser's. */
  timeZone: z.string().optional(),
  /**
   * Whether they have a second factor, an authenticator app
   * (spec 0033, AC-895). Only owners and admins are told; absent for others.
   */
  twoFactor: z.boolean().optional(),
});
/** One active member as the Members page lists them. */
export type MemberView = z.infer<typeof MemberView>;

export { MEMBER_SEARCH_MAX, MEMBERS_PAGE, MEMBERS_PAGE_MAX } from './team-limits.ts';

/**
 * A page of the workspace's active members (AC-810), by name: after
 * `cursor` (the last page's `nextCursor`), at most `limit`, and only those
 * whose name or email holds `search` (any case).
 */
export const MembersInput = WorkspaceScoped.extend({
  search: z.string().trim().max(MEMBER_SEARCH_MAX).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(MEMBERS_PAGE_MAX).optional(),
});
/** A page of the workspace's active members. */
export type MembersInput = z.infer<typeof MembersInput>;

/** One page of members, how many match in all, and where the next page starts when there is one. */
export const MembersPage = z.object({
  members: z.array(MemberView),
  /** Every active member the search matches (all of them without one), for the Members tab's count. */
  total: z.number().int().min(0),
  nextCursor: z.string().optional(),
});
/** One page of members. */
export type MembersPage = z.infer<typeof MembersPage>;

/** One member of the workspace, by id, for a change; its write's uuid too. */
export const MemberInput = WorkspaceScoped.extend({ memberId: Uuid, mutationId: Uuid });
/** One member of the workspace, by id. */
export type MemberInput = z.infer<typeof MemberInput>;

/** One member of the workspace, by id, to read something about them. */
export const MemberRead = WorkspaceScoped.extend({ memberId: Uuid });
/** One member of the workspace, by id, to read something about them. */
export type MemberRead = z.infer<typeof MemberRead>;

/** What removing a member will do, as the remove dialog lists it (spec 0031, AC-816). */
export const RemovalPreview = z.object({
  /** Booking pages that will pause, nobody being left to host them. */
  pausedPages: z.number().int().min(0),
  /** Calendar connections that will be disconnected. */
  calendars: z.number().int().min(0),
  /** Open tasks assigned to them. */
  openTasks: z.number().int().min(0),
  /** Live records whose member values (an Owner) name them. */
  records: z.number().int().min(0),
});
/** What removing a member will do. */
export type RemovalPreview = z.infer<typeof RemovalPreview>;

/** A removal (AC-814, AC-816): optionally who their open tasks and records go to. */
export const RemoveMemberInput = MemberInput.extend({ reassignTo: Uuid.optional() });
/** A removal. */
export type RemoveMemberInput = z.infer<typeof RemoveMemberInput>;

/** A removal's answer: the job handing their work on, when someone was chosen. */
export const RemovedMemberResult = z.object({ jobId: Uuid.optional() });
/** A removal's answer. */
export type RemovedMemberResult = z.infer<typeof RemovedMemberResult>;

/** A role change (spec 0009, AC-137; spec 0031, AC-811). */
export const SetRoleInput = MemberInput.extend({ role: Role });
/** A role change. */
export type SetRoleInput = z.infer<typeof SetRoleInput>;

/**
 * A workspace's members. `list` answers the active ones a page at a time to
 * every member. `setRole` and `remove` follow spec 0009's owner rules (403
 * `FORBIDDEN`, 409 `LAST_OWNER`); `leave` removes the caller, refused 409
 * `LAST_OWNER` for a workspace's only owner.
 */
export const membersContract = {
  list: oc.input(MembersInput).output(MembersPage),
  setRole: oc.input(SetRoleInput).output(MemberView),
  /** What removing a member will do (AC-816): `members.manage`, or about oneself. */
  removalPreview: oc.input(MemberRead).output(RemovalPreview),
  remove: oc.input(RemoveMemberInput).output(RemovedMemberResult),
  leave: oc.input(WorkspaceScoped.extend({ mutationId: Uuid })).output(z.void()),
  /**
   * Hands the workspace to another member (spec 0031, AC-813): an owner
   * only; in one transaction they become an owner and the caller an admin.
   */
  transferOwnership: oc.input(MemberInput).output(z.void()),
};
