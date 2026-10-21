import { enterDeletedWorkspace, restoreWorkspace } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { authed, memberDoor } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';
import { followInDirectory } from './router.ts';

/**
 * A deleted workspace's owners (bootstrap): the door refuses a deleted
 * workspace, so `enterDeletedWorkspace` reads the owner row itself within the
 * window; anyone else, and a live or purged workspace, gets the same
 * NOT_FOUND as an unknown address.
 */
export const deletedWorkspaceRouter = {
  deleted: authed.deletedWorkspace.deleted.handler(async ({ context, input }) => {
    const entry = await enterDeletedWorkspace(memberDoor(context), {
      userId: context.user.id,
      slug: input.workspace,
    });
    return { name: entry.name, slug: entry.slug, purgeAfter: entry.purgeAfter };
  }),
  restore: authed.deletedWorkspace.restore.handler(async ({ context, input }) => {
    const entry = await enterDeletedWorkspace(memberDoor(context), {
      userId: context.user.id,
      slug: input.workspace,
    });
    const settings = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreWorkspace(entry.scope, hooks, sourceOf(context)),
    );
    await followInDirectory('restore', () => context.directory.setWorkspaceDeleted(settings.id, false));
    return settings;
  }),
};
