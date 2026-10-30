// Whose scheduling a caller may see or change (spec 0037, AC-1253, AC-1258): the reach, read once per transaction,
// and `canActFor`, the one pure check every "for someone else" decision goes through. This file is the only place
// that reads a `schedule.*` permission (AC-1221, `scheduling-scan.test.ts`), and, beside it, `isSelf`, `isHostOf` and
// `managesPageOf` are the helpers that compare a principal's member id with a booking's or a page's.
//
// The reach is the most open of (AC-1253):
// - the role: `schedule.manage` or `schedule.view` over every member (owners and admins hold both); the `.team` pair
//   over members who share a team, which reaches nobody until teams exist (spec 0031 slice 8), so it fails closed;
// - delegations naming the caller (`schedule_delegations`): a member, or everyone. A team target reaches nobody
//   until teams exist. A level or target the code doesn't know grants nothing (AC-1223).
// Decision 7: reach from anything but the built in Owner or Admin role never covers an owner or an admin. Over them
// only a delegation they granted themself counts, or, over an admin, one an owner granted (its granter's role now).
// An everyone delegation leaves them out.
//
// The door never reads any of this (AC-1259): CRM requests pay nothing. One query reads it, inside the service's own
// transaction, and only when the role doesn't already manage everyone.
import { sql } from 'drizzle-orm';
import { ROLE_PERMISSIONS, ROLES, type Role } from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { isUuid } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from './mint.ts';
import { can, isRole, type Access, type Principal } from './policy.ts';

/** How far a reach goes into someone's scheduling: See shows it, Manage changes it. */
export type SchedulingLevel = 'view' | 'manage';

/** The caller's reach: themself, everyone at a level, and members at their own levels. */
export interface SchedulingReach {
  /** The caller, when a member: they always see and manage their own scheduling. */
  readonly self: string | undefined;
  /** Over everyone in the workspace (the system, the built in Owner and Admin roles), or undefined. */
  readonly all: SchedulingLevel | undefined;
  /** Over single members (delegations, and later team mates), by member id, the highest level each. */
  readonly members: ReadonlyMap<string, SchedulingLevel>;
  /**
   * Members whose Manage comes only from a delegation they granted themself while they can't change their own
   * hours (no `availability.own`): over their hours (`what: 'hours'`) it counts as See (AC-1255, decision 9).
   */
  readonly hoursSeenOnly: ReadonlySet<string>;
}

/** What a check is about: anything (the default), or a member's hours (schedules, date overrides, limits). */
export type SchedulingWhat = 'any' | 'hours';

const RANK: Readonly<Record<SchedulingLevel, number>> = { view: 1, manage: 2 };

/** A stored level as one the code knows, or undefined (which grants nothing, AC-1223). */
export function parseSchedulingLevel(value: unknown): SchedulingLevel | undefined {
  return value === 'view' || value === 'manage' ? value : undefined;
}

/** The higher of two levels, either possibly absent. */
export function higherLevel(
  a: SchedulingLevel | undefined,
  b: SchedulingLevel | undefined,
): SchedulingLevel | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** No reach at all: not even oneself (a form, a booking page, an email link). */
const NOBODY: SchedulingReach = Object.freeze({
  self: undefined,
  all: undefined,
  members: new Map<string, SchedulingLevel>(),
  hoursSeenOnly: new Set<string>(),
});

/** The member a principal is, or undefined. */
const selfOf = (principal: Principal): string | undefined =>
  principal.kind === 'member' ? principal.memberId : undefined;

/**
 * The reach over everyone that the access itself gives (pure): the system manages everyone; a member through the
 * built in role's `schedule.manage` or `schedule.view`. Nobody else: a key never holds `schedule.*`
 * (`KEY_FORBIDDEN_PERMISSIONS`, decision 7), and a form, a booking page or an email link has no member.
 */
export function roleReach(access: Access): SchedulingLevel | undefined {
  const { principal } = access;
  if (principal.kind === 'system') return 'manage';
  if (principal.kind !== 'member') return undefined;
  if (can(access, 'schedule.manage')) return 'manage';
  if (can(access, 'schedule.view')) return 'view';
  return undefined;
}

/** One delegation naming the caller, as the reach query reads it, and the member it reaches. */
export interface DelegationReachRow {
  readonly target_type: string;
  readonly level: string;
  readonly granted_by_self: boolean;
  /** The member reached: the target (a member delegation), or each active member (an everyone delegation). */
  readonly member_id: string | null;
  /** That member's role now. */
  readonly member_role: string | null;
  /** The role now of whoever last granted it, when they are still an active member. */
  readonly grantor_role: string | null;
}

