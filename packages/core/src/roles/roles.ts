// Custom roles (spec 0037, job J9, AC-1228 to AC-1241): a workspace's own roles, built from the permission catalog.
// Owner, Admin, Member and Guest stay pinned in code (`ROLE_PERMISSIONS`); a custom role is a row of
// `workspace_roles`, always based on Member, holding only permissions of grant `any` and a data access, Read and
// write or Read only. Every member reads the roles (a guest their names only); `access.manage` makes and changes
// them. Every write stores its audit row, and a change that touches people stores one `access` row naming them, so
// their screens read again under the role as it now stands (spec 0009, AC-146).
//
// Who holds a role changes in `members.ts` (`setMemberRole`, `setMemberRoles`); deleting a role moves its holders
// and open invitations here, in the delete's own transaction.
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  CUSTOM_ROLE_PERMISSIONS,
  CUSTOM_ROLES_MAX,
  customRolePermissions,
  grantOf,
  PERMISSIONS,
  ROLE_DESCRIPTION_MAX,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_NAME_MAX,
  ROLE_PERMISSIONS,
  ROLES,
  type DataAccess,
  type Permission,
  type RoleDefinition,
  type RolesList,
  type RolesOverview,
  type StartFrom,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { checkScope, type EngineScope } from '../access/mint.ts';
import { customRoleLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { touched } from '../engine/definitions.ts';
import { checkId, isUuid } from '../engine/ids.ts';
import { inputInvalid, postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { writeAudit, type AuditSource } from '../members/audit.ts';
import { delegatesReachedBy } from '../scheduling/delegations.ts';

const { invitations, members, workspaceRoles } = schema;

/** What every role write takes beside its input: where the request came from, for the audit row. */
export interface RoleWriteOptions {
  readonly source?: AuditSource;
}

/** The answer for a custom role that doesn't exist here. */
export const ROLE_NOT_FOUND = "That role doesn't exist.";
/** AC-1228's refusal for a built in role's name. */
export const ROLE_NAME_RESERVED_MESSAGE = 'Owner, Admin, Member and Guest are built in roles. Pick another name.';
/** AC-1228's refusal for the 21st role. */
export const ROLE_LIMIT_MESSAGE = `A workspace can have at most ${String(CUSTOM_ROLES_MAX)} custom roles.`;
/** AC-1238's refusal for a delete moving its people somewhere they can't go. */
export const MOVE_TO_INVALID_MESSAGE = 'Pick Member or another custom role.';
const NAME_TAKEN_MESSAGE = 'Another role has that name. Pick another.';
const STALE_MESSAGE = 'This role was changed in another tab or by someone else. Reload it to see.';

/** AC-1228's refusal for a permission only built in roles may hold, naming it. */
export function permissionNotAllowed(label: string): string {
  return `Custom roles can't hold ${label}. Only built in roles can.`;
}

/** A custom role row as these services read it. */
interface RoleRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  readonly isDefault: boolean;
  readonly position: number;
  readonly defaultObjectLevel: string;
  readonly startedFrom: string;
  readonly updatedAt: string | Date;
}

const ROLE_COLUMNS = {
  id: workspaceRoles.id,
  name: workspaceRoles.name,
  description: workspaceRoles.description,
  permissions: workspaceRoles.permissions,
  isDefault: workspaceRoles.isDefault,
  position: workspaceRoles.position,
  defaultObjectLevel: workspaceRoles.defaultObjectLevel,
  startedFrom: workspaceRoles.startedFrom,
  updatedAt: workspaceRoles.updatedAt,
} as const;

/** The data access a stored level reads as (AC-1229): `write` only when stored so. */
const dataAccessOf = (stored: string): DataAccess => (customRoleLevel(stored) === 'write' ? 'write' : 'read');

/** Every custom role of the workspace, in their order. */
async function readRoles(tx: WorkspaceTx, workspaceId: string): Promise<RoleRow[]> {
  return tx
    .select(ROLE_COLUMNS)
    .from(workspaceRoles)
    .where(eq(workspaceRoles.workspaceId, workspaceId))
    .orderBy(asc(workspaceRoles.position), asc(workspaceRoles.id));
}

/** One custom role, locked for the change when `lock`, or undefined. */
async function findRole(tx: WorkspaceTx, workspaceId: string, roleId: string, lock: boolean) {
  const query = tx
    .select(ROLE_COLUMNS)
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.id, roleId)));
  const [row] = await (lock ? query.for('update') : query);
  return row;
}

