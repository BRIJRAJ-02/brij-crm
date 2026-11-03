import {
  addTables,
  archiveTable,
  createPlace,
  deleteArea,
  deleteTable,
  getBusiness,
  installApp,
  listApps,
  moveTable,
  readFloor,
  removeApp,
  restoreTable,
  saveArea,
  saveBusiness,
  updatePlace,
  updateTable,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// The Hospitality suite's setup (spec 0065, H0): the Apps page, the business, its places and each place's floor.
// Inside a workspace, behind the member door; core checks the permission (`workspace.manage` to install and remove,
// `hospitality.manage` for the rest) before anything is read, then the app gate (`APP_NOT_INSTALLED`). None of these
// change a record, so they store no change event; each screen holds its own copy and reads it again when opened.
const h = member.hospitality;

export const hospitalityRouter = h.router({
  apps: h.apps.handler(({ context }) => listApps(context.scope)),
  install: h.install.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      installApp(context.scope, {
        app: input.app,
        withNeeded: input.withNeeded,
        ...(input.business === undefined ? {} : { business: input.business }),
      }),
    ),
  ),
  remove: h.remove.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      removeApp(context.scope, { app: input.app, withDependents: input.withDependents }),
    ),
  ),
  business: h.business.handler(({ context }) => getBusiness(context.scope)),
  saveBusiness: h.saveBusiness.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () => saveBusiness(context.scope, input.profile)),
  ),
  createPlace: h.createPlace.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      createPlace(context.scope, { id: input.id, place: input.place }),
    ),
  ),
  updatePlace: h.updatePlace.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updatePlace(context.scope, {
        placeId: input.placeId,
        ...(input.place === undefined ? {} : { place: input.place }),
        ...(input.hours === undefined ? {} : { hours: input.hours }),
      }),
    ),
  ),
  floor: h.floor.handler(({ context, input }) => readFloor(context.scope, { placeId: input.placeId })),
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
  addTables: h.addTables.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      addTables(context.scope, {
        placeId: input.placeId,
        labels: input.labels,
        minGuests: input.minGuests,
        maxGuests: input.maxGuests,
        online: input.online,
        ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
      }),
    ),
  ),
  updateTable: h.updateTable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updateTable(context.scope, {
        placeId: input.placeId,
        tableId: input.tableId,
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
        ...(input.minGuests === undefined ? {} : { minGuests: input.minGuests }),
        ...(input.maxGuests === undefined ? {} : { maxGuests: input.maxGuests }),
        ...(input.online === undefined ? {} : { online: input.online }),
        ...(input.joins === undefined ? {} : { joins: input.joins }),
      }),
    ),
  ),
  moveTable: h.moveTable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      moveTable(context.scope, { placeId: input.placeId, tableId: input.tableId, toIndex: input.toIndex }),
    ),
  ),
  archiveTable: h.archiveTable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      archiveTable(context.scope, { placeId: input.placeId, tableId: input.tableId }),
    ),
  ),
  restoreTable: h.restoreTable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      restoreTable(context.scope, { placeId: input.placeId, tableId: input.tableId }),
    ),
  ),
  deleteTable: h.deleteTable.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteTable(context.scope, { placeId: input.placeId, tableId: input.tableId }),
    ),
  ),
});
