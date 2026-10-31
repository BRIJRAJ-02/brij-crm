// The access model's catalog (spec 0009): the roles, the fixed list of
// workspace permissions each role holds, the scopes an API key may hold, and
// `access.mine`. Roles are flat lists, never a hierarchy: a role holds exactly
// the permissions its row names, and adding one to a role never grants it to
// any other. The server checks every call on its own; the browser reads this
// same list only to hide controls a person can't use.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { ROLES } from './roles.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

export { ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES } from './roles.ts';

/** A member's role in a workspace. An unknown role grants nothing (the door refuses it). */
export const Role = z.enum(ROLES);
/** A member's role in a workspace. */
export type Role = z.infer<typeof Role>;

/** Where a permission sits on the role screens (spec 0037, the catalog). */
export const PERMISSION_GROUPS = ['Workspace', 'People', 'Data', 'Scheduling', 'Integrations', 'Owner only'] as const;
/** One of the catalog's groups. */
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/**
 * Who may ever hold a permission (spec 0037, AC-1226): `owner`, only the Owner role; `admin`, Owner and Admin only,
 * never a custom role; `any`, the built in roles as the table says, and any custom role (spec 0037, job J9).
 */
export const GRANT_LEVELS = ['owner', 'admin', 'any'] as const;
/** One grant level. */
export type GrantLevel = (typeof GRANT_LEVELS)[number];

/** One catalog entry: the sentence a refusal carries, and what the role screens show (spec 0037, AC-1226). */
export interface PermissionEntry {
  readonly message: string;
  readonly label: string;
  readonly description: string;
  readonly group: PermissionGroup;
  readonly grant: GrantLevel;
}

/**
 * Every workspace permission (spec 0009; spec 0037, AC-1226 and AC-1227): the sentence a refusal for it carries (403
 * `FORBIDDEN`), its label, one line on what it allows, its group and its grant level. A name the code doesn't list
 * here grants nothing.
 */
