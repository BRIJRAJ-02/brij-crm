import { brandCacheTags, linkPageCacheTags } from '@crm/contracts';
import {
  businessCacheTags,
  discardBrandTemplate,
  getWorkspaceBrand,
  publishBrandTemplate,
  saveWorkspaceBrand,
  workspaceHandles,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// A workspace's brand kit (spec 0060, AC-1, AC-3, AC-23): Settings › Brand. Inside a workspace, behind the member
// door: every member reads it, and core checks `workspace.manage` before a save reads or writes anything. A save
// changes no record, so it stores no change event; it purges the edge's copies of the public brand answers.
export const brandRouter = member.brand.router({
  get: member.brand.get.handler(({ context }) => getWorkspaceBrand(context.scope)),
  save: member.brand.save.handler(async ({ context, input }) => {
    const saved = await commitWrite(context, { mutationId: input.mutationId }, () =>
      saveWorkspaceBrand(context.scope, {
        accent: input.accent,
        accentDark: input.accentDark,
        ...(input.template === undefined ? {} : { template: input.template }),
      }),
    );
    // Once committed, the edge's copies of every page's brand stylesheet and logo are deleted (AC-21), and the business
    // page's answer, which names its guest look's version (the accent is in it), so it never names an old one.
    await context.edgeCache.forget([
      ...brandCacheTags(context.scope.workspaceId),
      ...businessCacheTags(context.scope.workspaceId),
    ]);
    return saved;
  }),
  // The waiting template goes live (spec 0068): every public page's edge copies go once it has committed, the brand
  // answers and each member's link page, and the booking pages under their handles with it (AC-6816).
  publishTemplate: member.brand.publishTemplate.handler(async ({ context, input }) => {
    const published = await commitWrite(context, { mutationId: input.mutationId }, () =>
      publishBrandTemplate(context.scope),
    );
    const handles = await workspaceHandles(context.scope);
    await context.edgeCache.forget([...brandCacheTags(context.scope.workspaceId), ...linkPageCacheTags(...handles)]);
    return published;
  }),
  discardTemplate: member.brand.discardTemplate.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => discardBrandTemplate(context.scope)),
  ),
});
