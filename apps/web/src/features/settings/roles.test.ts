// The Roles screens' rules (spec 0037, AC-1240, AC-1241): the two scheduling Selects over the catalog, the role
// page's sections, what a save sends, whether a change takes access away, and "What can Priya do"'s lines.
import type { DelegationView, RoleDefinition } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { managedBy, reachLine, type CapabilityWords } from './capabilities.ts';
import {
  changesOf,
  draftOf,
  permissionSections,
  reachOf,
  roleTakesAway,
  startOf,
  takesAway,
  withReach,
} from './roles.ts';

const role = (over: Partial<RoleDefinition> & Pick<RoleDefinition, 'id' | 'label'>): RoleDefinition => ({
  description: '',
  permissions: [],
  dataAccess: 'write',
  isDefault: false,
  updatedAt: '2026-10-31T00:00:00.000Z',
  ...over,
});
const MEMBER = role({
  id: 'member',
  label: 'Member',
  builtIn: 'member',
  permissions: ['records.export', 'booking.manage'],
});
const ADMIN = role({
  id: 'admin',
  label: 'Admin',
  builtIn: 'admin',
  permissions: ['members.manage', 'records.export', 'booking.manage'],
});
const LEAD = role({ id: 'r1', label: 'Sales lead', permissions: ['schedule.view.team', 'schedule.manage.team'] });
const DESK = role({ id: 'r2', label: 'Receptionist', permissions: ['schedule.view', 'schedule.manage'] });

describe('the scheduling Selects (AC-1241)', () => {
  it('read the four permissions as See and Manage reach', () => {
    expect(reachOf([])).toEqual({ see: 'self', manage: 'self' });
    expect(reachOf(LEAD.permissions)).toEqual({ see: 'team', manage: 'team' });
    expect(reachOf(['schedule.view', 'schedule.manage.team'])).toEqual({ see: 'everyone', manage: 'team' });
  });

  it('widen See to a wider Manage, and narrow Manage to a narrower See, so a role never manages unseen people', () => {
    expect(withReach(['booking.manage'], { see: 'self', manage: 'everyone' }, 'manage')).toEqual([
      'booking.manage',
      'schedule.view',
      'schedule.manage',
    ]);
    expect(withReach(DESK.permissions, { see: 'team', manage: 'everyone' }, 'see')).toEqual([
      'schedule.view.team',
      'schedule.manage.team',
    ]);
    expect(withReach(DESK.permissions, { see: 'self', manage: 'self' }, 'see')).toEqual([]);
  });
});

describe('the role page', () => {
  it('leaves the four reach permissions and, for a custom role, the Owner only group out of its rows', () => {
    const custom = permissionSections(true);
    const names = custom.flatMap((section) => section.rows.map((row) => row.name));
    expect(names).not.toContain('schedule.view');
    expect(custom.map((section) => section.group)).not.toContain('Owner only');
    expect(permissionSections(false).map((section) => section.group)).toContain('Owner only');
    expect(custom.flatMap((section) => section.rows).find((row) => row.name === 'members.invite')?.isHoldable).toBe(
      false,
    );
  });

  it('sends only what changed, and says when a save takes something away', () => {
    const draft = { ...draftOf(LEAD), name: ' Sales leads ' };
    expect(changesOf(LEAD, draft)).toEqual({ name: 'Sales leads' });
    expect(takesAway(LEAD, draft)).toBe(false);
    expect(takesAway(LEAD, { ...draft, permissions: ['schedule.view.team'] })).toBe(true);
    expect(takesAway(LEAD, { ...draft, dataAccess: 'read' })).toBe(true);
  });

  it('starts a new role from Member, the Viewer preset, or a custom role', () => {
    const roles = [MEMBER, LEAD];
    expect(startOf(roles, 'member')).toEqual({
      permissions: ['records.export', 'booking.manage'],
      dataAccess: 'write',
    });
    expect(startOf(roles, 'viewer')).toEqual({ permissions: [], dataAccess: 'read' });
    expect(startOf(roles, 'r1').permissions).toEqual(['schedule.view.team', 'schedule.manage.team']);
  });

  it('asks first when a move takes access away', () => {
    const roles = [ADMIN, MEMBER, LEAD, DESK];
    expect(roleTakesAway(roles, 'admin', 'r2')).toBe(true);
    expect(roleTakesAway(roles, 'r1', 'r2')).toBe(true);
    expect(roleTakesAway(roles, 'member', 'admin')).toBe(false);
    expect(roleTakesAway(roles, 'gone', 'member')).toBe(true);
  });
});

describe('What can Priya do (AC-1243)', () => {
  const words: CapabilityWords = {
    reach: { self: 'Only their own', team: 'Their teams', everyone: 'Everyone' },
    and: (a, b) => `${a} and ${b}`,
    ownersAndAdmins: 'Owners and admins',
    holdersOf: (name) => `Everyone with ${name}`,
    teamHoldersOf: (name) => `${name} in their teams`,
    everyoneGrant: (name) => `${name} (everyone)`,
  };
  const names: Readonly<Record<string, string>> = { priya: 'Priya', bea: 'Bea', sam: 'Sam' };
  const nameOf = (id: string) => names[id];
  /** A delegation to `delegate` over `target`: a member's id, or `everyone`. */
  const grant = (delegate: string, target: string, level: 'view' | 'manage'): DelegationView => ({
    id: `${delegate}-${target}`,
    delegateMemberId: delegate,
    target: target === 'everyone' ? { type: 'everyone' } : { type: 'member', memberId: target },
    level,
    grantedBySelf: false,
    createdAt: '2026-10-31T00:00:00.000Z',
  });

  it('says whom they reach through their role and their delegations', () => {
    expect(reachLine(LEAD, [grant('priya', 'bea', 'view')], 'view', nameOf, words)).toBe('Their teams and Bea');
    expect(reachLine(MEMBER, [grant('priya', 'bea', 'view')], 'manage', nameOf, words)).toBe('Only their own');
    expect(reachLine(DESK, [], 'manage', nameOf, words)).toBe('Everyone');
  });

  it('names who manages their scheduling: owners and admins, roles that reach them, and their delegates', () => {
    const delegations = [
      grant('sam', 'priya', 'manage'),
      grant('bea', 'everyone', 'manage'),
      grant('bea', 'sam', 'view'),
    ];
    expect(managedBy({ id: 'priya', role: 'member' }, [ADMIN, LEAD, DESK], delegations, nameOf, words)).toEqual([
      'Owners and admins',
      'Sales lead in their teams',
      'Everyone with Receptionist',
      'Sam',
      'Bea (everyone)',
    ]);
    // An admin is reached by no custom role and no everyone grant (decision 7).
    expect(managedBy({ id: 'priya', role: 'admin' }, [LEAD, DESK], delegations, nameOf, words)).toEqual([
      'Owners and admins',
      'Sam',
    ]);
  });
});
