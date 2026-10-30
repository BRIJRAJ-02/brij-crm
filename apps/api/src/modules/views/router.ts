import {
  createView,
  deleteView,
  getView,
  listViews,
  markViewOpened,
  moveView,
  saveViewQuery,
  setDefaultView,
  setViewLayout,
  setViewLocked,
  updateView,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Saved views (spec 0020), inside a workspace: the door has let in an active member, and `context.scope` is
// theirs. The services decide who sees and changes which view; every write but `markOpened` goes through
// `commitWrite`, so its `views` event is stored with it and the worker is woken once it commits. `markOpened`
// is the member's own bookmark and stores no event.
export const viewsRouter = member.views.router({
  // A list's views (spec 0048) with `listId`, else the object's.
  list: member.views.list.handler(({ context, input }) => listViews(context.scope, input.objectId, input.listId)),
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
  create: member.views.create.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createView(
        context.scope,
        {
          id: input.id,
          objectId: input.objectId,
          listId: input.listId,
          name: input.name,
          kind: input.kind,
          visibility: input.visibility,
          config: input.config,
        },
        hooks,
      ),
    ),
  ),
  update: member.views.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateView(context.scope, { viewId: input.viewId, name: input.name, visibility: input.visibility }, hooks),
    ),
  ),
  setLayout: member.views.setLayout.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setViewLayout(context.scope, { viewId: input.viewId, layout: input.layout }, hooks),
    ),
  ),
  move: member.views.move.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveView(context.scope, { viewId: input.viewId, direction: input.direction }, hooks),
    ),
  ),
  setLocked: member.views.setLocked.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setViewLocked(context.scope, { viewId: input.viewId, locked: input.locked }, hooks),
    ),
  ),
  setDefault: member.views.setDefault.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setDefaultView(context.scope, { objectId: input.objectId, listId: input.listId, viewId: input.viewId }, hooks),
    ),
  ),
  delete: member.views.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteView(context.scope, { viewId: input.viewId }, hooks),
    ),
  ),
  markOpened: member.views.markOpened.handler(({ context, input }) =>
    markViewOpened(context.scope, { viewId: input.viewId }),
  ),
});