/** A custom role as the screens show it, with its holders when counted. */
function customView(row: RoleRow, holders: number | undefined): RoleDefinition {
  return {
    id: row.id,
    label: row.name,
    description: row.description,
    permissions: [...customRolePermissions(row.permissions)],
    dataAccess: dataAccessOf(row.defaultObjectLevel),
    ...(holders === undefined ? {} : { holders }),
    isDefault: row.isDefault,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/** Whether the caller reads role definitions in full (everyone but a guest, who gets names only). */
const readsInFull = (scope: EngineScope): boolean =>
  !(scope.access.principal.kind === 'member' && scope.access.principal.role === 'guest');

/** How many active members hold each built in role (without a custom one) and each custom role. */
async function holderCounts(tx: WorkspaceTx, workspaceId: string): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({ role: members.role, customRoleId: members.customRoleId, n: count() })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active')))
    .groupBy(members.role, members.customRoleId);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.customRoleId ?? row.role;
    counts.set(key, (counts.get(key) ?? 0) + row.n);
  }
  return counts;
}

/**
 * The roles every role picker offers (spec 0037, AC-1439, AC-1242): the built in roles, most power first, then the
 * custom roles in their order, each with its name and one line on what it can do, and the role new people get (the
 * one marked default, else `member`). Any member may read it; what a person may grant is still the owner rules'.
 */
export async function listRoles(scope: EngineScope, _input?: unknown): Promise<RolesList> {
  checkScope(scope);
  const custom = await inWorkspace(scope, (tx) => readRoles(tx, scope.workspaceId));
  return {
    roles: [
      ...ROLES.map((role) => ({
        id: role,
        label: ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
        builtIn: role,
      })),
      ...custom.map((row) => ({ id: row.id, label: row.name, description: row.description })),
    ],
    defaultRole: custom.find((row) => row.isDefault)?.id ?? 'member',
  };
}

/**
 * Every role with what it holds (spec 0037, `roles.overview`, AC-1239), for Settings › Roles and Compare: the built
 * in roles from the pinned table, then the custom roles in their order, each with its permissions, data access, how
 * many active members hold it and whether it is the default. Any member may read it; a guest gets the names alone.
 */
export async function roleOverview(scope: EngineScope, _input?: unknown): Promise<RolesOverview> {
  checkScope(scope);
  const full = readsInFull(scope);
  const { custom, counts } = await inWorkspace(scope, async (tx) => ({
    custom: await readRoles(tx, scope.workspaceId),
    counts: full ? await holderCounts(tx, scope.workspaceId) : new Map<string, number>(),
  }));
  const defaultId = custom.find((row) => row.isDefault)?.id;
  const builtIn: RoleDefinition[] = ROLES.map((role) => ({
    id: role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
    builtIn: role,
    permissions: full ? [...(ROLE_PERMISSIONS[role] as readonly Permission[])] : [],
    // A guest reads only what is shared with them (spec 0031): Read only, the screens say.
    dataAccess: role === 'guest' ? 'read' : 'write',
    ...(full ? { holders: counts.get(role) ?? 0 } : {}),
    isDefault: role === 'member' && defaultId === undefined,
  }));
  const own = custom.map((row) => {
    const view = customView(row, full ? (counts.get(row.id) ?? 0) : undefined);
    return full ? view : { ...view, permissions: [], description: row.description };
  });
  return { roles: [...builtIn, ...own], defaultRole: defaultId ?? 'member' };
}

