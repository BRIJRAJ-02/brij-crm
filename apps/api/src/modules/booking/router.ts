import {
  bookAsHost,
  listEditors,
  setEditors,
  bookingAssignments,
  reassignBooking,
  reassignUpcoming,
  rotationDistribution,
  adjustCount,
  undoAdjustment,
  createRotation,
  deleteRotation,
  listRotations,
  updateRotation,
  bookingGuestPath,
  cancelBooking,
  linkBookingRecord,
  markNoShow,
  routingReport,
  hostTarget,
  moveBooking,
  readMoveSlots,
  createBookingPage,
  createSchedule,
  createTimeBlock,
  deleteBookingPage,
  deleteSchedule,
  duplicateSchedule,
  bookingPageAttributes,
  getBookingPage,
  getSchedule,
  listBookingPages,
  listBookings,
  listScheduleMembers,
  listSchedules,
  listMeetings,
  listWorkspaceBookings,
  readBookingsCalendar,
  readTeamDay,
  reorderProfilePages,
  readDefaultHours,
  removeTimeBlock,
  saveDefaultHours,
  setDefaultSchedule,
  updateBookingPage,
  updateSchedule,
} from '@crm/core';
import { withInputFields } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { log } from '../../log.ts';
import { member } from '../../orpc.ts';

// Booking pages (spec 0025), inside a workspace: the door has let in an active member, and `context.scope` is theirs.
// The services check `booking.manage` and whose page it is. A page is settings, not CRM data: its writes store no
// outbox row, but still go through `commitWrite`, the one write path.
export const bookingPagesRouter = member.bookingPages.router({
  list: member.bookingPages.list.handler(async ({ context }) => [...(await listBookingPages(context.scope))]),
  get: member.bookingPages.get.handler(({ context, input }) => getBookingPage(context.scope, { pageId: input.pageId })),
  attributes: member.bookingPages.attributes.handler(({ context, input }) =>
    bookingPageAttributes(context.scope, { pageId: input.pageId }),
  ),
  create: member.bookingPages.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, () =>
        createBookingPage(context.scope, {
          id: input.id,
          title: input.title,
          timeZone: input.timeZone,
          ...(input.settings === undefined ? {} : { settings: input.settings }),
          ...(input.kind === undefined ? {} : { kind: input.kind }),
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.hosts === undefined ? {} : { hosts: input.hosts }),
        }),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  update: member.bookingPages.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updateBookingPage(context.scope, {
        pageId: input.pageId,
        settings: input.settings,
        ...(input.hosts === undefined ? {} : { hosts: input.hosts }),
        ...(input.routing === undefined ? {} : { routing: input.routing }),
      }),
    ),
  ),
  delete: member.bookingPages.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteBookingPage(context.scope, { pageId: input.pageId }),
    ),
  ),
  // The caller's own pages in their profile's new order (owner ask A102), one write: Settings › Profile's drag.
  reorderProfile: member.bookingPages.reorderProfile.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      reorderProfilePages(context.scope, { pageIds: input.pageIds }),
    ),
  ),
});

