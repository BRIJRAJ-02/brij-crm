import {
  decideJoinRequest,
  getWorkspaceDomains,
  listJoinable,
  listJoinRequests,
  newId,
  requestToJoin,
  setWorkspaceDomains,
} from '@crm/core';
import type { JoinDecision, RequestNotice } from '@crm/core';
import { renderJoinApproved, renderJoinRequest } from '@crm/emails';
import { apiError } from '../../errors.ts';
import { commitWrite } from '../../hooks.ts';
import { errorFields, log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { authed, member, type RequestContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// Domain join (spec 0031, slice 6, AC-819, AC-820). `join.list` and `join.request` are bootstrap: the signed in
// person isn't a member yet, and core finds their workspaces through the door's domain lookup, minting a scope in
// each, so nothing here builds one. `joinRequests.*` sit inside the workspace, behind the door, for those who manage
// its settings (domains) or invite (requests).

/** Requests one person may make in an hour, across workspaces: enough for a team, too few to flood admins. */
const REQUESTS_PER_HOUR = 10;

/** The person as the session knows them. */
const personOf = (user: {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
});

/** Tells each owner and admin about a new request, once it committed. Failures are logged, never thrown. */
async function mailAdmins(
  context: Pick<RequestContext, 'mailer' | 'appUrl' | 'requestId'>,
  notice: RequestNotice,
): Promise<void> {
  const origin = new URL(context.appUrl).origin;
  for (const admin of notice.admins) {
    try {
      const message = await renderJoinRequest(
        {
          requesterName: notice.requester.name,
          requesterEmail: notice.requester.email,
          reviewPath: `/w/${notice.slug}/settings/members`,
        },
        { appOrigin: origin, workspaceName: notice.workspaceName },
      );
      await context.mailer.send({ to: admin.email, ...message });
    } catch (error) {
      log.error('Join request email not sent', {
        requestId: context.requestId,
        mail: context.mailer.transport,
        ...errorFields(error),
      });
      captureFault(error, { task: 'join-request-mail' });
    }
  }
}

/** Tells the person their request was approved, once it committed. A failure is logged: they are in either way. */
async function mailApproved(
  context: Pick<RequestContext, 'mailer' | 'appUrl' | 'requestId'>,
  decision: JoinDecision,
): Promise<void> {
  if (!decision.approved) return;
  try {
    const message = await renderJoinApproved(
      { openPath: `/w/${decision.slug}` },
      { appOrigin: new URL(context.appUrl).origin, workspaceName: decision.workspaceName },
    );
    await context.mailer.send({ to: decision.email, ...message });
  } catch (error) {
    log.error('Join approval email not sent', {
      requestId: context.requestId,
      mail: context.mailer.transport,
      ...errorFields(error),
    });
    captureFault(error, { task: 'join-approved-mail' });
  }
}

/** `/join`: the workspaces the person may ask to join, and asking (bootstrap). */
export const joinRouter = {
  list: authed.join.list.handler(({ context }) => listJoinable({ db: context.db }, personOf(context.user))),
  request: authed.join.request.handler(async ({ context, input }) => {
    const limit = await context.limiter.consumeRateLimit(`join:request:${context.user.id}`, {
      window: 3600,
      max: REQUESTS_PER_HOUR,
    });
    if (!limit.allowed) throw apiError('RATE_LIMITED', 'Too many requests to join in the last hour. Try again later.');
    // A server made mutation id: the person has no events of this workspace to skip.
    const asked = await commitWrite(context, { mutationId: newId() }, (hooks) =>
      requestToJoin({ db: context.db }, personOf(context.user), input.workspaceId, hooks, {
        source: sourceOf(context),
      }),
    );
    if (asked.notice !== undefined) await mailAdmins(context, asked.notice);
    return asked.joinable;
  }),
};

/** A workspace's email domains and its requests to join, behind the door. */
export const joinRequestsRouter = member.joinRequests.router({
  domains: member.joinRequests.domains.handler(({ context }) =>
    getWorkspaceDomains(context.scope, personOf(context.user)),
  ),
  setDomains: member.joinRequests.setDomains.handler(({ context, input }) =>
    commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      setWorkspaceDomains(context.scope, { domains: input.domains }, personOf(context.user), hooks, {
        source: sourceOf(context),
      }),
    ),
  ),
  list: member.joinRequests.list.handler(({ context }) => listJoinRequests(context.scope)),
  decide: member.joinRequests.decide.handler(async ({ context, input }) => {
    const decision = await commitWrite(context, { mutationId: input.mutationId }, (hooks) =>
      decideJoinRequest(context.scope, { requestId: input.requestId, approve: input.approve }, hooks, {
        source: sourceOf(context),
      }),
    );
    await mailApproved(context, decision);
  }),
});