/** One custom role (`roles.get`), for its page: any member; a guest reads its name alone. */
export async function getRole(scope: EngineScope, input: { readonly roleId: string }): Promise<RoleDefinition> {
  checkScope(scope);
  const roleId = checkId(input.roleId, ROLE_NOT_FOUND);
  const full = readsInFull(scope);
  const found = await inWorkspace(scope, async (tx) => {
    const row = await findRole(tx, scope.workspaceId, roleId, false);
    if (row === undefined) return undefined;
    const [held] = full
      ? await tx
          .select({ n: count() })
          .from(members)
          .where(
            and(
              eq(members.workspaceId, scope.workspaceId),
              eq(members.status, 'active'),
              eq(members.customRoleId, roleId),
            ),
          )
      : [];
    return { row, holders: held?.n };
  });
  if (found === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
  const view = customView(found.row, found.holders);
  return full ? view : { ...view, permissions: [] };
}

/** A role's name, trimmed and checked (AC-1228): 1 to 40 characters, never a built in role's. */
function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw inputInvalid('name', 'Name the role.');
  if (trimmed.length > ROLE_NAME_MAX) throw inputInvalid('name', `Use ${String(ROLE_NAME_MAX)} characters or fewer.`);
  if ((ROLES as readonly string[]).includes(trimmed.toLowerCase())) {
    throw refuseOn('ROLE_NAME_RESERVED', ROLE_NAME_RESERVED_MESSAGE, 'name');
  }
  return trimmed;
}

/** A description, trimmed and checked (AC-1228): up to 200 characters. */
function checkDescription(description: string | undefined): string {
  const trimmed = (description ?? '').trim();
  if (trimmed.length > ROLE_DESCRIPTION_MAX) {
    throw inputInvalid('description', `Use ${String(ROLE_DESCRIPTION_MAX)} characters or fewer.`);
  }
  return trimmed;
}

/**
 * The permissions a write stores (AC-1228): each once, in catalog order. A name only built in roles may hold is 422
 * `PERMISSION_NOT_ALLOWED` naming its label; a name the catalog doesn't know is refused on `permissions`.
 */
export function checkPermissions(names: readonly string[]): readonly Permission[] {
  for (const name of names) {
    if (!Object.hasOwn(PERMISSIONS, name)) throw inputInvalid('permissions', 'Pick permissions from the list.');
    if (grantOf(name) !== 'any') {
      const label = (PERMISSIONS as Readonly<Record<string, { readonly label: string }>>)[name]?.label ?? name;
      throw refuseOn('PERMISSION_NOT_ALLOWED', permissionNotAllowed(label), 'permissions');
    }
  }
  return CUSTOM_ROLE_PERMISSIONS.filter((name) => names.includes(name));
}

/** The workspace's roles lock: role counts, positions and the default change one at a time (AC-1228). */
const lockRoles = (tx: WorkspaceTx, workspaceId: string) => lockKey(tx, `roles:${workspaceId}`);

/** Turns the unique name index's failure into `NAME_TAKEN` on `name`. */
async function nameGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (postgresError(error)?.code === '23505' && postgresError(error)?.constraint === 'workspace_roles_name') {
      throw refuseOn('NAME_TAKEN', NAME_TAKEN_MESSAGE, 'name');
    }
    throw error;
  }
}

/** The audit columns of a new row, by whoever acts. */
function created(scope: EngineScope) {
  const by = actorRow(scope.actor);
  return {
    createdByType: by.type,
    createdById: by.id,
    createdByMemberId: by.memberId,
    updatedByType: by.type,
    updatedById: by.id,
    updatedByMemberId: by.memberId,
  };
}

/** The member who wrote, as the one id a role write tells the Roles screens about (a key or the system names none). */
const writer = (scope: EngineScope): readonly string[] =>
  scope.actor.type === 'member' && scope.actor.id !== null ? [scope.actor.id] : [];

/** The active holders of a custom role, by id. */
async function holdersOf(tx: WorkspaceTx, workspaceId: string, roleId: string): Promise<readonly string[]> {
  const rows = await tx
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active'), eq(members.customRoleId, roleId)));
  return rows.map((row) => row.id);
}

/**
 * Who reads their access again after a role's permissions change (AC-1231, AC-1274): its holders, and the delegates
 * whose reach runs through them or through grants they last set. One `members` row too, naming the writer, so every
 * open Roles and Members screen reads the roles again.
 */
async function recordRoleChange(context: WriteContext, holders: readonly string[]): Promise<void> {
  const { tx, scope } = context;
  const reached = holders.length === 0 ? [] : await delegatesReachedBy(tx, scope.workspaceId, holders);
  const access = [...new Set([...holders, ...reached])];
  context.record({ members: [...new Set([...writer(scope), ...holders])], ...(access.length > 0 ? { access } : {}) });
}

