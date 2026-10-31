// A workspace's members (spec 0005; spec 0009; spec 0031): the list its
// screens show, a page at a time, and the owner rules for changing a member's
// role, removing them or leaving. Every change writes its audit row in its own
// transaction. Everything goes through the scope the access door made.
import { and, asc, count, eq, gt, ilike, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import * as z from 'zod';
import {
  LAST_OWNER_MESSAGE,
  MEMBERS_PAGE,
  MEMBERS_PAGE_MAX,
  OWNER_RULES_MESSAGE,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  SET_ROLES_MAX,
  type MembersPage,
  type MemberView,
  type GuestPreview,
  type MyAccess,
  type RemovalPreview,
  type Role,
  type SetRoleResult,
  type SetRolesResult,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { checkScope } from '../access/mint.ts';
import { can, isRole } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { startJob } from '../jobs/service.ts';
import { delegatesReachedBy } from '../scheduling/delegations.ts';
import { mySchedulingReach } from '../scheduling/visible.ts';
import type { JobRegistry } from '../jobs/registry.ts';
import { REASSIGN_KIND } from './reassign.ts';
import { countRemoval, runRemovalEffects } from './removal.ts';
import { writeAudit, writeAudits, type AuditSource } from './audit.ts';
import { ensureLinkPage } from '../booking/handles.ts';
import { checkSeats, revokeUnvouched } from './invitations.ts';
import { countBecomingGuest, leaveSchedulingAsGuest } from './guest.ts';
import { readCustomRole } from '../roles/roles.ts';

const { members, workspaceRoles, workspaces } = schema;

/** Whether the caller is a guest (spec 0031, slice 9): they read names, never addresses. */
const isGuest = (scope: EngineScope): boolean =>
  scope.access.principal.kind === 'member' && scope.access.principal.role === 'guest';

/** The columns a member is answered with, everywhere in this file. */
const VIEW_COLUMNS = {
  id: members.id,
  name: members.name,
  email: members.email,
  role: members.role,
  customRoleId: members.customRoleId,
  joinedAt: members.createdAt,
  avatarUrl: members.avatarUrl,
  timeZone: members.timeZone,
} as const;

/** A member row as `VIEW_COLUMNS` reads it, in the contract's shape; `withEmail` false leaves the address out. */
function toView(
  row: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly role: string;
    readonly customRoleId: string | null;
    readonly joinedAt: string | Date;
    readonly avatarUrl: string | null;
    readonly timeZone: string | null;
  },
  withEmail = true,
): MemberView {
  return {
    id: row.id,
    name: row.name,
    ...(withEmail ? { email: row.email } : {}),
    role: storedRole(row.role),
    ...(row.customRoleId === null ? {} : { customRoleId: row.customRoleId }),
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
 * member may read it. With `secondFactorUsers`, owners and admins also learn
 * who has a second factor (spec 0033, AC-895); nobody else does. A guest
 * (spec 0031, AC-829) gets names, roles and pictures but no one's email, and
 * searches by name only, so no address can be guessed a letter at a time.
 */
export async function listMembers(
  scope: EngineScope,
  input: { readonly search?: string; readonly cursor?: string; readonly limit?: number } = {},
  options: { readonly secondFactorUsers?: (userIds: readonly string[]) => Promise<ReadonlySet<string>> } = {},
): Promise<MembersPage> {
  const limit = Math.min(Math.max(Math.floor(input.limit ?? MEMBERS_PAGE), 1), MEMBERS_PAGE_MAX);
  const search = input.search?.trim() ?? '';
  const after = input.cursor === undefined ? undefined : decodeMemberCursor(input.cursor);
  const sortName = sql<string>`lower(${members.name})`;
  const seesEmails = !isGuest(scope);
  const matching = and(
    // Row level security keeps the read to this workspace; the filter says so too (house style).
    eq(members.workspaceId, scope.workspaceId),
    eq(members.status, 'active'),
    ...(search === ''
      ? []
      : seesEmails
        ? [or(ilike(members.name, `%${likeLiteral(search)}%`), ilike(members.email, `%${likeLiteral(search)}%`))]
        : [ilike(members.name, `%${likeLiteral(search)}%`)]),
  );
  const { rows, total } = await inWorkspace(scope, async (tx) => {
    const read = await tx
      .select({ ...VIEW_COLUMNS, userId: members.userId, sortName })
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
  // A reader who manages members (owners and admins) also learns who has a second factor (spec 0033, AC-895).
  const factors =
    options.secondFactorUsers !== undefined && can(scope.access, 'members.manage')
      ? await options.secondFactorUsers(page.flatMap((row) => (row.userId === null ? [] : [row.userId])))
      : undefined;
  return {
    members: page.map((row) => ({
      ...toView(row, seesEmails),
      ...(factors === undefined ? {} : { twoFactor: row.userId !== null && factors.has(row.userId) }),
    })),
    total,
    ...(rows.length > limit && last !== undefined ? { nextCursor: encodeMemberCursor(last.sortName, last.id) } : {}),
  };
}

/**
 * The caller's own access (`access.mine`, spec 0009, AC-136): their role, its
 * label (a custom role's own name, spec 0037, AC-1235), their permissions and their teams (spec 0031, AC-825), from
 * the scope the door sealed, and whose scheduling they reach beyond their own (spec 0037, AC-1261), one read of the
 * reach. Only a member has a role.
 */
export async function getMyAccess(scope: EngineScope): Promise<MyAccess> {
  checkScope(scope);
  const { principal, permissions } = scope.access;
  if (principal.kind !== 'member') throw new Error('Only a member has a role to show.');
  const { customRoleId } = principal;
  const [scheduling, custom] = await Promise.all([
    mySchedulingReach(scope),
    customRoleId === undefined
      ? Promise.resolve(undefined)
      : inWorkspace(scope, (tx) => readCustomRole(tx, scope.workspaceId, customRoleId, undefined)),
  ]);
  return {
    memberId: principal.memberId,
    role: principal.role,
    roleLabel: custom?.name ?? ROLE_LABELS[principal.role],
    permissions: [...permissions],
    ...(customRoleId === undefined ? {} : { customRoleId }),
    teamIds: [...principal.teamIds],
    ...(scheduling === undefined ? {} : { scheduling }),
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
  const acting = await lockActing(tx, scope);
  const [target] = await tx
    .select({ ...VIEW_COLUMNS, userId: members.userId })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')))
    .for('update');
  if (target === undefined) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
  return { target: { ...target, role: storedRole(target.role) }, acting };
}

/**
 * Locks the workspace's active owners and the acting member's own row, and answers the role they act with now
 * (the door's answer for one who is no longer a member, or holds a role the code doesn't know).
 */
async function lockActing(tx: WorkspaceTx, scope: EngineScope): Promise<Acting> {
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
  return acting;
}

/**
 * Refuses LAST_OWNER when `memberId` is the live workspace's only active owner (the database checks it too). A
 * deleted workspace needs no owner (account deletion leaves one, spec 0033): its row is read `for share`, so a
 * restore committing meanwhile is waited for and seen, and a restore after this commits finds its owner gone.
 */
async function keepAnOwner(tx: WorkspaceTx, scope: EngineScope, memberId: string | readonly string[]): Promise<void> {
  const leaving = typeof memberId === 'string' ? [memberId] : memberId;
  const [workspace] = await tx
    .select({ deletedAt: workspaces.deletedAt })
    .from(workspaces)
    .where(eq(workspaces.id, scope.workspaceId))
    .for('share');
  if (workspace !== undefined && workspace.deletedAt !== null) return;
  const [other] = await tx
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.workspaceId, scope.workspaceId),
        eq(members.role, 'owner'),
        eq(members.status, 'active'),
        notInArray(members.id, [...leaving]),
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

/** The role a change gives: a built in one, or a custom one (spec 0037, AC-1233), whose base role is `member`. */
interface NextRole {
  readonly role: Role;
  readonly customRole?: { readonly id: string; readonly name: string };
}

const ROLE_GONE = "That role doesn't exist.";

/** A change's role as asked: exactly one of a built in role and a custom role's id. */
function askedRole(input: { readonly role?: Role | undefined; readonly customRoleId?: string | undefined }): {
  readonly role?: Role;
  readonly customRoleId?: string;
} {
  if (input.customRoleId !== undefined) {
    if (input.role !== undefined) throw refuse('CONFIG_INVALID', 'Pick a role.');
    return { customRoleId: checkId(input.customRoleId, ROLE_GONE) };
  }
  if (!isRole(input.role)) throw refuse('CONFIG_INVALID', 'Pick a role.');
  return { role: input.role };
}

/** The role asked for as it stands now, read in the change's transaction: a custom role must still exist. */
async function nextRoleOf(
  tx: WorkspaceTx,
  workspaceId: string,
  asked: { readonly role?: Role; readonly customRoleId?: string },
): Promise<NextRole> {
  if (asked.customRoleId === undefined) return { role: asked.role ?? 'member' };
  const custom = await readCustomRole(tx, workspaceId, asked.customRoleId, 'share');
  if (custom === undefined) throw refuse('NOT_FOUND', ROLE_GONE);
  return { role: 'member', customRole: custom };
}

/** The name of the custom role a member holds now, for the audit row's before, or undefined. */
async function customRoleName(tx: WorkspaceTx, workspaceId: string, roleId: string | null) {
  if (roleId === null) return undefined;
  const [row] = await tx
    .select({ name: workspaceRoles.name })
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.id, roleId)));
  return row?.name;
}

/**
 * One member's role change inside a write that holds their row (`lockTarget`): the owner rules, the last owner, a
 * guest's seat, leaving scheduling for a guest, the row, its audit row, the link page back for a former guest, the
 * invitations their new role can't vouch for, and the `members` and `access` rows. Answers the member and how many
 * invitations went. A change to the role they already hold changes nothing.
 */
async function changeRole(
  context: WriteContext,
  acting: Acting,
  target: Awaited<ReturnType<typeof lockTarget>>['target'],
  next: NextRole,
  source: AuditSource | undefined,
): Promise<{ readonly view: MemberView; readonly cancelled: number; readonly changed: boolean }> {
  const { tx, scope } = context;
  const { role } = next;
  const nextCustom = next.customRole?.id ?? null;
  checkChangesRoles(scope, acting.role);
  checkOwnerRules(scope, acting, target, role);
  if (target.role === role && target.customRoleId === nextCustom) {
    return { view: toView({ ...target, role }), cancelled: 0, changed: false };
  }
  if (target.role === 'owner') await keepAnOwner(tx, scope, target.id);
  // A guest takes no seat (spec 0031, AC-809), so leaving the role takes one (a custom role among them, spec 0037
  // AC-1233); becoming one leaves scheduling, before the role is written, while the rotations still read them as a
  // host (AC-1432).
  if (target.role === 'guest') await checkSeats(tx, scope, 1);
  const leavesGuest = target.role === 'guest' && role !== 'guest';
  if (role === 'guest' && target.role !== 'guest') await leaveSchedulingAsGuest(context, target.id, source);
  const wasName = await customRoleName(tx, scope.workspaceId, target.customRoleId);
  await tx
    .update(members)
    .set({ role, customRoleId: nextCustom, ...touched(scope) })
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, target.id)));
  await writeAudit(
    tx,
    scope.workspaceId,
    scope.actor,
    {
      action: 'member.role_changed',
      targetType: 'member',
      targetId: target.id,
      before: {
        role: target.role,
        ...(target.customRoleId === null ? {} : { customRoleId: target.customRoleId }),
        ...(wasName === undefined ? {} : { customRoleName: wasName }),
      },
      after: {
        role,
        ...(next.customRole === undefined
          ? {}
          : { customRoleId: next.customRole.id, customRoleName: next.customRole.name }),
      },
    },
    source,
  );
  // A guest made a member gets the link page every member has (a kept one comes back as it was; late trap #77).
  if (leavesGuest && target.userId !== null) {
    await ensureLinkPage(tx, {
      userId: target.userId,
      workspaceId: scope.workspaceId,
      name: target.name,
      email: target.email,
    });
  }
  // What they sent and can't send now opens nothing: revoked, and said (late trap: invitations died untold). A
  // custom role never invites (`members.invite` is grant `admin`), so it counts as Member here.
  const cancelled = await revokeUnvouched(tx, scope, target.id, role, source);
  // Everyone's member list reads them again, and the relay drops the workspace's audiences (spec 0007, AC-82).
  // Their scheduling reach changed with their role, and so may that of the delegates reaching them or holding
  // grants they last set (spec 0037, decision 7): their own tabs read it again (AC-1274).
  const reached = await delegatesReachedBy(tx, scope.workspaceId, [target.id]);
  context.record({ members: [target.id], access: [...new Set([target.id, ...reached])] });
  return { view: toView({ ...target, role, customRoleId: nextCustom }), cancelled, changed: true };
}

