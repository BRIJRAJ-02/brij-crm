// `@crm/contracts/roles`: the roles and their names as the screens show them
// (spec 0009; spec 0031), as plain lists with no Zod, so the browser's data
// layer can label a role without pulling the schema library into its load.

/** The roles a member can hold, from most to least power. */
export const ROLES = ['owner', 'admin', 'member', 'guest'] as const;

/** One role's name. */
export type RoleName = (typeof ROLES)[number];

/** Each role's name as the screens show it. */
export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
} as const satisfies Record<RoleName, string>;

/** Each role in one line, as the role pickers describe it (spec 0031, the Invite dialog). */
export const ROLE_DESCRIPTIONS = {
  owner: 'Everything, including billing and deleting the workspace.',
  admin: 'Manages members, settings and every record.',
  member: 'Works with records; can’t change settings or members.',
  guest: 'Sees only what’s shared with them; takes no seat.',
} as const satisfies Record<RoleName, string>;
