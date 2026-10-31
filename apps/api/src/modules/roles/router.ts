import {
  createRole,
  deleteRole,
  duplicateRole,
  getRole,
  listRoles,
  moveRole,
  roleOverview,
  setDefaultRole,
  updateRole,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Every member reads the
// roles (spec 0037, AC-1439, AC-1239); the rules for custom roles (`access.manage`, the names, the catalog's grant
// levels, the 20 role cap) live in packages/core, and each write stores its audit row and its `members` and
// `access` rows with the write.
export const rolesRouter = member.roles.router({
  list: member.roles.list.handler(({ context }) => listRoles(context.scope)),
  overview: member.roles.overview.handler(({ context }) => roleOverview(context.scope)),
  get: member.roles.get.handler(({ context, input }) => getRole(context.scope, { roleId: input.roleId })),
  create: member.roles.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createRole(
        context.scope,
        {
          id: input.id,
          name: input.name,
          ...(input.description === undefined ? {} : { description: input.description }),
          permissions: input.permissions,
          dataAccess: input.dataAccess,
          startFrom: input.startFrom,
        },
        hooks,
        { source: sourceOf(context) },
      ),
    ),
  ),
  update: member.roles.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateRole(
        context.scope,
        {
          roleId: input.roleId,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
          ...(input.dataAccess === undefined ? {} : { dataAccess: input.dataAccess }),
          updatedAt: input.updatedAt,
        },
        hooks,
        { source: sourceOf(context) },
      ),
    ),
  ),
  duplicate: member.roles.duplicate.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      duplicateRole(context.scope, { roleId: input.roleId, id: input.id }, hooks, { source: sourceOf(context) }),
    ),
  ),
  delete: member.roles.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteRole(context.scope, { roleId: input.roleId, moveTo: input.moveTo }, hooks, {
        source: sourceOf(context),
      }),
    ),
  ),
  setDefault: member.roles.setDefault.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setDefaultRole(context.scope, { roleId: input.roleId }, hooks, { source: sourceOf(context) }),
    ),
  ),
  move: member.roles.move.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveRole(context.scope, { roleId: input.roleId, position: input.position }, hooks, {
        source: sourceOf(context),
      }),
    ),
  ),
});
