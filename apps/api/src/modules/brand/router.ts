import { brandCacheTags } from '@crm/contracts';
import { getWorkspaceBrand, saveWorkspaceBrand } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// A workspace's brand kit (spec 0060, AC-1, AC-3, AC-23): Settings › Brand. Inside a workspace, behind the member
// door: every member reads it, and core checks `workspace.manage` before a save reads or writes anything. A save
// changes no record, so it stores no change event; it purges the edge's copies of the public brand answers.
export const brandRouter = member.brand.router({
  get: member.brand.get.handler(({ context }) => getWorkspaceBrand(context.scope)),
  save: member.brand.save.handler(async ({ context, input }) => {
    const saved = await commitWrite(context, { mutationId: input.mutationId }, () =>
      saveWorkspaceBrand(context.scope, { accent: input.accent, accentDark: input.accentDark }),
    );
    // Once committed, the edge's copies of every page's brand stylesheet and logo are deleted (AC-21).
    await context.edgeCache.forget(brandCacheTags(context.scope.workspaceId));
    return saved;
  }),
});