/**
 * Makes a custom role (spec 0037, AC-1228, AC-1229): `access.manage`; a name of 1 to 40 characters, unique ignoring
 * case and never a built in role's (422 `ROLE_NAME_RESERVED`); a description up to 200; only grant `any`
 * permissions (422 `PERMISSION_NOT_ALLOWED`); a data access; and what it starts from (`member`, the `viewer` preset,
 * or a custom role, kept for spec 0037 J10's rule copy). At most 20 per workspace (409 `ROLE_LIMIT`), counted under
 * the workspace's roles lock. `id` is the caller's own: a retry with it answers the role it made. Its holders are
 * nobody yet, so only the Roles screens hear of it.
 */
export async function createRole(
  scope: EngineScope,
  input: {
    readonly id: string;
    readonly name: string;
    readonly description?: string | undefined;
    readonly permissions: readonly string[];
    readonly dataAccess: DataAccess;
    readonly startFrom: StartFrom;
  },
  hooks: readonly AfterWrite[] = [],
  options: RoleWriteOptions = {},
): Promise<RoleDefinition> {
  requirePermission(scope, 'access.manage');
  const id = checkId(input.id, ROLE_NOT_FOUND);
  const name = checkName(input.name);
  const description = checkDescription(input.description);
  const permissions = checkPermissions(input.permissions);
  const dataAccess: DataAccess = input.dataAccess === 'read' ? 'read' : 'write';
  const startFrom = input.startFrom;
  if (startFrom !== 'member' && startFrom !== 'viewer' && !isUuid(startFrom)) {
    throw inputInvalid('startFrom', 'Pick Member, Viewer or a custom role.');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockRoles(tx, scope.workspaceId);
      const again = await findRole(tx, scope.workspaceId, id, false);
      if (again !== undefined) return customView(again, 0);
      if (startFrom !== 'member' && startFrom !== 'viewer') {
        const from = await findRole(tx, scope.workspaceId, startFrom, false);
        if (from === undefined) throw refuseOn('NOT_FOUND', ROLE_NOT_FOUND, 'startFrom');
      }
      const [counted] = await tx
        .select({ n: count() })
        .from(workspaceRoles)
        .where(eq(workspaceRoles.workspaceId, scope.workspaceId));
      const position = counted?.n ?? 0;
      if (position >= CUSTOM_ROLES_MAX) throw refuse('ROLE_LIMIT', ROLE_LIMIT_MESSAGE);
      const [row] = await nameGuard(() =>
        tx
          .insert(workspaceRoles)
          .values({
            workspaceId: scope.workspaceId,
            id,
            name,
            description,
            permissions: [...permissions],
            position,
            defaultObjectLevel: dataAccess,
            startedFrom: startFrom,
            ...created(scope),
          })
          .returning(ROLE_COLUMNS),
      );
      if (row === undefined) throw new Error('The role was not stored.');
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'role.created',
          targetType: 'role',
          targetId: id,
          after: { name, permissions: [...permissions], dataAccess, startedFrom: startFrom },
        },
        options.source,
      );
      context.record({ members: writer(scope) });
      return customView(row, 0);
    },
    hooks,
  );
  return result;
}

/**
 * Changes a custom role (spec 0037, AC-1231): its name, description, permissions or data access, as given, refused
 * 409 `STALE` when it changed since `updatedAt` (the version the editor read). One transaction with one
 * `role.updated` audit row (the permissions added and removed) and one `access` row naming every active holder, so
 * their screens read again under the role as it now stands. A save that changes nothing writes nothing. Answers the
 * role and how many people the change reached.
 */
