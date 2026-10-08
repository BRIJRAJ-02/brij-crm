// The procedure bases (spec 0005, the access door). Every procedure is built
// on one of three:
// - `pub`: anyone (the status check);
// - `authed`: a signed in person (`context.user`), else 401 UNAUTHENTICATED;
// - `member`: `authed` plus the access door for the input's `workspace`
//   (`context.scope`), else the same NOT_FOUND for a non member, a removed
//   member and an unknown address.
// Only `enterWorkspace` in packages/core builds a member's scope; nothing in
// this app builds one. A `member` handler sees `context.scope` and neither
// `context.db` nor `context.identity`, so the door is its only way to the data. The contract walking
// test fails if a procedure outside the bootstrap list isn't built on `member`.
import { type AppEnvironment, contract, WorkspaceScoped } from '@crm/contracts';
import { enterWorkspace } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { implement, os } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import type { Auth, SessionUser } from './auth/auth.ts';
import { apiError } from './errors.ts';
import { log } from './log.ts';
import type { ReadGate } from './gate.ts';
import type { RealtimeTokens } from './realtime/tokens.ts';
import type { WakeRelay } from './realtime/wake.ts';

/** What every procedure receives. */
export interface RequestContext extends ResponseHeadersPluginContext {
  db: Database;
  /** Global identity: the directory and users. */
  identity: IdentityStore;
  /** Sign in: sessions and the configured providers. */
  auth: Auth;
  /**
   * Pokes the worker's relay (spec 0005). A write procedure calls it once its
   * engine call has resolved, so the write committed: see `realtime/wake.ts`.
   */
  wakeRelay: WakeRelay;
  environment: AppEnvironment;
  /** This request's id, also sent back as `x-request-id`; every log line about the request carries it. */
  requestId: string;
  /** The caller's IP, only when the edge guard trusted the request (see `edge.ts`). */
  clientIp: string | undefined;
  /** The request's headers, for the session cookie. */
  headers: Headers;
  /** This process's cap on heavy reads in flight per workspace (`records.query` and `records.count`). */
  readGate: ReadGate;
  /** Signs Centrifugo's tokens (spec 0005), or undefined where live updates are off (no `CENTRIFUGO_TOKEN_SECRET`). */
  realtime: RealtimeTokens | undefined;
}

/** What `authed` adds: the signed in person. */
export interface SessionContext {
  user: SessionUser;
}

export const base = implement(contract).$context<RequestContext>();

/** Procedures anyone may call. */
export const pub = base;

/** Puts the signed in person in `context.user`, or refuses UNAUTHENTICATED. A renewed session cookie goes back out. */
export const requireSession = os.$context<RequestContext>().middleware(async ({ context, next }) => {
  const session = await context.auth.session(context.headers, context.clientIp);
  if (session === undefined) throw apiError('UNAUTHENTICATED', 'Sign in to continue.');
  for (const cookie of session.setCookies) context.resHeaders?.append('set-cookie', cookie);
  return next({ context: { user: session.user } });
});

/**
 * What a `member` handler holds for `context.db` and `context.identity`:
 * nothing at run time, and `never` in the type (oRPC lets a middleware narrow
 * a context field, never widen it), so reading anything off either doesn't
 * compile. Global identity (sessions, the directory, every user) is no member
 * handler's business; one that needs a piece of it gets a narrow interface.
 */
const TAKEN_AWAY = undefined as never;

/**
 * The access door for a workspace procedure: reads `workspace` (its address)
 * from the input and puts the scope `enterWorkspace` returns in
 * `context.scope`. A non member, a removed member and an unknown address all
 * get the same NOT_FOUND. It takes `context.db` and `context.identity` away
 * (see `TAKEN_AWAY`), so a handler behind it reaches data only through its
 * scope.
 */
export const requireMember = os
  .$context<RequestContext & SessionContext>()
  .middleware(async ({ context, next }, input: unknown) => {
    const scoped = WorkspaceScoped.safeParse(input);
    if (!scoped.success) {
      throw apiError('INPUT_INVALID', 'Some of the input is invalid.', {
        issues: [{ path: ['workspace'], message: 'Name the workspace by its address.' }],
      });
    }
    const scope = await enterWorkspace(
      { db: context.db, identity: context.identity, log },
      { userId: context.user.id, slug: scoped.data.workspace },
    );
    return next({ context: { scope, db: TAKEN_AWAY, identity: TAKEN_AWAY } });
  });

/** Procedures for a signed in person, before any workspace (the bootstrap list). */
export const authed = base.use(requireSession);

/** Procedures inside a workspace: a session and an active member row there. */
export const member = authed.use(requireMember);
