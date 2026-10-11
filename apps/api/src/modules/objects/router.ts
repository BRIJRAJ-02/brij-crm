import { archiveObject, createObject, editObject, listObjects, moveObject, restoreObject } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Every write needs
// `schema.manage`, checked by the engine (spec 0012); refusals name the field they are about themselves.
export const objectsRouter = member.objects.router({
  list: member.objects.list.handler(({ context, input }) =>
    listObjects(context.scope, { includeArchived: input.includeArchived === true }),
  ),
  create: member.objects.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createObject(
        context.scope,
        {
          id: input.id,
          singularName: input.singularName,
          pluralName: input.pluralName,
          apiSlug: input.apiSlug,
          icon: input.icon,
          hue: input.hue,
        },
        hooks,
      ),
    ),
  ),
  update: member.objects.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      editObject(
        context.scope,
        {
          objectId: input.objectId,
          singularName: input.singularName,
          pluralName: input.pluralName,
          icon: input.icon,
          hue: input.hue,
        },
        hooks,
      ),
    ),
  ),
  reorder: member.objects.reorder.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveObject(context.scope, { objectId: input.objectId, position: input.position }, hooks),
    ),
  ),
  archive: member.objects.archive.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      archiveObject(context.scope, { objectId: input.objectId }, hooks),
    ),
  ),
  restore: member.objects.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreObject(context.scope, { objectId: input.objectId }, hooks),
    ),
  ),
});