/**
 * Changes a member's role (spec 0009, AC-137; spec 0037, AC-1233): to a built in `role`, or a custom role
 * (`customRoleId`, with `role` then `member`; one that doesn't exist is NOT_FOUND). Only an owner gives or takes
 * away the owner role; an admin moves members and admins between `member`, `admin`, `guest` and any custom role; a
 * member changes no roles, their own included. A person may change their own role within these rules. Demoting the
 * only active owner of a live workspace is refused 409 `LAST_OWNER`; a guest moved into any other role takes a seat
 * (409 `SEAT_LIMIT`). Answers the member with their role. The actor's role is checked as the door saw it before any
 * read, then again as it is now, under lock. Open invitations they sent that the new role can't vouch for are
 * revoked with it, and counted in the answer.
 */
export async function setMemberRole(
  scope: EngineScope,
  input: { readonly memberId: string; readonly role?: Role | undefined; readonly customRoleId?: string | undefined },
  hooks: readonly AfterWrite[] = [],
  options: MemberWriteOptions = {},
): Promise<SetRoleResult> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  const asked = askedRole(input);
  checkChangesRoles(scope, actingRole(scope));
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { target, acting } = await lockTarget(tx, scope, memberId);
      const next = await nextRoleOf(tx, scope.workspaceId, asked);
      const { view, cancelled } = await changeRole(context, acting, target, next, options.source);
      return { ...view, ...(cancelled > 0 ? { cancelledInvitations: cancelled } : {}) };
    },
    hooks,
  );
  return result;
}

