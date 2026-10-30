// The emails the product sends (spec 0001: Resend and React Email, Mailpit on
// a laptop): each queued kind's name and the params its template takes, the
// topics a member can turn off, and the shapes of the email preferences page.
// Plain Zod, no oRPC. Core checks a kind's params against these schemas when
// it queues an email, and the worker parses them again before `@crm/emails`
// draws it, so a template never meets a shape it doesn't know. Params hold
// what the email says, never a link to another site: every link is an app
// path the worker joins to the app's own origin.
import * as z from 'zod';

/**
 * A path inside the app (`/w/acme/bookings/list`): one leading slash, never
 * `//` or a backslash, so joined to the app's origin it can only ever open
 * the app. Emails take paths, never whole addresses, so no queued email can
 * carry a link to another site.
 */
export const AppPath = z
  .string()
  .max(2000)
  .regex(/^\/(?![/\\])[^\s\\]*$/, 'A path inside the app, starting with one /.');
/** A path inside the app. */
export type AppPath = z.infer<typeof AppPath>;

/** A short line an email shows as given: a name, a title, a file name. */
const Line = z.string().trim().min(1).max(200);

/** A longer text an email shows as given: a message, an excerpt. */
const Paragraph = z.string().trim().min(1).max(2000);

/**
 * An email address an email names or goes to (the visitor's, a guest's, a
 * calendar account's): one `@` with something on each side and no spaces or
 * brackets. Looser than a form's own check on purpose: an address a calendar
 * or a booking already holds (`john_doe#EXT#@contoso.onmicrosoft.com`) must
 * never fail the change that tells someone about it.
 */
export const EmailAddress = z
  .string()
  .trim()
  .max(320)
  .regex(/^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+$/, 'An email address.');
/** An email address an email names or goes to. */
export type EmailAddress = z.infer<typeof EmailAddress>;

const Address = EmailAddress;

/** A name someone else typed (a requester's): one line, no control characters, so it can't forge a subject. */
// eslint-disable-next-line no-control-regex
const Name = Line.regex(/^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/, 'A name on one line.');

/** A moment, as an ISO 8601 UTC string. */
const Instant = z.iso.datetime();

/** An IANA time zone the runtime knows (`Europe/London`), for the times an email states. */
export const EmailTimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'An IANA time zone, such as Europe/London.');
/** An IANA time zone. */
export type EmailTimeZone = z.infer<typeof EmailTimeZone>;

/** One label and value row: a form answer, a booking's time or place. A row with `href` links its value. */
export const EmailRow = z.strictObject({
  label: Line,
  value: z.string().trim().min(1).max(4000),
  /** An app path the value links to. */
  href: AppPath.optional(),
});
/** One label and value row. */
export type EmailRow = z.infer<typeof EmailRow>;

/** A form's answers as an email lists them: the questions the reader may see, in question order. */
const Answers = z.array(EmailRow).max(60);

/**
 * A new submission to a form (spec 0023, AC-1047), one email per member told
 * about it: who sent it, the answers that member may see (AC-573: hidden
 * means absent), and where it opens.
 */
export const FormSubmissionEmail = z.strictObject({
  formName: Line,
  /** The sender as they gave themselves: a name, an email, or both. */
  submitter: z.strictObject({ name: Line.optional(), email: Address.optional() }),
  answers: Answers,
  submittedAt: Instant,
  /** The zone the time is stated in; UTC when unset. */
  timeZone: EmailTimeZone.optional(),
  /** Where the submission opens in the app. */
  submissionPath: AppPath,
  /** Why this member is told: the lead went to them, or they made the form (a member who is both reads `lead`). */
  reason: z.enum(['lead', 'maker']).optional(),
  /** False when it couldn't be added to the CRM (it ended `failed`), so the reader knows to act on it. */
  filed: z.boolean().optional(),
});
/** A new submission to a form. */
export type FormSubmissionEmail = z.infer<typeof FormSubmissionEmail>;

/**
 * The visitor's copy of what they sent (spec 0023, AC-1048), when the form
 * turns it on: the form's subject and message, or the defaults, and the
 * answers the form shows in confirmations (never hidden questions).
 */
