// The Roles screens' rules as plain functions (spec 0037, job J9): which permissions a role's page shows in which
// group, how the two scheduling Selects read and write the catalog (AC-1241), what a save changes, and whether a
// change takes access away (so it asks first). No React or library imports, so tests and loaders can use them.
import {
  CUSTOM_ROLE_PERMISSIONS,
  grantOf,
  PERMISSION_GROUPS,
  PERMISSION_NAMES,
  PERMISSIONS,
  type DataAccess,
  type Permission,
  type PermissionGroup,
  type RoleDefinition,
} from '@crm/data';

/** The four scheduling reach permissions, which the role page shows as two Selects rather than four rows. */
export const REACH_PERMISSIONS: readonly Permission[] = [
  'schedule.view.team',
  'schedule.view',
  'schedule.manage.team',
  'schedule.manage',
];

/** How far a role reaches into other people's scheduling, as the Selects offer it. */
export type Reach = 'self' | 'team' | 'everyone';

const REACH_RANK: Readonly<Record<Reach, number>> = { self: 0, team: 1, everyone: 2 };

/** The See and Manage reach a set of permissions holds (AC-1241). */
export function reachOf(permissions: readonly string[]): { readonly see: Reach; readonly manage: Reach } {
  const level = (everyone: Permission, team: Permission): Reach =>
    permissions.includes(everyone) ? 'everyone' : permissions.includes(team) ? 'team' : 'self';
  return {
    see: level('schedule.view', 'schedule.view.team'),
    manage: level('schedule.manage', 'schedule.manage.team'),
  };
}

/**
 * The permissions with the two Selects' reach written in (AC-1241): Their teams writes the `.team` permission,
 * Everyone the plain one. A Manage wider than See widens See to match, and narrowing See narrows Manage, so a role
 * never manages people it can't see. `changed` says which Select moved, so the other follows it.
 */
export function withReach(
  permissions: readonly Permission[],
  reach: { readonly see: Reach; readonly manage: Reach },
  changed: 'see' | 'manage',
): readonly Permission[] {
  let { see, manage } = reach;
  if (REACH_RANK[manage] > REACH_RANK[see]) {
    if (changed === 'manage') see = manage;
    else manage = see;
  }
  const kept = permissions.filter((each) => !REACH_PERMISSIONS.includes(each));
  const written: Permission[] = [
    ...(see === 'everyone' ? (['schedule.view'] as const) : see === 'team' ? (['schedule.view.team'] as const) : []),
    ...(manage === 'everyone'
      ? (['schedule.manage'] as const)
      : manage === 'team'
        ? (['schedule.manage.team'] as const)
        : []),
  ];
  return CUSTOM_ROLE_PERMISSIONS.filter((each) => kept.includes(each) || written.includes(each));
}

/** One permission row on a role's page. */
export interface PermissionRow {
  readonly name: Permission;
  readonly label: string;
  readonly description: string;
  /** A custom role may hold it (grant `any`); otherwise only built in roles can. */
  readonly isHoldable: boolean;
}

/** One group of rows on a role's page, in the catalog's group order; Owner only is left out of custom roles. */
export interface PermissionSection {
  readonly group: PermissionGroup;
  readonly rows: readonly PermissionRow[];
}

/**
 * The role page's sections (AC-1240): each catalog group with its permissions as rows, the four scheduling reach
 * permissions left out (they are the two Selects). `forCustom` drops the Owner only group: a custom role can never
 * hold any of it, so five locked rows would only be noise.
 */
export function permissionSections(forCustom: boolean): readonly PermissionSection[] {
  const names = PERMISSION_NAMES;
  return PERMISSION_GROUPS.filter((group) => !(forCustom && group === 'Owner only'))
    .map((group) => ({
      group,
      rows: names
        .filter((name) => PERMISSIONS[name].group === group && !REACH_PERMISSIONS.includes(name))
        .map((name) => ({
          name,
          label: PERMISSIONS[name].label,
          description: PERMISSIONS[name].description,
          isHoldable: grantOf(name) === 'any',
        })),
    }))
    .filter((section) => section.rows.length > 0);
}

