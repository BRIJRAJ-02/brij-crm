import { listRecents, searchWorkspace, visitRecent } from '@crm/core';
import { member } from '../../orpc.ts';

// The command menu (spec 0039), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. The search shares the workspace's places in the read gate with `records.query`, and is cancelled with its
// request. `recents.visit` is the member's own bookmark and stores no event, like `views.markOpened`.
export const searchRouter = member.search.router({
  query: member.search.query.handler(({ context, input, signal }) =>
    context.readGate.run(context.scope.workspaceId, () =>
      searchWorkspace(
        context.scope,
        { query: input.query, ...(input.limit === undefined ? {} : { limit: input.limit }) },
        signal,
      ),
    ),
  ),
});

export const recentsRouter = member.recents.router({
  list: member.recents.list.handler(async ({ context }) => ({ items: [...(await listRecents(context.scope))] })),
  visit: member.recents.visit.handler(({ context, input }) =>
    visitRecent(context.scope, { kind: input.kind, id: input.id }),
  ),
});
