import { createRelationship, renameRelationship } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Both writes need
// `schema.manage`, checked by the engine (spec 0014); refusals name the side they are about (`from.title`).
export const relationshipsRouter = member.relationships.router({
  create: member.relationships.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createRelationship(
        context.scope,
        {
          id: input.id,
          cardinality: input.cardinality,
          from: { objectId: input.from.objectId, title: input.from.title },
          to: { objectId: input.to.objectId, title: input.to.title },
        },
        hooks,
      ),
    ),
  ),
  update: member.relationships.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      renameRelationship(
        context.scope,
        { relationshipId: input.relationshipId, fromTitle: input.from?.title, toTitle: input.to?.title },
        hooks,
      ),
    ),
  ),
});
