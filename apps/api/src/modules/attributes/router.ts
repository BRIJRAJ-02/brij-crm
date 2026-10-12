import {
  archiveAttributes,
  createAttribute,
  editAttribute,
  listObjectAttributes,
  moveAttribute,
  restoreAttributes,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Every write needs
// `schema.manage`, checked by the engine (spec 0012); refusals name the field they are about themselves.
export const attributesRouter = member.attributes.router({
  list: member.attributes.list.handler(({ context, input }) =>
    listObjectAttributes(context.scope, input.objectId, { includeArchived: input.includeArchived === true }),
  ),
  create: member.attributes.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createAttribute(
        context.scope,
        {
          objectId: input.objectId,
          id: input.id,
          title: input.title,
          type: input.type,
          apiSlug: input.apiSlug,
          description: input.description,
          isMulti: input.isMulti,
          isRequired: input.isRequired,
          isUnique: input.isUnique,
          config: input.config,
          defaultValue: input.defaultValue,
        },
        hooks,
      ),
    ),
  ),
  update: member.attributes.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      editAttribute(
        context.scope,
        {
          attributeId: input.attributeId,
          title: input.title,
          description: input.description,
          isRequired: input.isRequired,
          isUnique: input.isUnique,
          config: input.config,
          defaultValue: input.defaultValue,
        },
        hooks,
      ),
    ),
  ),
  reorder: member.attributes.reorder.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveAttribute(context.scope, { attributeId: input.attributeId, position: input.position }, hooks),
    ),
  ),
  archive: member.attributes.archive.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      archiveAttributes(context.scope, { attributeId: input.attributeId }, hooks),
    ),
  ),
  restore: member.attributes.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreAttributes(context.scope, { attributeId: input.attributeId }, hooks),
    ),
  ),
});
