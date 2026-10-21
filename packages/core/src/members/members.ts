// A workspace's members (spec 0005; spec 0009; spec 0031): the list its
// screens show, a page at a time, and the owner rules for changing a member's
// role, removing them or leaving. Every change writes its audit row in its own
// transaction. Everything goes through the scope the access door made.
import { and, asc, count, eq, gt, ilike, ne, or, sql } from 'drizzle-orm';
import * as z from 'zod';
import {
  LAST_OWNER_MESSAGE,
  MEMBERS_PAGE,
  MEMBERS_PAGE_MAX,
  OWNER_RULES_MESSAGE,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  type MembersPage,
  type MemberView,
  type MyAccess,
  type Role,
  type RolesList,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { checkScope } from '../access/mint.ts';
import { can, isRole } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { deleteMemberViews } from '../views/manage.ts';
import { deleteMemberCalendars } from '../calendar/connections.ts';
import { writeAudit, type AuditSource } from './audit.ts';

const { members } = schema;

/** The columns a member is answered with, everywhere in this file. */
const VIEW_COLUMNS = {
  id: members.id,
  name: members.name,
  email: members.email,
  role: members.role,
  joinedAt: members.createdAt,
  avatarUrl: members.avatarUrl,
  timeZone: members.timeZone,
} as const;

/** A member row as `VIEW_COLUMNS` reads it, in the contract's shape. */
function toView(row: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly joinedAt: string | Date;
  readonly avatarUrl: string | null;
  readonly timeZone: string | null;
}): MemberView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: storedRole(row.role),
    joinedAt: new Date(row.joinedAt).toISOString(),
    ...(row.avatarUrl === null ? {} : { avatarUrl: row.avatarUrl }),
    ...(row.timeZone === null ? {} : { timeZone: row.timeZone }),
  };
}

/** Where a page of members starts: after this name (as Postgres lowercases it) and id. */
const MemberCursor = z.strictObject({ n: z.string().max(400), i: z.uuid() });

/** A page's cursor as the opaque text a client holds. */
const encodeMemberCursor = (name: string, id: string): string =>
  Buffer.from(JSON.stringify({ n: name, i: id })).toString('base64url');

/** A client's cursor text back into where to start, or refuses `INPUT_INVALID` on `cursor`. */
function decodeMemberCursor(text: string): z.infer<typeof MemberCursor> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const cursor = MemberCursor.safeParse(parsed);
  if (!cursor.success) throw inputInvalid('cursor', 'That page link isn’t right. Start again from the top.');
  return cursor.data;
}

/** `text` with LIKE's wildcards and escape taken literally. */
const likeLiteral = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/**
 * A page of the workspace's active members, by name (spec 0031, AC-810):
 * each with their role, when they joined, their picture and time zone.
 * `search` keeps those whose name or email holds it, in any case; `cursor`
 * starts after the last page's end. Removed members are left out. Every
 * member may read it.
 */
export async function listMembers(
  scope: EngineScope,
  input: { readonly search?: string; readonly cursor?: string; readonly limit?: number } = {},
): Promise<MembersPage> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? MEMBERS_PAGE), 1), MEMBERS_PAGE_MAX);
  const search = input.search?.trim() ?? '';
  const after = input.cursor === undefined ? undefined : decodeMemberCursor(input.cursor);
  const sortName = sql<string>`lower(${members.name})`;
  const matching = and(
    // Row level security keeps the read to this workspace; the filter says so too (house style).
    eq(members.workspaceId, scope.workspaceId),
    eq(members.status, 'active'),
    ...(search === ''
      ? []
      : [or(ilike(members.name, `%${likeLiteral(search)}%`), ilike(members.email, `%${likeLiteral(search)}%`))]),
  );
  const { rows, total } = await inWorkspace(scope, async (tx) => {
    const read = await tx
      .select({ ...VIEW_COLUMNS, sortName })
      .from(members)
      .where(
        and(
          matching,
          ...(after === undefined
            ? []
            : [or(gt(sortName, after.n), and(eq(sortName, after.n), gt(members.id, after.i)))]),
        ),
      )
      .orderBy(asc(sortName), asc(members.id))
      .limit(limit + 1);
    const [counted] = await tx.select({ n: count() }).from(members).where(matching);
    return { rows: read, total: counted?.n ?? 0 };
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    members: page.map(toView),
    total,
    ...(rows.length > limit && last !== undefined ? { nextCursor: encodeMemberCursor(last.sortName, last.id) } : {}),
  };
}