export const FormConfirmationEmail = z.strictObject({
  formName: Line,
  /** The form's own subject line; "We got your message" when unset. */
  subject: Line.optional(),
  /** The form's own message, or its thank you text. */
  message: Paragraph.optional(),
  answers: Answers,
  submittedAt: Instant,
  timeZone: EmailTimeZone.optional(),
});
/** The visitor's copy of what they sent. */
export type FormConfirmationEmail = z.infer<typeof FormConfirmationEmail>;

/**
 * A member's calendar stopped syncing (spec 0024, AC-619 and AC-620):
 * `expired` when the provider withdrew access, `failed` when syncing kept
 * failing for 6 hours. Sent to the member who connected it.
 */
export const CalendarDisconnectedEmail = z.strictObject({
  provider: z.enum(['google', 'microsoft']),
  /** The calendar account, the member's own. */
  accountEmail: Address,
  reason: z.enum(['expired', 'failed']),
  /** Where the member reconnects it. */
  settingsPath: AppPath,
});
/** A member's calendar stopped syncing. */
export type CalendarDisconnectedEmail = z.infer<typeof CalendarDisconnectedEmail>;

/**
 * A booking cancelled because its host deleted its calendar event (spec 0025,
 * AC-641's note of 20 October 2026). Only the host is told: the guest gets
 * no email from Timefix.
 */
export const BookingCalendarRemovedEmail = z.strictObject({
  /** The booking page's title ("Intro call"). */
  title: Line,
  guestName: Line,
  guestEmail: Address,
  startsAt: Instant,
  endsAt: Instant,
  /** The host's zone, the booking page's. */
  timeZone: EmailTimeZone,
  bookingsPath: AppPath,
});
/** A booking cancelled because its host deleted its calendar event. */
export type BookingCalendarRemovedEmail = z.infer<typeof BookingCalendarRemovedEmail>;

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

/**
 * A membership's link page (26 Oct 2026): its handle, made the moment the membership was, so the welcome says
 * where the page lives (`/<handle>`, which the app's origin sends on to the public one) and where to edit it.
 */
export const LinkPageEmailPart = z.strictObject({
  /** The handle alone: the email writes the address from it and the public origin. */
  handle: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  /** The link page editor (`/w/<slug>/link-page`). */
  editPath: AppPath,
});
/** A membership's link page, as a welcome names it. */
export type LinkPageEmailPart = z.infer<typeof LinkPageEmailPart>;

