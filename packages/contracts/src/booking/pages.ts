// Booking pages for members (spec 0025, milestone 1): `bookingPages.*` lists,
// reads, makes, changes and deletes pages; `bookings.list` lists one page's
// bookings. A member with `booking.manage` changes their own pages; one with
// `booking.admin` changes everyone's.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { WorkspaceScoped } from '../workspaces.ts';
import { BookingLocation, BookingPageSettings } from './settings.ts';

/** A page as a member sees it in Settings › Booking pages. */
export const BookingPageView = BookingPageSettings.extend({
  id: z.uuid(),
  publicKey: z.string(),
  kind: z.enum(['personal', 'collective', 'round_robin']),
  ownerMemberId: z.uuid(),
  /** Confirmed bookings starting this calendar month (UTC). */
  bookingsThisMonth: z.number().int().min(0),
  /** The reader may change it: their own page with `booking.manage`, anyone's with `booking.admin`. */
  canChange: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
/** A page as a member sees it. */
export type BookingPageView = z.infer<typeof BookingPageView>;

/** Every page the reader may see: their own, or everyone's with `booking.admin`. */
export const ListBookingPagesInput = WorkspaceScoped;
/** The pages read. */
export type ListBookingPagesInput = z.infer<typeof ListBookingPagesInput>;

/** One page. */
export const GetBookingPageInput = WorkspaceScoped.extend({ pageId: z.uuid() });
/** One page. */
export type GetBookingPageInput = z.infer<typeof GetBookingPageInput>;

/**
 * A new personal page for the caller. `id` is a UUID v7 the browser mints, and
 * the retry key. Settings left out take their defaults: 30 minutes on video,
 * weekdays 09:00 to 17:00 in `timeZone`, no buffers or notice, 60 days ahead,
 * live, and a slug from the title.
 */
export const CreateBookingPageInput = WorkspaceScoped.extend({
  id: z.uuid({ version: 'v7', message: 'The page id must be a UUID v7.' }),
  title: BookingPageSettings.shape.title,
  timeZone: BookingPageSettings.shape.availability.shape.timeZone,
  settings: BookingPageSettings.partial().optional(),
  mutationId: z.uuid(),
});
/** A new personal page. */
export type CreateBookingPageInput = z.infer<typeof CreateBookingPageInput>;

/** A change to a page: only the settings given. */
export const UpdateBookingPageInput = WorkspaceScoped.extend({
  pageId: z.uuid(),
  settings: BookingPageSettings.partial(),
  mutationId: z.uuid(),
});
/** A change to a page. */
export type UpdateBookingPageInput = z.infer<typeof UpdateBookingPageInput>;

/** Deleting a page: it is hidden, its bookings stay, and its link answers that it's no longer available (AC-648). */
export const DeleteBookingPageInput = WorkspaceScoped.extend({ pageId: z.uuid(), mutationId: z.uuid() });
/** Deleting a page. */
export type DeleteBookingPageInput = z.infer<typeof DeleteBookingPageInput>;

/** A booking as the page's members see it. */
export const BookingView = z.object({
  id: z.uuid(),
  pageId: z.uuid(),
  hostMemberId: z.uuid(),
  startsAt: Timestamp,
  endsAt: Timestamp,
  visitorName: z.string(),
  visitorEmail: z.string(),
  visitorTimeZone: z.string(),
  status: z.enum(['confirmed', 'cancelled']),
  personRecordId: z.uuid().optional(),
  companyRecordId: z.uuid().optional(),
  /** The calendar event couldn't be made: the booking stands, and the host should add it by hand. */
  eventFailed: z.boolean(),
  createdAt: Timestamp,
});
/** A booking. */
export type BookingView = z.infer<typeof BookingView>;

/** At most this many bookings in one read. */
export const BOOKINGS_PAGE_MAX = 100;

/** One page's bookings: upcoming (soonest first) or past (latest first). */
export const ListBookingsInput = WorkspaceScoped.extend({
  pageId: z.uuid(),
  when: z.enum(['upcoming', 'past']),
});
/** One page's bookings. */
export type ListBookingsInput = z.infer<typeof ListBookingsInput>;

/** Member procedures for booking pages. */
export const bookingPagesContract = {
  list: oc.input(ListBookingPagesInput).output(z.array(BookingPageView)),
  get: oc.input(GetBookingPageInput).output(BookingPageView),
  create: oc.input(CreateBookingPageInput).output(BookingPageView),
  update: oc.input(UpdateBookingPageInput).output(BookingPageView),
  delete: oc.input(DeleteBookingPageInput).output(z.object({ pageId: z.uuid() })),
};

/** A member's own hours and days off, which their pages may follow. */
export const MemberHours = z.object({ availability: BookingPageSettings.shape.availability });
/** A member's own hours. */
export type MemberHours = z.infer<typeof MemberHours>;

/** The caller's own hours; never set yet, weekdays 09:00 to 17:00 in `timeZone`. */
export const GetMemberHoursInput = WorkspaceScoped.extend({
  timeZone: BookingPageSettings.shape.availability.shape.timeZone,
});
/** The caller's own hours. */
export type GetMemberHoursInput = z.infer<typeof GetMemberHoursInput>;

/** Replaces the caller's own hours. */
export const UpdateMemberHoursInput = WorkspaceScoped.extend({
  availability: BookingPageSettings.shape.availability,
  mutationId: z.uuid(),
});
/** Replaces the caller's own hours. */
export type UpdateMemberHoursInput = z.infer<typeof UpdateMemberHoursInput>;

/**
 * A booking in Bookings, the workspace's list (spec 0025, AC-646): the
 * booking, its page's title and location, the meeting's video link once the
 * event has one, the visitor's guests and note, and why it was cancelled.
 */
export const BookingListItem = BookingView.extend({
  pageTitle: z.string(),
  location: BookingLocation,
  videoUrl: z.string().optional(),
  guests: z.array(z.string()),
  note: z.string().optional(),
  cancelReason: z.string().optional(),
});
/** A booking in Bookings. */
export type BookingListItem = z.infer<typeof BookingListItem>;

/** At most this many bookings in one read of Bookings. */
export const BOOKINGS_LIST_MAX = 200;

/** Bookings' tabs: confirmed and not yet ended, confirmed and ended, and cancelled. */
export const BookingsTab = z.enum(['upcoming', 'past', 'cancelled']);
/** One of Bookings' tabs. */
export type BookingsTab = z.infer<typeof BookingsTab>;

/**
 * Bookings, the workspace's list: upcoming (confirmed, not yet ended, soonest
 * first), past (confirmed and ended, latest first) or cancelled (latest
 * first), across every page the reader may see (their own, and the ones they
 * host; everyone's with `booking.admin`).
 */
export const ListWorkspaceBookingsInput = WorkspaceScoped.extend({ when: BookingsTab });
/** Bookings, the workspace's list. */
export type ListWorkspaceBookingsInput = z.infer<typeof ListWorkspaceBookingsInput>;

/** Member procedures for bookings. */
export const bookingsContract = {
  list: oc.input(ListBookingsInput).output(z.array(BookingView)),
  listAll: oc.input(ListWorkspaceBookingsInput).output(z.array(BookingListItem)),
  hours: oc.input(GetMemberHoursInput).output(MemberHours),
  setHours: oc.input(UpdateMemberHoursInput).output(MemberHours),
};
