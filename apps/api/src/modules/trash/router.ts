import { countTrash, deleteForever, queryTrash, restoreRecords } from '@crm/core';
import { commitCounted } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// The trash (spec 0022), inside a workspace: the door has let in an active member, and `context.scope` is theirs.
// The reads share the workspace's places in the read gate with the record reads, so a seventh at once answers 429.
export const trashRouter = member.trash.router({
  query: member.trash.query.handler(({ context, input }) =>
    context.readGate.run(context.scope.workspaceId, async () => {
      const page = await queryTrash(context.scope, {
        ...(input.objectId === undefined ? {} : { objectId: input.objectId }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
      return page.nextCursor === undefined
        ? { items: [...page.items] }
        : { items: [...page.items], nextCursor: page.nextCursor };
    }),
  ),
  count: member.trash.count.handler(({ context, input }) =>
    context.readGate.run(context.scope.workspaceId, () =>
      countTrash(context.scope, input.objectId === undefined ? {} : { objectId: input.objectId }),
    ),
  ),
  // Every write answers `echoes` (spec 0006): how many change events carry its mutation id, so its tab skips them.
  restore: member.trash.restore.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      restoreRecords(context.scope, { recordIds: input.recordIds }, hooks),
    );
    return { results: [...result], echoes };
  }),
  // Owners and admins only (records.purge, spec 0022 milestone 4): up to 500 records removed for good.
  deleteForever: member.trash.deleteForever.handler(async ({ context, input }) => {
    const { result, echoes } = await commitCounted(context, { mutationId: input.mutationId }, (hooks) =>
      deleteForever(context.scope, { recordIds: input.recordIds }, hooks),
    );
    // Each record's outcome as the contract names it: a refused one (an object the member may only read) keeps
    // its reason; `deleted-since` only ever comes from a purge job's count, never from this call.
    const results = result.map(({ recordId, state, refusal }) =>
      state === 'refused'
        ? { recordId, state, ...(refusal === undefined ? {} : { refusal }) }
        : { recordId, state: state === 'purged' ? ('purged' as const) : ('not-in-trash' as const) },
    );
    return { results, echoes };
  }),
});