export const PERMISSIONS = {
  'workspace.manage': {
    message: 'Only workspace owners and admins can change the workspace’s settings.',
    label: 'Change workspace settings',
    description: 'Rename the workspace and change its time zone, email domains and calendar settings.',
    group: 'Workspace',
    grant: 'admin',
  },
  'workspace.delete': {
    message: 'Only workspace owners can delete the workspace.',
    label: 'Delete the workspace',
    description: 'Delete the workspace and everything in it.',
    group: 'Owner only',
    grant: 'owner',
  },
  'members.invite': {
    message: 'Only workspace owners and admins can invite people.',
    label: 'Invite people',
    description: 'Invite people into any role but Owner (owners invite owners too).',
    group: 'People',
    grant: 'admin',
  },
  'members.manage': {
    message: 'Only workspace owners and admins can change members’ roles or remove them.',
    label: 'Change roles and remove people',
    description: 'Change anyone’s role and remove people, within the owner rules.',
    group: 'People',
    grant: 'admin',
  },
  'jobs.manage': {
    message: 'Only workspace owners and admins can manage other people’s jobs.',
    label: 'Manage everyone’s background jobs',
    description: 'See, stop and confirm background jobs anyone started.',
    group: 'Workspace',
    grant: 'admin',
  },
  'teams.manage': {
    message: 'Only workspace owners and admins can change teams.',
    label: 'Manage teams',
    description: 'Create teams and change who is in them.',
    group: 'People',
    grant: 'admin',
  },
  'access.manage': {
    message: 'Only workspace owners and admins can change who sees what.',
    label: 'Manage roles and access',
    description: 'Make and change roles, and set who sees which objects, fields and records.',
    group: 'People',
    grant: 'admin',
  },
  'schema.manage': {
    message: 'Only workspace owners and admins can change objects and attributes.',
    label: 'Change objects and attributes',
    description: 'Add and change objects, attributes, options and relationships.',
    group: 'Data',
    grant: 'any',
  },
  'views.manage': {
    message: 'Only workspace owners and admins can lock or change locked views.',
    label: 'Manage shared views',
    description: 'Lock shared views and change locked ones.',
    group: 'Data',
    grant: 'any',
  },
  // Lists (spec 0048, decision 1): members make their own working sets; managing someone else's needs schema.manage.
  'lists.manage': {
    message: 'Your role can’t make lists.',
    label: 'Make lists',
    description: 'Make lists and pipelines, and change the ones they made.',
    group: 'Data',
    grant: 'any',
  },
  'records.purge': {
    message: 'Only workspace owners and admins can delete records forever.',
    label: 'Delete records forever',
    description: 'Empty the trash and delete records for good.',
    group: 'Data',
    grant: 'any',
  },
  // Forms (spec 0023): building, publishing and pausing forms, and acting on their submissions.
  'forms.manage': {
    message: 'Only workspace owners and admins can change forms and their submissions.',
    label: 'Build forms',
    description: 'Build, publish and pause forms, and handle their submissions.',
    group: 'Data',
    grant: 'any',
  },
  'records.export': {
    message: 'Your role can’t export records.',
    label: 'Export records',
    description: 'Export the records and fields you can see.',
    group: 'Data',
    grant: 'any',
  },
  'api_keys.manage': {
    message: 'Only workspace owners and admins can manage API keys.',
    label: 'Manage API keys',
    description: 'Create and revoke API keys.',
    group: 'Integrations',
    grant: 'admin',
  },
  'webhooks.manage': {
    message: 'Only workspace owners and admins can manage webhooks.',
    label: 'Manage webhooks',
    description: 'Subscribe and manage webhooks.',
    group: 'Integrations',
    grant: 'admin',
  },
  'automations.manage': {
    message: 'Only workspace owners and admins can manage automations.',
    label: 'Build automations',
    description: 'Build and run automations.',
    group: 'Data',
    grant: 'any',
  },
  'audit.read': {
    message: 'Only workspace owners and admins can see workspace changes.',
    label: 'Read the audit log',
    description: 'See who changed what across the workspace.',
    group: 'Workspace',
    grant: 'admin',
  },
  'workspace.export': {
    message: 'Only workspace owners can export the whole workspace.',
    label: 'Export the whole workspace',
    description: 'Download a full copy of the workspace.',
    group: 'Owner only',
    grant: 'owner',
  },
  'billing.manage': {
    message: 'Only workspace owners can manage billing.',
    label: 'Manage billing',
    description: 'Change the plan and payment details.',
    group: 'Owner only',
    grant: 'owner',
  },
  'support.grant': {
    message: 'Only workspace owners can let support into the workspace.',
    label: 'Let support in',
    description: 'Give support staff access to the workspace.',
    group: 'Owner only',
    grant: 'owner',
  },
  // Booking pages (spec 0025): your own pages, and every page in the workspace (team pages, others'). Spec 0037
  // (decision 12): `booking.admin` is for things (pages, team pages, rotations); people's time is `schedule.*`.
  'booking.manage': {
    message: 'Your role can’t make booking pages.',
    label: 'Take bookings',
    description: 'Make your own booking pages, take bookings and block your own time.',
    group: 'Scheduling',
    grant: 'any',
  },
  'booking.admin': {
    message: 'Only workspace owners and admins can change other people’s booking pages.',
    label: 'Manage every booking page',
    description: 'Change any booking page, team pages and rotations.',
    group: 'Scheduling',
    grant: 'any',
  },
  // Comments (spec 0038, decision 4): removing another member's comment. Nobody edits another's.
  'comments.manage': {
    message: 'Only workspace owners and admins can delete other people’s comments.',
    label: 'Delete anyone’s comments',
    description: 'Delete comments other people wrote.',
    group: 'Data',
    grant: 'any',
  },
  // Account security (spec 0033, AC-893): the workspace's sign in rules (require two factor, session length, sign out
  // everyone). Owners only (owner decision 7).
  'security.manage': {
    message: 'Only workspace owners can change how people sign in to this workspace.',
    label: 'Change how people sign in',
    description: 'Require two factor sign in, set how long sessions last and sign everyone out.',
    group: 'Owner only',
    grant: 'owner',
  },
  // Whose time a person may see or change (spec 0037, AC-1227): the `schedule.*` four are read only through
  // `packages/core/src/access/scheduling.ts`, never by a `can(…)` anywhere else (AC-1221). `availability.own` is the
  // member's own hours (AC-1255, AC-1260).
  'availability.own': {
    message: 'Your hours are set by the people who manage your scheduling.',
    label: 'Change your own hours',
    description: 'Change your own schedules and date overrides.',
    group: 'Scheduling',
    grant: 'any',
  },
  'schedule.view': {
    message: 'Your role can’t see other people’s scheduling.',
    label: 'See everyone’s scheduling',
    description: 'See every member’s calendar column, hours, time off and bookings.',
    group: 'Scheduling',
    grant: 'any',
  },
  'schedule.view.team': {
    message: 'Your role can’t see your teams’ scheduling.',
    label: 'See their teams’ scheduling',
    description: 'The same, for people who share a team with them.',
    group: 'Scheduling',
    grant: 'any',
  },
  'schedule.manage': {
    message: 'Your role can’t change other people’s scheduling.',
    label: 'Manage everyone’s scheduling',
    description: 'Change anyone’s hours, time off and limits, and book, move or reassign their meetings.',
    group: 'Scheduling',
    grant: 'any',
  },
  'schedule.manage.team': {
    message: 'Your role can’t change your teams’ scheduling.',
    label: 'Manage their teams’ scheduling',
    description: 'The same, for people who share a team with them.',
    group: 'Scheduling',
    grant: 'any',
  },
  'routing.manage': {
    message: 'Only people who set up routing can change it.',
    label: 'Set up routing',
    description: 'Change the routing setup, skills and learning, and see every routing decision.',
    group: 'Scheduling',
    grant: 'admin',
  },
} as const satisfies Record<string, PermissionEntry>;

