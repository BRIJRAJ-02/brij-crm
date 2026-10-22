import { randomInt } from 'node:crypto';
import {
  accountDeletionCheck,
  accountSecurity,
  deleteMyAccount,
  type AccountDeletionDeps,
  listMySessions,
  type PasskeyDeps,
  passkeyStepUpOptions,
  closeJoinRequestsOf,
  listMyActivity,
  removeMyPasskey,
  renameMyPasskey,
  revokeMyOtherSessions,
  revokeMySession,
  startStepUp,
  verifyPasskeyStepUp,
  verifyStepUp,
  type SessionCaller,
  type StepUpDeps,
} from '@crm/core';
import { renderAccountDeleted, renderSignInCode } from '@crm/emails';
import { backgroundHooks, commitWrite } from '../../hooks.ts';
import { apiError } from '../../errors.ts';
import { refusalOf } from '../../mail/mailer.ts';
import { log } from '../../log.ts';
import { captureFault } from '../../monitoring/sentry.ts';
import { authed, memberDoor, type RequestContext, type SessionContext } from '../../orpc.ts';

/** Step up checks per person (AC-882's limits, for a step up too): 5 in 5 minutes, 15 in an hour. */
export const STEP_UP_CHECKS = { window: 5 * 60, max: 5 } as const;
/** Step up checks per person in an hour. */
export const STEP_UP_CHECKS_HOUR = { window: 60 * 60, max: 15 } as const;
/** Step up emails per person: 3 in 10 minutes. */
export const STEP_UP_SENDS = { window: 10 * 60, max: 3 } as const;
/** Passkey step up challenges per person: 20 in 10 minutes (each replaces the last, so this only stops a flood). */
export const STEP_UP_PASSKEY_CHALLENGES = { window: 10 * 60, max: 20 } as const;

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
      try {
        const message = await renderSignInCode(code, { appOrigin: new URL(context.appUrl).origin });
        await context.mailer.send({ to: email, ...message });
      } catch (error) {
        // Only the error's name and the mail service's refusal code: never its message, which could quote the
        // recipient. Reported, since every step up waits on this mail; the person is told the code didn't go.
        const refusal = refusalOf(error)?.code;
        log.error('Step up code not sent', {
          mail: context.mailer.transport,
          error: error instanceof Error ? error.name : typeof error,
          ...(refusal === undefined ? {} : { refusal }),
        });
        captureFault(error, { requestId: context.requestId, task: 'step up mail' });
        throw apiError('API_UNAVAILABLE', CODE_NOT_SENT_MESSAGE);
      }
      log.info('Step up code sent', { mail: context.mailer.transport });
    },
    mintCode: () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
    hashCode: (code) => context.auth.hashStepUpCode(code),
    requiredBy: (userId) => context.requiredBy(userId),
  };
}

/** What the passkey procedures need: the identity store, and sign in's passkey step up. */
function passkeyDeps(context: RequestContext): PasskeyDeps {
  return {
    identity: context.identity,
    passkeyOptions: (caller) => context.auth.passkeyStepUp.options(caller.userId, caller.sessionId),
    checkPasskey: (caller, response) => context.auth.passkeyStepUp.check(caller.userId, caller.sessionId, response),
    requiredBy: (userId) => context.requiredBy(userId),
  };
}

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
    // Their join requests in workspaces they never joined: open ones declined, and none naming them (AC-905).
    closeJoinRequests: async (userId) => {
      await closeJoinRequestsOf(memberDoor(context), userId);
    },
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

/** What a step up answers when its code email couldn't be sent: plain, and what to do next. */
export const CODE_NOT_SENT_MESSAGE = 'We couldn’t send the code just now. Try again in a few minutes.';

/** How long to wait, in whole minutes (at least one), or hours from an hour up, as a refusal says it. */
export function waitFor(seconds: number | undefined): string {
  const minutes = Math.max(1, Math.ceil((seconds ?? 60) / 60));
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return hours === 1 ? '1 hour' : `${String(hours)} hours`;
  }
  return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
}

/**
 * Counts one use of a per person limit; refuses RATE_LIMITED when any window
 * is spent, saying `lead` and how many minutes until the longest spent window
 * lets a try through again.
 */
async function limit(
  context: RequestContext,
  key: string,
  windows: readonly { readonly window: number; readonly max: number }[],
  lead: string,
): Promise<void> {
  const decisions = await Promise.all(
    windows.map((each, index) => context.identity.consumeRateLimit(`${key}|${String(index)}`, each)),
  );
  const spent = decisions.filter((decision) => !decision.allowed);
  if (spent.length === 0) return;
  const wait = Math.max(...spent.map((decision) => decision.retryAfterSeconds ?? 60));
  throw apiError('RATE_LIMITED', `${lead} Wait ${waitFor(wait)}, then try again.`);
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
  // The person's last 90 days of security events (AC-898): by their user id, from schema auth.
  activity: {
    list: authed.account.activity.list.handler(({ context, input }) =>
      listMyActivity({ identity: context.identity }, callerOf(context), input),
    ),
  },
  stepUp: {
    start: authed.account.stepUp.start.handler(async ({ context }) => {
      await limit(context, `step-up-send:${context.user.id}`, [STEP_UP_SENDS], 'Too many codes sent.');
      return startStepUp(stepUpDeps(context), { ...callerOf(context), email: context.user.email });
    }),
    verify: authed.account.stepUp.verify.handler(async ({ context, input }) => {
      // Counted per person whatever the method, so neither an app code nor a backup code can be guessed at.
      await limit(context, `step-up:${context.user.id}`, [STEP_UP_CHECKS, STEP_UP_CHECKS_HOUR], 'Too many tries.');
      return verifyStepUp(stepUpDeps(context), callerOf(context), input);
    }),
    passkeyOptions: authed.account.stepUp.passkeyOptions.handler(async ({ context }) => {
      await limit(context, `step-up-passkey:${context.user.id}`, [STEP_UP_PASSKEY_CHALLENGES], 'Too many tries.');
      return passkeyStepUpOptions(passkeyDeps(context), callerOf(context));
    }),
    verifyPasskey: authed.account.stepUp.verifyPasskey.handler(async ({ context, input }) => {
      // The same per person count as a code: a step up is never guessed at by switching method.
      await limit(context, `step-up:${context.user.id}`, [STEP_UP_CHECKS, STEP_UP_CHECKS_HOUR], 'Too many tries.');
      return verifyPasskeyStepUp(passkeyDeps(context), callerOf(context), input);
    }),
  },
  passkeys: {
    rename: authed.account.passkeys.rename.handler(({ context, input }) =>
      renameMyPasskey(passkeyDeps(context), callerOf(context), input),
    ),
    remove: authed.account.passkeys.remove.handler(({ context, input }) =>
      removeMyPasskey(passkeyDeps(context), callerOf(context), input),
    ),
  },
  deletion: {
    check: authed.account.deletion.check.handler(({ context }) =>
      accountDeletionCheck(deletionDeps(context), callerOf(context)),
    ),
    // Each workspace's removal stores its members event, so the write path pokes the relay once it commits.
    confirm: authed.account.deletion.confirm.handler(({ context, input }) =>
      commitWrite(context, undefined, () =>
        deleteMyAccount(deletionDeps(context), { ...callerOf(context), email: context.user.email }, input),
      ),
    ),
  },
});