export async function updateRole(
  scope: EngineScope,
  input: {
    readonly roleId: string;
    readonly name?: string | undefined;
    readonly description?: string | undefined;
    readonly permissions?: readonly string[] | undefined;
    readonly dataAccess?: DataAccess | undefined;
    readonly updatedAt: string;
  },
  hooks: readonly AfterWrite[] = [],
  options: RoleWriteOptions = {},
): Promise<{ readonly role: RoleDefinition; readonly affectedMembers: number }> {
  requirePermission(scope, 'access.manage');
  const roleId = checkId(input.roleId, ROLE_NOT_FOUND);
  const name = input.name === undefined ? undefined : checkName(input.name);
  const description = input.description === undefined ? undefined : checkDescription(input.description);
  const permissions = input.permissions === undefined ? undefined : checkPermissions(input.permissions);
  const readAt = Date.parse(input.updatedAt);
  if (Number.isNaN(readAt)) throw inputInvalid('updatedAt', 'Reload the role and try again.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await findRole(tx, scope.workspaceId, roleId, true);
      if (row === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      // Compared to the millisecond, as the version travels in ISO 8601.
      if (Math.floor(new Date(row.updatedAt).getTime()) !== readAt) throw refuse('STALE', STALE_MESSAGE);
      const held = customRolePermissions(row.permissions);
      const nextPermissions = permissions ?? held;
      const added = nextPermissions.filter((each) => !held.includes(each));
      const removed = held.filter((each) => !nextPermissions.includes(each));
      const wasAccess = dataAccessOf(row.defaultObjectLevel);
      const nextAccess = input.dataAccess === undefined ? wasAccess : input.dataAccess === 'read' ? 'read' : 'write';
      const nextName = name ?? row.name;
      const nextDescription = description ?? row.description;
      const holders = await holdersOf(tx, scope.workspaceId, roleId);
      const changesAccess = added.length > 0 || removed.length > 0 || nextAccess !== wasAccess;
      if (!changesAccess && nextName === row.name && nextDescription === row.description) {
        return { role: customView(row, holders.length), affectedMembers: 0 };
      }
      const [saved] = await nameGuard(() =>
        tx
          .update(workspaceRoles)
          .set({
            name: nextName,
            description: nextDescription,
            permissions: [...nextPermissions],
            defaultObjectLevel: nextAccess,
            ...touched(scope),
          })
          .where(and(eq(workspaceRoles.workspaceId, scope.workspaceId), eq(workspaceRoles.id, roleId)))
          .returning(ROLE_COLUMNS),
      );
      if (saved === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'role.updated',
          targetType: 'role',
          targetId: roleId,
          before: {
            name: row.name,
            ...(nextDescription === row.description ? {} : { description: row.description }),
            ...(nextAccess === wasAccess ? {} : { dataAccess: wasAccess }),
          },
          after: {
            name: nextName,
            ...(nextDescription === row.description ? {} : { description: nextDescription }),
            ...(nextAccess === wasAccess ? {} : { dataAccess: nextAccess }),
            added: [...added],
            removed: [...removed],
          },
        },
        options.source,
      );
      // A rename alone changes what nobody may do: the lists read it again, nobody's access.
      if (changesAccess) await recordRoleChange(context, holders);
      else context.record({ members: [...new Set([...writer(scope), ...holders])] });
      return { role: customView(saved, holders.length), affectedMembers: changesAccess ? holders.length : 0 };
    },
    hooks,
  );
  return result;
}

/** "<name> copy", then " 2", " 3" on clashes (AC-1232), within the name's 40 characters. */
export function copyName(name: string, taken: ReadonlySet<string>): string {
  for (let n = 1; n <= CUSTOM_ROLES_MAX + 1; n += 1) {
    const suffix = n === 1 ? ' copy' : ` copy ${String(n)}`;
    const candidate = `${name.slice(0, ROLE_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${name.slice(0, ROLE_NAME_MAX - 10)} ${String(Date.now()).slice(-8)}`;
}

/**
 * Copies a custom role (spec 0037, AC-1232): "<name> copy" (" 2", " 3" on clashes) with the same permissions and
 * data access, started from the role it copies; it counts toward the 20 (409 `ROLE_LIMIT`). `id` is the caller's
 * own. (Copying its access rules arrives with custom role rule subjects, spec 0037 J10.)
 */
export async function duplicateRole(
  scope: EngineScope,
  input: { readonly roleId: string; readonly id: string },
  hooks: readonly AfterWrite[] = [],
  options: RoleWriteOptions = {},
): Promise<RoleDefinition> {
  requirePermission(scope, 'access.manage');
  const roleId = checkId(input.roleId, ROLE_NOT_FOUND);
  const id = checkId(input.id, ROLE_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockRoles(tx, scope.workspaceId);
      const again = await findRole(tx, scope.workspaceId, id, false);
      if (again !== undefined) return customView(again, 0);
      const all = await readRoles(tx, scope.workspaceId);
      const source = all.find((row) => row.id === roleId);
      if (source === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      if (all.length >= CUSTOM_ROLES_MAX) throw refuse('ROLE_LIMIT', ROLE_LIMIT_MESSAGE);
      const name = copyName(source.name, new Set(all.map((row) => row.name.toLowerCase())));
      const permissions = customRolePermissions(source.permissions);
      const [row] = await nameGuard(() =>
        tx
          .insert(workspaceRoles)
          .values({
            workspaceId: scope.workspaceId,
            id,
            name,
            description: source.description,
            permissions: [...permissions],
            position: all.length,
            defaultObjectLevel: dataAccessOf(source.defaultObjectLevel),
            startedFrom: source.id,
            ...created(scope),
          })
          .returning(ROLE_COLUMNS),
      );
      if (row === undefined) throw new Error('The role was not stored.');
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'role.created',
          targetType: 'role',
          targetId: id,
          after: {
            name,
            permissions: [...permissions],
            dataAccess: dataAccessOf(source.defaultObjectLevel),
            startedFrom: source.id,
          },
        },
        options.source,
      );
      context.record({ members: writer(scope) });
      return customView(row, 0);
    },
    hooks,
  );
  return result;
}

