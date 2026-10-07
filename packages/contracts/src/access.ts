// The access model's catalog (spec 0009): the roles, the fixed list of
// workspace permissions each role holds, the scopes an API key may hold, and
// `access.mine`. Roles are flat lists, never a hierarchy: a role holds exactly
// the permissions its row names, and adding one to a role never grants it to
// any other. The server checks every call on its own; the browser reads this
// same list only to hide controls a person can't use.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { WorkspaceScoped } from './workspaces.ts';

/** The roles a member can hold, from most to least power. `#23` may add a fourth. */
export const ROLES = ['owner', 'admin', 'member'] as const;

/** A member's role in a workspace. An unknown role grants nothing (the door refuses it). */
export const Role = z.enum(ROLES);
/** A member's role in a workspace. */
export type Role = z.infer<typeof Role>;

/** Each role's name as the screens show it. */
export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
} as const satisfies Record<Role, string>;

/**
 * Every workspace permission, with the sentence a refusal for it carries
 * (403 `FORBIDDEN`). A name the code doesn't list here grants nothing.
 */
export const PERMISSIONS = {
  'workspace.manage': { message: 'Only workspace owners and admins can change the workspace’s settings.' },
  'workspace.delete': { message: 'Only workspace owners can delete the workspace.' },
  'members.invite': { message: 'Only workspace owners and admins can invite people.' },
  'members.manage': { message: 'Only workspace owners and admins can change members’ roles or remove them.' },
  'jobs.manage': { message: 'Only workspace owners and admins can manage other people’s jobs.' },
  'teams.manage': { message: 'Only workspace owners and admins can change teams.' },
  'access.manage': { message: 'Only workspace owners and admins can change who sees what.' },
  'schema.manage': { message: 'Only workspace owners and admins can change objects and attributes.' },
  'views.manage': { message: 'Only workspace owners and admins can lock or change locked views.' },
  'records.purge': { message: 'Only workspace owners and admins can delete records forever.' },
  'records.export': { message: 'Your role can’t export records.' },
  'api_keys.manage': { message: 'Only workspace owners and admins can manage API keys.' },
  'webhooks.manage': { message: 'Only workspace owners and admins can manage webhooks.' },
  'automations.manage': { message: 'Only workspace owners and admins can manage automations.' },
  'audit.read': { message: 'Only workspace owners and admins can read the audit log.' },
  'workspace.export': { message: 'Only workspace owners can export the whole workspace.' },
  'billing.manage': { message: 'Only workspace owners can manage billing.' },
  'support.grant': { message: 'Only workspace owners can let support into the workspace.' },
} as const satisfies Record<string, { readonly message: string }>;

/** Every permission's name, in catalog order. */
export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as readonly (keyof typeof PERMISSIONS)[];

/** One workspace permission. */
export const Permission = z.enum(
  Object.keys(PERMISSIONS) as [keyof typeof PERMISSIONS, ...(keyof typeof PERMISSIONS)[]],
);
/** One workspace permission. */
export type Permission = z.infer<typeof Permission>;

/** The five permissions only an owner holds. Admins hold every other one. */
const OWNER_ONLY: readonly Permission[] = ['workspace.delete', 'workspace.export', 'billing.manage', 'support.grant'];

/**
 * Each role's permissions: the whole table, pinned by a test, so a change is
 * a reviewed change. The owner holds everything; an admin everything but the
 * owner only ones; a member exports what they can see.
 */
export const ROLE_PERMISSIONS = {
  owner: PERMISSION_NAMES,
  admin: PERMISSION_NAMES.filter((permission) => !OWNER_ONLY.includes(permission)),
  member: ['records.export'],
} as const satisfies Record<Role, readonly Permission[]>;

/**
 * The permissions an API key can never hold (#34): managing people, teams,
 * rules, billing and support access, and deleting the workspace stay with
 * people.
 */
export const KEY_FORBIDDEN_PERMISSIONS: readonly Permission[] = [
  'members.manage',
  'members.invite',
  'access.manage',
  'teams.manage',
  'billing.manage',
  'workspace.delete',
  'support.grant',
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

/** The refusal when a change would leave a live workspace with no active owner (409 `LAST_OWNER`). */
export const LAST_OWNER_MESSAGE = 'A workspace needs an owner. Make someone else an owner first.';

/** The caller's own access in a workspace: their role, its label, and their permissions. */
export const MyAccess = z.object({
  role: Role,
  roleLabel: z.string(),
  permissions: z.array(Permission),
});
/** The caller's own access in a workspace. */
export type MyAccess = z.infer<typeof MyAccess>;

/** The access namespace. `mine` answers the caller's own role and permissions; the screens hide controls from it. */
export const accessContract = {
  mine: oc.input(WorkspaceScoped).output(MyAccess),
};
