// The signed in person's own sessions (spec 0033, milestone 1): list them,
// sign one out, or sign out every other one. These run before any workspace
// is chosen and touch only the caller's own rows in the identity store, by
// session id; a token never reaches here. Each ending is kept as a security
// event, and cuts the person's live connections (`signedOut`), so the device
// whose session ended goes to sign in at once rather than at its next call.
import {
  type AccountSession,
  type ListSessionsInput,
  type RevokedSessions,
  type RevokeSessionInput,
  SESSION_PAGE_MAX,
  SessionCursor,
  type SessionPage,
  STEP_UP_MINUTES,
} from '@crm/contracts';
import type { IdentityStore, SessionListing } from '@crm/db';
import { inputInvalid, refuse } from '../engine/refusals.ts';

/** What the session procedures need. */
export interface SessionsDeps {
  readonly identity: Pick<
    IdentityStore,
    'listSessions' | 'revokeSession' | 'revokeOtherSessions' | 'sessionVerifiedAt' | 'recordSecurityEvent'
  >;
  /**
   * Cuts every live connection of the user with the signed out code (4501),
   * after the session rows are gone. Best effort: it never throws, and a
   * device it misses still finds itself signed out at its next call.
   */
  readonly signedOut: (userId: string) => Promise<void>;
  /** The clock (`Date.now` by default). */
  readonly now?: () => number;
}

/** Who is asking: the signed in person, the session their request carries, and where it came from. */
export interface SessionCaller {
  readonly userId: string;
  readonly sessionId: string;
  /** The IP the edge guard trusted, if any. */
  readonly ip?: string;
}

/** What a cursor that isn't one of ours answers. */
export const SESSION_CURSOR_MESSAGE = 'That list position is not valid here. Start again from the top.';

/** What a session id that isn't the caller's (or is gone) answers: the same either way. */
export const UNKNOWN_SESSION = 'That device is already signed out.';

/** What "Sign out of all other devices" answers on a session that hasn't proven itself lately (AC-896). */
export const STEP_UP_MESSAGE = `Confirm it's you first: this needs a sign in in the last ${String(STEP_UP_MINUTES)} minutes.`;

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function decodeCursor(cursor: string): SessionCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw inputInvalid('cursor', SESSION_CURSOR_MESSAGE);
  }
  const bound = SessionCursor.safeParse(parsed);
  // Only a moment the server wrote (fixed width, microseconds), so a forged one never reaches a cast.
  if (!bound.success || !MOMENT.test(bound.data.updatedAt) || Number.isNaN(Date.parse(bound.data.updatedAt))) {
    throw inputInvalid('cursor', SESSION_CURSOR_MESSAGE);
  }
  return bound.data;
}

function encodeCursor(row: SessionListing): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updatedAt, id: row.id } satisfies SessionCursor)).toString(
    'base64url',
  );
}

/** A moment from the store as the contract's ISO 8601 (milliseconds). */
const iso = (moment: string): string => new Date(moment).toISOString();

function listingOf(row: SessionListing, currentId: string): AccountSession {
  return {
    id: row.id,
    deviceLabel: row.deviceLabel ?? '',
    ...(row.country === null ? {} : { country: row.country }),
    ...(row.city === null ? {} : { city: row.city }),
    lastActiveAt: iso(row.updatedAt),
    signedInAt: iso(row.createdAt),
    current: row.id === currentId,
  };
}

/**
 * The caller's live sessions, most recently used first (AC-890), a page at a
 * time; the one their request carries is marked `current`.
 */
export async function listMySessions(
  deps: Pick<SessionsDeps, 'identity'>,
  caller: SessionCaller,
  input: ListSessionsInput,
): Promise<SessionPage> {
  const after = input?.cursor === undefined ? undefined : decodeCursor(input.cursor);
  const rows = await deps.identity.listSessions(caller.userId, {
    ...(after === undefined ? {} : { after }),
    limit: SESSION_PAGE_MAX + 1,
  });
  const page = rows.slice(0, SESSION_PAGE_MAX);
  const last = page.at(-1);
  return {
    items: page.map((row) => listingOf(row, caller.sessionId)),
    ...(rows.length > SESSION_PAGE_MAX && last !== undefined ? { nextCursor: encodeCursor(last) } : {}),
  };
}

/**
 * Signs out one of the caller's sessions by id (AC-891). Another person's
 * session, a gone one and an unknown id all answer the same NOT_FOUND.
 */
export async function revokeMySession(
  deps: SessionsDeps,
  caller: SessionCaller,
  input: RevokeSessionInput,
): Promise<{ readonly ok: true }> {
  const ended = await deps.identity.revokeSession(caller.userId, input.sessionId);
  if (ended === undefined) throw refuse('NOT_FOUND', UNKNOWN_SESSION);
  // Cut the device off first (it never throws), so a failed event write can't leave it connected.
  await deps.signedOut(caller.userId);
  await deps.identity.recordSecurityEvent({
    userId: caller.userId,
    kind: 'session_revoked',
    sessionId: input.sessionId,
    ...(caller.ip === undefined ? {} : { ip: caller.ip }),
    ...(ended.country === null ? {} : { country: ended.country }),
    ...(ended.deviceLabel === null ? {} : { deviceLabel: ended.deviceLabel }),
  });
  return { ok: true };
}

/** Whether a session's last verification (sign in, or a step up) is within `STEP_UP_MINUTES` of `now`. */
export function isFresh(verifiedAt: string | undefined, now: number): boolean {
  if (verifiedAt === undefined) return false;
  const at = Date.parse(verifiedAt);
  return !Number.isNaN(at) && now - at <= STEP_UP_MINUTES * 60_000 && at <= now + 60_000;
}

/**
 * Signs out every session of the caller but this one (AC-892). It needs a
 * fresh verification on this session (AC-896): until milestone 2's step up,
 * that is a sign in within the last 10 minutes; otherwise 403
 * STEP_UP_REQUIRED.
 */
export async function revokeMyOtherSessions(deps: SessionsDeps, caller: SessionCaller): Promise<RevokedSessions> {
  const now = (deps.now ?? Date.now)();
  const verifiedAt = await deps.identity.sessionVerifiedAt(caller.userId, caller.sessionId);
  if (!isFresh(verifiedAt, now)) throw refuse('STEP_UP_REQUIRED', STEP_UP_MESSAGE);
  const count = await deps.identity.revokeOtherSessions(caller.userId, caller.sessionId);
  if (count > 0) {
    await deps.signedOut(caller.userId);
    await deps.identity.recordSecurityEvent({
      userId: caller.userId,
      kind: 'sessions_revoked',
      sessionId: caller.sessionId,
      ...(caller.ip === undefined ? {} : { ip: caller.ip }),
      detail: { count },
    });
  }
  return { count };
}
