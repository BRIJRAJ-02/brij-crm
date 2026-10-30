import {
  archiveAttributes,
  attributeImpact,
  createAttribute,
  editAttribute,
  listListAttributes,
  listObjectAttributes,
  moveAttribute,
  restoreAttributes,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Every write needs
// `schema.manage`, checked by the engine (spec 0012); refusals name the field they are about themselves.
export const attributesRouter = member.attributes.router({
  // A list's own fields with `listId` (spec 0048), else the object's.
  list: member.attributes.list.handler(({ context, input }) =>
    input.listId === undefined
      ? listObjectAttributes(context.scope, input.objectId, { includeArchived: input.includeArchived === true })
      : listListAttributes(context.scope, input.listId, { includeArchived: input.includeArchived === true }),
  ),
  create: member.attributes.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createAttribute(
        context.scope,
        {
          objectId: input.objectId,
          listId: input.listId,
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
          options: input.options,
          rules: input.rules,
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
          rules: input.rules,
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
  impact: member.attributes.impact.handler(({ context, input }) =>
    attributeImpact(context.scope, { attributeId: input.attributeId }),
  ),
  restore: member.attributes.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreAttributes(context.scope, { attributeId: input.attributeId }, hooks),
    ),
  ),
});
