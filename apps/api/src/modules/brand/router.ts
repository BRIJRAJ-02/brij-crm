import { getWorkspaceBrand, saveWorkspaceBrand } from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// A workspace's brand kit (spec 0060, AC-1, AC-3, AC-23): Settings › Brand. Inside a workspace, behind the member
// door: every member reads it, and core checks `workspace.manage` before a save reads or writes anything. A save
// changes no record, so it stores no change event; the public pages read the kit afresh on their next load.
export const brandRouter = member.brand.router({
  get: member.brand.get.handler(({ context }) => getWorkspaceBrand(context.scope)),
  save: member.brand.save.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveWorkspaceBrand(context.scope, { accent: input.accent, accentDark: input.accentDark }),
    ),
  ),
});
