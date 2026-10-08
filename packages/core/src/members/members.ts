// A workspace's members (spec 0005; spec 0009): the list its screens show, and
// the owner rules for changing a member's role or removing them (#23 adds the
// procedures and screens on these services). Everything goes through the
// scope the access door made.
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import {
  LAST_OWNER_MESSAGE,
  OWNER_RULES_MESSAGE,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type MemberSummary,
  type MyAccess,
  type Role,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { checkScope } from '../access/mint.ts';
import { can, isRole } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';

const { members } = schema;

/** The workspace's active members (id, name, email), by name. Removed members are left out. */
export async function listMembers(scope: EngineScope): Promise<MemberSummary[]> {
  return inWorkspace(scope, (tx) =>
    tx
      .select({ id: members.id, name: members.name, email: members.email })
      .from(members)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.status, 'active')))
      .orderBy(asc(sql`lower(${members.name})`), asc(members.id)),
  );
}

/**
 * The caller's own access (`access.mine`, spec 0009, AC-136): their role, its
 * label and their permissions, from the scope the door sealed, with no read.
 * Only a member has a role.
 */
export function getMyAccess(scope: EngineScope): MyAccess {
  checkScope(scope);
  const { principal, permissions } = scope.access;
  if (principal.kind !== 'member') throw new Error('Only a member has a role to show.');
  return {
    memberId: principal.memberId,
    role: principal.role,
    roleLabel: ROLE_LABELS[principal.role],
    permissions: [...permissions],
  };
}

/** A member as the owner rules return it: who, and their role now. */
export interface MemberWithRole extends MemberSummary {
  readonly role: Role;
}

const MEMBER_NOT_FOUND = "That member doesn't exist.";
/** What the door answers a person who is no longer an active member. */
const NOT_A_MEMBER = "That workspace doesn't exist, or you're not a member of it.";

/** The role the actor acts with for the owner rules: a member's own, the system as an owner, anyone else none. */
function actingRole(scope: EngineScope): Role | undefined {
  const { principal } = scope.access;
  if (principal.kind === 'system') return 'owner';
  return principal.kind === 'member' ? principal.role : undefined;
}

function isSelf(scope: EngineScope, memberId: string): boolean {
  const { principal } = scope.access;
  return principal.kind === 'member' && principal.memberId === memberId;
}

/** A stored role the code doesn't know counts as an owner's, so only an owner may touch that member (fail closed). */
const storedRole = (role: string): Role => (isRole(role) ? role : 'owner');

/** Whether an actor acting with `role` (now, as locked) holds `members.manage`: the system and keys by their access. */
function manages(scope: EngineScope, role: Role | undefined): boolean {
  if (scope.access.principal.kind !== 'member') return can(scope.access, 'members.manage');
  return role !== undefined && (ROLE_PERMISSIONS[role] as readonly string[]).includes('members.manage');
}

/** The actor, as the owner rules judge them: their role now, read under lock, not as the door saw it. */
interface Acting {
  readonly role: Role | undefined;
}

/**
 * Locks the workspace's active owners, the acting member's own row and the
 * target, so two owners changing each other at once take turns, and an
 * actor demoted or removed since the request came in acts with their role
 * now. Refuses NOT_FOUND unless the target is an active member, and as the
 * door does when the actor no longer is one, or holds a role the code
 * doesn't know.
 */
async function lockTarget(tx: WorkspaceTx, scope: EngineScope, memberId: string) {
  await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.role, 'owner'), eq(members.status, 'active')))
    .orderBy(asc(members.id))
    .for('update');
  const { principal } = scope.access;
  let acting: Acting = { role: actingRole(scope) };
  if (principal.kind === 'member') {
    const [self] = await tx
      .select({ role: members.role })
      .from(members)
      .where(
        and(
          eq(members.workspaceId, scope.workspaceId),
          eq(members.id, principal.memberId),
          eq(members.status, 'active'),
        ),
      )
      .for('update');
    if (self === undefined || !isRole(self.role)) throw refuse('NOT_FOUND', NOT_A_MEMBER);
    acting = { role: self.role };
  }
  const [target] = await tx
    .select({ id: members.id, name: members.name, email: members.email, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')))
    .for('update');
  if (target === undefined) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
  return { target: { ...target, role: storedRole(target.role) }, acting };
}

/** Refuses LAST_OWNER when `memberId` is the live workspace's only active owner (the database checks it too). */
async function keepAnOwner(tx: WorkspaceTx, scope: EngineScope, memberId: string): Promise<void> {
  const [other] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, scope.workspaceId),
        eq(members.role, 'owner'),
        eq(members.status, 'active'),
        ne(members.id, memberId),
      ),
    )
    .limit(1);
  if (other === undefined) throw refuse('LAST_OWNER', LAST_OWNER_MESSAGE);
}

