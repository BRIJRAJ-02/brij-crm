import { addAttribute, listObjectAttributes } from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const attributesRouter = member.attributes.router({
  list: member.attributes.list.handler(({ context, input }) => listObjectAttributes(context.scope, input.objectId)),
  create: member.attributes.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        addAttribute(context.scope, { objectId: input.objectId, title: input.title, type: input.type }, hooks),
      );
    } catch (error) {
      // The API name is derived from the title, so a taken one is the title field's to show.
      throw withInputFields(error, { SLUG_TAKEN: 'title' });
    }
  }),
});
