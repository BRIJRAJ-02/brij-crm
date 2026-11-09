import { brandCacheTags, menuCacheTags } from '@crm/contracts';
import {
  businessCacheTags,
  deleteItem,
  deleteMenu,
  deleteOptionGroup,
  deleteSection,
  discardMenuDraft,
  moveMenuPart,
  placeItem,
  publishMenus,
  readMenuDraft,
  removeMenuPhoto,
  saveItem,
  saveMenu,
  saveMenuLook,
  saveOptionGroup,
  saveSection,
  setItemSoldOut,
  setMenuHidden,
} from '@crm/core';
import { forgetAfterCommit } from '../../edge-cache.ts';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext } from '../../orpc.ts';
import { errorFields, log } from '../../log.ts';

// The Menu app (spec 0065, H1): the editor's draft and its edits, Publish and Discard, and Sold out. Inside a
// workspace, behind the member door; core checks the permission before anything is read, then the app gate
// (`APP_NOT_INSTALLED`). None of these change a record, so they store no change event; the Menus screen holds the
// draft and every write answers it whole. Publish, Sold out and Live or Hidden purge the guest menus' edge copies (`menu:<placeId>`)
// once the write committed (Rules settled: Routes); photo files neither the draft nor the published menus name any
// more are removed from the store after Publish and Discard.
const m = member.menu;

/** The business a call names (spec 0065 H7), as core takes it: left out, the workspace's first. */
const inProperty = (input: { readonly property?: string | undefined }) =>
  input.property === undefined ? {} : { propertyId: input.property };

/** Removes stored photo files, quietly: a file left behind costs storage, never a wrong answer. */
async function removeFiles(context: RequestContext, paths: readonly string[]): Promise<void> {
  if (paths.length === 0 || context.files === undefined) return;
  await context.files.remove(paths).catch((error: unknown) => {
    log.warn('menu.photos.kept', { requestId: context.requestId, ...errorFields(error) });
  });
}

export const menuRouter = m.router({
  draft: m.draft.handler(({ context, input }) => readMenuDraft(context.scope, inProperty(input))),
  saveMenu: m.saveMenu.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveMenu(context.scope, {
        ...inProperty(input),
        id: input.id,
        name: input.name,
        placeIds: input.placeIds,
        ...(input.note === undefined ? {} : { note: input.note }),
        ...(input.serving === undefined ? {} : { serving: input.serving }),
        ...(input.taxRate === undefined ? {} : { taxRate: input.taxRate }),
        ...(input.serviceRate === undefined ? {} : { serviceRate: input.serviceRate }),
      }),
    ),
  ),
  deleteMenu: m.deleteMenu.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteMenu(context.scope, { ...inProperty(input), menuId: input.menuId }),
    ),
  ),
  saveSection: m.saveSection.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveSection(context.scope, {
        ...inProperty(input),
        id: input.id,
        menuId: input.menuId,
        name: input.name,
        layout: input.layout,
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.serving === undefined ? {} : { serving: input.serving }),
      }),
    ),
  ),
  deleteSection: m.deleteSection.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteSection(context.scope, { ...inProperty(input), sectionId: input.sectionId }),
    ),
  ),
  saveItem: m.saveItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveItem(context.scope, {
        ...inProperty(input),
        id: input.id,
        item: input.item,
        ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
      }),
    ),
  ),
  deleteItem: m.deleteItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteItem(context.scope, { ...inProperty(input), itemId: input.itemId }),
    ),
  ),
  removePhoto: m.removePhoto.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      removeMenuPhoto(context.scope, { ...inProperty(input), itemId: input.itemId }),
    ),
  ),
  placeItem: m.placeItem.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      placeItem(context.scope, {
        ...inProperty(input),
        itemId: input.itemId,
        sectionId: input.sectionId,
        placed: input.placed,
      }),
    ),
  ),
  move: m.move.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      moveMenuPart(context.scope, {
        ...inProperty(input),
        part: input.part,
        id: input.id,
        toIndex: input.toIndex,
        ...(input.sectionId === undefined ? {} : { sectionId: input.sectionId }),
      }),
    ),
  ),
  saveGroup: m.saveGroup.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveOptionGroup(context.scope, {
        ...inProperty(input),
        id: input.id,
        name: input.name,
        rule: input.rule,
        min: input.min,
        options: input.options,
        ...(input.max === undefined ? {} : { max: input.max }),
      }),
    ),
  ),
  deleteGroup: m.deleteGroup.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteOptionGroup(context.scope, { ...inProperty(input), groupId: input.groupId }),
    ),
  ),
  setSoldOut: m.setSoldOut.handler(async ({ context, input }) => {
    const { draft, placeIds } = await commitWrite(context, { mutationId: input.mutationId }, () =>
      setItemSoldOut(context.scope, { ...inProperty(input), itemId: input.itemId, soldOut: input.soldOut }),
    );
    await forgetAfterCommit(context.edgeCache, menuCacheTags(...placeIds));
    // The business page shows the menu too (spec 0066, AC-6642): its edge copies go with the guest menu's.
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId, placeIds));
    return draft;
  }),
  setHidden: m.setHidden.handler(async ({ context, input }) => {
    const { draft, placeIds } = await commitWrite(context, { mutationId: input.mutationId }, () =>
      setMenuHidden(context.scope, { ...inProperty(input), hidden: input.hidden }),
    );
    await forgetAfterCommit(context.edgeCache, menuCacheTags(...placeIds));
    // The business page shows the menu too (spec 0066, AC-6642): its edge copies go with the guest menu's.
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId, placeIds));
    return draft;
  }),
  // The guest look (spec 0065, AC-6570 as amended): live at once, so every guest page's edge copy goes once it has
  // committed: the menus' answers and shells, the business page's, and anything filed under the brand.
  saveLook: m.saveLook.handler(async ({ context, input }) => {
    const { draft, placeIds, removedPaths } = await commitWrite(context, { mutationId: input.mutationId }, () =>
      saveMenuLook(context.scope, { ...inProperty(input), look: input.look }),
    );
    await forgetAfterCommit(context.edgeCache, [
      ...menuCacheTags(...placeIds),
      ...businessCacheTags(context.scope.workspaceId, placeIds),
      ...brandCacheTags(context.scope.workspaceId),
    ]);
    await removeFiles(context, removedPaths);
    return draft;
  }),
  publish: m.publish.handler(async ({ context, input }) => {
    const { draft, placeIds, removedPaths } = await commitWrite(context, { mutationId: input.mutationId }, () =>
      publishMenus(context.scope, inProperty(input)),
    );
    await forgetAfterCommit(context.edgeCache, menuCacheTags(...placeIds));
    // The business page shows the menu too (spec 0066, AC-6642): its edge copies go with the guest menu's.
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId, placeIds));
    await removeFiles(context, removedPaths);
    return draft;
  }),
  discard: m.discard.handler(async ({ context, input }) => {
    const { draft, removedPaths } = await commitWrite(context, { mutationId: input.mutationId }, () =>
      discardMenuDraft(context.scope, inProperty(input)),
    );
    await removeFiles(context, removedPaths);
    return draft;
  }),
});