/** A role page's draft: what the role will be once saved. */
export interface RoleDraft {
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly Permission[];
  readonly dataAccess: DataAccess;
}

/** The draft a role starts from: as it stands. */
export function draftOf(role: RoleDefinition): RoleDraft {
  return {
    name: role.label,
    description: role.description,
    permissions: CUSTOM_ROLE_PERMISSIONS.filter((each) => role.permissions.includes(each)),
    dataAccess: role.dataAccess,
  };
}

/** What a save sends: only what changed from the role as it stands. */
export function changesOf(
  role: RoleDefinition,
  draft: RoleDraft,
): {
  readonly name?: string;
  readonly description?: string;
  readonly permissions?: readonly Permission[];
  readonly dataAccess?: DataAccess;
} {
  const was = draftOf(role);
  const samePermissions =
    was.permissions.length === draft.permissions.length &&
    was.permissions.every((each) => draft.permissions.includes(each));
  return {
    ...(draft.name.trim() === was.name ? {} : { name: draft.name.trim() }),
    ...(draft.description.trim() === was.description ? {} : { description: draft.description.trim() }),
    ...(samePermissions ? {} : { permissions: draft.permissions }),
    ...(draft.dataAccess === was.dataAccess ? {} : { dataAccess: draft.dataAccess }),
  };
}

/** Whether a save takes anything away from the role's people: a permission off, or Read only (it asks first). */
export function takesAway(role: RoleDefinition, draft: RoleDraft): boolean {
  const was = draftOf(role);
  return (
    was.permissions.some((each) => !draft.permissions.includes(each)) ||
    (was.dataAccess === 'write' && draft.dataAccess === 'read')
  );
}

/**
 * Whether moving someone from one role to another takes access away (the Members page asks first): any permission
 * they hold now and wouldn't, or Read and write becoming Read only. Built in roles by their pinned permissions;
 * an unknown role counts as taking away (it asks).
 */
export function roleTakesAway(roles: readonly RoleDefinition[], from: string, to: string): boolean {
  const before = roles.find((role) => role.id === from);
  const after = roles.find((role) => role.id === to);
  if (before === undefined || after === undefined) return true;
  if (before.builtIn === 'owner' || (before.builtIn === 'admin' && after.builtIn !== 'owner')) return true;
  if (before.dataAccess === 'write' && after.dataAccess === 'read') return true;
  return before.permissions.some((each) => !after.permissions.includes(each));
}

/** The Viewer preset's start (AC-1229): Read only and no permissions. */
export const VIEWER_START = { permissions: [] as readonly Permission[], dataAccess: 'read' as DataAccess };

/** What a new role starts with from its Start from: Member's permissions, nothing (Viewer), or a custom role's. */
export function startOf(
  roles: readonly RoleDefinition[],
  from: string,
): { readonly permissions: readonly Permission[]; readonly dataAccess: DataAccess } {
  if (from === 'viewer') return VIEWER_START;
  const role = roles.find((each) => each.id === from) ?? roles.find((each) => each.builtIn === 'member');
  return {
    permissions: CUSTOM_ROLE_PERMISSIONS.filter((each) => role?.permissions.includes(each) ?? false),
    dataAccess: role?.dataAccess ?? 'write',
  };
}

/** The roles a person's role Select offers `actor` (AC-1242): the built in ones they may grant, then custom roles. */
export function grantableIds(builtIns: readonly string[], roles: readonly RoleDefinition[]): readonly string[] {
  const custom = builtIns.includes('member') ? roles.filter((role) => role.builtIn === undefined) : [];
  return [...builtIns, ...custom.map((role) => role.id)];
}
