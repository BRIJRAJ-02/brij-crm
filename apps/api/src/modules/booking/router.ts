import {
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
  // Time the member closes on their own calendar (spec 0027): a block, or a hold for private pages.
  blocks: {
    create: member.bookings.blocks.create.handler(({ context, input }) =>
      commitWrite(context, { mutationId: input.mutationId }, () =>
        createTimeBlock(context.scope, {
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
