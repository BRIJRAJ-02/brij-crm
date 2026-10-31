// Whose scheduling a caller reaches (spec 0037, AC-1253, AC-1258, AC-1270): `canActFor`, the reach combination and
// the level parsing, as pure checks over the grid: each role permission, each delegation target and level, unknown
// levels and targets, a removed target, decision 7 (owners and admins) and decision 9 (hours set by others).
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '@crm/contracts';
import { keyAccess, roleAccess, SYSTEM_ACCESS, type Access, emailLinkAccess } from './policy.ts';
import {
  canActFor,
  combineReach,
  isHostOf,
  isSelf,
  managesPageOf,
  parseSchedulingLevel,
  reachSummary,
  roleReach,
  rolesWithTeamScope,
  TEAM_SCOPE,
  teamRoleReach,
  type DelegationReachRow,
  type SchedulingReach,
} from './scheduling.ts';

const ME = '0190f0f0-0000-7000-8000-000000000001';
const BEA = '0190f0f0-0000-7000-8000-000000000002';
const CY = '0190f0f0-0000-7000-8000-000000000003';
const OWEN = '0190f0f0-0000-7000-8000-000000000004';
const ADA = '0190f0f0-0000-7000-8000-000000000005';
const NOBODY = '0190f0f0-0000-7000-8000-000000000009';

const reach = (all: SchedulingReach['all'], members: Record<string, 'view' | 'manage'> = {}): SchedulingReach => ({
  self: ME,
  all,
  members: new Map(Object.entries(members)),
  hoursSeenOnly: new Set(),
});

/** One delegation row as the reach query answers it. */
const row = (over: Partial<DelegationReachRow> & { readonly member_id: string | null }): DelegationReachRow => ({
  target_type: 'member',
  level: 'manage',
  granted_by_self: false,
  member_role: 'member',
  grantor_role: 'admin',
  ...over,
});

const member = (role: 'owner' | 'admin' | 'member'): Access =>
  roleAccess({ kind: 'member', memberId: ME, role, teamIds: [] });

describe('canActFor', () => {
  it('always reaches yourself, at both levels, whatever else the reach says', () => {
    expect(canActFor(reach(undefined), ME, 'view')).toBe(true);
    expect(canActFor(reach(undefined), ME, 'manage')).toBe(true);
    expect(canActFor(reach(undefined), ME, 'manage', 'hours')).toBe(true);
  });

  it('reaches everyone at the level everyone is reached, Manage covering See', () => {
    expect(canActFor(reach('manage'), BEA, 'manage')).toBe(true);
    expect(canActFor(reach('view'), BEA, 'view')).toBe(true);
    expect(canActFor(reach('view'), BEA, 'manage')).toBe(false);
  });

  it('reaches a named member at their own level, and nobody unnamed', () => {
    const named = reach(undefined, { [BEA]: 'view', [CY]: 'manage' });
    expect(canActFor(named, BEA, 'view')).toBe(true);
    expect(canActFor(named, BEA, 'manage')).toBe(false);
    expect(canActFor(named, CY, 'manage')).toBe(true);
    expect(canActFor(named, NOBODY, 'view')).toBe(false);
  });

  it('keeps the higher of everyone and a member’s own level', () => {
    expect(canActFor(reach('view', { [BEA]: 'manage' }), BEA, 'manage')).toBe(true);
    expect(canActFor(reach('manage', { [BEA]: 'view' }), BEA, 'manage')).toBe(true);
  });

  it('reaches nobody but yourself without any reach, and nobody at all with no self', () => {
    expect(canActFor(reach(undefined), BEA, 'view')).toBe(false);
    expect(
      canActFor({ self: undefined, all: undefined, members: new Map(), hoursSeenOnly: new Set() }, ME, 'view'),
    ).toBe(false);
  });

  it('counts Manage from a member’s own grant as See over their hours while it is all there is (decision 9)', () => {
    const selfGranted: SchedulingReach = { ...reach(undefined, { [BEA]: 'manage' }), hoursSeenOnly: new Set([BEA]) };
    expect(canActFor(selfGranted, BEA, 'manage')).toBe(true);
    expect(canActFor(selfGranted, BEA, 'view', 'hours')).toBe(true);
    expect(canActFor(selfGranted, BEA, 'manage', 'hours')).toBe(false);
    // Manage from the role still changes them.
    expect(canActFor({ ...selfGranted, all: 'manage' }, BEA, 'manage', 'hours')).toBe(true);
  });
});

describe('the level parsing', () => {
  it('knows view and manage and nothing else', () => {
    expect(parseSchedulingLevel('view')).toBe('view');
    expect(parseSchedulingLevel('manage')).toBe('manage');
    for (const unknown of ['admin', 'Manage', '', null, undefined, 2])
      expect(parseSchedulingLevel(unknown)).toBeUndefined();
  });
});

