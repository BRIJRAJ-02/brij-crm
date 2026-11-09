import {
  duplicateService,
  addStaffBlock,
  addStaffTimeOff,
  archiveServices,
  archiveStaff,
  copyShifts,
  deleteServiceCategory,
  getCatalogue,
  getShifts,
  getTeam,
  linkStaff,
  moveService,
  moveServiceCategory,
  moveStaff,
  removeStaffBlock,
  removeStaffPhoto,
  removeStaffTimeOff,
  restoreServices,
  restoreStaff,
  saveService,
  saveServiceCategory,
  saveStaff,
  serviceTimes,
  setServicesCategory,
  setServicesOnline,
  setShifts,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member } from '../../orpc.ts';

// Services, staff and shifts (spec 0066 B1): Settings › Services, Staff and Shifts. Inside a workspace, behind the
// member door; core checks the permission before any input is read (`services.manage` for the catalogue and the
// profiles, `services.calendar` for shifts, time off, blocks and the desk's times), then the Appointments gate. Every
// write answers the whole catalogue or team, and stores one `visits` change event naming the places it touched, so an
// open catalogue, team or day reads again; it purges those places' offered times too.
const s = member.services;

/** The business a catalogue call names (spec 0065 H7), as core takes it: left out, the workspace's first. */
const inProperty = (input: { readonly property?: string | undefined }) =>
  input.property === undefined ? {} : { propertyId: input.property };

export const servicesRouter = s.router({
  catalogue: s.catalogue.handler(({ context, input }) => getCatalogue(context.scope, inProperty(input))),
  saveCategory: s.saveCategory.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveServiceCategory(
        context.scope,
        { ...inProperty(input), id: input.id, name: input.name },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  deleteCategory: s.deleteCategory.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteServiceCategory(
        context.scope,
        { ...inProperty(input), categoryId: input.categoryId },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  moveCategory: s.moveCategory.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveServiceCategory(
        context.scope,
        { ...inProperty(input), categoryId: input.categoryId, toIndex: input.toIndex },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  saveService: s.saveService.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveService(
        context.scope,
        { ...inProperty(input), id: input.id, service: input.service },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  moveService: s.moveService.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveService(
        context.scope,
        { ...inProperty(input), serviceId: input.serviceId, categoryId: input.categoryId, toIndex: input.toIndex },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  setOnline: s.setOnline.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setServicesOnline(
        context.scope,
        { ...inProperty(input), serviceIds: input.serviceIds, online: input.online },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  setCategory: s.setCategory.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setServicesCategory(
        context.scope,
        { ...inProperty(input), serviceIds: input.serviceIds, categoryId: input.categoryId },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  archive: s.archive.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      archiveServices(
        context.scope,
        { ...inProperty(input), serviceIds: input.serviceIds },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  // A copy into another business's catalogue (spec 0065 H7, AC-6591).
  duplicate: s.duplicate.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      duplicateService(
        context.scope,
        { ...inProperty(input), serviceId: input.serviceId, toPropertyId: input.to, id: input.id },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  restore: s.restore.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreServices(
        context.scope,
        { ...inProperty(input), serviceIds: input.serviceIds },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  team: s.team.handler(({ context }) => getTeam(context.scope)),
  shifts: s.shifts.handler(({ context }) => getShifts(context.scope)),
  saveStaff: s.saveStaff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveStaff(context.scope, { id: input.id, staff: input.staff }, { slotCache: context.visitSlots }, hooks),
    ),
  ),
  moveStaff: s.moveStaff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      moveStaff(
        context.scope,
        { staffId: input.staffId, toIndex: input.toIndex },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  // Linking stores one `visits` event naming the profile's places, as every write here does.
  linkStaff: s.linkStaff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      linkStaff(context.scope, { staffId: input.staffId, memberId: input.memberId }, {}, hooks),
    ),
  ),
  archiveStaff: s.archiveStaff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      archiveStaff(context.scope, { staffId: input.staffId }, { slotCache: context.visitSlots }, hooks),
    ),
  ),
  restoreStaff: s.restoreStaff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      restoreStaff(context.scope, { staffId: input.staffId }, { slotCache: context.visitSlots }, hooks),
    ),
  ),
  removeStaffPhoto: s.removeStaffPhoto.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeStaffPhoto(
        context.scope,
        { staffId: input.staffId },
        {
          slotCache: context.visitSlots,
          // The file goes once the row let go of it, so nothing keeps a face nobody points at.
          forgetFile: async (path) => {
            await context.files?.remove([path]).catch(() => undefined);
          },
        },
        hooks,
      ),
    ),
  ),
  setShifts: s.setShifts.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setShifts(
        context.scope,
        { staffId: input.staffId, placeId: input.placeId, shifts: input.shifts, outsideHours: input.outsideHours },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  copyShifts: s.copyShifts.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      copyShifts(
        context.scope,
        { staffId: input.staffId, placeId: input.placeId, toStaffIds: input.toStaffIds },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  addTimeOff: s.addTimeOff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      addStaffTimeOff(
        context.scope,
        {
          id: input.id,
          staffId: input.staffId,
          placeId: input.placeId,
          start: input.start,
          end: input.end,
          reason: input.reason,
        },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  removeTimeOff: s.removeTimeOff.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeStaffTimeOff(context.scope, { id: input.id }, { slotCache: context.visitSlots }, hooks),
    ),
  ),
  addBlock: s.addBlock.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      addStaffBlock(
        context.scope,
        {
          id: input.id,
          staffId: input.staffId,
          placeId: input.placeId,
          start: input.start,
          end: input.end,
          reason: input.reason,
        },
        { slotCache: context.visitSlots },
        hooks,
      ),
    ),
  ),
  removeBlock: s.removeBlock.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      removeStaffBlock(context.scope, { id: input.id }, { slotCache: context.visitSlots }, hooks),
    ),
  ),
  times: s.times.handler(({ context, input }) =>
    serviceTimes(
      context.scope,
      { busy: context.bookingCalendar.busy, slotCache: context.visitSlots },
      {
        placeId: input.placeId,
        serviceId: input.serviceId,
        variantId: input.variantId,
        staffId: input.staffId,
        date: input.date,
      },
    ),
  ),
});
