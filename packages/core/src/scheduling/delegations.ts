// Delegations of scheduling access (spec 0037, AC-1254 to AC-1257): See or
// Manage over one member's scheduling (or everyone's) given to one member.
// A member grants and takes back delegations over themself (their assistant);
// holders of `members.manage` grant and take back any over members, never over
// an owner, and over an admin only when they are an owner; a delegate may take
// back their own. Every grant, change and removal writes one audit row and one
// `access` outbox row naming the delegate, so their open screens read their
// reach again (AC-1257, AC-1274). The reach these rows give is read by
// `access/scheduling.ts` alone.
//
// The actor's role is read again under lock, as the owner rules do, so someone
// demoted since the request came in acts with their role now. Two grants at
// once take the delegate's and the target's advisory locks in key order, so
// neither cap can be passed (AC-1256).
import { and, asc, count, eq, or, sql } from 'drizzle-orm';
import {
  DELEGATES_PER_MEMBER,
  DELEGATIONS_PER_DELEGATE,
  DELEGATIONS_WORKSPACE_MAX,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type DelegationsList,
  type DelegationTarget,
  type DelegationView,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkScope } from '../access/mint.ts';
import { can, isRole } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { parseSchedulingLevel, rolesWithTeamScope, type SchedulingLevel } from '../access/scheduling.ts';
import { lockKey } from '../booking/locks.ts';
import { audit, touched } from '../engine/definitions.ts';
import { checkId, newId, uuidList } from '../engine/ids.ts';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit, writeAudits, type AuditSource } from '../members/audit.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';

const { members, scheduleDelegations, teams } = schema;

/** A member who isn't here, or isn't the caller's to ask about: the same sentence (timefix's wording). */
const NO_PERSON = 'That person isn’t in this workspace.';
const NO_DELEGATION = 'That access doesn’t exist, or isn’t yours to change.';
const NOT_A_MEMBER = "That workspace doesn't exist, or you're not a member of it.";
const DELEGATE_INVALID = 'Pick another active teammate who isn’t a guest.';
const NO_TEAM = 'That team doesn’t exist.';
const OVER_OWNER = 'Only an owner can let someone see or manage their own scheduling.';
const OVER_ADMIN = 'Only an owner can let someone see or manage an admin’s scheduling.';

/** What every delegation write takes beside its input: where the request came from, for the audit row. */
export interface DelegationWriteOptions {
  readonly source?: AuditSource;
}

/** The member the scope acts as, or a refusal: only members hold or grant delegations. */
function actingMember(scope: EngineScope): string {
  const { principal } = scope.access;
  if (principal.kind !== 'member') throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
  return principal.memberId;
}

/** Whether a role (now, as read under lock) holds `members.manage`; an unknown role doesn't. */
const roleManages = (role: string | undefined): boolean =>
  role !== undefined && isRole(role) && (ROLE_PERMISSIONS[role] as readonly string[]).includes('members.manage');

/** One active member as a delegation write reads them, locked `for share` so they can't leave meanwhile. */
async function activeMember(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
): Promise<{ readonly id: string; readonly name: string; readonly role: string } | undefined> {
  const [row] = await tx
    .select({ id: members.id, name: members.name, role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, memberId), eq(members.status, 'active')))
    .for('share');
  return row;
}

