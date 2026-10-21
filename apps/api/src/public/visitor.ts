// Who is looking at a booking page (spec 0028, AC-720 to AC-722), and how to
// read their busy times. Two ways to be known:
//
// - Signed in to Timefix in this browser (the app's own session cookie, same
//   origin). Their calendar is a connection they made as a member: each of
//   their workspaces is entered through the member door, and the connection
//   whose account is their sign in email wins, else the one synced last. The
//   host on their own page is nobody here: no overlay, no prefill.
// - A guest who connected Google for this visit: the access token, sealed
//   with the calendar token key and bound to their email, rides in an http
//   only cookie on the public booking path for at most the token's hour. No
//   refresh token exists, and nothing is written to the database or a log.
//
// Busy times stay on the server; the routes turn them into slot starts.
import {
  deriveKey,
  isRefusal,
  listCalendarConnections,
  normaliseEmail,
  openTokens,
  sealTokens,
  signValue,
  verifyValue,
  type BusyInterval,
  type BusyReader,
  type TokenBinding,
  type TokenKey,
} from '@crm/core';
import type { PublicViewer } from '@crm/contracts';
import type { Auth, AuthSession } from '../auth/auth.ts';
import type { GuestCalendar, GuestGrant } from '../calendar/google.ts';

/** The guest's sealed calendar access. */
export const GUEST_COOKIE = 'crm_guest_calendar';
/** Only the public booking routes ever receive it. */
export const GUEST_COOKIE_PATH = '/api/public/booking';
/** The nonce of a guest connect under way, on the callback's path only. */
export const GUEST_STATE_COOKIE = 'crm_guest_state';
/** The connect leg's own path, which the nonce cookie is scoped to. */
export const GUEST_CONNECT_PATH = '/api/public/booking/connect/';
/** Where Google sends a guest back. */
export const GUEST_CALLBACK_PATH = '/api/public/booking/connect/callback';

const COOKIE_VERSION = 'gc1';
/** The most workspaces read for a signed in visitor's calendar. */
const MAX_WORKSPACES = 10;

