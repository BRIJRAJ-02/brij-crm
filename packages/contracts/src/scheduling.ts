// Scheduling access (spec 0037, the scheduling access child): See or Manage
// over another member's scheduling, from the role and from per person
// delegations (timefix's "Sees all calendars", widened). The shapes here are
// what `scheduling.delegations.*` and `members.visible` answer; who may do what
// is the server's (`packages/core/src/access/scheduling.ts`).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** How far a reach goes into someone's scheduling: See shows it, Manage changes it (AC-1251). */
export const SchedulingLevel = z.enum(['view', 'manage']);
/** How far a reach goes into someone's scheduling. */
export type SchedulingLevel = z.infer<typeof SchedulingLevel>;

/** Whom a delegation is over: one member, one team (its active members at each check), or everyone (AC-1254). */
export const DelegationTarget = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('member'), memberId: Uuid }),
  z.strictObject({ type: z.literal('team'), teamId: Uuid }),
  z.strictObject({ type: z.literal('everyone') }),
]);
/** Whom a delegation is over. */
export type DelegationTarget = z.infer<typeof DelegationTarget>;

/** One delegation as the screens list it (AC-1254, AC-1266). */
export const DelegationView = z.object({
  id: Uuid,
  /** Who gains the reach. */
  delegateMemberId: Uuid,
  target: DelegationTarget,
  level: SchedulingLevel,
  /** True when the member it is over granted it themself (AC-1255): it never changes hours set by others. */
  grantedBySelf: z.boolean(),
  /** Who last granted it, when a member did. */
  grantedBy: Uuid.optional(),
  createdAt: z.iso.datetime({ offset: true }),
});
/** One delegation. */
export type DelegationView = z.infer<typeof DelegationView>;

/** The most delegations one delegate may hold (team and everyone delegations count once each, AC-1256). */
export const DELEGATIONS_PER_DELEGATE = 50;
/** The most delegates naming one member as their target (AC-1256). */
export const DELEGATES_PER_MEMBER = 20;

/** The most delegations one workspace wide read answers (Settings › Members' Scheduling column, AC-1267). */
export const DELEGATIONS_WORKSPACE_MAX = 2000;

/**
 * `scheduling.delegations.list`: where `memberId` (the caller when absent) is the delegate or the target; or, with
 * `everyone: true`, every delegation in the workspace (holders of `members.manage` only, for the Members page's
 * Scheduling column, AC-1267), oldest first, up to `DELEGATIONS_WORKSPACE_MAX`.
 */
export const DelegationsListInput = WorkspaceScoped.extend({
  memberId: Uuid.optional(),
  everyone: z.literal(true).optional(),
});
/** `scheduling.delegations.list`'s input. */
export type DelegationsListInput = z.infer<typeof DelegationsListInput>;

/** A member's delegations both ways. */
export const DelegationsList = z.object({ delegations: z.array(DelegationView) });
/** A member's delegations both ways. */
export type DelegationsList = z.infer<typeof DelegationsList>;

/** `scheduling.delegations.grant`: a grant over the same delegate and target changes its level. */
export const GrantDelegationInput = WorkspaceScoped.extend({
  delegateMemberId: Uuid,
  target: DelegationTarget,
  level: SchedulingLevel,
  mutationId: Uuid,
});
/** `scheduling.delegations.grant`'s input. */
export type GrantDelegationInput = z.infer<typeof GrantDelegationInput>;

/** `scheduling.delegations.revoke`. */
export const RevokeDelegationInput = WorkspaceScoped.extend({ id: Uuid, mutationId: Uuid });
/** `scheduling.delegations.revoke`'s input. */
export type RevokeDelegationInput = z.infer<typeof RevokeDelegationInput>;

/** One member in the caller's See reach (AC-1261), and whether they may Manage them. */
export const VisibleMember = z.object({ id: Uuid, name: z.string(), canManage: z.boolean() });
/** One member in the caller's See reach. */
export type VisibleMember = z.infer<typeof VisibleMember>;

/** The members in the caller's See reach: the caller first, then by name (AC-1261, AC-1268). */
export const VisibleMembers = z.object({ members: z.array(VisibleMember) });
/** The members in the caller's See reach. */
export type VisibleMembers = z.infer<typeof VisibleMembers>;

/**
 * The scheduling access namespace (spec 0037, the Procedures table). `delegations.list`: yourself, or anyone with
 * `members.manage` (anyone else is 404). `delegations.grant`: over yourself with `booking.manage`, otherwise
 * `members.manage` (never over an owner; over an admin only by an owner): 403 `FORBIDDEN`, 404 `NOT_FOUND`, 409
 * `DELEGATION_LIMIT`, 422 `DELEGATE_INVALID`. `delegations.revoke`: the member it is over, the delegate, or
 * `members.manage` (404 otherwise).
 */
export const schedulingContract = {
  delegations: {
    list: oc.input(DelegationsListInput).output(DelegationsList),
    grant: oc.input(GrantDelegationInput).output(DelegationView),
    revoke: oc.input(RevokeDelegationInput).output(z.void()),
  },
};