/** A stored row as the screens list it, or undefined for a level or target the code doesn't know (AC-1223). */
function toView(row: typeof scheduleDelegations.$inferSelect): DelegationView | undefined {
  const level = parseSchedulingLevel(row.level);
  if (level === undefined) return undefined;
  let target: DelegationTarget;
  if (row.targetType === 'member' && row.targetMemberId !== null)
    target = { type: 'member', memberId: row.targetMemberId };
  else if (row.targetType === 'team' && row.targetTeamId !== null) target = { type: 'team', teamId: row.targetTeamId };
  else if (row.targetType === 'everyone' && row.targetMemberId === null && row.targetTeamId === null) {
    target = { type: 'everyone' };
  } else return undefined;
  return {
    id: row.id,
    delegateMemberId: row.delegateMemberId,
    target,
    level,
    grantedBySelf: row.grantedBySelf,
    ...(row.updatedByMemberId === null ? {} : { grantedBy: row.updatedByMemberId }),
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** What an audit row stores of a delegation: ids and its level, never a name. */
function auditFields(row: {
  readonly delegateMemberId: string;
  readonly targetType: string;
  readonly targetMemberId: string | null;
  readonly targetTeamId: string | null;
  readonly level: string;
}): Readonly<Record<string, unknown>> {
  return {
    level: row.level,
    targetType: row.targetType,
    ...(row.targetMemberId === null ? {} : { targetMemberId: row.targetMemberId }),
    ...(row.targetTeamId === null ? {} : { targetTeamId: row.targetTeamId }),
  };
}

/**
 * A member's delegations both ways (`scheduling.delegations.list`): those they hold and those over them, oldest
 * first. Anyone may ask about themself; only `members.manage` about someone else, who otherwise answers NOT_FOUND,
 * as does a member who isn't active here.
 */
export async function listDelegations(
  scope: EngineScope,
  input: { readonly memberId?: string | undefined; readonly everyone?: boolean | undefined } = {},
): Promise<DelegationsList> {
  checkScope(scope);
  const me = actingMember(scope);
  // Every delegation in the workspace (the Members page's Scheduling column, AC-1267): `members.manage` alone, who
  // may grant and remove any of them anyway. Anyone else meets it as a refusal, never a partial list.
  if (input.everyone === true) {
    if (input.memberId !== undefined) throw inputInvalid('memberId', 'Ask for one person or everyone, not both.');
    if (!can(scope.access, 'members.manage')) throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
    return inWorkspace(scope, async (tx) => {
      const rows = await tx
        .select()
        .from(scheduleDelegations)
        .where(eq(scheduleDelegations.workspaceId, scope.workspaceId))
        .orderBy(asc(scheduleDelegations.createdAt), asc(scheduleDelegations.id))
        .limit(DELEGATIONS_WORKSPACE_MAX);
      return { delegations: rows.flatMap((row) => toView(row) ?? []) };
    });
  }
  const memberId = input.memberId === undefined ? me : checkId(input.memberId, NO_PERSON);
  if (memberId !== me && !can(scope.access, 'members.manage')) throw refuse('NOT_FOUND', NO_PERSON);
  return inWorkspace(scope, async (tx) => {
    if (memberId !== me) {
      const [found] = await tx
        .select({ id: members.id })
        .from(members)
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId), eq(members.status, 'active')));
      if (found === undefined) throw refuse('NOT_FOUND', NO_PERSON);
    }
    const rows = await tx
      .select()
      .from(scheduleDelegations)
      .where(
        and(
          eq(scheduleDelegations.workspaceId, scope.workspaceId),
          or(eq(scheduleDelegations.delegateMemberId, memberId), eq(scheduleDelegations.targetMemberId, memberId)),
        ),
      )
      .orderBy(asc(scheduleDelegations.createdAt), asc(scheduleDelegations.id))
      .limit(DELEGATIONS_PER_DELEGATE + DELEGATES_PER_MEMBER);
    return { delegations: rows.flatMap((row) => toView(row) ?? []) };
  });
}

/** The advisory locks a grant takes: the delegate's and (a member target) the target's, in key order (AC-1256). */
async function lockBoth(tx: WorkspaceTx, workspaceId: string, delegate: string, target: string | undefined) {
  const keys = [`delegations:delegate:${workspaceId}:${delegate}`];
  if (target !== undefined) keys.push(`delegations:target:${workspaceId}:${target}`);
  for (const key of keys.sort()) await lockKey(tx, key);
}