/** Every permission's name, in catalog order. */
export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as readonly (keyof typeof PERMISSIONS)[];

/** One workspace permission. */
export const Permission = z.enum(
  Object.keys(PERMISSIONS) as [keyof typeof PERMISSIONS, ...(keyof typeof PERMISSIONS)[]],
);
/** One workspace permission. */
export type Permission = z.infer<typeof Permission>;

/**
 * The permissions only an owner holds: every one of grant `owner` (five, since spec 0033 added `security.manage`).
 * The owner role itself, an owner only power too, follows the owner rules.
 */
const OWNER_ONLY: readonly Permission[] = PERMISSION_NAMES.filter((name) => PERMISSIONS[name].grant === 'owner');

/**
 * Each role's permissions: the whole table, pinned by a test, so a change is
 * a reviewed change. The owner holds everything; an admin everything but the
 * owner only ones; a guest nothing; a member exports what they can see, makes their own
 * booking pages and changes their own hours (spec 0037, AC-1227).
 */
export const ROLE_PERMISSIONS = {
  owner: PERMISSION_NAMES,
  admin: PERMISSION_NAMES.filter((permission) => !OWNER_ONLY.includes(permission)),
  member: ['lists.manage', 'records.export', 'booking.manage', 'availability.own'],
  // A guest holds nothing (spec 0031, AC-828): they read what the access rules share with them, and no more.
  guest: [],
} as const satisfies Record<Role, readonly Permission[]>;

/**
 * The permissions an API key can never hold (#34): managing people, teams,
 * rules, billing and support access, and deleting the workspace stay with
 * people. So does reading the audit log (spec 0046): History names invitees'
 * addresses and askers' names, which a key, never holding `members.invite`,
 * may not read either.
 */