/**
 * Deletes a custom role (spec 0037, AC-1238), moving its people and open invitations to `moveTo`: Member, or another
 * custom role (anything else 422 `MOVE_TO_INVALID`). In one transaction: the holders and invitations move, the default
 * falls back to Member when it was this role, the role goes, the positions close up, one `role.deleted` audit row
 * (how many moved, and where) and one `access` row naming the people moved. (A custom role's access rules arrive
 * with spec 0037 J10, which deletes them here too.)
 */
export async function deleteRole(
  scope: EngineScope,
  input: { readonly roleId: string; readonly moveTo: string },
  hooks: readonly AfterWrite[] = [],
  options: RoleWriteOptions = {},
): Promise<{ readonly moved: number }> {
  requirePermission(scope, 'access.manage');
  const roleId = checkId(input.roleId, ROLE_NOT_FOUND);
  const moveTo = input.moveTo;
  if (moveTo !== 'member' && (!isUuid(moveTo) || moveTo === roleId)) {
    throw refuseOn('MOVE_TO_INVALID', MOVE_TO_INVALID_MESSAGE, 'moveTo');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockRoles(tx, scope.workspaceId);
      const row = await findRole(tx, scope.workspaceId, roleId, true);
      if (row === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      const target = moveTo === 'member' ? undefined : await findRole(tx, scope.workspaceId, moveTo, true);
      if (moveTo !== 'member' && target === undefined) {
        throw refuseOn('MOVE_TO_INVALID', MOVE_TO_INVALID_MESSAGE, 'moveTo');
      }
      const nextRoleId = target?.id ?? null;
      const moved = await tx
        .update(members)
        .set({ customRoleId: nextRoleId, ...touched(scope) })
        .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.customRoleId, roleId)))
        .returning({ id: members.id, status: members.status });
      await tx
        .update(invitations)
        .set({ customRoleId: nextRoleId, ...touched(scope) })
        .where(and(eq(invitations.workspaceId, scope.workspaceId), eq(invitations.customRoleId, roleId)));
      // A default role deleted leaves Member the default (AC-1238).
      const wasDefault = row.isDefault;
      await tx
        .delete(workspaceRoles)
        .where(and(eq(workspaceRoles.workspaceId, scope.workspaceId), eq(workspaceRoles.id, roleId)));
      await tx.execute(sql`
        update workspace_roles set position = position - 1
        where workspace_id = ${scope.workspaceId}::uuid and position > ${row.position}
      `);
      const active = moved.filter((each) => each.status === 'active').map((each) => each.id);
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'role.deleted',
          targetType: 'role',
          targetId: roleId,
          before: { name: row.name, ...(wasDefault ? { isDefault: true } : {}) },
          after: { name: row.name, moved: active.length, moveTo: nextRoleId ?? 'member' },
        },
        options.source,
      );
      await recordRoleChange(context, active);
      return { moved: active.length };
    },
    hooks,
  );
  return result;
}

/**
 * Sets the role new people get (spec 0037, AC-1237): a custom role, or `null` for Member. At most one is the default
 * (a partial unique index); the Invite dialog preselects it, the invite link offers it, and approving a join
 * request suggests it. One `role.default_changed` audit row when it changes.
 */
