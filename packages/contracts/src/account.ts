// Account security (spec 0033): the signed in person's own devices and
// sessions, before any workspace is chosen. Sessions travel by id only: a
// session token never leaves the server (AC-891), so nothing here can be used
// to take over a session, and a person reaches only their own.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { Uuid } from './values/ids.ts';

/**
 * How long a verification at sign in (or, from milestone 2, a step up) counts
 * as fresh for a sensitive change on that session (AC-896): 10 minutes.
 */
export const STEP_UP_MINUTES = 10;

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
  'passkey_added',
  'passkey_removed',
  'alert_sent',
] as const;
/** One kind of security event. */
export const SecurityEventKind = z.enum(SECURITY_EVENT_KINDS);
/** One kind of security event. */
export type SecurityEventKind = z.infer<typeof SecurityEventKind>;

/** How a sign in happened, as a security event records it. */
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
 * The account procedures (spec 0033). Each needs a session and no workspace
 * (the bootstrap list); each reaches only the caller's own sessions.
 * `revoke` answers NOT_FOUND for a session that isn't the caller's (or is
 * gone); `revokeOthers` answers 403 STEP_UP_REQUIRED unless this session was
 * verified within `STEP_UP_MINUTES`.
 */
export const accountContract = {
  sessions: {
    list: oc.input(ListSessionsInput).output(SessionPage),
    revoke: oc.input(RevokeSessionInput).output(z.object({ ok: z.literal(true) })),
    revokeOthers: oc.output(RevokedSessions),
  },
};
