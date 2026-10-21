import { randomInt } from 'node:crypto';
import {
  accountDeletionCheck,
  accountSecurity,
  deleteMyAccount,
  type AccountDeletionDeps,
  listMySessions,
  revokeMyOtherSessions,
  revokeMySession,
  startStepUp,
  verifyStepUp,
  type SessionCaller,
  type StepUpDeps,
} from '@crm/core';
import { renderAccountDeleted, renderSignInCode } from '@crm/emails';
import { backgroundHooks } from '../../hooks.ts';
import { apiError } from '../../errors.ts';
import { log } from '../../log.ts';
import { authed, memberDoor, type RequestContext, type SessionContext } from '../../orpc.ts';

/** Step up checks per person (AC-882's limits, for a step up too): 5 in 5 minutes, 15 in an hour. */
export const STEP_UP_CHECKS = { window: 5 * 60, max: 5 } as const;
/** Step up checks per person in an hour. */
export const STEP_UP_CHECKS_HOUR = { window: 60 * 60, max: 15 } as const;
/** Step up emails per person: 3 in 10 minutes. */
export const STEP_UP_SENDS = { window: 10 * 60, max: 3 } as const;

// Bootstrap: a session, no workspace (spec 0033). Each procedure reaches only the caller's own sessions, by id.

/** The caller as the session services take them: their user, this request's session, and the trusted IP. */
function callerOf(context: RequestContext & SessionContext): SessionCaller {
  return {
    userId: context.user.id,
    sessionId: context.sessionId,
    ...(context.clientIp === undefined ? {} : { ip: context.clientIp }),
  };
}

/** What a step up needs, from the request: the identity store, the second factor check, and the mailer. */
function stepUpDeps(context: RequestContext): StepUpDeps {
  return {
    identity: context.identity,
    checkSecondFactor: (userId, method, code) => context.auth.checkSecondFactor(userId, method, code),
    backupCodesLeft: (userId) => context.auth.backupCodesLeft(userId),
    sendCode: async (email, code) => {
      // The code goes only to the account's own address; the log names neither.
      const message = await renderSignInCode(code, { appOrigin: new URL(context.appUrl).origin });
      await context.mailer.send({ to: email, ...message });
      log.info('Step up code sent', { mail: context.mailer.transport });
    },
    mintCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
    hashCode: (code) => context.auth.hashStepUpCode(code),
  };
}

/** Account deletion's join request step until the members lane's table lands: there is nothing to close. */
const closeNoJoinRequests = async (_userId: string): Promise<void> => {};

/** What deleting the account needs, from the request (spec 0033, AC-902 to AC-907). */
function deletionDeps(context: RequestContext): AccountDeletionDeps {
  const calendar = context.calendar;
  return {
    // Each workspace is entered through the door in packages/core, opened as the member base opens it.
    ...memberDoor(context),
    hooks: backgroundHooks,
    signedOut: context.signedOut,
    ...(calendar === undefined
      ? {}
      : {
          calendar: {
            tokenKey: calendar.tokenKey,
            // Google's revoke endpoint (the same OAuth client) takes either token and ends the whole grant; the
            // refresh token outlives the other. Best effort, never throws.
            revoke: (grant) =>
              grant.provider === 'google' ? calendar.guest.revoke(grant.tokens.refreshToken) : Promise.resolve(),
          },
        }),
    // No join requests table on this base yet: the members lane (spec 0031 slice 6b) wires its close here.
    closeJoinRequests: closeNoJoinRequests,
    sendFarewell: async (email) => {
      try {
        const message = await renderAccountDeleted(new Date(), { appOrigin: new URL(context.appUrl).origin });
        await context.mailer.send({ to: email, ...message });
      } catch (error) {
        // The account is gone either way; the log names neither the address nor the person.
        log.error('Account deleted email not sent', { error: error instanceof Error ? error.name : typeof error });
      }
    },
  };
}

/** Counts one use of a per person limit; refuses RATE_LIMITED when any window is spent. */
async function limit(
  context: RequestContext,
  key: string,
  windows: readonly { readonly window: number; readonly max: number }[],
  message: string,
): Promise<void> {
  const decisions = await Promise.all(
    windows.map((each, index) => context.identity.consumeRateLimit(`${key}|${String(index)}`, each)),
  );
  if (decisions.some((decision) => !decision.allowed)) throw apiError('RATE_LIMITED', message);
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
  security: {
    get: authed.account.security.get.handler(({ context }) => accountSecurity(stepUpDeps(context), callerOf(context))),
  },
  stepUp: {
    start: authed.account.stepUp.start.handler(async ({ context }) => {
      await limit(
        context,
        `step-up-send:${context.user.id}`,
        [STEP_UP_SENDS],
        'Too many codes sent. Wait a few minutes.',
      );
      return startStepUp(stepUpDeps(context), { ...callerOf(context), email: context.user.email });
    }),
    verify: authed.account.stepUp.verify.handler(async ({ context, input }) => {
      // Counted per person whatever the method, so neither an app code nor a backup code can be guessed at.
      await limit(
        context,
        `step-up:${context.user.id}`,
        [STEP_UP_CHECKS, STEP_UP_CHECKS_HOUR],
        'Too many tries. Wait 15 minutes, then try again.',
      );
      return verifyStepUp(stepUpDeps(context), callerOf(context), input);
    }),
  },
  deletion: {
    check: authed.account.deletion.check.handler(({ context }) =>
      accountDeletionCheck(deletionDeps(context), callerOf(context)),
    ),
    confirm: authed.account.deletion.confirm.handler(async ({ context, input }) => {
      const deleted = await deleteMyAccount(
        deletionDeps(context),
        { ...callerOf(context), email: context.user.email },
        input,
      );
      // Each workspace's removal stored its members event: the relay sends them.
      context.wakeRelay();
      return deleted;
    }),
  },
});
