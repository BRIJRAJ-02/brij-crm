// Account security (spec 0033): the signed in person's own devices and
// sessions, before any workspace is chosen. Sessions travel by id only: a
// session token never leaves the server (AC-891), so nothing here can be used
// to take over a session, and a person reaches only their own.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';

export { STEP_UP_CODE_MINUTES, STEP_UP_MINUTES } from './account-limits.ts';

/** The most sessions one page of `account.sessions.list` answers. */
export const SESSION_PAGE_MAX = 50;

/**
 * The kinds of security event kept per account (AC-898), in `auth.security_event`.
 * The detail of each never holds a code, secret or token.
 */
export const SECURITY_EVENT_KINDS = [
  'sign_in',
  'sign_out',
  'session_revoked',
  'sessions_revoked',
  'two_factor_on',
  'two_factor_off',
  'backup_codes_made',
  'backup_code_used',
  // Passkeys were taken out on 22 October 2026; these two stay so the history recorded before reads back.
  'passkey_added',
  'passkey_removed',
  'alert_sent',
  // Settings › Profile's Sync Google photo linked Google as a way to sign in (23 October 2026).
  'google_linked',
] as const;
/** One kind of security event. */
export const SecurityEventKind = z.enum(SECURITY_EVENT_KINDS);
/** One kind of security event. */
export type SecurityEventKind = z.infer<typeof SecurityEventKind>;

/** How a sign in happened, as a security event records it (`passkey` only in history from before 22 October 2026). */
export const SignInMethod = z.enum(['email_code', 'google', 'passkey']);
/** How a sign in happened. */
export type SignInMethod = z.infer<typeof SignInMethod>;

/**
 * One live session of the signed in person (AC-890): which device, roughly
 * where, and when it was last used (to the day: Better Auth refreshes a
 * session's `updated_at` at most daily). Its id names it for `revoke`; there
 * is no token.
 */
export const AccountSession = z.object({
  id: Uuid,
  /** "Chrome on macOS", parsed once at sign in; empty when the browser said nothing useful. */
  deviceLabel: z.string(),
  /** Two letter country code from the edge, when known. */
  country: z.string().optional(),
  city: z.string().optional(),
  /** When the session was last used, ISO 8601 UTC. */
  lastActiveAt: z.iso.datetime(),
  /** When it signed in, ISO 8601 UTC. */
  signedInAt: z.iso.datetime(),
  /** True for the session this request carries ("This device"). */
  current: z.boolean(),
});
/** One live session. */
export type AccountSession = z.infer<typeof AccountSession>;

/** One page of the person's sessions: the opaque cursor to the next, if any. */
export const ListSessionsInput = z.object({ cursor: z.string().max(200).optional() }).optional();
/** One page of the person's sessions. */
export type ListSessionsInput = z.infer<typeof ListSessionsInput>;

/** A page of sessions, newest activity first, and the cursor for the next. */
export const SessionPage = z.object({
  items: z.array(AccountSession),
  nextCursor: z.string().optional(),
});
/** A page of sessions. */
export type SessionPage = z.infer<typeof SessionPage>;

/** Where a page of sessions ends, inside the opaque cursor: the last row's activity moment and id. Strict. */
export const SessionCursor = z.strictObject({ updatedAt: z.string().max(40), id: Uuid });
/** Where a page of sessions ends. */
export type SessionCursor = z.infer<typeof SessionCursor>;

/** Signing out one session by its id. */
export const RevokeSessionInput = z.object({ sessionId: Uuid });
/** Signing out one session. */
export type RevokeSessionInput = z.infer<typeof RevokeSessionInput>;

/** How many other sessions "Sign out of all other devices" ended. */
export const RevokedSessions = z.object({ count: z.number().int().min(0) });
/** How many other sessions were ended. */
export type RevokedSessions = z.infer<typeof RevokedSessions>;

/**
 * How a step up proves who it is by a code (AC-896): an app code or a backup
 * code when two factor is on, else an email code.
 */
export const StepUpMethod = z.enum(['email', 'totp', 'backup']);
/** How a step up proves who it is. */
export type StepUpMethod = z.infer<typeof StepUpMethod>;

/** Asking for a step up email code (the only method that sends anything). */
export const StepUpStartInput = z.object({ method: z.literal('email') });
/** Asking for a step up email code. */
export type StepUpStartInput = z.infer<typeof StepUpStartInput>;

/** What a refused step up code says, in place of Zod's own wording (which reached a person once). */
const STEP_UP_CODE_REFUSED = 'That code doesn’t look right. Check it and try again.';

/** A step up's code: 6 digits from the app or the email, or a backup code ("abcde-12345"). */
export const StepUpVerifyInput = z.object({
  method: StepUpMethod,
  code: z
    .string()
    .trim()
    .min(6, STEP_UP_CODE_REFUSED)
    .max(20, STEP_UP_CODE_REFUSED)
    .regex(/^[A-Za-z0-9-]+$/, STEP_UP_CODE_REFUSED),
});
/** A step up's code. */
export type StepUpVerifyInput = z.infer<typeof StepUpVerifyInput>;

