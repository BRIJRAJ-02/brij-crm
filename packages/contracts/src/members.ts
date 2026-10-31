// A workspace's members as its screens show them (spec 0005): the Owner
// column and the member picker resolve a member id to a name here; the
// Members page (spec 0031) reads their roles, pictures and time zones, a page
// at a time, and changes their roles and who is in.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Role } from './access.ts';
import { MEMBER_SEARCH_MAX, MEMBERS_PAGE_MAX } from './team-limits.ts';
import { VisibleMembers } from './scheduling.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/**
 * One active member: the id actor values carry, their name in this workspace, and their email, absent when the
 * reader is a guest (spec 0031, AC-829: a guest never learns another member's address).
 */
export const MemberSummary = z.object({
  id: Uuid,
  name: z.string(),
  email: z.string().optional(),
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
  /** Their custom role (spec 0037, AC-1233), when they hold one: `role` is then `member`. */
  customRoleId: Uuid.optional(),
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
  search: z
    .string()
    .trim()
    .max(MEMBER_SEARCH_MAX, { error: `Keep the search to ${String(MEMBER_SEARCH_MAX)} characters.` })
    .optional(),
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
  /** Fields whose default names them: the removal takes them out of it. */
  defaults: z.number().int().min(0),
  /** Of those, required ones left with no default, so every new record needs a value for them. */
  requiredDefaults: z.number().int().min(0),
  /** Open invitations they sent (the invite link among them), revoked with them: nobody vouches for them any more. */
  invitations: z.number().int().min(0),
  /** Live forms that make them the owner of each new record: their leads arrive with no owner from now. */
  ownedForms: z.number().int().min(0),
});
/** What removing a member will do. */
export type RemovalPreview = z.infer<typeof RemovalPreview>;

/**
 * What making a member a guest will do (spec 0031, slice 9; spec 0037, AC-1432), as the confirm dialog lists it: a
 * guest can't host, so they leave scheduling.
 */
export const GuestPreview = z.object({
  /** Booking pages they alone host, which pause. */
  pausedPages: z.number().int().min(0),
  /** Rotations they leave. */
  rotations: z.number().int().min(0),
  /** Their upcoming bookings, each flagged "Needs a host" (a round robin one is handed on). */
  upcomingBookings: z.number().int().min(0),
  /** Scheduling delegations over them or held by them, which go. */
  delegations: z.number().int().min(0),
  /** Their link page is live and hides (kept, back as it was if they are a member again). */
  hidesLinkPage: z.boolean(),
});
/** What making a member a guest will do. */
export type GuestPreview = z.infer<typeof GuestPreview>;

/** A removal (AC-814, AC-816): optionally who their open tasks and records go to. */
export const RemoveMemberInput = MemberInput.extend({ reassignTo: Uuid.optional() });
/** A removal. */
export type RemoveMemberInput = z.infer<typeof RemoveMemberInput>;

/** A removal's answer: the job handing their work on, when someone was chosen. */
export const RemovedMemberResult = z.object({ jobId: Uuid.optional() });
/** A removal's answer. */
export type RemovedMemberResult = z.infer<typeof RemovedMemberResult>;

/** Exactly one of a built in role and a custom role, as a role change names it (spec 0037, AC-1233). */
const oneRole = (value: { readonly role?: unknown; readonly customRoleId?: unknown }) =>
  (value.role === undefined) !== (value.customRoleId === undefined);

/**
 * A role change (spec 0009, AC-137; spec 0031, AC-811): a built in `role`, or a `customRoleId` (spec 0037, AC-1233),
 * never both.
 */
export const SetRoleInput = MemberInput.extend({ role: Role.optional(), customRoleId: Uuid.optional() }).refine(
  oneRole,
  { error: 'Pick a role.', path: ['role'] },
);
/** A role change. */
export type SetRoleInput = z.infer<typeof SetRoleInput>;

/**
 * A member with their new role, and how many open invitations they sent were cancelled with the change, when any:
 * a role that can't send them any more leaves them opening nothing, so they are revoked and the change says so.
 */
export const SetRoleResult = MemberView.extend({ cancelledInvitations: z.number().int().min(1).optional() });
/** A member with their new role, and the invitations the change cancelled. */
export type SetRoleResult = z.infer<typeof SetRoleResult>;

/** The most people one Change role changes at once (spec 0037, AC-1242). */
export const SET_ROLES_MAX = 100;

/** Change role for several people at once (spec 0037, AC-1242): one role for all, in one transaction. */
export const SetRolesInput = WorkspaceScoped.extend({
  memberIds: z
    .array(Uuid)
    .min(1, { error: 'Pick at least one person.' })
    .max(SET_ROLES_MAX, { error: `Change at most ${String(SET_ROLES_MAX)} people at once.` }),
  role: Role.optional(),
  customRoleId: Uuid.optional(),
  mutationId: Uuid,
}).refine(oneRole, { error: 'Pick a role.', path: ['role'] });
/** Change role for several people at once. */
export type SetRolesInput = z.infer<typeof SetRolesInput>;

/** What a Change role for several did: how many changed, and the open invitations cancelled with them. */
export const SetRolesResult = z.object({
  changed: z.number().int().min(0),
  cancelledInvitations: z.number().int().min(1).optional(),
});
/** What a Change role for several did. */
export type SetRolesResult = z.infer<typeof SetRolesResult>;

/**
 * A workspace's members. `list` answers the active ones a page at a time to
 * every member. `setRole` and `remove` follow spec 0009's owner rules (403
 * `FORBIDDEN`, 409 `LAST_OWNER`); `leave` removes the caller, refused 409
 * `LAST_OWNER` for a workspace's only owner.
 */
export const membersContract = {
  list: oc.input(MembersInput).output(MembersPage),
  setRole: oc.input(SetRoleInput).output(SetRoleResult),
  /** One role for several people (spec 0037, AC-1242): the same rules as `setRole`, all or nothing. */
  setRoles: oc.input(SetRolesInput).output(SetRolesResult),
  /** What removing a member will do (AC-816): `members.manage`, or about oneself. */
  removalPreview: oc.input(MemberRead).output(RemovalPreview),
  /** What making a member a guest will do (spec 0031, slice 9): `members.manage` only. */
  guestPreview: oc.input(MemberRead).output(GuestPreview),
  remove: oc.input(RemoveMemberInput).output(RemovedMemberResult),
  leave: oc.input(WorkspaceScoped.extend({ mutationId: Uuid })).output(z.void()),
  /**
   * Hands the workspace to another member (spec 0031, AC-813): an owner
   * only; in one transaction they become an owner and the caller an admin.
   */
  transferOwnership: oc.input(MemberInput).output(z.void()),
  /**
   * The members in the caller's See reach (spec 0037, AC-1261): the caller first, then by name, each with whether
   * the caller may Manage them. Any member may call it; someone with no reach gets themself alone.
   */
  visible: oc.input(WorkspaceScoped).output(VisibleMembers),
};