describe('the reach from the role', () => {
  it('manages everyone for owners, admins and the system; nobody for a member', () => {
    expect(roleReach(member('owner'))).toBe('manage');
    expect(roleReach(member('admin'))).toBe('manage');
    expect(roleReach(member('member'))).toBeUndefined();
    expect(roleReach(SYSTEM_ACCESS)).toBe('manage');
  });

  it('gives a key no reach (keys never hold schedule.*, decision 7), and nothing to an email link', () => {
    expect(roleReach(keyAccess('k', ['schedule.view', 'schedule.manage']))).toBeUndefined();
    // `booking.admin` is for things, not people's time (decision 12).
    expect(roleReach(keyAccess('k', ['booking.admin']))).toBeUndefined();
    expect(roleReach(emailLinkAccess(ME))).toBeUndefined();
  });

  it('holds the four schedule permissions on owners and admins only, and availability.own on every role', () => {
    for (const permission of ['schedule.view', 'schedule.view.team', 'schedule.manage', 'schedule.manage.team']) {
      expect((ROLE_PERMISSIONS.owner as readonly string[]).includes(permission)).toBe(true);
      expect((ROLE_PERMISSIONS.admin as readonly string[]).includes(permission)).toBe(true);
      expect((ROLE_PERMISSIONS.member as readonly string[]).includes(permission)).toBe(false);
    }
    for (const role of ['owner', 'admin', 'member'] as const) {
      expect((ROLE_PERMISSIONS[role] as readonly string[]).includes('availability.own')).toBe(true);
    }
  });
});

describe('the reach over team mates from the role (AC-1253)', () => {
  it('reads the `.team` pair for a member principal only, Manage over See', () => {
    const lead = (permissions: readonly string[]): Access =>
      ({ ...member('member'), permissions: [...permissions] }) as Access;
    expect(teamRoleReach(lead(['schedule.manage.team', 'schedule.view.team']))).toBe('manage');
    expect(teamRoleReach(lead(['schedule.view.team']))).toBe('view');
    expect(teamRoleReach(member('member'))).toBeUndefined();
    expect(teamRoleReach(keyAccess('k', ['schedule.manage.team']))).toBeUndefined();
    expect(teamRoleReach(SYSTEM_ACCESS)).toBeUndefined();
  });

  it('names no built in role whose reach runs through teams: owners and admins manage everyone', () => {
    expect(rolesWithTeamScope()).toEqual([]);
  });
});

