// What a member holds now, read under a share lock inside a write's own transaction (spec 0037, J9): the rechecks a
// write makes after the door let the actor in, so a role changed meanwhile counts. A custom role holder holds the
// role's stored permissions kept to grant `any` ones; a built in role its pinned list; anything unknown nothing.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { customRolePermissions, ROLE_PERMISSIONS, type Permission, type Role } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { isRole } from '../access/policy.ts';

const { members, workspaceRoles } = schema;

/** One active member as a recheck reads them: their role, and the permissions they hold now. */
export interface HeldNow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly permissions: readonly Permission[];
}

/** A row's permissions (pure): a custom role's grant `any` ones, a built in role's pinned list, else none. */
export function heldPermissions(row: {
  readonly role: string;
  readonly customRoleId: string | null;
  readonly customPermissions: readonly string[] | null;
}): readonly Permission[] {
  if (row.customRoleId !== null) {
    return row.role === 'member' && row.customPermissions !== null ? customRolePermissions(row.customPermissions) : [];
  }
  return isRole(row.role) ? (ROLE_PERMISSIONS[row.role as Role] as readonly Permission[]) : [];
}

/** An active member and what they hold now, held `for share` (the member row), or undefined. */
export async function memberHeldNow(
  tx: WorkspaceTx,
  workspaceId: string,
  memberId: string,
): Promise<HeldNow | undefined> {
  const [row] = await tx
    .select({
      id: members.id,
      name: members.name,
      role: members.role,
      customRoleId: members.customRoleId,
      customPermissions: workspaceRoles.permissions,
    })
    .from(members)
    .leftJoin(
      workspaceRoles,
      and(eq(workspaceRoles.workspaceId, members.workspaceId), eq(workspaceRoles.id, members.customRoleId)),
    )
    .where(and(eq(members.workspaceId, workspaceId), eq(members.id, memberId), eq(members.status, 'active')))
    .for('share', { of: members });
  if (row === undefined) return undefined;
  return { id: row.id, name: row.name, role: row.role, permissions: heldPermissions(row) };
}

/**
 * The active members who hold `permission` now, by their built in role or their custom role (spec 0037): who a
 * notice for that permission's holders goes to. One read.
 */
export async function holdersOf(
  tx: WorkspaceTx,
  workspaceId: string,
  permission: Permission,
): Promise<readonly { readonly id: string; readonly email: string }[]> {
  const builtIn = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission),
  );
  const rows = await tx
    .select({ id: members.id, email: members.email })
    .from(members)
    .leftJoin(
      workspaceRoles,
      and(eq(workspaceRoles.workspaceId, members.workspaceId), eq(workspaceRoles.id, members.customRoleId)),
    )
    .where(
      and(
        eq(members.workspaceId, workspaceId),
        eq(members.status, 'active'),
        sql`(
          (${members.customRoleId} is null and ${inArray(members.role, builtIn.length === 0 ? ['owner'] : builtIn)})
          or (${members.customRoleId} is not null and ${members.role} = 'member'
            and ${permission} = any(${workspaceRoles.permissions}))
        )`,
      ),
    );
  return rows;
}
