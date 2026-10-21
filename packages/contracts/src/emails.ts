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