/**
 * The roles every role picker offers (spec 0037, AC-1439): the built in
 * roles, most power first, each with its name and one line on what it can
 * do, and `member` for new people. Custom roles (spec 0037) join here. Any
 * member may read it; what a person may grant is still the owner rules'.
 */
export function listRoles(scope: EngineScope): RolesList {
  checkScope(scope);
  return {
    roles: ROLES.map((role) => ({
      id: role,
      label: ROLE_LABELS[role],
      description: ROLE_DESCRIPTIONS[role],
      builtIn: role,
    })),
    defaultRole: 'member',
  };
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

/** A member as the owner rules return it: who, their role now, and the rest the Members page shows. */
export type MemberWithRole = MemberView;

/** What every member write takes beside its input: where the request came from, for the audit row. */
export interface MemberWriteOptions {
  readonly source?: AuditSource;
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
    .select({ ...VIEW_COLUMNS, userId: members.userId })
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

/**
 * Only a holder of `members.manage` changes a role, their own included (fail
 * closed): a member, a guest or a custom role without it changes none, so no
 * role can promote itself.
 */
function checkChangesRoles(scope: EngineScope, role: Role | undefined): void {
  if (!manages(scope, role)) throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
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
  options: MemberWriteOptions = {},
): Promise<MemberWithRole> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  if (!isRole(input.role)) throw refuse('CONFIG_INVALID', 'Pick owner, admin or member.');
  const role = input.role;
  checkChangesRoles(scope, actingRole(scope));
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { target, acting } = await lockTarget(tx, scope, memberId);
      checkChangesRoles(scope, acting.role);
      checkOwnerRules(scope, acting, target, role);
      if (target.role === role) return toView({ ...target, role });
      if (target.role === 'owner') await keepAnOwner(tx, scope, target.id);
      await tx
        .update(members)
        .set({ role, ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, target.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'member.role_changed',
          targetType: 'member',
          targetId: target.id,
          before: { role: target.role },
          after: { role },
        },
        options.source,
      );
      // Everyone's member list reads them again, and the relay drops the workspace's audiences (spec 0007, AC-82).
      context.record({ members: [target.id] });
      return toView({ ...target, role });
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
  options: MemberWriteOptions = {},
): Promise<RemovedMember> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  checkManages(scope, actingRole(scope), memberId);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { target, acting } = await lockTarget(tx, scope, memberId);
      // Leaving is always yours to do; the last owner guard still holds.
      const isLeaving = isSelf(scope, target.id);
      if (!isLeaving) checkOwnerRules(scope, acting, target);
      if (target.role === 'owner') await keepAnOwner(tx, scope, target.id);
      await tx
        .update(members)
        .set({ status: 'removed', ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, target.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: isLeaving ? 'member.left' : 'member.removed',
          targetType: 'member',
          targetId: target.id,
          before: { status: 'active' },
          after: { status: 'removed' },
        },
        options.source,
      );
      // Their private views and last opened views go with them (spec 0020, AC-490); their shared views stay.
      await deleteMemberViews(context, target.id);
      // Their calendar connections and the meetings only they held go too (spec 0024, AC-614).
      await deleteMemberCalendars(context, target.id);
      // The `access` row that disconnects them comes with slice 5 of spec 0031; the member list changes now.
      context.record({ members: [target.id] });
      return target.userId === null ? {} : { userId: target.userId, memberId: target.id };
    },
    hooks,
  );
  return result;
}

/** Who a removal took out: their signed in identity, when they have one, so the directory can forget them. */
export interface RemovedMember {
  readonly userId?: string;
  /** The member row removed, so the directory drops only the row that named it. */
  readonly memberId?: string;
}

/**
 * The caller leaves the workspace (spec 0031, AC-812): the removal on
 * themself, so their views and calendars go with them, and the only active
 * owner can't leave (409 `LAST_OWNER`). Only a member can leave.
 */
export async function leaveWorkspace(
  scope: EngineScope,
  hooks: readonly AfterWrite[] = [],
  options: MemberWriteOptions = {},
): Promise<RemovedMember> {
  checkScope(scope);
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', 'Only a member can leave a workspace.');
  return removeMember(scope, { memberId: principal.memberId }, hooks, options);
}
