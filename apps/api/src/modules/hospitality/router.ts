import {
  addResources,
  archiveResource,
  createPlace,
  deleteArea,
  deleteResource,
  getBusiness,
  installApp,
  listApps,
  moveResource,
  listResources,
  removeApp,
  restoreResource,
  saveArea,
  saveBusiness,
  updatePlace,
  updateResource,
} from '@crm/core';
import { businessCacheTags } from '@crm/contracts';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// The Hospitality suite's setup (spec 0065, H0): the Apps page, the business, its places and each place's floor.
// Inside a workspace, behind the member door; core checks the permission (`workspace.manage` to install and remove,
// `hospitality.manage` for the rest) before anything is read, then the app gate (`APP_NOT_INSTALLED`). None of these
// change a record; installing or removing an app stores one `nav` change event naming every active member, so their
// sidebars follow, and the rest store none (each screen holds its own copy and reads it again when opened).
const h = member.hospitality;

export const hospitalityRouter = h.router({
  apps: h.apps.handler(({ context }) => listApps(context.scope)),
  install: h.install.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      installApp(
        context.scope,
        {
          app: input.app,
          withNeeded: input.withNeeded,
          ...(input.business === undefined ? {} : { business: input.business }),
        },
        hooks,
      ),
    ),
  ),
  remove: h.remove.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeApp(context.scope, { app: input.app, withDependents: input.withDependents }, hooks),
    ),
  ),
  business: h.business.handler(({ context }) => getBusiness(context.scope)),
  saveBusiness: h.saveBusiness.handler(async ({ context, input }) => {
    const saved = await commitWrite(context, { mutationId: input.mutationId }, () =>
      saveBusiness(context.scope, input.profile),
    );
    // The business page reads its name, kind and contact live (spec 0066, B4): its edge copies go.
    await context.edgeCache.forget(businessCacheTags(context.scope.workspaceId));
    return saved;
  }),
  createPlace: h.createPlace.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      createPlace(context.scope, { id: input.id, place: input.place }),
    ),
  ),
  updatePlace: h.updatePlace.handler(async ({ context, input }) => {
    const place = await commitWrite(context, { mutationId: input.mutationId }, () =>
      updatePlace(context.scope, {
        placeId: input.placeId,
        ...(input.place === undefined ? {} : { place: input.place }),
        ...(input.hours === undefined ? {} : { hours: input.hours }),
      }),
    );
    // A place's address and hours show on the business page live (spec 0066, B4): its edge copies go.
    await context.edgeCache.forget(businessCacheTags(context.scope.workspaceId, [input.placeId]));
    return place;
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
});