/** A page's bookings (AC-646), for whoever may change the page. */
export const bookingsRouter = member.bookings.router({
  list: member.bookings.list.handler(async ({ context, input }) => [
    ...(await listBookings(context.scope, { pageId: input.pageId, when: input.when })),
  ]),
  // Bookings, the workspace's list: every booking the reader may see, upcoming or past.
  listAll: member.bookings.listAll.handler(async ({ context, input }) => [
    ...(await listWorkspaceBookings(context.scope, { when: input.when })),
  ]),
  // Bookings' list: every meeting, bookings and the reader's own calendar events, a page at a time.
  meetings: member.bookings.meetings.handler(({ context, input }) =>
    listMeetings(context.scope, {
      when: input.when,
      source: input.source,
      hosts: input.hosts,
      ...(input.calendarIds === undefined ? {} : { calendarIds: input.calendarIds }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
    }),
  ),
  // Bookings' week: the bookings in a range and the reader's own calendar events beside them.
  calendar: member.bookings.calendar.handler(({ context, input }) =>
    readBookingsCalendar(context.scope, { from: input.from, to: input.to, hosts: input.hosts }),
  ),
  // The Team day (spec 0030, as spec 0037 amends it): one column per member in the reader's See reach.
  teamDay: member.bookings.teamDay.handler(({ context, input }) =>
    readTeamDay(context.scope, {
      day: input.day,
      timeZone: input.timeZone,
      ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
      ...(input.withBookings === undefined ? {} : { withBookings: input.withBookings }),
      ...(input.order === undefined ? {} : { order: input.order }),
    }),
  ),
  // The member's default schedule's hours (spec 0035; `schedules.*` is the full surface).
  hours: member.bookings.hours.handler(({ context, input }) =>
    readDefaultHours(context.scope, { timeZone: input.timeZone }),
  ),
  setHours: member.bookings.setHours.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      saveDefaultHours(context.scope, { availability: input.availability }, hooks),
    ),
  ),
  // Book someone in (spec 0027): a booking in the member's own time, its records live, its event after the commit.
  bookAsHost: member.bookings.bookAsHost.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, async (hooks) => {
      const booked = await bookAsHost(
        context.scope,
        { calendar: context.bookingCalendar, linkKey: context.bookingLinkKey, log },
        {
          idempotencyKey: input.idempotencyKey,
          pageId: input.pageId,
          start: new Date(input.start),
          minutes: input.minutes,
          name: input.name,
          email: input.email,
          timeZone: input.timeZone,
          guests: input.guests,
          message: input.message,
          calendarId: input.calendarId,
          forMemberId: input.forMemberId,
        },
        hooks,
      );
      return { bookingId: booked.bookingId, ...(booked.notInCrm === undefined ? {} : { notInCrm: booked.notInCrm }) };
    }),
  ),
  // Changing a booking (AC-640): its host, a co-host, the page's owner or an admin moves or cancels it (`seen.ts`); the
  // guest is emailed.
  // Bookings write no change event: the screen reads its lists again after the change.
  cancel: member.bookings.cancel.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      cancelBooking(
        hostTarget(context.scope, input.bookingId),
        { calendar: context.bookingCalendar, log },
        { reason: input.reason },
      ),
    ),
  ),
  // A no show (spec 0043, AC-1613): its host, a co-host, the page's owner or an admin; audited, counted in routing's
  // report.
  markNoShow: member.bookings.markNoShow.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      markNoShow(context.scope, { bookingId: input.bookingId, noShow: input.noShow }),
    ),
  ),
  // A booking linked to a record by hand (polish F2): its host, a co-host, the page's owner or an admin, then the record's own
  // access (visible, and on an object they may change); audited.
  link: member.bookings.link.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      linkBookingRecord(context.scope, { bookingId: input.bookingId, recordId: input.recordId }),
    ),
  ),
  move: member.bookings.move.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      moveBooking(
        hostTarget(context.scope, input.bookingId),
        { calendar: context.bookingCalendar, log },
        { start: new Date(input.start), ...(input.minutes === undefined ? {} : { minutes: input.minutes }) },
      ),
    ),
  ),
  moveSlots: member.bookings.moveSlots.handler(({ context, input }) =>
    readMoveSlots(
      hostTarget(context.scope, input.bookingId),
      { calendar: context.bookingCalendar, log },
      {
        from: new Date(input.from),
        to: new Date(input.to),
        ...(input.minutes === undefined ? {} : { minutes: input.minutes }),
      },
    ),
  ),
  // Why a round robin booking went to its host (spec 0029, AC-742): its host and admins only.
  assignments: member.bookings.assignments.handler(async ({ context, input }) => [
    ...(await bookingAssignments(context.scope, { bookingId: input.bookingId })),
  ]),
  // Giving a round robin seat to someone else (spec 0029, AC-748): Manage over the current and the new host.
  reassign: member.bookings.reassign.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      reassignBooking(
        context.scope,
        { calendar: context.bookingCalendar, log },
        {
          bookingId: input.bookingId,
          ...(input.rotationId === undefined ? {} : { rotationId: input.rotationId }),
          ...(input.memberId === undefined ? {} : { memberId: input.memberId }),
        },
      ),
    ),
  ),
  // The guest page's address, read only when the member asks: it carries the guest's key.
  guestLink: member.bookings.guestLink.handler(({ context, input }) =>
    bookingGuestPath(context.scope, { linkKey: context.bookingLinkKey }, { bookingId: input.bookingId }),
  ),
  // Time the member closes on their own calendar (spec 0027): a block, or a hold for private pages.
  blocks: {
    create: member.bookings.blocks.create.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () =>
        createTimeBlock(context.scope, {
          id: input.id,
          kind: input.kind,
          repeat: input.repeat,
          date: input.date,
          startMinute: input.startMinute,
          endMinute: input.endMinute,
          timeZone: input.timeZone,
          label: input.label,
          pageId: input.pageId,
          forMemberId: input.forMemberId,
        }),
      ),
    ),
    remove: member.bookings.blocks.remove.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () => removeTimeBlock(context.scope, { id: input.id })),
    ),
  },
});