/**
 * Gives `delegateMemberId` See or Manage over a member's scheduling, a team's (its active members at each check,
 * AC-1254) or everyone's (`scheduling.delegations.grant`, AC-1255). Over yourself it needs `booking.manage`; over
 * anyone else, a team or everyone, `members.manage` (403 `FORBIDDEN`), never over an owner, and over an admin only as
 * an owner (a team delegation never reaches them, `access/scheduling.ts`). A delegate who isn't an active member, or
 * the target as their own delegate, is 422 `DELEGATE_INVALID`; an unknown member or team 404 `NOT_FOUND`; past 50 delegations held or 20 delegates over one member 409 `DELEGATION_LIMIT`.
 * A grant over the same delegate and target changes its level (one `delegation.changed` row), or changes nothing.
 */
export async function grantDelegation(
  scope: EngineScope,
  input: {
    readonly delegateMemberId: string;
    readonly target: DelegationTarget;
    readonly level: SchedulingLevel;
  },
  hooks: readonly AfterWrite[] = [],
  options: DelegationWriteOptions = {},
): Promise<DelegationView> {
  checkScope(scope);
  const me = actingMember(scope);
  const level = parseSchedulingLevel(input.level);
  if (level === undefined) throw inputInvalid('level', 'Pick See or Manage.');
  const delegate = checkId(input.delegateMemberId, DELEGATE_INVALID);
  const { target } = input;
  // A target type the code doesn't know is refused, whatever the contract let through (AC-1223).
  const kind: string = target.type;
  if (kind !== 'member' && kind !== 'team' && kind !== 'everyone') {
    throw inputInvalid('target', 'Pick a person, a team or everyone.');
  }
  const targetMember = target.type === 'member' ? checkId(target.memberId, NO_PERSON) : undefined;
  const targetTeam = target.type === 'team' ? checkId(target.teamId, NO_TEAM) : undefined;
  const overSelf = targetMember === me;
  // As the door saw the actor, before any read; then again as they are now, under lock.
  if (overSelf) {
    if (!can(scope.access, 'booking.manage')) throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
  } else if (!can(scope.access, 'members.manage')) {
    throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const actor = await activeMember(tx, scope.workspaceId, me);
      if (actor === undefined || !isRole(actor.role)) throw refuse('NOT_FOUND', NOT_A_MEMBER);
      if (overSelf) {
        if (!(ROLE_PERMISSIONS[actor.role] as readonly string[]).includes('booking.manage')) {
          throw refuse('FORBIDDEN', PERMISSIONS['booking.manage'].message);
        }
      } else if (!roleManages(actor.role)) {
        throw refuse('FORBIDDEN', PERMISSIONS['members.manage'].message);
      }
      const over = targetMember === undefined ? undefined : await activeMember(tx, scope.workspaceId, targetMember);
      if (targetMember !== undefined && over === undefined) throw refuse('NOT_FOUND', NO_PERSON);
      // The team stays while the grant is made (its delete takes the row `for update`).
      if (targetTeam !== undefined && !(await teamExists(tx, scope.workspaceId, targetTeam))) {
        throw refuse('NOT_FOUND', NO_TEAM);
      }
      if (!overSelf && over !== undefined) {
        // Decision 7: an owner's scheduling is theirs to share; an admin's an owner's too.
        if (over.role !== 'member' && over.role !== 'admin') throw refuse('FORBIDDEN', OVER_OWNER);
        if (over.role === 'admin' && actor.role !== 'owner') throw refuse('FORBIDDEN', OVER_ADMIN);
      }
      if (delegate === targetMember) throw refuse('DELEGATE_INVALID', DELEGATE_INVALID);
      const holder = await activeMember(tx, scope.workspaceId, delegate);
      if (holder === undefined) throw refuse('DELEGATE_INVALID', DELEGATE_INVALID);
      await lockBoth(tx, scope.workspaceId, delegate, targetMember);
      const sameTarget =
        targetMember !== undefined
          ? and(eq(scheduleDelegations.targetType, 'member'), eq(scheduleDelegations.targetMemberId, targetMember))
          : targetTeam !== undefined
            ? and(eq(scheduleDelegations.targetType, 'team'), eq(scheduleDelegations.targetTeamId, targetTeam))
            : eq(scheduleDelegations.targetType, 'everyone');
      const [existing] = await tx
        .select()
        .from(scheduleDelegations)
        .where(
          and(
            eq(scheduleDelegations.workspaceId, scope.workspaceId),
            eq(scheduleDelegations.delegateMemberId, delegate),
            sameTarget,
          ),
        )
        .for('update');
      if (existing !== undefined) {
        const view = toView(existing);
        // The same grant by the same granter changes nothing; by someone else it becomes theirs (decision 7 reads
        // who last set it), so an owner's grant again over a member since made an admin takes effect.
        const same = existing.level === level && existing.grantedBySelf === overSelf;
        if (view !== undefined && same && existing.updatedByMemberId === me) return view;
        const [changed] = await tx
          .update(scheduleDelegations)
          .set({ level, grantedBySelf: overSelf, ...touched(scope) })
          .where(and(eq(scheduleDelegations.workspaceId, scope.workspaceId), eq(scheduleDelegations.id, existing.id)))
          .returning();
        if (changed === undefined) throw new Error('A delegation locked for update vanished.');
        await writeAudit(
          tx,
          scope.workspaceId,
          scope.actor,
          {
            action: 'delegation.changed',
            targetType: 'member',
            targetId: delegate,
            before: auditFields(existing),
            after: auditFields(changed),
          },
          options.source,
        );
        context.record({ access: [delegate] });
        return toViewOrThrow(changed);
      }
      await checkCaps(tx, scope.workspaceId, holder, over);
      const [made] = await tx
        .insert(scheduleDelegations)
        .values({
          workspaceId: scope.workspaceId,
          id: newId(),
          delegateMemberId: delegate,
          targetType: target.type,
          targetMemberId: targetMember ?? null,
          targetTeamId: targetTeam ?? null,
          level,
          grantedBySelf: overSelf,
          ...audit(scope),
        })
        .returning();
      if (made === undefined) throw new Error('A delegation insert returned no row.');
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        { action: 'delegation.granted', targetType: 'member', targetId: delegate, after: auditFields(made) },
        options.source,
      );
      // The delegate's open screens read their reach again (AC-1257, AC-1274).
      context.record({ access: [delegate] });
      return toViewOrThrow(made);
    },
    hooks,
  );
  return result;
}

