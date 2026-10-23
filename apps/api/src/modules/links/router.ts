import { addRecordLinks, pageLinks, removeRecordLinks } from '@crm/core';
import { commitCounted } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Inside a workspace: the door has let in an active member, and `context.scope` is theirs. Link deltas (spec 0014,
// milestone 2): the engine checks `write` on the near side and that every far record is visible; refusals carry
// the side's attribute id. Each answers `echoes`, so the tab that sent it skips its own events.
export const linksRouter = member.links.router({
  add: member.links.add.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      addRecordLinks(
        context.scope,
        {
          recordId: input.recordId,
          attributeId: input.attributeId,
          targets: input.targets,
          ...(input.move === undefined ? {} : { move: input.move }),
          ...(input.baseVersionId === undefined ? {} : { baseVersionId: input.baseVersionId }),
        },
        hooks,
      ),
    );
    return { ...result, written: { ...result.written }, changedRecordIds: [...result.changedRecordIds], echoes };
  }),
  remove: member.links.remove.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      removeRecordLinks(
        context.scope,
        { recordId: input.recordId, attributeId: input.attributeId, targetRecordIds: input.targetRecordIds },
        hooks,
      ),
    );
    return { ...result, written: { ...result.written }, changedRecordIds: [...result.changedRecordIds], echoes };
  }),
  // A read (spec 0014, milestone 3): one side's linked records the reader may see, a page at a time, with the total.
  page: member.links.page.handler(async ({ context, input }) => {
    const answer = await pageLinks(context.scope, {
      recordId: input.recordId,
      attributeId: input.attributeId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    return { ...answer, items: [...answer.items] };
  }),
});