/** Refuses FORBIDDEN unless an actor with `role` holds `members.manage` or is acting on themself. */
function checkManages(scope: EngineScope, role: Role | undefined, memberId: string): void {
  if (!isSelf(scope, memberId) && !manages(scope, role)) {
    throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
  }
}

/**
 * The owner rules (spec 0009, AC-137) for acting on `target`: anyone but the
 * person themself needs `members.manage`, and only an owner may touch the
 * owner role, whether giving it (`toRole`) or changing or removing an owner.
 */
function checkOwnerRules(
  scope: EngineScope,
  acting: Acting,
  target: { readonly id: string; readonly role: Role },
  toRole?: Role,
): void {
  checkManages(scope, acting.role, target.id);
  const touchesOwner = target.role === 'owner' || toRole === 'owner';
  if (touchesOwner && acting.role !== 'owner') throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
}

/** A member changes no roles, not even their own. */
function checkChangesRoles(role: Role | undefined): void {
  if (role === 'member') throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
}

/**
 * Changes a member's role (spec 0009, AC-137): only an owner gives or takes
 * away the owner role; an admin moves members and admins between `member` and
 * `admin`; a member changes no roles, their own included. A person may change
 * their own role within these rules. Demoting the only active owner of a live
 * workspace is refused 409 `LAST_OWNER`. Answers the member with their role.
 * The actor's role is checked as the door saw it before any read, then again
 * as it is now, under lock.
 */
export async function setMemberRole(
  scope: EngineScope,
  input: { readonly memberId: string; readonly role: Role },
  hooks: readonly AfterWrite[] = [],
): Promise<MemberWithRole> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  if (!isRole(input.role)) throw refuse('CONFIG_INVALID', 'Pick owner, admin or member.');
  const role = input.role;
  checkChangesRoles(actingRole(scope));
  checkManages(scope, actingRole(scope), memberId);
  const { result } = await runWrite(
    scope,
    async ({ tx }) => {
      const { target, acting } = await lockTarget(tx, scope, memberId);
      checkChangesRoles(acting.role);
      checkOwnerRules(scope, acting, target, role);
      if (target.role === role) return { id: target.id, name: target.name, email: target.email, role };
      if (target.role === 'owner') await keepAnOwner(tx, scope, target.id);
      await tx
        .update(members)
        .set({ role, ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, target.id)));
      return { id: target.id, name: target.name, email: target.email, role };
    },
    hooks,
  );
  return result;
}

/**
 * Removes a member (spec 0009, AC-137): their row stays, marked `removed`, so
 * everything they made still names them, and the door refuses them from the
 * next request. Needs `members.manage`, except to remove yourself; only an
 * owner removes an owner, and the only active owner of a live workspace is
 * never removed (409 `LAST_OWNER`).
 */
export async function removeMember(
  scope: EngineScope,
  input: { readonly memberId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<void> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  checkManages(scope, actingRole(scope), memberId);
  await runWrite(
    scope,
    async ({ tx }) => {
      const { target, acting } = await lockTarget(tx, scope, memberId);
      // Leaving is always yours to do; the last owner guard still holds.
      if (!isSelf(scope, target.id)) checkOwnerRules(scope, acting, target);
      if (target.role === 'owner') await keepAnOwner(tx, scope, target.id);
      await tx
        .update(members)
        .set({ status: 'removed', ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, target.id)));
    },
    hooks,
  );
}