/** Whether `teamId` is a team here, its row locked `for share` so a delete waits for the grant. */
async function teamExists(tx: WorkspaceTx, workspaceId: string, teamId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.workspaceId, workspaceId), eq(teams.id, teamId)))
    .for('share');
  return row !== undefined;
}

/** A row this write itself just stored, as a view: its level and target are always ones the code knows. */
function toViewOrThrow(row: typeof scheduleDelegations.$inferSelect): DelegationView {
  const view = toView(row);
  if (view === undefined) throw new Error('A delegation was stored with a level or target the code doesn’t know.');
  return view;
}

/** Refuses 409 `DELEGATION_LIMIT` past 50 delegations held by the delegate, or 20 delegates over one member. */
async function checkCaps(
  tx: WorkspaceTx,
  workspaceId: string,
  holder: { readonly id: string; readonly name: string },
  over: { readonly id: string; readonly name: string } | undefined,
): Promise<void> {
  const [held] = await tx
    .select({ n: count() })
    .from(scheduleDelegations)
    .where(and(eq(scheduleDelegations.workspaceId, workspaceId), eq(scheduleDelegations.delegateMemberId, holder.id)));
  if ((held?.n ?? 0) >= DELEGATIONS_PER_DELEGATE) {
    throw refuse(
      'DELEGATION_LIMIT',
      `${holder.name} can already see or manage ${String(DELEGATIONS_PER_DELEGATE)} people’s scheduling.`,
    );
  }
  if (over === undefined) return;
  const [delegates] = await tx
    .select({ n: count() })
    .from(scheduleDelegations)
    .where(and(eq(scheduleDelegations.workspaceId, workspaceId), eq(scheduleDelegations.targetMemberId, over.id)));
  if ((delegates?.n ?? 0) >= DELEGATES_PER_MEMBER) {
    throw refuse(
      'DELEGATION_LIMIT',
      `${over.name} already has ${String(DELEGATES_PER_MEMBER)} people managing their scheduling.`,
    );
  }
}