/**
 * Change role for several people at once (spec 0037, AC-1242): one role for up to 100 members, each under the same
 * rules as `setMemberRole`, all in one transaction, so one refusal changes nobody. Batched: the owners, the actor and
 * every target are locked once (targets in id order), the custom role names read once, one update, one audit insert
 * (a row per member changed) and one reach read; only a guest leaving scheduling, a former guest's link page and the
 * invitations each changed member sent run per person. Answers how many changed and the invitations cancelled.
 */
export async function setMemberRoles(
  scope: EngineScope,
  input: {
    readonly memberIds: readonly string[];
    readonly role?: Role | undefined;
    readonly customRoleId?: string | undefined;
  },
  hooks: readonly AfterWrite[] = [],
  options: MemberWriteOptions = {},
): Promise<SetRolesResult> {
  checkScope(scope);
  checkChangesRoles(scope, actingRole(scope));
  const ids = [...new Set(input.memberIds.map((id) => checkId(id, MEMBER_NOT_FOUND)))].sort();
  if (ids.length === 0 || ids.length > SET_ROLES_MAX) {
    throw refuse('CONFIG_INVALID', `Change 1 to ${String(SET_ROLES_MAX)} people at once.`);
  }
  const asked = askedRole(input);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const next = await nextRoleOf(tx, scope.workspaceId, asked);
      const acting = await lockActing(tx, scope);
      checkChangesRoles(scope, acting.role);
      const read = await tx
        .select({ ...VIEW_COLUMNS, userId: members.userId })
        .from(members)
        .where(and(eq(members.workspaceId, scope.workspaceId), inArray(members.id, ids), eq(members.status, 'active')))
        .orderBy(asc(members.id))
        .for('update');
      if (read.length !== ids.length) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
      const targets = read.map((row) => ({ ...row, role: storedRole(row.role) }));
      for (const target of targets) checkOwnerRules(scope, acting, target, next.role);
      const nextCustom = next.customRole?.id ?? null;
      const changing = targets.filter((target) => target.role !== next.role || target.customRoleId !== nextCustom);
      if (changing.length === 0) return { changed: 0 };
      const leavingOwners = changing.filter((target) => target.role === 'owner').map((target) => target.id);
      if (leavingOwners.length > 0) await keepAnOwner(tx, scope, leavingOwners);
      // Guests take no seat (spec 0031, AC-809): each one leaving the role takes one, counted once for all.
      const guestsLeaving = next.role === 'guest' ? [] : changing.filter((target) => target.role === 'guest');
      await checkSeats(tx, scope, guestsLeaving.length);
      if (next.role === 'guest') {
        for (const target of changing) {
          if (target.role !== 'guest') await leaveSchedulingAsGuest(context, target.id, options.source);
        }
      }
      const customIds = [
        ...new Set(changing.flatMap((target) => (target.customRoleId === null ? [] : [target.customRoleId]))),
      ];
      const names =
        customIds.length === 0
          ? new Map<string, string>()
          : new Map(
              (
                await tx
                  .select({ id: workspaceRoles.id, name: workspaceRoles.name })
                  .from(workspaceRoles)
                  .where(and(eq(workspaceRoles.workspaceId, scope.workspaceId), inArray(workspaceRoles.id, customIds)))
              ).map((row) => [row.id, row.name]),
            );
      const changedIds = changing.map((target) => target.id);
      await tx
        .update(members)
        .set({ role: next.role, customRoleId: nextCustom, ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), inArray(members.id, changedIds)));
      await writeAudits(
        tx,
        scope.workspaceId,
        scope.actor,
        changing.map((target) => {
          const wasName = target.customRoleId === null ? undefined : names.get(target.customRoleId);
          return {
            action: 'member.role_changed' as const,
            targetType: 'member' as const,
            targetId: target.id,
            before: {
              role: target.role,
              ...(target.customRoleId === null ? {} : { customRoleId: target.customRoleId }),
              ...(wasName === undefined ? {} : { customRoleName: wasName }),
            },
            after: {
              role: next.role,
              ...(next.customRole === undefined
                ? {}
                : { customRoleId: next.customRole.id, customRoleName: next.customRole.name }),
            },
          };
        }),
        options.source,
      );
      // A guest made a member gets the link page every member has (a kept one comes back as it was).
      for (const target of guestsLeaving) {
        if (target.userId !== null) {
          await ensureLinkPage(tx, {
            userId: target.userId,
            workspaceId: scope.workspaceId,
            name: target.name,
            email: target.email,
          });
        }
      }
      // What they sent and can't send now opens nothing: one statement each, rows only for what goes.
      let cancelled = 0;
      for (const target of changing) {
        cancelled += await revokeUnvouched(tx, scope, target.id, next.role, options.source);
      }
      const reached = await delegatesReachedBy(tx, scope.workspaceId, changedIds);
      context.record({ members: changedIds, access: [...new Set([...changedIds, ...reached])] });
      return { changed: changing.length, ...(cancelled > 0 ? { cancelledInvitations: cancelled } : {}) };
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
  input: { readonly memberId: string; readonly reassignTo?: string },
  hooks: readonly AfterWrite[] = [],
  options: MemberWriteOptions & { readonly jobs?: JobRegistry } = {},
): Promise<RemovedMember> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  checkManages(scope, actingRole(scope), memberId);
  const reassignTo = input.reassignTo === undefined ? undefined : checkId(input.reassignTo, REASSIGNEE_NOT_FOUND);
  if (reassignTo === memberId) throw refuse('NOT_FOUND', REASSIGNEE_NOT_FOUND);
  // Leaving hands nothing on: the job would run as someone no longer here.
  if (reassignTo !== undefined && isSelf(scope, memberId)) throw inputInvalid('reassignTo', LEAVING_HANDS_NOTHING_ON);
  if (reassignTo !== undefined && options.jobs === undefined) throw new Error('Reassigning needs the job kinds.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { target, acting } = await lockTarget(tx, scope, memberId);
      // Leaving is always yours to do; the last owner guard still holds.
      const isLeaving = isSelf(scope, target.id);
      if (!isLeaving) checkOwnerRules(scope, acting, target);
      if (target.role === 'owner') await keepAnOwner(tx, scope, target.id);
      // Whom their work goes to, when anyone: an active member other than them, read under lock.
      if (reassignTo !== undefined) {
        const [heir] = await tx
          .select({ id: members.id })
          .from(members)
          .where(
            and(eq(members.workspaceId, scope.workspaceId), eq(members.id, reassignTo), eq(members.status, 'active')),
          )
          .for('share');
        if (heir === undefined) throw refuse('NOT_FOUND', REASSIGNEE_NOT_FOUND);
      }
      const by = actorRow(scope.actor);
      await tx
        .update(members)
        .set({
          status: 'removed',
          leftAt: sql`now()`,
          removedByType: by.type,
          removedById: by.id,
          removedByMemberId: by.memberId,
          ...touched(scope),
        })
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
      // Every feature's part (spec 0031, AC-814; spec 0037, AC-1440): views, calendars, booking pages, in order.
      await runRemovalEffects(context, target.id, options.source);
      // Their work handed on, as the remover's job, once this commits (AC-816).
      const job =
        reassignTo === undefined || options.jobs === undefined
          ? undefined
          : await startJob(context, options.jobs, {
              kind: REASSIGN_KIND,
              params: { fromMemberId: target.id, toMemberId: reassignTo },
            });
      // Everyone's member list reads them again, and their own tabs are cut off (an `access` row, AC-817).
      context.record({ members: [target.id], access: [target.id] });
      return {
        ...(target.userId === null ? {} : { userId: target.userId }),
        memberId: target.id,
        ...(job === undefined ? {} : { jobId: job.jobId }),
      };
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
  /** The job handing their work on, when the remover chose someone (AC-816). */
  readonly jobId?: string;
}