/** A role the code knows that is an owner's or an admin's; an unknown one counts as one (fail closed). */
const isProtected = (role: string | null): boolean => role === null || !isRole(role) || role !== 'member';

/** Whether a member with `role` can change their own hours; an unknown role can't (fail closed). */
const ownsHours = (role: string | null): boolean =>
  role !== null && isRole(role) && (ROLE_PERMISSIONS[role] as readonly string[]).includes('availability.own');

/**
 * The reach from the caller's delegations (pure, AC-1270): each row's level over its member, the highest level per
 * member, with decision 7 and decision 9 applied. Unknown levels and targets, a team target, and rows naming no
 * active member grant nothing.
 */
export function combineReach(
  self: string | undefined,
  all: SchedulingLevel | undefined,
  rows: readonly DelegationReachRow[],
): SchedulingReach {
  const members = new Map<string, SchedulingLevel>();
  // Per member: the highest level from anything but a self grant, and whether a self grant gave Manage.
  const otherwise = new Map<string, SchedulingLevel>();
  const selfManaged = new Set<string>();
  const roles = new Map<string, string | null>();
  for (const row of rows) {
    const level = parseSchedulingLevel(row.level);
    const memberId = row.member_id;
    if (level === undefined || memberId === null || memberId === self) continue;
    if (row.target_type !== 'member' && row.target_type !== 'everyone') continue;
    const guarded = isProtected(row.member_role);
    if (guarded) {
      // Owners and admins: never through everyone; through a member delegation only their own grant, or an owner's
      // over an admin.
      if (row.target_type === 'everyone') continue;
      const byOwner = row.grantor_role === 'owner' && row.member_role === 'admin';
      if (!row.granted_by_self && !byOwner) continue;
    }
    roles.set(memberId, row.member_role);
    members.set(memberId, higherLevel(members.get(memberId), level) ?? level);
    if (row.granted_by_self && row.target_type === 'member') {
      if (level === 'manage') selfManaged.add(memberId);
    } else {
      otherwise.set(memberId, higherLevel(otherwise.get(memberId), level) ?? level);
    }
  }
  const hoursSeenOnly = new Set<string>();
  for (const memberId of selfManaged) {
    if (!ownsHours(roles.get(memberId) ?? null) && otherwise.get(memberId) !== 'manage') hoursSeenOnly.add(memberId);
  }
  return { self, all, members, hoursSeenOnly };
}

/**
 * The caller's reach, read once per transaction at the scheduling choke point (AC-1258), in one query: the
 * delegations naming them, each with the member it reaches, that member's role and the granter's role now. Skipped
 * when the role already manages everyone. A member removed since the door let them in has no delegations left.
 */
export async function schedulingReach(tx: WorkspaceTx, scope: EngineScope): Promise<SchedulingReach> {
  const { access } = scope;
  const { principal } = access;
  const all = roleReach(access);
  const self = selfOf(principal);
  if (principal.kind !== 'member') return { ...NOBODY, all };
  if (all === 'manage') return { ...NOBODY, self, all };
  const me = principal.memberId;
  // Two arms, so each takes its index: a member delegation's target by the members key, an everyone delegation's
  // members by the workspace's active members. The granter is whoever last set the level.
  const found = await tx.execute<DelegationReachRow & Record<string, unknown>>(sql`
    select d.target_type, d.level, d.granted_by_self, t.id::text as member_id, t.role::text as member_role,
      g.role::text as grantor_role
    from schedule_delegations d
    left join members t on t.workspace_id = d.workspace_id and t.id = d.target_member_id and t.status = 'active'
    left join members g on g.workspace_id = d.workspace_id and g.id = d.updated_by_member_id and g.status = 'active'
    where d.workspace_id = ${scope.workspaceId}::uuid and d.delegate_member_id = ${me}::uuid
      and d.target_type = 'member'
    union all
    select d.target_type, d.level, d.granted_by_self, t.id::text, t.role::text, null
    from schedule_delegations d
    join members t on t.workspace_id = d.workspace_id and t.status = 'active' and t.id <> d.delegate_member_id
    where d.workspace_id = ${scope.workspaceId}::uuid and d.delegate_member_id = ${me}::uuid
      and d.target_type = 'everyone'
  `);
  return combineReach(self, all, found.rows);
}