/** How this session stands for sensitive changes: fresh until when, and whether a second factor proved it. */
export const SessionFreshness = z.object({
  /** ISO 8601 UTC; absent when the session isn't fresh. */
  freshUntil: z.iso.datetime().optional(),
  /** True when the last verification used a second factor (turning two factor off needs it, AC-885). */
  withSecondFactor: z.boolean(),
});
/** How this session stands for sensitive changes. */
export type SessionFreshness = z.infer<typeof SessionFreshness>;

/**
 * Account › Sign in and devices' state (AC-881, AC-883): two factor on or off, how many
 * backup codes are left, and this session's freshness. Never a secret or a code.
 */
export const AccountSecurity = z.object({
  twoFactor: z.object({
    on: z.boolean(),
    /** Unused backup codes left, while two factor is on. */
    backupCodesLeft: z.number().int().min(0).optional(),
  }),
  session: SessionFreshness,
  /**
   * The workspaces the person is in that require two factor (AC-885), by
   * name: while any does, their last second factor can't be turned off.
   */
  requiredBy: z.array(z.string()),
});
/** Account › Sign in and devices' state. */
export type AccountSecurity = z.infer<typeof AccountSecurity>;

/** A workspace where the person is the last active owner: deleting the account waits until it has another (AC-902). */
export const DeletionBlocker = z.object({ slug: z.string(), name: z.string() });
/** A workspace blocking account deletion. */
export type DeletionBlocker = z.infer<typeof DeletionBlocker>;

/**
 * What stands in the way of deleting the account: the workspaces it is the last owner of. And `lost`: the deleted
 * workspaces it is the only owner of, by name, which nobody could restore afterwards (said, never in the way).
 */
export const AccountDeletionCheck = z.object({ blockers: z.array(DeletionBlocker), lost: z.array(z.string()) });
/** What stands in the way of deleting the account. */
export type AccountDeletionCheck = z.infer<typeof AccountDeletionCheck>;

/** Deleting the account: its email typed in full, to confirm (AC-903). */
export const DeleteAccountInput = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: 'Type your email address to confirm.' })
    .max(320, { error: 'Type your email address to confirm.' }),
});
/** Deleting the account. */
export type DeleteAccountInput = z.infer<typeof DeleteAccountInput>;

/** How many days of security events Recent activity lists (AC-898); they are kept a year. */
export const ACTIVITY_DAYS = 90;

/**
 * One security event as Account › Sign in and devices › Recent activity lists it
 * (AC-898): what happened, when, and for a sign in how, on what and roughly
 * where. Never an IP, a code or a token.
 */
export const SecurityActivity = z.object({
  id: Uuid,
  at: z.iso.datetime({ offset: true }),
  kind: SecurityEventKind,
  method: SignInMethod.optional(),
  deviceLabel: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
});
/** One security event in Recent activity. */
export type SecurityActivity = z.infer<typeof SecurityActivity>;

/** A page of Recent activity, newest first, and the cursor for the next. */
export const ActivityPage = z.object({ items: z.array(SecurityActivity), nextCursor: z.string().optional() });
/** A page of Recent activity. */
export type ActivityPage = z.infer<typeof ActivityPage>;

/** Where the next page of Recent activity starts: an opaque cursor from the last page. */
export const ListActivityInput = z.object({ cursor: z.string().max(200).optional() });
/** Where the next page of Recent activity starts. */
export type ListActivityInput = z.infer<typeof ListActivityInput>;

/**
 * The account procedures (spec 0033). Each needs a session and no workspace
 * (the bootstrap list); each reaches only the caller's own sessions.
 * `revoke` answers NOT_FOUND for a session that isn't the caller's (or is
 * gone); `revoke` (another device) and `revokeOthers` answer 403 STEP_UP_REQUIRED
 * unless this session was verified within `STEP_UP_MINUTES`.
 */
export const accountContract = {
  sessions: {
    list: oc.input(ListSessionsInput).output(SessionPage),
    revoke: oc.input(RevokeSessionInput).output(z.object({ ok: z.literal(true) })),
    revokeOthers: oc.output(RevokedSessions),
  },
  /** Two factor on or off, backup codes left, and this session's freshness (AC-881). */
  security: { get: oc.output(AccountSecurity) },
  /** The person's last 90 days of security events, newest first (AC-898). */
  activity: { list: oc.input(ListActivityInput).output(ActivityPage) },
  /**
   * A step up (AC-896): `start` emails a code (only while two factor is off);
   * `verify` checks an email code, an app code or a backup code and makes
   * this session fresh for `STEP_UP_MINUTES`. 422 CODE_INVALID, 429 after
   * too many tries.
   */
  stepUp: {
    start: oc.input(StepUpStartInput).output(z.object({ sent: z.literal(true) })),
    verify: oc.input(StepUpVerifyInput).output(SessionFreshness),
  },
  /**
   * Deleting the account (AC-902 to AC-907): `check` names the workspaces it
   * is the last owner of; `confirm` deletes it after a fresh step up and the
   * email typed in full (403 STEP_UP_REQUIRED or SECOND_FACTOR_REQUIRED,
   * 409 LAST_OWNER, 400 INPUT_INVALID on `email`).
   */
  deletion: {
    check: oc.output(AccountDeletionCheck),
    confirm: oc.input(DeleteAccountInput).output(z.object({ deleted: z.literal(true) })),
  },
};