describe('the reach from delegations', () => {
  it('reaches a member target at its level, and every non owner, non admin member through everyone', () => {
    const combined = combineReach(ME, undefined, [
      row({ member_id: BEA, level: 'view' }),
      row({ target_type: 'everyone', member_id: CY, level: 'manage', grantor_role: null }),
      row({ target_type: 'everyone', member_id: OWEN, member_role: 'owner', grantor_role: null }),
      row({ target_type: 'everyone', member_id: ADA, member_role: 'admin', grantor_role: null }),
    ]);
    expect(canActFor(combined, BEA, 'view')).toBe(true);
    expect(canActFor(combined, BEA, 'manage')).toBe(false);
    expect(canActFor(combined, CY, 'manage')).toBe(true);
    // Decision 7: everyone never covers an owner or an admin.
    expect(canActFor(combined, OWEN, 'view')).toBe(false);
    expect(canActFor(combined, ADA, 'view')).toBe(false);
  });

  it('keeps the highest level when two delegations reach one member', () => {
    const combined = combineReach(ME, undefined, [
      row({ member_id: BEA, level: 'view' }),
      row({ target_type: 'everyone', member_id: BEA, level: 'manage', grantor_role: null }),
    ]);
    expect(canActFor(combined, BEA, 'manage')).toBe(true);
  });

  it('reaches a team’s members, and team mates through the role’s team scope, never an owner or an admin', () => {
    const combined = combineReach(ME, undefined, [
      row({ target_type: 'team', member_id: BEA, level: 'view', grantor_role: null }),
      row({ target_type: TEAM_SCOPE, member_id: CY, level: 'manage', grantor_role: null }),
      row({ target_type: 'team', member_id: OWEN, member_role: 'owner', grantor_role: null }),
      row({ target_type: TEAM_SCOPE, member_id: ADA, member_role: 'admin', grantor_role: null }),
      // Overlapping: the team scope sees Bea, a team delegation manages her; the higher wins.
      row({ target_type: TEAM_SCOPE, member_id: BEA, level: 'view', grantor_role: null }),
    ]);
    expect(canActFor(combined, BEA, 'view')).toBe(true);
    expect(canActFor(combined, BEA, 'manage')).toBe(false);
    expect(canActFor(combined, CY, 'manage')).toBe(true);
    expect(canActFor(combined, OWEN, 'view')).toBe(false);
    expect(canActFor(combined, ADA, 'view')).toBe(false);
    // A team delegation is never a self grant: it changes hours.
    expect(canActFor(combined, CY, 'manage', 'hours')).toBe(true);
  });

  it('grants nothing for an unknown level, an unknown target, or a target no longer active', () => {
    const combined = combineReach(ME, undefined, [
      row({ member_id: BEA, level: 'admin' }),
      row({ target_type: 'team', member_id: CY, level: 'owner' }),
      row({ target_type: 'department', member_id: CY }),
      // A removed target: the query's join finds no active member.
      row({ member_id: null }),
    ]);
    expect(combined.members.size).toBe(0);
    expect(canActFor(combined, BEA, 'view')).toBe(false);
    expect(canActFor(combined, CY, 'view')).toBe(false);
  });

  it('reaches an owner or an admin only through their own grant, or an owner’s over an admin (decision 7)', () => {
    const combined = combineReach(ME, undefined, [
      row({ member_id: OWEN, member_role: 'owner', grantor_role: 'admin' }),
      row({ member_id: ADA, member_role: 'admin', grantor_role: 'admin' }),
    ]);
    expect(canActFor(combined, OWEN, 'view')).toBe(false);
    expect(canActFor(combined, ADA, 'view')).toBe(false);
    const allowed = combineReach(ME, undefined, [
      row({ member_id: OWEN, member_role: 'owner', granted_by_self: true, grantor_role: 'owner' }),
      row({ member_id: ADA, member_role: 'admin', grantor_role: 'owner' }),
    ]);
    expect(canActFor(allowed, OWEN, 'manage')).toBe(true);
    expect(canActFor(allowed, ADA, 'manage')).toBe(true);
    // A role the code doesn't know counts as an owner's (fail closed).
    const unknown = combineReach(ME, undefined, [row({ member_id: BEA, member_role: 'guest' })]);
    expect(canActFor(unknown, BEA, 'view')).toBe(false);
  });

  it('never names the caller among the members, and keeps the role’s reach over everyone', () => {
    const combined = combineReach(ME, 'view', [row({ target_type: 'everyone', member_id: ME, grantor_role: null })]);
    expect(combined.members.has(ME)).toBe(false);
    expect(combined.all).toBe('view');
    expect(canActFor(combined, BEA, 'view')).toBe(true);
  });

  it('leaves a member’s hours to their managers when their own grant is all a delegate has (decision 9)', () => {
    // Every built in role holds availability.own, so a self grant changes their hours; an unknown role doesn't.
    const holds = combineReach(ME, undefined, [row({ member_id: BEA, granted_by_self: true })]);
    expect(canActFor(holds, BEA, 'manage', 'hours')).toBe(true);
    const admin = combineReach(ME, undefined, [
      row({ member_id: BEA, granted_by_self: true, member_role: 'admin', grantor_role: 'admin' }),
    ]);
    expect(canActFor(admin, BEA, 'manage', 'hours')).toBe(true);
    const unknownRole = combineReach(ME, undefined, [
      row({ member_id: BEA, granted_by_self: true, member_role: 'doctor' }),
    ]);
    // A role the code doesn't know is protected and grants through the self grant only, and never their hours.
    expect(canActFor(unknownRole, BEA, 'manage')).toBe(true);
    expect(canActFor(unknownRole, BEA, 'manage', 'hours')).toBe(false);
    // An owner's grant beside it counts only over an admin; over a role the code doesn't know, nothing (fail closed).
    const both = combineReach(ME, undefined, [
      row({ member_id: BEA, granted_by_self: true, member_role: 'doctor' }),
      row({ target_type: 'member', member_id: BEA, member_role: 'doctor', grantor_role: 'owner' }),
    ]);
    expect(canActFor(both, BEA, 'manage', 'hours')).toBe(false);
  });

  it('sums up for the screens (access.mine, AC-1261)', () => {
    expect(reachSummary(reach(undefined))).toEqual({
      seesOthers: false,
      managesOthers: false,
      seesEveryone: false,
      managesEveryone: false,
    });
    expect(reachSummary(reach(undefined, { [BEA]: 'view' }))).toEqual({
      seesOthers: true,
      managesOthers: false,
      seesEveryone: false,
      managesEveryone: false,
    });
    expect(reachSummary(reach('view', { [BEA]: 'manage' }))).toEqual({
      seesOthers: true,
      managesOthers: true,
      seesEveryone: true,
      managesEveryone: false,
    });
  });
});

describe('the helpers that compare member ids (AC-1221)', () => {
  const me = { kind: 'member' as const, memberId: ME, role: 'member' as const, teamIds: [] };

  it('knows yourself, a host and a page’s manager', () => {
    expect(isSelf(me, ME)).toBe(true);
    expect(isSelf(me, BEA)).toBe(false);
    expect(isSelf({ kind: 'system' }, ME)).toBe(false);
    expect(isHostOf({ hostMemberId: ME }, me)).toBe(true);
    expect(isHostOf({ hostMemberId: BEA, coHostIds: [ME] }, me)).toBe(true);
    expect(isHostOf({ hostMemberId: BEA }, me)).toBe(false);
    expect(managesPageOf({ ownerMemberId: ME }, member('member'))).toBe(true);
    expect(managesPageOf({ ownerMemberId: BEA }, member('member'))).toBe(false);
    expect(managesPageOf({ ownerMemberId: BEA }, member('admin'))).toBe(true);
    expect(managesPageOf({ ownerMemberId: BEA }, SYSTEM_ACCESS)).toBe(true);
  });
});
