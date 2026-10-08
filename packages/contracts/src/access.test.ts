// The role table is pinned (spec 0009, AC-133): a change to who holds what is
// a reviewed change to this file, never a side effect.
import { describe, expect, it } from 'vitest';
import {
  KEY_DATA_SCOPES,
  KEY_SCOPES,
  MyAccess,
  Permission,
  PERMISSION_NAMES,
  PERMISSIONS,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
} from './access.ts';

describe('the permission catalog', () => {
  it('lists the eighteen permissions of spec 0009, jobs.manage among them', () => {
    expect([...PERMISSION_NAMES]).toEqual([
      'workspace.manage',
      'workspace.delete',
      'members.invite',
      'members.manage',
      'jobs.manage',
      'teams.manage',
      'access.manage',
      'schema.manage',
      'views.manage',
      'records.purge',
      'records.export',
      'api_keys.manage',
      'webhooks.manage',
      'automations.manage',
      'audit.read',
      'workspace.export',
      'billing.manage',
      'support.grant',
    ]);
  });

  it('gives every permission a refusal sentence, and schema.manage the one the spec fixes', () => {
    for (const name of PERMISSION_NAMES) expect(PERMISSIONS[name].message).toMatch(/\.$/);
    expect(PERMISSIONS['schema.manage'].message).toBe(
      'Only workspace owners and admins can change objects and attributes.',
    );
  });

  it('parses no name outside the catalog', () => {
    expect(Permission.safeParse('schema.manage').success).toBe(true);
    expect(Permission.safeParse('schema.admin').success).toBe(false);
    expect(Permission.safeParse('').success).toBe(false);
  });
});

describe('the role table', () => {
  /** The table in spec 0009, row by row: which roles hold each permission. */
  const TABLE: Record<string, readonly string[]> = {
    'workspace.manage': ['owner', 'admin'],
    'workspace.delete': ['owner'],
    'members.invite': ['owner', 'admin'],
    'members.manage': ['owner', 'admin'],
    'jobs.manage': ['owner', 'admin'],
    'teams.manage': ['owner', 'admin'],
    'access.manage': ['owner', 'admin'],
    'schema.manage': ['owner', 'admin'],
    'views.manage': ['owner', 'admin'],
    'records.purge': ['owner', 'admin'],
    'records.export': ['owner', 'admin', 'member'],
    'api_keys.manage': ['owner', 'admin'],
    'webhooks.manage': ['owner', 'admin'],
    'automations.manage': ['owner', 'admin'],
    'audit.read': ['owner', 'admin'],
    'workspace.export': ['owner'],
    'billing.manage': ['owner'],
    'support.grant': ['owner'],
  };

  it('holds exactly the table, row by row', () => {
    expect(Object.keys(TABLE)).toEqual([...PERMISSION_NAMES]);
    for (const [permission, roles] of Object.entries(TABLE)) {
      const holders = ROLES.filter((role) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission));
      expect([permission, holders]).toEqual([permission, roles]);
    }
  });

  it('leaves admins only the four owner only permissions short of an owner', () => {
    const missing = PERMISSION_NAMES.filter((name) => !(ROLE_PERMISSIONS.admin as readonly string[]).includes(name));
    expect(missing).toEqual(['workspace.delete', 'workspace.export', 'billing.manage', 'support.grant']);
  });

  it('names the three roles as the screens show them', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'member']);
    expect(ROLE_LABELS).toEqual({ owner: 'Owner', admin: 'Admin', member: 'Member' });
  });
});

describe('the key scope catalog', () => {
  it('holds every permission but the seven that stay with people, plus the two data levels', () => {
    for (const forbidden of [
      'members.manage',
      'members.invite',
      'access.manage',
      'teams.manage',
      'billing.manage',
      'workspace.delete',
      'support.grant',
    ]) {
      expect(KEY_SCOPES).not.toContain(forbidden);
    }
    expect(KEY_SCOPES).toContain('schema.manage');
    expect(KEY_SCOPES).toContain('records.export');
    expect(KEY_SCOPES.slice(-2)).toEqual([...KEY_DATA_SCOPES]);
    expect(KEY_SCOPES).toHaveLength(PERMISSION_NAMES.length - 7 + 2);
  });
});

describe('access.mine', () => {
  const MEMBER = '01a11b9d-2f11-7efa-871e-95e7b00fbe23';

  it('answers the member id, a role, its label and permissions from the catalog', () => {
    expect(
      MyAccess.parse({ memberId: MEMBER, role: 'member', roleLabel: 'Member', permissions: ['records.export'] }),
    ).toEqual({
      memberId: MEMBER,
      role: 'member',
      roleLabel: 'Member',
      permissions: ['records.export'],
    });
    expect(MyAccess.safeParse({ role: 'guest', roleLabel: 'Guest', permissions: [] }).success).toBe(false);
  });
});
