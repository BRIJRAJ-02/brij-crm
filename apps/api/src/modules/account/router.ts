import { listMySessions, revokeMyOtherSessions, revokeMySession, type SessionCaller } from '@crm/core';
import { authed, type RequestContext, type SessionContext } from '../../orpc.ts';

// Bootstrap: a session, no workspace (spec 0033). Each procedure reaches only the caller's own sessions, by id.

/** The caller as the session services take them: their user, this request's session, and the trusted IP. */
function callerOf(context: RequestContext & SessionContext): SessionCaller {
  return {
    userId: context.user.id,
    sessionId: context.sessionId,
    ...(context.clientIp === undefined ? {} : { ip: context.clientIp }),
  };
}

export const accountRouter = authed.account.router({
  sessions: {
    list: authed.account.sessions.list.handler(({ context, input }) =>
      listMySessions({ identity: context.identity }, callerOf(context), input),
    ),
    revoke: authed.account.sessions.revoke.handler(({ context, input }) =>
      revokeMySession({ identity: context.identity, signedOut: context.signedOut }, callerOf(context), input),
    ),
    revokeOthers: authed.account.sessions.revokeOthers.handler(({ context }) =>
      revokeMyOtherSessions({ identity: context.identity, signedOut: context.signedOut }, callerOf(context)),
    ),
  },
});
