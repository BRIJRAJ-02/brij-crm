// Whose scheduling a caller may see or change (spec 0037, AC-1258): the reach, read once per transaction, and
// `canActFor`, the one pure check every "for someone else" decision goes through. Built now as spec 0035's seam:
// today the reach is everyone for `booking.admin` and nobody else, the rule spec 0035 (AC-971) gives. Spec 0037's J4
// fills it from `schedule.manage` and `schedule.view`, teams and delegations, here alone, with no service changing.
import type { WorkspaceTx } from '@crm/db';
import type { EngineScope } from './mint.ts';
import { can } from './policy.ts';

/** How far a caller reaches into someone's scheduling: See shows it, Manage changes it. */
export type SchedulingLevel = 'view' | 'manage';

/** The caller's reach: themself, everyone at a level, and members at their own levels. */
export interface SchedulingReach {
  /** The caller, when a member: they always see and manage their own scheduling. */
  readonly self: string | undefined;
  /** Over everyone in the workspace, or undefined. */
  readonly all: SchedulingLevel | undefined;
  /** Over single members (spec 0037: team mates and delegations), by member id. Empty until then. */
  readonly members: ReadonlyMap<string, SchedulingLevel>;
}

/**
 * The caller's reach, read once per transaction at the scheduling choke point (spec 0037, AC-1258). Today: the
 * system manages everyone; a member or a key with `booking.admin` manages everyone; anyone else only themself.
 * `tx` is where spec 0037 reads teams and delegations, one query.
 */
export function schedulingReach(_tx: WorkspaceTx, scope: EngineScope): Promise<SchedulingReach> {
  const { principal } = scope.access;
  const self = principal.kind === 'member' ? principal.memberId : undefined;
  const all = principal.kind === 'system' || can(scope.access, 'booking.admin') ? 'manage' : undefined;
  return Promise.resolve({ self, all, members: new Map() });
}

/**
 * Whether the reach covers `memberId` at `need` (spec 0037, pure): yourself always; `view` when everyone is
 * reached or the member is at either level; `manage` when everyone is managed or the member is.
 */
export function canActFor(reach: SchedulingReach, memberId: string, need: SchedulingLevel): boolean {
  if (memberId === reach.self) return true;
  const level = reach.all === 'manage' ? 'manage' : (reach.members.get(memberId) ?? reach.all);
  if (level === undefined) return false;
  return need === 'view' || level === 'manage';
}