export const KEY_FORBIDDEN_PERMISSIONS: readonly Permission[] = [
  'members.manage',
  'members.invite',
  'access.manage',
  'teams.manage',
  'billing.manage',
  'workspace.delete',
  'support.grant',
  'security.manage',
  'audit.read',
  // Spec 0037, decision 7: reach over owners' and admins' scheduling comes only from the built in Owner and Admin
  // roles, so a key never holds whose time it may see or change.
  'schedule.view',
  'schedule.view.team',
  'schedule.manage',
  'schedule.manage.team',
  // Spec 0048: list definitions stay with people; a key reads and writes entries through `data.*`.
  'lists.manage',
];

/** The data level a key holds on every object, as a scope. A key with neither reads and writes no data. */
export const KEY_DATA_SCOPES = ['data.read', 'data.write'] as const;

/**
 * The key scope catalog (#34): every permission a key may hold, then the two
 * data levels. A scope outside this list grants nothing.
 */
export const KEY_SCOPES: readonly string[] = [
  ...PERMISSION_NAMES.filter((permission) => !KEY_FORBIDDEN_PERMISSIONS.includes(permission)),
  ...KEY_DATA_SCOPES,
];

/**
 * The refusal (403 `FORBIDDEN`) when someone who isn't an owner tries to make
 * someone an owner, or to change or remove an owner: the owner rules, which no
 * permission grants.
 */
export const OWNER_RULES_MESSAGE = 'Only an owner can make someone an owner, or change or remove an owner.';

/** The refusal when a change would leave a live workspace with no active owner (409 `LAST_OWNER`). */
export const LAST_OWNER_MESSAGE = 'A workspace needs an owner. Make someone else an owner first.';

/**
 * The caller's own access in a workspace: their member id (what actor values
 * and change events name them by), their role, its label, and their permissions.
 */
export const MyAccess = z.object({
  memberId: Uuid,
  role: Role,
  roleLabel: z.string(),
  permissions: z.array(Permission),
  /** The custom role the caller holds (spec 0037, AC-1235), when any: `role` is then `member`, `roleLabel` its name. */
  customRoleId: Uuid.optional(),
  /** The teams the caller is in (spec 0031, AC-825); absent from an answer that predates teams. */
  teamIds: z.array(Uuid).optional(),
  /**
   * Whose scheduling the caller reaches beyond their own (spec 0037, AC-1261), for the screens to show their
   * pickers: someone else at all (See, Manage), and everyone. The server checks every call through the reach anyway.
   */
  scheduling: z
    .object({
      seesOthers: z.boolean(),
      managesOthers: z.boolean(),
      seesEveryone: z.boolean(),
      managesEveryone: z.boolean(),
    })
    .optional(),
});
/** The caller's own access in a workspace. */
export type MyAccess = z.infer<typeof MyAccess>;

/** The access namespace. `mine` answers the caller's own role and permissions; the screens hide controls from it. */
export const accessContract = {
  mine: oc.input(WorkspaceScoped).output(MyAccess),
};

/**
 * One role a person may hold, as every role picker offers it (spec 0037,
 * AC-1439): its id, its name and one line on what it can do. Built in roles
 * are named by their role; custom roles (spec 0037, AC-1242) by their uuid,
 * with no `builtIn`.
 */
export const RoleOption = z.object({
  id: z.string().min(1).max(64),
  label: z.string(),
  description: z.string(),
  /** The built in role this is; absent for a custom role. */
  builtIn: Role.optional(),
});
/** One role a person may hold. */
export type RoleOption = z.infer<typeof RoleOption>;

/**
 * The workspace's roles, most power first, then its custom roles in their order, and the one new people get unless
 * someone picks another: `member`, or the custom role marked "Default for new people" (AC-1237).
 */
export const RolesList = z.object({
  roles: z.array(RoleOption),
  defaultRole: z.string(),
});
/** The workspace's roles. */
export type RolesList = z.infer<typeof RolesList>;

/** The most custom roles a workspace may have (spec 0037, AC-1228). */
export const CUSTOM_ROLES_MAX = 20;
/** The longest custom role name (AC-1228). */
export const ROLE_NAME_MAX = 40;
/** The longest custom role description (AC-1228). */
export const ROLE_DESCRIPTION_MAX = 200;