/**
 * Takes a delegation back (`scheduling.delegations.revoke`): the member it is over, its delegate, or a holder of
 * `members.manage` (never over an owner, over an admin only as an owner). Anyone else, and an unknown id, answers
 * NOT_FOUND. One `delegation.revoked` row, and an `access` row naming the delegate.
 */
export async function revokeDelegation(
  scope: EngineScope,
  input: { readonly id: string },
  hooks: readonly AfterWrite[] = [],
  options: DelegationWriteOptions = {},
): Promise<void> {
  checkScope(scope);
  const me = actingMember(scope);
  const id = checkId(input.id, NO_DELEGATION);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const actor = await activeMember(tx, scope.workspaceId, me);
      if (actor === undefined) throw refuse('NOT_FOUND', NOT_A_MEMBER);
      const [row] = await tx
        .select()
        .from(scheduleDelegations)
        .where(and(eq(scheduleDelegations.workspaceId, scope.workspaceId), eq(scheduleDelegations.id, id)))
        .for('update');
      if (row === undefined) throw refuse('NOT_FOUND', NO_DELEGATION);
      const isOwn = (row.targetType === 'member' && row.targetMemberId === me) || row.delegateMemberId === me;
      if (!isOwn && !(await mayManageOver(tx, scope.workspaceId, actor.role, row.targetMemberId))) {
        throw refuse('NOT_FOUND', NO_DELEGATION);
      }
      await tx
        .delete(scheduleDelegations)
        .where(and(eq(scheduleDelegations.workspaceId, scope.workspaceId), eq(scheduleDelegations.id, row.id)));
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'delegation.revoked',
          targetType: 'member',
          targetId: row.delegateMemberId,
          before: auditFields(row),
        },
        options.source,
      );
      context.record({ access: [row.delegateMemberId] });
    },
    hooks,
  );
}

/** Whether an actor with `role` (now) may change a delegation over `targetMemberId` (or everyone) as a manager. */
async function mayManageOver(
  tx: WorkspaceTx,
  workspaceId: string,
  role: string,
  targetMemberId: string | null,
): Promise<boolean> {
  if (!roleManages(role)) return false;
  if (targetMemberId === null) return true;
  const [target] = await tx
    .select({ role: members.role })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, targetMemberId), eq(members.status, 'active')))
    .for('share');
  if (target === undefined) return false;
  if (target.role === 'member') return true;
  return target.role === 'admin' && role === 'owner';
}

/**
 * Removal (spec 0031, AC-814; spec 0037, AC-1269): every delegation the member holds or that is over them goes, in
 * the removal's transaction, with an `access` row naming each delegate who lost reach (the removed member's own
 * row is the removal's).
 */
async function deleteMemberDelegations(context: WriteContext, memberId: string): Promise<void> {
  const { tx, scope } = context;
  // Everyone delegations stop reaching them, and grants they last set over admins stop counting (decision 7).
  const reached = await delegatesReachedBy(tx, scope.workspaceId, [memberId]);
  const gone = await tx
    .delete(scheduleDelegations)
    .where(
      and(
        eq(scheduleDelegations.workspaceId, scope.workspaceId),
        or(eq(scheduleDelegations.delegateMemberId, memberId), eq(scheduleDelegations.targetMemberId, memberId)),
      ),
    )
    .returning({ delegate: scheduleDelegations.delegateMemberId });
  const delegates = [...new Set([...reached, ...gone.map((row) => row.delegate)])].filter((id) => id !== memberId);
  if (delegates.length > 0) context.record({ access: delegates });
}

/**
 * A team is deleted (spec 0037, AC-1269): the delegations over it go in the delete's transaction (before the team
 * row, whose foreign key would cascade them anyway), each with a `delegation.revoked` audit row, and one `access` row
 * names their delegates, whose reach shrank. Answers those delegates.
 */
