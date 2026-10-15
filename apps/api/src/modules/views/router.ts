import { getView, listViews, saveViewQuery } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Saved views (spec 0020), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. The services decide who sees and changes which view; a save goes through `commitWrite`, so its `views`
// event is stored with it and the worker is woken once it commits.
export const viewsRouter = member.views.router({
  list: member.views.list.handler(({ context, input }) => listViews(context.scope, input.objectId)),
  get: member.views.get.handler(({ context, input }) => getView(context.scope, input.viewId)),
  saveQuery: member.views.saveQuery.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveViewQuery(
        context.scope,
        {
          viewId: input.viewId,
          filter: input.filter,
          sorts: input.sorts,
          baseQueryVersion: input.baseQueryVersion,
          force: input.force,
        },
        hooks,
      ),
    ),
  ),
});
