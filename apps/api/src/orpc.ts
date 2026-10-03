// The procedure bases (spec 0005, the access door). Every procedure is built
// on one of three:
// - `pub`: anyone (the status check);
// - `authed`: a signed in person (`context.user`), else 401 UNAUTHENTICATED;
// - `member`: `authed` plus the access door for the input's `workspace`
//   (`context.scope`), else the same NOT_FOUND for a non member, a removed
//   member and an unknown address.
// Only `enterWorkspace` in packages/core builds a member's scope; nothing in
// this app builds one. The contract walking test fails if a procedure outside
// the bootstrap list isn't built on `member`.
import { type AppEnvironment, contract, WorkspaceScoped } from '@crm/contracts';
import { enterWorkspace } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { implement, os } from '@orpc/server';
import type { ResponseHeadersPluginContext } from '@orpc/server/plugins';
import type { Auth, SessionUser } from './auth/auth.ts';
import { apiError } from './errors.ts';

/** What every procedure receives. */
export interface RequestContext extends ResponseHeadersPluginContext {
  db: Database;
  /** Global identity: the directory and users. */
  identity: IdentityStore;
  /** Sign in: sessions and the configured providers. */
  auth: Auth;
  environment: AppEnvironment;
  /** This request's id, also sent back as `x-request-id`; every log line about the request carries it. */
  requestId: string;
  /** The caller's IP, only when the edge guard trusted the request (see `edge.ts`). */
  clientIp: string | undefined;
  /** The request's headers, for the session cookie. */
  headers: Headers;
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
 * The access door for a workspace procedure: reads `workspace` (its address)
 * from the input and puts the scope `enterWorkspace` returns in
 * `context.scope`. A non member, a removed member and an unknown address all
 * get the same NOT_FOUND.
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
      { db: context.db, identity: context.identity },
      { userId: context.user.id, slug: scoped.data.workspace },
    );
    return next({ context: { scope } });
  });

/** Procedures for a signed in person, before any workspace (the bootstrap list). */
export const authed = base.use(requireSession);

/** Procedures inside a workspace: a session and an active member row there. */
export const member = authed.use(requireMember);