export async function setDefaultRole(
  scope: EngineScope,
  input: { readonly roleId: string | null },
  hooks: readonly AfterWrite[] = [],
  options: RoleWriteOptions = {},
): Promise<void> {
  requirePermission(scope, 'access.manage');
  const roleId = input.roleId === null ? null : checkId(input.roleId, ROLE_NOT_FOUND);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockRoles(tx, scope.workspaceId);
      const all = await readRoles(tx, scope.workspaceId);
      const was = all.find((row) => row.isDefault);
      const next = roleId === null ? undefined : all.find((row) => row.id === roleId);
      if (roleId !== null && next === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      if (was?.id === next?.id) return;
      await tx
        .update(workspaceRoles)
        // Not a version change: an editor open on the role keeps saving (its `STALE` check reads `updated_at`).
        .set({ isDefault: false })
        .where(and(eq(workspaceRoles.workspaceId, scope.workspaceId), eq(workspaceRoles.isDefault, true)));
      if (next !== undefined) {
        await tx
          .update(workspaceRoles)
          .set({ isDefault: true })
          .where(and(eq(workspaceRoles.workspaceId, scope.workspaceId), eq(workspaceRoles.id, next.id)));
      }
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'role.default_changed',
          targetType: 'role',
          targetId: next?.id ?? was?.id ?? scope.workspaceId,
          before: { name: was?.name ?? 'Member' },
          after: { name: next?.name ?? 'Member' },
        },
        options.source,
      );
      context.record({ members: writer(scope) });
    },
    hooks,
  );
}

/**
 * Moves a custom role to `position` among the custom roles (0 first), the others closing up around it. One
 * `role.updated` audit row with its place before and after.
 */
export async function moveRole(
  scope: EngineScope,
  input: { readonly roleId: string; readonly position: number },
  hooks: readonly AfterWrite[] = [],
  options: RoleWriteOptions = {},
): Promise<void> {
  requirePermission(scope, 'access.manage');
  const roleId = checkId(input.roleId, ROLE_NOT_FOUND);
  if (!Number.isInteger(input.position) || input.position < 0) {
    throw inputInvalid('position', 'Pick a place in the list.');
  }
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockRoles(tx, scope.workspaceId);
      const all = await readRoles(tx, scope.workspaceId);
      const from = all.findIndex((row) => row.id === roleId);
      if (from === -1) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      const to = Math.min(input.position, all.length - 1);
      if (from === to) return;
      const order = all.filter((row) => row.id !== roleId);
      const moving = all[from];
      if (moving === undefined) throw refuse('NOT_FOUND', ROLE_NOT_FOUND);
      order.splice(to, 0, moving);
      for (const [position, row] of order.entries()) {
        if (row.position === position) continue;
        await tx
          .update(workspaceRoles)
          .set({ position })
          .where(and(eq(workspaceRoles.workspaceId, scope.workspaceId), eq(workspaceRoles.id, row.id)));
      }
      await writeAudit(
        tx,
        scope.workspaceId,
        scope.actor,
        {
          action: 'role.updated',
          targetType: 'role',
          targetId: moving.id,
          before: { name: moving.name, position: from },
          after: { name: moving.name, position: to },
        },
        options.source,
      );
      context.record({ members: writer(scope) });
    },
    hooks,
  );
}

/** A custom role as `setMemberRole` and invitations read it: its id and name, or undefined when it doesn't exist. */
export async function readCustomRole(
  tx: WorkspaceTx,
  workspaceId: string,
  roleId: string,
  lock: 'share' | undefined,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  const query = tx
    .select({ id: workspaceRoles.id, name: workspaceRoles.name })
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.id, roleId)));
  const [row] = await (lock === undefined ? query : query.for(lock));
  return row;
}

/** The custom role new people get (AC-1237), or undefined for Member. */
export async function defaultCustomRole(
  tx: WorkspaceTx,
  workspaceId: string,
): Promise<{ readonly id: string; readonly name: string } | undefined> {
  // Held for share, so a delete waits for the join that gives it (its holders' foreign key restricts the delete).
  const [row] = await tx
    .select({ id: workspaceRoles.id, name: workspaceRoles.name })
    .from(workspaceRoles)
    .where(and(eq(workspaceRoles.workspaceId, workspaceId), eq(workspaceRoles.isDefault, true)))
    .for('share');
  return row;
}