/**
 * Whether the reach covers `memberId` at `need` (pure, AC-1258): yourself always; `view` when everyone is reached
 * or the member is at either level; `manage` when everyone is managed or the member is. About `hours`, Manage that
 * comes only from the member's own grant while they can't change their own hours counts as See (AC-1255). Services
 * still check the member is active and their own permissions (AC-1252).
 */
export function canActFor(
  reach: SchedulingReach,
  memberId: string,
  need: SchedulingLevel,
  what: SchedulingWhat = 'any',
): boolean {
  if (reach.self !== undefined && memberId === reach.self) return true;
  let own = reach.members.get(memberId);
  if (what === 'hours' && own === 'manage' && reach.hoursSeenOnly.has(memberId)) own = 'view';
  const level = higherLevel(reach.all, own);
  if (level === undefined) return false;
  return need === 'view' || level === 'manage';
}

/** What the screens show of a reach (`access.mine`'s `scheduling`, AC-1261). */
export function reachSummary(reach: SchedulingReach): {
  readonly seesOthers: boolean;
  readonly managesOthers: boolean;
  readonly seesEveryone: boolean;
  readonly managesEveryone: boolean;
} {
  const levels = [...reach.members.values()];
  return {
    seesOthers: reach.all !== undefined || levels.length > 0,
    managesOthers: reach.all === 'manage' || levels.includes('manage'),
    seesEveryone: reach.all !== undefined,
    managesEveryone: reach.all === 'manage',
  };
}

/** Whether `memberId` is the principal themself: the one comparison of a principal's member id outside the reach. */
export function isSelf(principal: Principal, memberId: string): boolean {
  return principal.kind === 'member' && principal.memberId === memberId;
}

/** Whether the principal hosts a booking (its host, or a co-host when the caller has them in hand). */
export function isHostOf(
  booking: { readonly hostMemberId: string; readonly coHostIds?: readonly string[] },
  principal: Principal,
): boolean {
  if (principal.kind !== 'member') return false;
  return booking.hostMemberId === principal.memberId || (booking.coHostIds ?? []).includes(principal.memberId);
}

/**
 * Whether the principal manages a booking's page (decision 12): its owner, or `booking.admin`, which manages every
 * page (its editors join with job J14). The system manages every page. A workspace link has no owner here (null).
 *
 */
export function managesPageOf(booking: { readonly ownerMemberId: string | null }, access: Access): boolean {
  const { principal } = access;
  if (principal.kind === 'system') return true;
  return can(access, 'booking.admin') || (principal.kind === 'member' && booking.ownerMemberId === principal.memberId);
}

/**
 * The built in roles whose holders manage everyone's scheduling (`schedule.manage`): who is told when a booking
 * needs a host (spec 0029, AC-749), since reassigning it needs Manage over every host it could go to.
 */
export function rolesManagingEveryone(): readonly Role[] {
  return ROLES.filter((role) => (ROLE_PERMISSIONS[role] as readonly string[]).includes('schedule.manage'));
}

/** What a member outside the caller's See reach reads as: the same sentence as one who doesn't exist (AC-1258). */
export const NO_PERSON = 'That person isn’t in this workspace.';

/** The refusal for a member the caller may See but not Manage (AC-1258), with their first name when known. */
export function seeOnlyMessage(name: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first === undefined || first === ''
    ? 'You can see this person’s scheduling but not change it.'
    : `You can see ${first}’s scheduling but not change it.`;
}

/**
 * The check every "for someone else" service makes before acting on `memberId` (AC-1258): the reach read once, the
 * member active, not a guest, and in See reach (else NOT_FOUND, as an unknown member), and reached at `need` (else
 * 403 FORBIDDEN naming them). Answers the reach for any further check. The caller checks their own permission first
 * (AC-1275).
 */
export async function actingFor(
  tx: WorkspaceTx,
  scope: EngineScope,
  memberId: string,
  need: SchedulingLevel,
  what: SchedulingWhat = 'any',
): Promise<SchedulingReach> {
  const reach = await schedulingReach(tx, scope);
  if (!isUuid(memberId) || !canActFor(reach, memberId, 'view')) throw refuse('NOT_FOUND', NO_PERSON);
  const found = await tx.execute<{ name: string }>(sql`
    select name from members where id = ${memberId}::uuid and status = 'active' and role::text <> 'guest'
  `);
  const [row] = found.rows;
  if (row === undefined) throw refuse('NOT_FOUND', NO_PERSON);
  if (!canActFor(reach, memberId, need, what)) throw refuse('FORBIDDEN', seeOnlyMessage(row.name));
  return reach;
}
