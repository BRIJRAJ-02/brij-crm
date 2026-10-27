// What a role actually lets someone do (27 October 2026, the owner: "letting
// someone know what access does what"). Every role picker in the app offers a
// name and one sentence — "Manages members, settings and every record" — while
// the truth, `ROLE_PERMISSIONS`, never reaches a screen. Someone choosing a
// role for a colleague is guessing.
//
// This is the one place that turns permissions into something a person can
// read: each permission's power in plain words, those powers grouped into a
// handful of areas, and a role's standing in each area. It is derived from
// `ROLE_PERMISSIONS`, never written out by hand, so a permission added to a
// role shows up here with no second edit and the screens can't drift from
// what the server enforces.
//
// Plain TypeScript, no Zod: the role pickers are on the first load.
import { ROLE_PERMISSIONS, type Permission, type Role } from './access.ts';

/**
 * What each permission lets someone do, as a capability rather than a
 * refusal. `PERMISSIONS` holds the sentence a 403 carries ("Only workspace
 * owners can manage billing"), which reads as a wall; choosing a role needs
 * the other direction, what this person will be able to do.
 */
export const PERMISSION_POWERS: Record<Permission, string> = {
  'workspace.manage': 'Change workspace settings',
  'workspace.delete': 'Delete the workspace',
  'workspace.export': 'Export the whole workspace',
  'members.invite': 'Invite people',
  'members.manage': 'Change roles and remove people',
  'jobs.manage': 'Manage everyone’s imports and jobs',
  'teams.manage': 'Change teams',
  'access.manage': 'Change who sees what',
  'schema.manage': 'Change objects and fields',
  'views.manage': 'Lock views and change locked ones',
  'records.purge': 'Delete records forever',
  'records.export': 'Export records',
  'forms.manage': 'Build, publish and pause forms',
  'api_keys.manage': 'Manage API keys',
  'webhooks.manage': 'Manage webhooks',
  'automations.manage': 'Manage automations',
  'audit.read': 'See the workspace’s history',
  'billing.manage': 'Manage billing',
  'support.grant': 'Let support into the workspace',
  'booking.manage': 'Make booking pages',
  'booking.admin': 'Change other people’s booking pages',
  'comments.manage': 'Delete other people’s comments',
  'security.manage': 'Change how people sign in',
};

/** One group of powers, as a person thinks about them rather than as the code names them. */
export interface PermissionArea {
  readonly id: string;
  readonly title: string;
  readonly permissions: readonly Permission[];
}

/**
 * The areas the powers are shown in, in the order a person meets them:
 * their own work first, the workspace's keys last. Every permission sits in
 * exactly one area (`role-powers.test.ts` holds that, so a new permission
 * can't quietly go unshown).
 */
export const PERMISSION_AREAS: readonly PermissionArea[] = [
  { id: 'records', title: 'Records', permissions: ['records.export', 'records.purge'] },
  { id: 'schema', title: 'Objects and fields', permissions: ['schema.manage', 'views.manage'] },
  { id: 'capture', title: 'Forms and booking', permissions: ['forms.manage', 'booking.manage', 'booking.admin'] },
  {
    id: 'people',
    title: 'People and access',
    permissions: [
      'members.invite',
      'members.manage',
      'teams.manage',
      'access.manage',
      'comments.manage',
      'jobs.manage',
    ],
  },
  {
    id: 'connections',
    title: 'Connections',
    permissions: ['api_keys.manage', 'webhooks.manage', 'automations.manage'],
  },
  {
    id: 'workspace',
    title: 'Workspace',
    permissions: [
      'workspace.manage',
      'security.manage',
      'audit.read',
      'billing.manage',
      'workspace.export',
      'support.grant',
      'workspace.delete',
    ],
  },
];

/**
 * What everyone in the workspace can do without holding any permission at
 * all. Said once, above the areas: a Member holds two permissions, which
 * reads as almost nothing until you know that seeing and changing records
 * isn't one of them. Object, field and record rules narrow this per person;
 * the sentence stays true of the role.
 */
export const EVERYONE_CAN = 'Everyone can see and change records, and make notes, tasks and comments.';

/** How much of an area a role holds. */
export type AreaStanding = 'all' | 'some' | 'none';

/** A role's standing in one area: how much of it they hold, and which powers they do and don't have. */
export interface AreaPowers {
  readonly area: PermissionArea;
  readonly standing: AreaStanding;
  /** The powers the role holds, in the area's order, in plain words. */
  readonly held: readonly string[];
  /** The powers it doesn't, in the area's order, so "what I can't do" is answerable too. */
  readonly withheld: readonly string[];
}

/**
 * What a role can do, area by area, derived from `ROLE_PERMISSIONS`. The one
 * read every screen that explains a role uses, so none of them can disagree
 * with the server or with each other.
 */
export function rolePowers(role: Role): readonly AreaPowers[] {
  const held = new Set<string>(ROLE_PERMISSIONS[role]);
  return PERMISSION_AREAS.map((area) => {
    const has = area.permissions.filter((permission) => held.has(permission));
    const hasnt = area.permissions.filter((permission) => !held.has(permission));
    const standing: AreaStanding = hasnt.length === 0 ? 'all' : has.length === 0 ? 'none' : 'some';
    return {
      area,
      standing,
      held: has.map((permission) => PERMISSION_POWERS[permission]),
      withheld: hasnt.map((permission) => PERMISSION_POWERS[permission]),
    };
  });
}

/** How many powers a role holds out of all of them, for the one line above the areas. */
export function roleReach(role: Role): { readonly held: number; readonly total: number } {
  return { held: ROLE_PERMISSIONS[role].length, total: Object.keys(PERMISSION_POWERS).length };
}
