import { menuCacheTags } from '@crm/contracts';
import {
  addResources,
  archiveResource,
  businessCacheTags,
  createPlace,
  createProperty,
  listProperties,
  removeProperty,
  deleteArea,
  deleteResource,
  getBusiness,
  getMemberReach,
  setMemberReach,
  menuPlaceIds,
  installApp,
  listApps,
  moveResource,
  listResources,
  listQrCodes,
  regenerateTableCode,
  removeApp,
  restoreResource,
  saveArea,
  saveBusiness,
  updatePlace,
  updateResource,
} from '@crm/core';
import { forgetAfterCommit } from '../../edge-cache.ts';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext } from '../../orpc.ts';

// The Hospitality suite's setup (spec 0065, H0): the Apps page, the business, its places and each place's floor.
// Inside a workspace, behind the member door; core checks the permission (`workspace.manage` to install and remove,
// `hospitality.manage` for the rest) before anything is read, then the app gate (`APP_NOT_INSTALLED`). None of these
// change a record; installing or removing an app stores one `nav` change event naming every active member, so their
// sidebars follow, and the rest store none (each screen holds its own copy and reads it again when opened).
const h = member.hospitality;

/**
 * Purges every place's guest menu from the edge (Rules settled: Routes): the business, a place's address or hours,
 * or an app installed or removed changes what `/m/<key>` answers, so its copies go once the write committed.
 */
async function forgetMenus(context: RequestContext & { readonly scope: Parameters<typeof menuPlaceIds>[0] }) {
  await forgetAfterCommit(context.edgeCache, menuCacheTags(...(await menuPlaceIds(context.scope))));
}

export const hospitalityRouter = h.router({
  apps: h.apps.handler(({ context }) => listApps(context.scope)),
  install: h.install.handler(async ({ context, input }) => {
    const view = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      installApp(
        context.scope,
        {
          app: input.app,
          withNeeded: input.withNeeded,
          ...(input.business === undefined ? {} : { business: input.business }),
        },
        hooks,
      ),
    );
    await forgetMenus(context);
    // The business page shows what its apps add (the menu, Reserve) and is live only while one is on: its edge
    // copies go with any change of apps (spec 0066, AC-6816).
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId));
    return view;
  }),
  remove: h.remove.handler(async ({ context, input }) => {
    const view = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeApp(context.scope, { app: input.app, withDependents: input.withDependents }, hooks),
    );
    await forgetMenus(context);
    // With the last app gone the page answers 404 at once, not after the edge's minute (spec 0066, AC-6816).
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId));
    return view;
  }),
  business: h.business.handler(({ context, input }) =>
    getBusiness(context.scope, input.property === undefined ? {} : { propertyId: input.property }),
  ),
  // Properties (spec 0065 H7, slice 2): adding or removing one changes every member's sidebar (the switcher), so each
  // stores one `nav` change event; neither changes a guest page, so nothing at the edge is purged.
  properties: h.properties.handler(({ context }) => listProperties(context.scope)),
  createProperty: h.createProperty.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      createProperty(
        context.scope,
        { id: input.id, name: input.name, kind: input.kind, currency: input.currency },
        hooks,
      ),
    ),
  ),
  removeProperty: h.removeProperty.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeProperty(context.scope, { propertyId: input.property }, hooks),
    ),
  ),
  // Where a member may work (spec 0065 H7, AC-6594): the member panel's picker. A change stores one `nav` change event
  // for that member; it changes no guest page, so nothing at the edge is purged.
  memberReach: h.memberReach.handler(({ context, input }) =>
    getMemberReach(context.scope, { memberId: input.memberId }),
  ),
  setMemberReach: h.setMemberReach.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setMemberReach(context.scope, { memberId: input.memberId, reach: input.reach }, hooks),
    ),
  ),
  saveBusiness: h.saveBusiness.handler(async ({ context, input }) => {
    const saved = await commitWrite(context, { mutationId: input.mutationId }, () =>
      saveBusiness(context.scope, input.profile, input.property === undefined ? {} : { propertyId: input.property }),
    );
    await forgetMenus(context);
    // The business page reads its name, kind and contact live (spec 0066, B4): its edge copies go.
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId));
    return saved;
  }),
  createPlace: h.createPlace.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      createPlace(context.scope, {
        id: input.id,
        place: input.place,
        ...(input.property === undefined ? {} : { propertyId: input.property }),
      }),
    ),
  ),
  updatePlace: h.updatePlace.handler(async ({ context, input }) => {
    const saved = await commitWrite(context, { mutationId: input.mutationId }, () =>
      updatePlace(context.scope, {
        placeId: input.placeId,
        ...(input.place === undefined ? {} : { place: input.place }),
        ...(input.hours === undefined ? {} : { hours: input.hours }),
      }),
    );
    await forgetAfterCommit(context.edgeCache, menuCacheTags(saved.id));
    // A place's address and hours show on the business page live (spec 0066, B4): its edge copies go.
    await forgetAfterCommit(context.edgeCache, businessCacheTags(context.scope.workspaceId, [input.placeId]));
    return saved;
  }),
  resources: h.resources.handler(({ context, input }) => listResources(context.scope, { placeId: input.placeId })),
  saveArea: h.saveArea.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      saveArea(context.scope, {
        placeId: input.placeId,
        name: input.name,
        ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
        ...(input.id === undefined ? {} : { id: input.id }),
      }),
    ),
  ),
  deleteArea: h.deleteArea.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteArea(context.scope, { placeId: input.placeId, areaId: input.areaId }),
    ),
  ),
  addResources: h.addResources.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      addResources(context.scope, {
        placeId: input.placeId,
        kind: input.kind,
        labels: input.labels,
        minCapacity: input.minCapacity,
        maxCapacity: input.maxCapacity,
        online: input.online,
        ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
      }),
    ),
  ),
  updateResource: h.updateResource.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updateResource(context.scope, {
        placeId: input.placeId,
        resourceId: input.resourceId,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
        ...(input.minCapacity === undefined ? {} : { minCapacity: input.minCapacity }),
        ...(input.maxCapacity === undefined ? {} : { maxCapacity: input.maxCapacity }),
        ...(input.online === undefined ? {} : { online: input.online }),
        ...(input.joins === undefined ? {} : { joins: input.joins }),
      }),
    ),
  ),
  moveResource: h.moveResource.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      moveResource(context.scope, { placeId: input.placeId, resourceId: input.resourceId, toIndex: input.toIndex }),
    ),
  ),
  archiveResource: h.archiveResource.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      archiveResource(context.scope, { placeId: input.placeId, resourceId: input.resourceId }),
    ),
  ),
  restoreResource: h.restoreResource.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      restoreResource(context.scope, { placeId: input.placeId, resourceId: input.resourceId }),
    ),
  ),
  deleteResource: h.deleteResource.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteResource(context.scope, { placeId: input.placeId, resourceId: input.resourceId }),
    ),
  ),
  // Menu QR (spec 0065, H2): a place's table codes, and a new code for one table. A code changes no guest menu answer
  // (the menu is read by key; the table by its code, never cached), so nothing at the edge is purged.
  qrCodes: h.qrCodes.handler(({ context, input }) => listQrCodes(context.scope, { placeId: input.placeId })),
  regenerateTableCode: h.regenerateTableCode.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      regenerateTableCode(context.scope, { placeId: input.placeId, resourceId: input.resourceId }),
    ),
  ),
});
