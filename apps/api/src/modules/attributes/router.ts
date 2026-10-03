import { addAttribute, listObjectAttributes } from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { writeHooks } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs.
export const attributesRouter = member.attributes.router({
  list: member.attributes.list.handler(({ context, input }) => listObjectAttributes(context.scope, input.objectId)),
  create: member.attributes.create.handler(async ({ context, input }) => {
    try {
      return await addAttribute(
        context.scope,
        { objectId: input.objectId, title: input.title, type: input.type },
        writeHooks(context, { mutationId: input.mutationId }),
      );
    } catch (error) {
      // The API name is derived from the title, so a taken one is the title field's to show.
      throw withInputFields(error, { SLUG_TAKEN: 'title' });
    }
  }),
});