/**
 * A cookie's name as sent: `__Secure-` outside local, so no plain http page
 * (or a sibling subdomain over http) can set it for us.
 */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Secure-${base}` : base;
}

/** The longest cookie value a browser keeps (and `verifyValue` reads): past it the guest would silently stay unknown. */
const COOKIE_MAX = 3800;

/** The keys a guest cookie is sealed and signed with: the token key, and one derived from it for the signature. */
export interface GuestKeys {
  readonly tokenKey: TokenKey;
  readonly cookieKey: Buffer;
}

/** The guest keys from the calendar token key. */
export function guestKeys(tokenKey: TokenKey): GuestKeys {
  return { tokenKey, cookieKey: deriveKey(tokenKey, 'booking-guest-cookie') };
}

const bindingOf = (email: string): TokenBinding => ({
  workspaceId: 'booking-guest',
  memberId: 'booking-guest',
  provider: 'google',
  accountEmail: email,
});

/**
 * The cookie's value and life for a guest's grant: the token sealed, the rest
 * signed, both ending with the token. Undefined when it won't fit a cookie.
 */
export function sealGuest(
  keys: GuestKeys,
  grant: GuestGrant,
  now: Date,
): { readonly value: string; readonly maxAge: number } | undefined {
  const maxAge = Math.max(0, Math.floor((Date.parse(grant.expiresAt) - now.getTime()) / 1000) - 60);
  const sealed = sealTokens(
    keys.tokenKey,
    { accessToken: grant.accessToken, refreshToken: '', expiresAt: grant.expiresAt },
    bindingOf(grant.email),
  );
  const value = signValue(
    keys.cookieKey,
    COOKIE_VERSION,
    { m: grant.email, n: grant.name, t: sealed.toString('base64url') },
    maxAge,
    now,
  );
  return value.length > COOKIE_MAX ? undefined : { value, maxAge };
}

/** A guest's grant from their cookie, or undefined for none, another key, tampering or an expired one. */
export function openGuest(keys: GuestKeys, value: string | undefined, now: Date): GuestGrant | undefined {
  const payload = verifyValue(keys.cookieKey, COOKIE_VERSION, value, now);
  if (payload === undefined) return undefined;
  const { m: email, n: name, t: sealed } = payload;
  if (typeof email !== 'string' || typeof name !== 'string' || typeof sealed !== 'string') return undefined;
  try {
    const tokens = openTokens(keys.tokenKey, Buffer.from(sealed, 'base64url'), bindingOf(email));
    return { accessToken: tokens.accessToken, expiresAt: tokens.expiresAt, email, name };
  } catch {
    return undefined;
  }
}

/** A visitor's busy times over a range, or `unreachable` when their calendar couldn't be read. */
export type VisitorBusy = (from: string, to: string) => Promise<readonly BusyInterval[] | 'unreachable'>;

/** A recognised visitor, and their busy times when their calendar is on. */
export interface Visitor {
  readonly viewer: PublicViewer;
  readonly busy?: VisitorBusy;
}

/** The scope the member door hands back, as `listCalendarConnections` takes it. */
type DoorScope = Parameters<typeof listCalendarConnections>[0];

/** What finding the visitor needs. */
export interface VisitorDeps {
  readonly auth: Auth;
  /** The workspaces a user was added to (the identity directory). */
  readonly workspacesOf: (userId: string) => Promise<readonly { readonly slug: string }[]>;
  /** The member door, as the RPC's `member` base opens it, for this signed in session. */
  readonly enter: (session: AuthSession, slug: string) => Promise<DoorScope>;
  /** Members' busy times over their connected calendars. */
  readonly memberBusy: BusyReader;
  /** The guest leg, where calendar sync is set up. */
  readonly guest?: { readonly calendar: GuestCalendar; readonly keys: GuestKeys };
}

/** What a request says about its visitor. */
export interface VisitorRequest {
  readonly headers: Headers;
  readonly clientIp: string | undefined;
  readonly guestCookie: string | undefined;
  /** Whether this user hosts the page being looked at. */
  readonly isHost: (userId: string) => Promise<boolean>;
  readonly now: Date;
}

/** The visitor, and any session cookies to send back (a session extended on use renews its cookie). */
export interface FoundVisitor {
  readonly visitor?: Visitor;
  /** The signed in person hosts this page. */
  readonly isHost?: true;
  readonly setCookies: readonly string[];
}

/** A signed in member's calendar to overlay: the healthiest connection, preferring their sign in email. */
async function memberCalendar(
  deps: VisitorDeps,
  session: AuthSession,
): Promise<Pick<Visitor, 'busy'> & { readonly calendar: PublicViewer['calendar'] }> {
  const { user } = session;
  const workspaces = (await deps.workspacesOf(user.id)).slice(0, MAX_WORKSPACES);
  const found = await Promise.all(
    workspaces.map(async ({ slug }) => {
      try {
        const scope = await deps.enter(session, slug);
        const { principal } = scope.access;
        if (principal.kind !== 'member') return [];
        const { memberId } = principal;
        return (await listCalendarConnections(scope)).map((connection) => ({
          workspaceId: scope.workspaceId,
          memberId,
          connection,
        }));
      } catch (error) {
        // Not an active member there any more: that workspace simply has no calendar of theirs.
        if (isRefusal(error)) return [];
        throw error;
      }
    }),
  );
  const all = found.flat();
  const email = normaliseEmail(user.email);
  const [best] = all
    .filter(({ connection }) => connection.status === 'connected' || connection.status === 'syncing')
    .toSorted(
      (a, b) =>
        Number(b.connection.accountEmail === email) - Number(a.connection.accountEmail === email) ||
        (b.connection.lastSyncedAt ?? '').localeCompare(a.connection.lastSyncedAt ?? ''),
    );
  if (best === undefined) return { calendar: all.length > 0 ? 'needs-reconnect' : 'none' };
  return {
    calendar: 'on',
    busy: async (from, to) => {
      const answer = await deps.memberBusy({ workspaceId: best.workspaceId, memberId: best.memberId, from, to });
      return answer.status === 'read' ? answer.busy : 'unreachable';
    },
  };
}

/**
 * The visitor of a booking page: signed in (the session wins over a guest
 * cookie), a guest with a live cookie, or nobody. The page's own host is nobody.
 */
export async function findVisitor(deps: VisitorDeps, request: VisitorRequest): Promise<FoundVisitor> {
  const session = await deps.auth.session(request.headers, request.clientIp);
  if (session !== undefined) {
    const { setCookies, user } = session;
    if (await request.isHost(user.id)) return { setCookies, isHost: true };
    const calendar = await memberCalendar(deps, session);
    return {
      setCookies,
      visitor: {
        viewer: { name: user.name, email: user.email, source: 'account', calendar: calendar.calendar },
        ...(calendar.busy === undefined ? {} : { busy: calendar.busy }),
      },
    };
  }
  const guest = deps.guest;
  const grant = guest === undefined ? undefined : openGuest(guest.keys, request.guestCookie, request.now);
  if (guest === undefined || grant === undefined) return { setCookies: [] };
  return {
    setCookies: [],
    visitor: {
      viewer: { name: grant.name, email: grant.email, source: 'google', calendar: 'on' },
      busy: async (from, to) => {
        try {
          return await guest.calendar.freeBusy(grant.accessToken, from, to);
        } catch {
          return 'unreachable';
        }
      },
    },
  };
}