export async function deleteTeamDelegations(
  context: WriteContext,
  teamId: string,
  source?: AuditSource,
): Promise<readonly string[]> {
  const { tx, scope } = context;
  const gone = await tx
    .delete(scheduleDelegations)
    .where(and(eq(scheduleDelegations.workspaceId, scope.workspaceId), eq(scheduleDelegations.targetTeamId, teamId)))
    .returning();
  await writeAudits(
    tx,
    scope.workspaceId,
    scope.actor,
    gone.map((row) => ({
      action: 'delegation.revoked' as const,
      targetType: 'member' as const,
      targetId: row.delegateMemberId,
      before: auditFields(row),
    })),
    source,
  );
  const delegates = [...new Set(gone.map((row) => row.delegateMemberId))];
  if (delegates.length > 0) context.record({ access: delegates });
  return delegates;
}

/**
 * The delegates holding a delegation over any of `teamIds` (spec 0037, AC-1274): whose reach changes when someone
 * joins or leaves one of those teams. One read on the target team index, inside the change's transaction.
 */
export async function teamDelegates(
  tx: WorkspaceTx,
  workspaceId: string,
  teamIds: readonly string[],
): Promise<readonly string[]> {
  if (teamIds.length === 0) return [];
  const found = await tx.execute<{ id: string }>(sql`
    select distinct delegate_member_id::text as id from schedule_delegations
    where workspace_id = ${workspaceId}::uuid and target_type = 'team' and target_team_id = any(${uuidList(teamIds)})
  `);
  return found.rows.map((row) => row.id);
}

/** The delegations' part of a member's removal (AC-1269). */
export const delegationsRemoval: RemovalEffect = {
  feature: 'scheduling access',
  constraints: ['schedule_delegations_delegate', 'schedule_delegations_target_member'],
  run: deleteMemberDelegations,
};

/**
 * The members whose reach changes when `memberIds` change role, leave or join (spec 0037, AC-1274): those holding
 * a delegation over one of them, over a team one of them is in, every holder of an everyone delegation (owners and
 * admins are left out of it), those holding a delegation one of them last set (decision 7 reads the granter's role
 * now), and their team mates whose role reaches through teams (`rolesWithTeamScope`). One read inside the change's
 * own transaction, before any team membership goes; the caller names them in its `access` row.
 */
export async function delegatesReachedBy(
  tx: WorkspaceTx,
  workspaceId: string,
  memberIds: readonly string[],
): Promise<readonly string[]> {
  if (memberIds.length === 0) return [];
  const ids = uuidList(memberIds);
  const scoped = rolesWithTeamScope();
  const found = await tx.execute<{ id: string }>(sql`
    select distinct d.delegate_member_id::text as id from schedule_delegations d
    where d.workspace_id = ${workspaceId}::uuid
      and (d.target_member_id = any(${ids}) or d.target_type = 'everyone' or d.updated_by_member_id = any(${ids})
        or (d.target_type = 'team' and exists (
          select 1 from team_members tm
          where tm.workspace_id = d.workspace_id and tm.team_id = d.target_team_id and tm.member_id = any(${ids}))))
    ${
      scoped.length === 0
        ? sql``
        : sql`union
    select mate.member_id::text from team_members mine
    join team_members mate on mate.workspace_id = mine.workspace_id and mate.team_id = mine.team_id
    join members m on m.workspace_id = mate.workspace_id and m.id = mate.member_id and m.status = 'active'
    where mine.workspace_id = ${workspaceId}::uuid and mine.member_id = any(${ids})
      and m.role::text = any(${`{${scoped.join(',')}}`}::text[])`
    }
  `);
  return found.rows.map((row) => row.id);
}

/**
 * A member joined (spec 0037, AC-1274): every holder of an everyone delegation reaches them now, so the join's
 * transaction stores one `access` row naming those delegates, and their open screens read their reach again.
 */
export async function recordJoinReach(context: WriteContext, workspaceId: string, memberId: string): Promise<void> {
  const reached = await delegatesReachedBy(context.tx, workspaceId, [memberId]);
  if (reached.length > 0) context.record({ access: reached });
}
