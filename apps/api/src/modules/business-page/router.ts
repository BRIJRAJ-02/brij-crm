import {
  businessCacheTags,
  claimBusinessHandle,
  discardBusinessPage,
  getBusinessPage,
  publishBusinessPage,
  saveBusinessPage,
  setPlaceSlug,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { member } from '../../orpc.ts';

// The business page's editor (spec 0066, B4 lite): Settings › Business › Page. Inside a workspace, behind the member
// door; core checks `hospitality.manage` before anything is read, then the app gate. None of these change a record
// or store an outbox row (the editor holds its own copy and reads it again when opened). What guests see changes on
// Publish, a new address or a new place slug: those delete the business's copies at the edge (`business:<opaque id>`
// covers every place's answer), and Publish removes the pictures nothing uses any more from the store.
const b = member.businessPage;

export const businessPageRouter = b.router({
  page: b.page.handler(({ context }) => getBusinessPage(context.scope)),
  claimHandle: b.claimHandle.handler(async ({ context, input }) => {
    const changed = await commitWrite(context, { mutationId: input.mutationId }, () =>
      claimBusinessHandle(context.scope, { handle: input.handle }),
    );
    if (changed.stale) await context.edgeCache.forget(businessCacheTags(context.scope.workspaceId));
    return changed.view;
  }),
  save: b.save.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveBusinessPage(context.scope, { draft: input.draft }),
    ),
  ),
  setPlaceSlug: b.setPlaceSlug.handler(async ({ context, input }) => {
    const changed = await commitWrite(context, { mutationId: input.mutationId }, () =>
      setPlaceSlug(context.scope, { placeId: input.placeId, slug: input.slug }),
    );
    await context.edgeCache.forget(businessCacheTags(context.scope.workspaceId, [input.placeId]));
    return changed.view;
  }),
  publish: b.publish.handler(async ({ context, input }) => {
    const published = await commitWrite(context, { mutationId: input.mutationId }, () =>
      publishBusinessPage(context.scope),
    );
    await context.edgeCache.forget(businessCacheTags(context.scope.workspaceId));
    if (published.unusedPaths.length > 0 && context.files !== undefined) {
      // Their rows are gone already; a store that keeps a file only keeps an unreachable one, so it is logged, not thrown.
      await context.files.remove([...published.unusedPaths]).catch((error: unknown) => {
        log.warn('business_page.photos.unremoved', errorFields(error));
      });
    }
    return published.view;
  }),
  discard: b.discard.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => discardBusinessPage(context.scope)),
  ),
});