const REASSIGNEE_NOT_FOUND = "The member to hand their work to isn't in this workspace.";
const LEAVING_HANDS_NOTHING_ON = 'Someone leaving can’t hand their work on; an owner or admin can, after.';

/**
 * What removing a member will do (spec 0031, AC-816): the booking pages that
 * pause, the calendars disconnected, their open tasks and the records naming
 * them, counted for the remove dialog with no lock. A holder of
 * `members.manage` may ask about anyone, any member about themself (before
 * leaving); anyone else is refused FORBIDDEN. A member who isn't active here
 * is NOT_FOUND.
 */
export async function previewRemoval(
  scope: EngineScope,
  input: { readonly memberId: string },
): Promise<RemovalPreview> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  checkManages(scope, actingRole(scope), memberId);
  return inWorkspace(scope, async (tx) => {
    const [target] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
    if (target === undefined) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
    return countRemoval(tx, scope.workspaceId, memberId);
  });
}

/**
 * What making a member a guest will do (spec 0031, slice 9; spec 0037, AC-1432), for the confirm dialog: pages that
 * pause, rotations they leave, upcoming bookings that will need a host and delegations that go. Only a holder of
 * `members.manage` may ask (FORBIDDEN otherwise, checked before any read); a member who isn't active here is
 * NOT_FOUND. Counted with no lock.
 */