/**
 * Who may ever hold a permission (AC-1244): its catalog grant level, and `owner` for a name the catalog doesn't list
 * or an entry with none, so an unknown or half added permission is never held by anyone but the Owner role.
 */
export function grantOf(name: string): GrantLevel {
  if (!Object.hasOwn(PERMISSIONS, name)) return 'owner';
  const entry: unknown = (PERMISSIONS as Readonly<Record<string, unknown>>)[name];
  const grant = typeof entry === 'object' && entry !== null && 'grant' in entry ? entry.grant : undefined;
  return grant === 'admin' || grant === 'any' ? grant : 'owner';
}

/** The permissions a custom role may hold (AC-1228): every catalog permission of grant `any`, in catalog order. */
export const CUSTOM_ROLE_PERMISSIONS: readonly Permission[] = PERMISSION_NAMES.filter(
  (name) => grantOf(name) === 'any',
);

/**
 * A custom role's stored permission names as the permissions it holds (AC-1234, AC-1248): only catalog names of
 * grant `any`, each once, in catalog order. Anything else stored, an admin or owner permission or a name the code
 * doesn't know, grants nothing.
 */
export function customRolePermissions(stored: readonly string[]): readonly Permission[] {
  return CUSTOM_ROLE_PERMISSIONS.filter((name) => stored.includes(name));
}

/**
 * A custom role's data access (AC-1229): `write`, Read and write, the default; `read`, Read only, so its holders
 * create, edit and delete no record.
 */
export const DataAccess = z.enum(['write', 'read']);
/** A custom role's data access. */
export type DataAccess = z.infer<typeof DataAccess>;

/** What a new custom role starts from (AC-1228, AC-1229): Member, the Viewer preset (Read only, nothing), or a custom role. */
export const StartFrom = z.union([z.literal('member'), z.literal('viewer'), Uuid]);
/** What a new custom role starts from. */
export type StartFrom = z.infer<typeof StartFrom>;

/** A custom role's name (AC-1228): 1 to 40 characters, trimmed. The reserved names are refused by the server. */
export const RoleName = z
  .string()
  .trim()
  .min(1, { error: 'Name the role.' })
  .max(ROLE_NAME_MAX, { error: `Use ${String(ROLE_NAME_MAX)} characters or fewer.` });

/** A custom role's description (AC-1228): up to 200 characters. */
export const RoleDescription = z
  .string()
  .trim()
  .max(ROLE_DESCRIPTION_MAX, { error: `Use ${String(ROLE_DESCRIPTION_MAX)} characters or fewer.` });

/** A stored permission name as a role write sends it; the server keeps it to the catalog's `any` ones. */
const PermissionName = z.string().min(1).max(64);

/**
 * One role as the Roles page and Compare show it (spec 0037, `roles.overview`, AC-1239): built in roles by their role
 * (permissions from the pinned table, `builtIn` set), custom roles by their uuid with their stored permissions kept
 * to the ones they hold. `holders` counts its active members; a guest reading it gets names only (no permissions, no
 * counts).
 */
export const RoleDefinition = z.object({
  id: z.string().min(1).max(64),
  label: z.string(),
  description: z.string(),
  builtIn: Role.optional(),
  permissions: z.array(Permission),
  dataAccess: DataAccess,
  holders: z.number().int().min(0).optional(),
  isDefault: z.boolean(),
  /** A custom role's version, for `roles.update`'s `STALE` check; absent for a built in role. */
  updatedAt: z.iso.datetime({ offset: true }).optional(),
});
/** One role as the Roles page shows it. */
export type RoleDefinition = z.infer<typeof RoleDefinition>;

/** Every role, built in first then custom in their order, and the default for new people (AC-1239). */
export const RolesOverview = z.object({
  roles: z.array(RoleDefinition),
  defaultRole: z.string(),
});
/** Every role. */
export type RolesOverview = z.infer<typeof RolesOverview>;

/** One custom role, by id, to read. */
export const RoleRead = WorkspaceScoped.extend({ roleId: Uuid });
/** One custom role, by id. */
export type RoleRead = z.infer<typeof RoleRead>;

