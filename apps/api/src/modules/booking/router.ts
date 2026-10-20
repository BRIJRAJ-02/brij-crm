import {
  bookAsHost,
  bookingGuestPath,
  cancelBooking,
  hostTarget,
  moveBooking,
  readMoveSlots,
  createBookingPage,
  createTimeBlock,
  deleteBookingPage,
  getBookingPage,
  getMemberHours,
  listBookingPages,
  listBookings,
  listWorkspaceBookings,
  readBookingsCalendar,
  removeTimeBlock,
  setMemberHours,
  updateBookingPage,
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
  create: member.bookingPages.create.handler(async ({ context, input }) => {
    try {
      return await commitWrite(context, { mutationId: input.mutationId }, () =>
        createBookingPage(context.scope, {
          id: input.id,
          title: input.title,
          timeZone: input.timeZone,
          ...(input.settings === undefined ? {} : { settings: input.settings }),
        }),
      );
    } catch (error) {
      throw withInputFields(error, { ID_TAKEN: 'id' });
    }
  }),
  update: member.bookingPages.update.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      updateBookingPage(context.scope, { pageId: input.pageId, settings: input.settings }),
    ),
  ),
  delete: member.bookingPages.delete.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      deleteBookingPage(context.scope, { pageId: input.pageId }),
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
  // Bookings' week: the bookings in a range and the reader's own calendar events beside them.
  calendar: member.bookings.calendar.handler(({ context, input }) =>
    readBookingsCalendar(context.scope, { from: input.from, to: input.to }),
  ),
  // The member's own hours and days off (Bookings › Availability), which their pages may follow.
  hours: member.bookings.hours.handler(({ context, input }) =>
    getMemberHours(context.scope, { timeZone: input.timeZone }),
  ),
  setHours: member.bookings.setHours.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      setMemberHours(context.scope, { availability: input.availability }),
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
        },
        hooks,
      );
      return { bookingId: booked.bookingId };
    }),
  ),
  // Changing a booking (AC-640): its host, the page's owner or an admin moves or cancels it; the guest is emailed.
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
  move: member.bookings.move.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, () =>
      moveBooking(
        hostTarget(context.scope, input.bookingId),
        { calendar: context.bookingCalendar, log },
        { start: new Date(input.start) },
      ),
    ),
  ),
  moveSlots: member.bookings.moveSlots.handler(({ context, input }) =>
    readMoveSlots(
      hostTarget(context.scope, input.bookingId),
      { calendar: context.bookingCalendar, log },
      { from: new Date(input.from), to: new Date(input.to) },
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
        }),
      ),
    ),
    remove: member.bookings.blocks.remove.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () => removeTimeBlock(context.scope, { id: input.id })),
    ),
  },
});