export async function previewGuest(scope: EngineScope, input: { readonly memberId: string }): Promise<GuestPreview> {
  checkScope(scope);
  checkChangesRoles(scope, actingRole(scope));
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    const [target] = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
    if (target === undefined) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
    return countBecomingGuest(tx, scope.workspaceId, memberId);
  });
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

/**
 * Hands the workspace to another member (spec 0031, AC-813): in one
 * transaction they become an owner and the caller an admin, with one audit
 * row. Only an owner may, to another active member; several owners stay
 * allowed, so a target who is already an owner just leaves the caller an
 * admin. Refuses 403 `FORBIDDEN` (not an owner, checked again under lock)
 * and 404 `NOT_FOUND` (no such active member, or the caller themself).
 */
export async function transferOwnership(
  scope: EngineScope,
  input: { readonly memberId: string },
  hooks: readonly AfterWrite[] = [],
  options: MemberWriteOptions = {},
): Promise<void> {
  checkScope(scope);
  const memberId = checkId(input.memberId, MEMBER_NOT_FOUND);
  const { principal } = scope.access;
  if (principal.kind !== 'member' || principal.role !== 'owner') throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
  if (principal.memberId === memberId) throw refuse('NOT_FOUND', MEMBER_NOT_FOUND);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { target, acting } = await lockTarget(tx, scope, memberId);
      if (acting.role !== 'owner') throw refuse('FORBIDDEN', OWNER_RULES_MESSAGE);
      // A guest made owner takes a seat (spec 0031, AC-809).
      if (target.role === 'guest') await checkSeats(tx, scope, 1);
      await tx
        .update(members)
        // An owner holds no custom role (spec 0037, AC-1233).
        .set({ role: 'owner', customRoleId: null, ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, target.id)));
      await tx
        .update(members)
        .set({ role: 'admin', ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, principal.memberId)));
      // An admin can't send owner invitations: any they sent as owner opens nothing now, so it is revoked.
      await revokeUnvouched(tx, scope, principal.memberId, 'admin', options.source);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'workspace.ownership_transferred',
          targetType: 'member',
          targetId: target.id,
          before: {
            toRole: target.role,
            ...(target.customRoleId === null ? {} : { toCustomRoleId: target.customRoleId }),
            fromRole: 'owner',
            from: principal.memberId,
          },
          after: { toRole: 'owner', fromRole: 'admin', from: principal.memberId },
        },
        options.source,
      );
      // Both lists read them again, and the caller's own access changes (spec 0007, AC-82). The delegates reaching
      // either, or holding grants either last set, may see more or less of their scheduling (spec 0037, AC-1274).
      const reached = await delegatesReachedBy(tx, scope.workspaceId, [target.id, principal.memberId]);
      context.record({
        members: [target.id, principal.memberId],
        ...(reached.length === 0 ? {} : { access: [...reached] }),
      });
    },
    hooks,
  );
}
