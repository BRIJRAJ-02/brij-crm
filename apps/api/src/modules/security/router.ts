import {
  getWorkspaceSecurity,
  requireFresh,
  setWorkspaceSecurity,
  signOutEveryone,
  type WorkspaceSecurityDeps,
} from '@crm/core';
import { commitWrite } from '../../hooks.ts';
import { member, type RequestContext, type SessionContext } from '../../orpc.ts';
import { sourceOf } from '../../source.ts';

// A workspace's sign in rules (spec 0033, milestone 4): Settings › Workspace › Security. Inside a workspace, owners
// only (`security.manage`, checked first in core). The writes change no records and store no change event: the
// door reads the row on every request, so nothing needs telling.

/** Who has a second factor among the members, and whether the caller does: ids only, through `context.factors`. */
function factorsOf(
  context: Pick<RequestContext, 'factors'> & Pick<SessionContext, 'doorSession'>,
): WorkspaceSecurityDeps {
  return {
    secondFactorUsers: (userIds) => context.factors.secondFactorUsers(userIds),
    callerHasSecondFactor: () => context.doorSession.hasSecondFactor(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Keeps the owner who changed the rules in: their own session proven again,
 * once the change has committed, with the proof it already had. Without one
 * (a session gone meanwhile) nothing is marked.
 */
function keepCaller(context: Pick<RequestContext, 'factors'> & Pick<SessionContext, 'user' | 'sessionId'>) {
  return async (): Promise<void> => {
    const proof = await context.factors.sessionVerification(context.user.id, context.sessionId);
    if (proof === undefined) return;
    await context.factors.markSessionVerified(context.user.id, context.sessionId, proof.with);
  };
}

export const workspaceSecurityRouter = member.workspaceSecurity.router({
  get: member.workspaceSecurity.get.handler(({ context, input }) =>
    getWorkspaceSecurity(context.scope, input, factorsOf(context)),
  ),
  set: member.workspaceSecurity.set.handler(async ({ context, input }) => {
    const rules = await commitWrite(context, undefined, (hooks) =>
      setWorkspaceSecurity(
        context.scope,
        {
          ...(input.requireTwoFactor === undefined ? {} : { requireTwoFactor: input.requireTwoFactor }),
          ...(input.sessionLengthDays === undefined ? {} : { sessionLengthDays: input.sessionLengthDays }),
        },
        factorsOf(context),
        hooks,
        sourceOf(context),
      ),
    );
    // A length shorter than the owner's own sign in would shut them out of the page they just changed it on.
    const days = input.sessionLengthDays;
    if (typeof days === 'number' && Date.now() - context.doorSession.verifiedAt.getTime() > days * DAY_MS) {
      await keepCaller(context)();
    }
    return rules;
  }),
  // An ending action for everyone else: the caller confirms it's them first (a fresh step up, AC-896), and keeps
  // their own session, proven again once the cut off has committed.
  signOutEveryone: member.workspaceSecurity.signOutEveryone.handler(async ({ context, input }) => {
    const caller = { userId: context.user.id, sessionId: context.sessionId };
    await requireFresh({ identity: context.factors }, caller);
    return commitWrite(context, undefined, (hooks) =>
      signOutEveryone(
        context.scope,
        input,
        {
          ...factorsOf(context),
          keepCaller: keepCaller(context),
        },
        hooks,
        sourceOf(context),
      ),
    );
  }),
});
