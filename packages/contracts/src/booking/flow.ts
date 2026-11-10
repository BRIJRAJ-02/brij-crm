// A booking page's flow rules for members (spec 0062, L1): the one off links a host makes from the page editor
// (AC-6204), and the Confirm and Decline a page that requires confirmation asks of its host (AC-6203).
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Timestamp } from '../values/attribute-values.ts';
import { Uuid } from '../values/ids.ts';
import { WorkspaceScoped } from '../workspaces.ts';

/** The most bookings one link may make. */
export const ONE_OFF_USES_MAX = 50;

/** The furthest ahead a link may expire, in days. */
export const ONE_OFF_EXPIRY_DAYS_MAX = 365;

/** How many links one page keeps listed. */
export const ONE_OFF_LINKS_MAX = 100;

/** The longest reason a decline may give its visitor. */
export const DECLINE_REASON_MAX = 500;

/** Where a link stands: `open` books, the rest answer "This link has been used". */
export const ONE_OFF_STATES = ['open', 'used', 'expired', 'revoked'] as const;
/** Where a link stands. */
export const OneOffState = z.enum(ONE_OFF_STATES);
/** Where a link stands. */
export type OneOffState = z.infer<typeof OneOffState>;

/** One one off link as its page's editor lists it: never its token, which is shown once, when it is made. */
export const OneOffLinkView = z.object({
  id: Uuid,
  label: z.string().optional(),
  maxUses: z.number().int(),
  uses: z.number().int(),
  expiresAt: Timestamp.optional(),
  state: OneOffState,
  createdAt: Timestamp,
});
/** One one off link. */
export type OneOffLinkView = z.infer<typeof OneOffLinkView>;

/** A page's one off links, newest first. */
export const ListOneOffLinksInput = WorkspaceScoped.extend({ pageId: Uuid });
/** A page's one off links. */
export type ListOneOffLinksInput = z.infer<typeof ListOneOffLinksInput>;

/** A new one off link: an optional label, its uses (1 by default) and an optional expiry up to a year ahead. */
export const CreateOneOffLinkInput = WorkspaceScoped.extend({
  pageId: Uuid,
  label: z
    .string()
    .trim()
    .max(60, { error: 'Keep the label to 60 characters.' })
    .optional()
    .transform((label) => (label === '' ? undefined : label)),
  maxUses: z
    .number()
    .int({ error: 'Give a whole number of bookings.' })
    .min(1, { error: 'A link books at least once.' })
    .max(ONE_OFF_USES_MAX, { error: `A link books at most ${String(ONE_OFF_USES_MAX)} times.` })
    .default(1),
  expiresAt: Timestamp.optional(),
  mutationId: Uuid,
});
/** A new one off link. */
export type CreateOneOffLinkInput = z.input<typeof CreateOneOffLinkInput>;

/** A new link and its token: the only answer that ever carries the token, so the editor copies it now or never. */
export const CreatedOneOffLink = z.object({ link: OneOffLinkView, token: z.string() });
/** A new link and its token. */
export type CreatedOneOffLink = z.infer<typeof CreatedOneOffLink>;

/** Revokes a link: it books nothing more. */
export const RevokeOneOffLinkInput = WorkspaceScoped.extend({ pageId: Uuid, linkId: Uuid, mutationId: Uuid });
/** Revokes a link. */
export type RevokeOneOffLinkInput = z.infer<typeof RevokeOneOffLinkInput>;

/** A page's bookings waiting for a Confirm, soonest first (AC-6203). */
export const ListRequestsInput = WorkspaceScoped.extend({ pageId: Uuid });
/** A page's requests. */
export type ListRequestsInput = z.infer<typeof ListRequestsInput>;

/** One booking waiting for a Confirm, as its host sees it: who asked, for when, and when it declines itself. */
export const BookingRequestView = z.object({
  bookingId: Uuid,
  start: Timestamp,
  end: Timestamp,
  visitorName: z.string(),
  visitorEmail: z.string(),
  /** When the wait runs out and the request declines itself. */
  expiresAt: Timestamp,
});
/** One booking waiting for a Confirm. */
export type BookingRequestView = z.infer<typeof BookingRequestView>;

/** The most requests Meetings › Requests lists at once, across every page. */
export const WAITING_REQUESTS_MAX = 100;

/** Every request the reader may answer, across the pages, for Meetings › Requests (the Bookings redesign). */
export const ListWaitingRequestsInput = WorkspaceScoped;
/** Every request the reader may answer. */
export type ListWaitingRequestsInput = z.infer<typeof ListWaitingRequestsInput>;

/** One request on Meetings › Requests: a page's request and the page it was made on. */
export const WaitingRequestView = BookingRequestView.extend({ pageId: Uuid });
/** One request on Meetings › Requests. */
export type WaitingRequestView = z.infer<typeof WaitingRequestView>;

/** Confirms a request: its event, confirmation and reminders go as any booking's. */
export const ConfirmBookingInput = WorkspaceScoped.extend({ bookingId: Uuid, mutationId: Uuid });
/** Confirms a request. */
export type ConfirmBookingInput = z.infer<typeof ConfirmBookingInput>;

/** Declines a request, with an optional reason its visitor is sent. */
export const DeclineBookingInput = WorkspaceScoped.extend({
  bookingId: Uuid,
  reason: z
    .string()
    .trim()
    .max(DECLINE_REASON_MAX, { error: `Keep the reason to ${String(DECLINE_REASON_MAX)} characters.` })
    .optional(),
  mutationId: Uuid,
});
/** Declines a request. */
export type DeclineBookingInput = z.infer<typeof DeclineBookingInput>;

/** Member procedures for a page's flow rules. */
export const bookingFlowContract = {
  links: oc.input(ListOneOffLinksInput).output(z.array(OneOffLinkView)),
  createLink: oc.input(CreateOneOffLinkInput).output(CreatedOneOffLink),
  revokeLink: oc.input(RevokeOneOffLinkInput).output(OneOffLinkView),
  requests: oc.input(ListRequestsInput).output(z.array(BookingRequestView)),
  /** Every request the reader may answer, soonest first, at most `WAITING_REQUESTS_MAX`. */
  waiting: oc.input(ListWaitingRequestsInput).output(z.array(WaitingRequestView)),
  /** Whether it was confirmed now: a request already answered changes nothing. */
  confirm: oc.input(ConfirmBookingInput).output(z.object({ confirmed: z.boolean() })),
  decline: oc.input(DeclineBookingInput).output(z.object({ declined: z.boolean() })),
};
