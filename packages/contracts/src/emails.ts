// The emails the product sends (spec 0001: Resend and React Email, Mailpit on
// a laptop): the params each email's template takes. Plain Zod, no oRPC.
// `@crm/emails` parses them again before it draws an email, so a template
// never meets a shape it doesn't know. Params hold what the email says, never
// a link to another site: every link is an app path joined to the app's own
// origin.
import * as z from 'zod';

/**
 * A path inside the app (`/w/acme/bookings/list`): one leading slash, never
 * `//` or a backslash, so joined to the app's origin it can only ever open
 * the app. Emails take paths, never whole addresses, so no email can carry a
 * link to another site.
 */
export const AppPath = z
  .string()
  .max(2000)
  .regex(/^\/(?![/\\])[^\s\\]*$/, 'A path inside the app, starting with one /.');
/** A path inside the app. */
export type AppPath = z.infer<typeof AppPath>;

/** A short line an email shows as given: a name, a title, a file name. */
const Line = z.string().trim().min(1).max(200);

/** A name someone else typed (a requester's): one line, no control characters, so it can't forge a subject. */
// eslint-disable-next-line no-control-regex
const Name = Line.regex(/^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/, 'A name on one line.');

/** A moment, as an ISO 8601 UTC string. */
const Instant = z.iso.datetime();

/**
 * An invitation to join a workspace (spec 0031, AC-803 to AC-808). Sent from
 * the inviting request, never queued: its link carries the invitation's raw
 * token, which spec 0031 keeps out of every table (only its hash is stored).
 */
export const MemberInviteEmail = z.strictObject({
  inviterName: Line,
  role: z.enum(['owner', 'admin', 'member', 'guest']),
  /** The invitation's page, with its token. Drawn into the email and sent at once, never stored. */
  acceptPath: AppPath,
  expiresAt: Instant,
});
/** An invitation to join a workspace. */
export type MemberInviteEmail = z.infer<typeof MemberInviteEmail>;

/**
 * A request to join a workspace through its email domain (spec 0031,
 * AC-819), to each of its owners and admins: who asked, and the button to
 * the Members page's Join requests tab. Sent from the asking request.
 */
export const JoinRequestEmail = z.strictObject({
  requesterName: Name,
  requesterEmail: z.email().max(254),
  /** The Members page, where the request waits. */
  reviewPath: AppPath,
});
/** A request to join, to a workspace's owners and admins. */
export type JoinRequestEmail = z.infer<typeof JoinRequestEmail>;

/** An approved request to join (spec 0031, AC-820), to the person who asked: the button into the workspace. */
export const JoinApprovedEmail = z.strictObject({
  openPath: AppPath,
});
/** An approved request to join. */
export type JoinApprovedEmail = z.infer<typeof JoinApprovedEmail>;

/**
 * A deleted workspace (spec 0031, AC-823), to each of its active members:
 * who deleted it and the day it goes for good. An owner's carries the way
 * back to restore it; nobody else's has a button.
 */
export const WorkspaceDeletedEmail = z.strictObject({
  deletedBy: Name,
  /** The day the purge may take it, as the email writes it ("19 November 2026"). */
  until: Line,
  /** The workspace's address, where an owner restores it; absent for anyone else. */
  restorePath: AppPath.optional(),
});
/** A deleted workspace's notice. */
export type WorkspaceDeletedEmail = z.infer<typeof WorkspaceDeletedEmail>;