// Availability schedules (spec 0035): a member's named hours, their own with `booking.manage`, anyone's with
// `booking.admin`. Every write stores one `schedules` outbox row (ids only), so the member's other tabs read again.
export const schedulesRouter = member.schedules.router({
  members: member.schedules.members.handler(({ context }) => listScheduleMembers(context.scope)),
  list: member.schedules.list.handler(({ context, input }) =>
    listSchedules(context.scope, { memberId: input.memberId, timeZone: input.timeZone }),
  ),
  get: member.schedules.get.handler(({ context, input }) => getSchedule(context.scope, { id: input.id })),
  create: member.schedules.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
        createSchedule(
          context.scope,
          {
            id: input.id,
            memberId: input.memberId,
            name: input.name,
            timeZone: input.timeZone,
            availability: input.availability,
            isDefault: input.isDefault,
          },
          hooks,
        ),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  update: member.schedules.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      updateSchedule(
        context.scope,
        { id: input.id, name: input.name, availability: input.availability, updatedAt: input.updatedAt },
        hooks,
      ),
    ),
  ),
  setDefault: member.schedules.setDefault.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setDefaultSchedule(context.scope, { id: input.id }, hooks),
    ),
  ),
  duplicate: member.schedules.duplicate.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      duplicateSchedule(context.scope, { id: input.id, newId: input.newId }, hooks),
    ),
  ),
  delete: member.schedules.delete.handler(async ({ context, input }) => {
    const deleted = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      deleteSchedule(context.scope, { id: input.id }, hooks),
    );
    return { id: deleted.id, repointed: { pages: deleted.repointed.pages } };
  }),
});

// Rotations (spec 0029): the pools round robin pages book from. Listing needs `booking.manage` (a member sees the
// ones they're in, their own count only); making, changing and deleting need `booking.admin`. Settings, not CRM
// data: no outbox row, but every write goes through `commitWrite`.
export const rotationsRouter = member.rotations.router({
  list: member.rotations.list.handler(async ({ context }) => [...(await listRotations(context.scope))]),
  create: member.rotations.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, () =>
        createRotation(context.scope, { id: input.id, settings: input.settings, members: input.members }),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  update: member.rotations.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updateRotation(context.scope, {
        rotationId: input.rotationId,
        settings: input.settings,
        ...(input.members === undefined ? {} : { members: input.members }),
      }),
    ),
  ),
  distribution: member.rotations.distribution.handler(({ context, input }) =>
    rotationDistribution(context.scope, { rotationId: input.rotationId }),
  ),
  adjust: member.rotations.adjust.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      adjustCount(context.scope, {
        rotationId: input.rotationId,
        memberId: input.memberId,
        units: input.units,
        note: input.note,
      }),
    ),
  ),
  reassignUpcoming: member.rotations.reassignUpcoming.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      reassignUpcoming(context.scope, { rotationId: input.rotationId, memberId: input.memberId }),
    ),
  ),
  undoAdjustment: member.rotations.undoAdjustment.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      undoAdjustment(context.scope, { rotationId: input.rotationId, adjustmentId: input.adjustmentId }),
    ),
  ),
  delete: member.rotations.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteRotation(context.scope, { rotationId: input.rotationId }),
    ),
  ),
});

// Page and rotation editors (spec 0037, AC-1331): Sharing. Settings, not CRM data: no outbox row, but the write goes
// through `commitWrite`.
export const editorsRouter = member.editors.router({
  list: member.editors.list.handler(({ context, input }) =>
    listEditors(context.scope, { resourceType: input.resourceType, resourceId: input.resourceId }),
  ),
  set: member.editors.set.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      setEditors(context.scope, {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        memberIds: input.memberIds,
      }),
    ),
  ),
});

// Lead routing (spec 0043, AC-1612): a form's or a team page's per rule report. Rules are saved with their surface.
export const routingRouter = member.routing.router({
  report: member.routing.report.handler(({ context, input }) =>
    routingReport(context.scope, { surface: input.surface, days: input.days }),
  ),
});