/** A new custom role (AC-1228): its own id (so a retry makes one role), name, description, permissions and start. */
export const CreateRoleInput = WorkspaceScoped.extend({
  id: Uuid,
  name: RoleName,
  description: RoleDescription.optional(),
  permissions: z.array(PermissionName).max(64),
  dataAccess: DataAccess,
  startFrom: StartFrom,
  mutationId: Uuid,
});
/** A new custom role. */
export type CreateRoleInput = z.infer<typeof CreateRoleInput>;

/** A change to a custom role (AC-1231): what is given changes; `updatedAt` is the version the editor read. */
export const UpdateRoleInput = WorkspaceScoped.extend({
  roleId: Uuid,
  name: RoleName.optional(),
  description: RoleDescription.optional(),
  permissions: z.array(PermissionName).max(64).optional(),
  dataAccess: DataAccess.optional(),
  updatedAt: z.iso.datetime({ offset: true }),
  mutationId: Uuid,
});
/** A change to a custom role. */
export type UpdateRoleInput = z.infer<typeof UpdateRoleInput>;

/** A role after a change, and how many people it changed for. */
export const RoleUpdated = z.object({ role: RoleDefinition, affectedMembers: z.number().int().min(0) });
/** A role after a change. */
export type RoleUpdated = z.infer<typeof RoleUpdated>;

/** A copy of a custom role (AC-1232), under its own id. */
export const DuplicateRoleInput = WorkspaceScoped.extend({ roleId: Uuid, id: Uuid, mutationId: Uuid });
/** A copy of a custom role. */
export type DuplicateRoleInput = z.infer<typeof DuplicateRoleInput>;

/** Deleting a custom role (AC-1238): where its people and open invitations go, Member or another custom role. */
export const DeleteRoleInput = WorkspaceScoped.extend({
  roleId: Uuid,
  moveTo: z.union([z.literal('member'), Uuid]),
  mutationId: Uuid,
});
/** Deleting a custom role. */
export type DeleteRoleInput = z.infer<typeof DeleteRoleInput>;

/** What a delete moved: its people (open invitations move too, uncounted). */
export const RoleDeleted = z.object({ moved: z.number().int().min(0) });
/** What a delete moved. */
export type RoleDeleted = z.infer<typeof RoleDeleted>;

/** The role new people get (AC-1237): a custom role, or `null` for Member. */
export const SetDefaultRoleInput = WorkspaceScoped.extend({ roleId: Uuid.nullable(), mutationId: Uuid });
/** The role new people get. */
export type SetDefaultRoleInput = z.infer<typeof SetDefaultRoleInput>;

/** A custom role moved to a place among the custom roles (0 first). */
export const MoveRoleInput = WorkspaceScoped.extend({
  roleId: Uuid,
  position: z
    .number()
    .int()
    .min(0)
    .max(CUSTOM_ROLES_MAX - 1),
  mutationId: Uuid,
});
/** A custom role moved. */
export type MoveRoleInput = z.infer<typeof MoveRoleInput>;

/**
 * The roles (spec 0037, AC-1439 and job J9). `list` is what every role picker offers (the Invite dialog, the Members
 * page, the invite link and join approvals); `overview` and `get` the Roles page and Compare; any member may read
 * them. Every write is `access.manage`'s and answers the role as it stands.
 */
export const rolesContract = {
  list: oc.input(WorkspaceScoped).output(RolesList),
  overview: oc.input(WorkspaceScoped).output(RolesOverview),
  get: oc.input(RoleRead).output(RoleDefinition),
  create: oc.input(CreateRoleInput).output(RoleDefinition),
  update: oc.input(UpdateRoleInput).output(RoleUpdated),
  duplicate: oc.input(DuplicateRoleInput).output(RoleDefinition),
  delete: oc.input(DeleteRoleInput).output(RoleDeleted),
  setDefault: oc.input(SetDefaultRoleInput).output(z.void()),
  move: oc.input(MoveRoleInput).output(z.void()),
};