/** An approved request to join (spec 0031, AC-820), to the person who asked: the button into the workspace. */
export const JoinApprovedEmail = z.strictObject({
  openPath: AppPath,
  /** Their link page in the workspace, made with the membership; absent when it couldn't be made yet. */
  linkPage: LinkPageEmailPart.optional(),
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

/**
 * A restored workspace (late trap #89), to each of its active members but the owner who restored it: who did, and
 * the way back in. Each was told it was deleted and going for good, and heard nothing when it came back.
 */
export const WorkspaceRestoredEmail = z.strictObject({
  restoredBy: Name,
  /** The workspace's address. */
  openPath: AppPath,
});
/** A restored workspace's notice. */
export type WorkspaceRestoredEmail = z.infer<typeof WorkspaceRestoredEmail>;
/**
 * A sign in from a device not seen for the account in 90 days (spec 0033,
 * AC-897): when, the device, the approximate place, and a link to the
 * account's security page, never a link that changes anything. Its template
 * only: an account isn't a workspace, so it can't use the workspace email
 * queue.
 * TODO(account lane, spec 0033 milestone 4): decide how it is queued (AC-897
 * says a job keyed by the session id), then draw it with `renderEmail`.
 */
export const SignInAlertEmail = z.strictObject({
  signedInAt: Instant,
  timeZone: EmailTimeZone.optional(),
  /** The browser and system, such as "Chrome on macOS". */
  device: Line,
  /** An approximate place, such as "London, United Kingdom", when known. */
  place: Line.optional(),
  /** `passkey` only for an email queued before passkeys were taken out (22 October 2026). */
  method: z.enum(['code', 'google', 'passkey']),
  securityPath: AppPath,
});
/** A sign in from a new device. */
export type SignInAlertEmail = z.infer<typeof SignInAlertEmail>;

const Count = z.number().int().min(0);

/** An import a member started has finished (#30): what it did, and where to see the result. */
export const ImportFinishedEmail = z.strictObject({
  /** The object imported into, as its plural name ("People"). */
  objectName: Line,
  fileName: Line.optional(),
  outcome: z.enum(['done', 'failed', 'cancelled']),
  created: Count,
  updated: Count,
  skipped: Count,
  failed: Count,
  resultPath: AppPath,
});
/** An import has finished. */
export type ImportFinishedEmail = z.infer<typeof ImportFinishedEmail>;

/**
 * A member's background job ended `failed` (late trap #20): which job, the runner's plain sentence for why (never a
 * value, spec 0008 AC-124), and the Background jobs page. An import says how it ended in its own email instead.
 */
export const JobFailedEmail = z.strictObject({
  /** The kind's label (`jobLabel`), such as "Bulk edit". */
  jobLabel: Line,
  /** Why it stopped, as the job's page says it. */
  reason: Paragraph,
  jobsPath: AppPath,
  /** When they started it, stated in `timeZone`; absent on an email queued before 30 October 2026. */
  startedAt: Instant.optional(),
  timeZone: EmailTimeZone.optional(),
  /** How far it got before it stopped: items done, of how many when the kind knows. */
  progress: z.strictObject({ done: Count, total: Count.optional() }).optional(),
});
/** A member's background job failed. */
export type JobFailedEmail = z.infer<typeof JobFailedEmail>;

/**
 * Welcome to a workspace (26 Oct 2026), to a new member once their membership exists (they made the workspace, or
 * accepted an invitation or the invite link): the button into it, and their link page, live already, with its
 * address and where to edit it. Once per membership. An approved request to join says the same in its own email.
 */
export const WorkspaceWelcomeEmail = z.strictObject({
  openPath: AppPath,
  /** They made the workspace themselves (first run), rather than joining someone else's. */
  created: z.boolean().optional(),
  /** Their link page; absent when it couldn't be made yet (the daily cleanup makes it later). */
  linkPage: LinkPageEmailPart.optional(),
});
/** Welcome to a workspace. */
export type WorkspaceWelcomeEmail = z.infer<typeof WorkspaceWelcomeEmail>;

/**
 * Scheduling changed (spec 0037, AC-1264): to a member, when someone else changed their scheduling, ten minutes of
 * that person's changes in one email, a line each ("Working hours, Monday: 9:00 AM to 5:00 PM became 10:00 AM to
 * 6:00 PM"), never a note or anything the member didn't already own.
 */
export const SchedulingChangedEmail = z.strictObject({
  /** Who changed it, by name. */
  actorName: Name,
  lines: z.array(Line).min(1).max(30),
  /** Lines past the ones listed. */
  more: z.number().int().min(0),
  /** Scheduling › Availability, where the member sees their hours now. */
  availabilityPath: AppPath,
});
/** The scheduling changed email's params. */
export type SchedulingChangedEmail = z.infer<typeof SchedulingChangedEmail>;

/** Every email with a template, and its params' schema. The sign in code is drawn on its own (`renderSignInCode`). */
export const EMAIL_PARAMS = {
  form_submission: FormSubmissionEmail,
  form_confirmation: FormConfirmationEmail,
  calendar_disconnected: CalendarDisconnectedEmail,
  booking_calendar_removed: BookingCalendarRemovedEmail,
  member_invite: MemberInviteEmail,
  sign_in_alert: SignInAlertEmail,
  import_finished: ImportFinishedEmail,
  job_failed: JobFailedEmail,
  workspace_welcome: WorkspaceWelcomeEmail,
  scheduling_changed: SchedulingChangedEmail,
} as const;

/** A kind of email with a template. */
export const EmailKind = z.enum(
  Object.keys(EMAIL_PARAMS) as [keyof typeof EMAIL_PARAMS, ...(keyof typeof EMAIL_PARAMS)[]],
);
/** A kind of email with a template. */
export type EmailKind = z.infer<typeof EmailKind>;

/** A kind's params, by kind. */
export type EmailParams = { readonly [K in EmailKind]: z.infer<(typeof EMAIL_PARAMS)[K]> };

/**
 * The kinds that go through the workspace email queue (`queueEmail`, the
 * worker's `crm_email` task). The others are sent from their request (an
 * invitation, as a sign in code is) or not sent yet (a sign in alert).
 */
export const QUEUED_EMAIL_KINDS = [
  'form_submission',
  'form_confirmation',
  'calendar_disconnected',
  'booking_calendar_removed',
  'import_finished',
  'job_failed',
  'workspace_welcome',
  'scheduling_changed',
] as const satisfies readonly EmailKind[];
/** A kind that goes through the workspace email queue. */
export const QueuedEmailKind = z.enum(QUEUED_EMAIL_KINDS);
/** A kind that goes through the workspace email queue. */
export type QueuedEmailKind = z.infer<typeof QueuedEmailKind>;

/**
 * The topics a member can turn off: optional emails only, and the one list
 * of them (with `EMAIL_KIND_TOPICS` below), so a change of mind is one edit.
 * An email of a topic carries a link to the member's email preferences, and
 * is skipped once its topic is off. Everything else (sign in, security,
 * calendar alerts, bookings, invitations, an import's result, a failed job) always goes:
 * the owner's default of 21 October 2026. `mentions` has no queued kind: a
 * mention is emailed once, in the notifications email (spec 0038), which
 * leaves mentions out while the topic is off.
 */
export const EMAIL_TOPICS = ['form_submissions', 'mentions'] as const;
/** A topic a member can turn off. */
export const EmailTopic = z.enum(EMAIL_TOPICS);
/** A topic a member can turn off. */
export type EmailTopic = z.infer<typeof EmailTopic>;

/** Which topic each optional kind belongs to; a kind not listed always goes. */
export const EMAIL_KIND_TOPICS: { readonly [K in EmailKind]?: EmailTopic } = {
  form_submission: 'form_submissions',
};

/** One topic on the email preferences page: whether the member gets it. */
export const EmailPreference = z.strictObject({ topic: EmailTopic, subscribed: z.boolean() });
/** One topic on the email preferences page. */
export type EmailPreference = z.infer<typeof EmailPreference>;

/**
 * The email preferences page (opened from an email's link, no sign in): the
 * workspace the emails come from, the topic the link came from, and every
 * topic with its state. Never the member's address or any other member.
 */
export const EmailPreferencesView = z.strictObject({
  workspaceName: z.string(),
  /** The topic of the email the link was in, shown first. */
  topic: EmailTopic,
  preferences: z.array(EmailPreference),
});
/** The email preferences page. */
export type EmailPreferencesView = z.infer<typeof EmailPreferencesView>;

/** A change on the email preferences page: one topic on or off. */
export const EmailPreferenceChange = z.strictObject({ topic: EmailTopic, subscribed: z.boolean() });
/** A change on the email preferences page. */
export type EmailPreferenceChange = z.infer<typeof EmailPreferenceChange>;

/**
 * A one click unsubscribe's answer (an optional email's `List-Unsubscribe`,
 * from the reader's mail service or the page it opens in a browser): its
 * topic is off. The workspace's name and the topic only; never the member's
 * other choices, which the one click's token can't read.
 */
export const EmailUnsubscribed = z.strictObject({
  unsubscribed: z.literal(true),
  workspaceName: z.string(),
  topic: EmailTopic,
});
/** A one click unsubscribe's answer. */
export type EmailUnsubscribed = z.infer<typeof EmailUnsubscribed>;
/** One notification as an email lists it: what happened, about what, its words, and where it opens. */
export const NotificationEmailItem = z.strictObject({
  /** "Ada Lovelace mentioned you". */
  sentence: Line,
  /** The record it is about, by name, when there is one. */
  recordName: Line.optional(),
  /** The comment's start, mentions as "@Name", or the task's title; at most 200 characters. */
  excerpt: z.string().max(200),
  /** Where it opens: the comment's thread on its record, or the task over the inbox. */
  path: AppPath,
});
/** One notification in an email. */
export type NotificationEmailItem = z.infer<typeof NotificationEmailItem>;

/**
 * The notifications email (spec 0038, AC-1176, AC-1177): a member's unread
 * notifications not yet emailed, newest first, read as that member when the
 * email task runs, so it never holds what they can't read at that moment.
 */
export const NotificationsEmail = z.strictObject({
  items: z.array(NotificationEmailItem).min(1).max(20),
  /** More waiting past the ones listed, which the inbox shows. */
  more: z.number().int().min(0),
  inboxPath: AppPath,
  /** Settings › Account › Notifications, the footer's preferences link. */
  settingsPath: AppPath,
  /** The daily digest (AC-1178): named so in its subject and heading. */
  digest: z.boolean().optional(),
});
/** The notifications email's params. */
export type NotificationsEmail = z.infer<typeof NotificationsEmail>;
