// The role table is pinned (spec 0009, AC-133): a change to who holds what is
// a reviewed change to this file, never a side effect.
import { describe, expect, it } from 'vitest';
import {
  GRANT_LEVELS,
  KEY_DATA_SCOPES,
  PERMISSION_GROUPS,
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
  it('lists the eighteen permissions of spec 0009, jobs.manage among them, forms.manage of spec 0023, the booking two of spec 0025, comments.manage of spec 0038, security.manage of spec 0033 and the six of spec 0037', () => {
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
      'forms.manage',
      'records.export',
      'api_keys.manage',
      'webhooks.manage',
      'automations.manage',
      'audit.read',
      'workspace.export',
      'billing.manage',
      'support.grant',
      'booking.manage',
      'booking.admin',
      'comments.manage',
      'security.manage',
      'availability.own',
      'schedule.view',
      'schedule.view.team',
      'schedule.manage',
      'schedule.manage.team',
      'routing.manage',
    ]);
  });

  // Spec 0037, AC-1226: every permission carries a label, a one line description, a group and a grant level.
  it('gives every permission a label, a description, a group and a grant level', () => {
    for (const name of PERMISSION_NAMES) {
      const entry = PERMISSIONS[name];
      expect([name, entry.label.length > 0, /\.$/.test(entry.description)]).toEqual([name, true, true]);
      expect(PERMISSION_GROUPS).toContain(entry.group);
      expect(GRANT_LEVELS).toContain(entry.grant);
    }
  });

  it('pins each grant level (AC-1226, AC-1227): owner only five, admin only ten, the rest any', () => {
    const of = (grant: string) => PERMISSION_NAMES.filter((name) => PERMISSIONS[name].grant === grant);
    expect(of('owner')).toEqual([
      'workspace.delete',
      'workspace.export',
      'billing.manage',
      'support.grant',
      'security.manage',
    ]);
    expect(of('admin')).toEqual([
      'workspace.manage',
      'members.invite',
      'members.manage',
      'jobs.manage',
      'teams.manage',
      'access.manage',
      'api_keys.manage',
      'webhooks.manage',
      'audit.read',
      'routing.manage',
    ]);
    expect(of('any')).toEqual([
      'schema.manage',
      'views.manage',
      'records.purge',
      'forms.manage',
      'records.export',
      'automations.manage',
      'booking.manage',
      'booking.admin',
      'comments.manage',
      'availability.own',
      'schedule.view',
      'schedule.view.team',
      'schedule.manage',
      'schedule.manage.team',
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
    'forms.manage': ['owner', 'admin'],
    'records.export': ['owner', 'admin', 'member'],
    'api_keys.manage': ['owner', 'admin'],
    'webhooks.manage': ['owner', 'admin'],
    'automations.manage': ['owner', 'admin'],
    'audit.read': ['owner', 'admin'],
    'workspace.export': ['owner'],
    'billing.manage': ['owner'],
    'support.grant': ['owner'],
    'booking.manage': ['owner', 'admin', 'member'],
    'booking.admin': ['owner', 'admin'],
    'comments.manage': ['owner', 'admin'],
    'security.manage': ['owner'],
    // Spec 0037 (AC-1227): everyone changes their own hours; owners and admins see and manage everyone's scheduling.
    'availability.own': ['owner', 'admin', 'member'],
    'schedule.view': ['owner', 'admin'],
    'schedule.view.team': ['owner', 'admin'],
    'schedule.manage': ['owner', 'admin'],
    'schedule.manage.team': ['owner', 'admin'],
    'routing.manage': ['owner', 'admin'],
  };

  it('holds exactly the table, row by row', () => {
    expect(Object.keys(TABLE)).toEqual([...PERMISSION_NAMES]);
    for (const [permission, roles] of Object.entries(TABLE)) {
      const holders = ROLES.filter((role) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission));
      expect([permission, holders]).toEqual([permission, roles]);
    }
  });

  it('leaves admins only the five owner only permissions short of an owner', () => {
    const missing = PERMISSION_NAMES.filter((name) => !(ROLE_PERMISSIONS.admin as readonly string[]).includes(name));
    expect(missing).toEqual([
      'workspace.delete',
      'workspace.export',
      'billing.manage',
      'support.grant',
      'security.manage',
    ]);
  });

  it('names the three roles as the screens show them', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'member']);
    expect(ROLE_LABELS).toEqual({ owner: 'Owner', admin: 'Admin', member: 'Member' });
  });
});

describe('the key scope catalog', () => {
  it('holds every permission but the thirteen that stay with people, plus the two data levels', () => {
    for (const forbidden of [
      'security.manage',
      'members.manage',
      'members.invite',
      'access.manage',
      'teams.manage',
      'billing.manage',
      'workspace.delete',
      'support.grant',
      'audit.read',
      'schedule.view',
      'schedule.view.team',
      'schedule.manage',
      'schedule.manage.team',
    ]) {
      expect(KEY_SCOPES).not.toContain(forbidden);
    }
    expect(KEY_SCOPES).toContain('schema.manage');
    expect(KEY_SCOPES).toContain('records.export');
    expect(KEY_SCOPES.slice(-2)).toEqual([...KEY_DATA_SCOPES]);
    expect(KEY_SCOPES).toHaveLength(PERMISSION_NAMES.length - 13 + 2);
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
