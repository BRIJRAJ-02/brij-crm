// A step up (spec 0033, AC-896): before a sensitive account change, the
// session proves who it is again. With two factor on, that is an app code or
// a backup code; with it off, a code emailed to the account's address. A
// proof makes this session fresh for STEP_UP_MINUTES (`auth.session.verified_at`).
// Turning two factor off takes the second factor itself (AC-885). Attempt
// limits are the caller's (the API counts them per person before calling).
// Nothing here sees a secret: the second factor check is handed in.
import {
  type AccountSecurity,
  type SessionFreshness,
  STEP_UP_CODE_MINUTES,
  STEP_UP_MINUTES,
  type StepUpVerifyInput,
} from '@crm/contracts';
import type { IdentityStore } from '@crm/db';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { SessionCaller } from './sessions.ts';

/** What a step up needs. */
export interface StepUpDeps {
  readonly identity: Pick<
    IdentityStore,
    | 'sessionVerification'
    | 'markSessionVerified'
    | 'twoFactorState'
    | 'putStepUpCode'
    | 'checkStepUpCode'
    | 'listPasskeys'
    | 'hasPasskey'
  >;
  /** Checks an app code or a backup code (a backup code is used up). Never throws for a wrong code. */
  readonly checkSecondFactor: (userId: string, method: 'totp' | 'backup', code: string) => Promise<boolean>;
  /** How many unused backup codes the person has, while two factor is on. */
  readonly backupCodesLeft: (userId: string) => Promise<number | undefined>;
  /** Emails a step up code to the account's address. */
  readonly sendCode: (email: string, code: string) => Promise<void>;
  /** A fresh 6 digit code. */
  readonly mintCode: () => string;
  /** The code as kept: a one way hash, so the table never holds a usable code. */
  readonly hashCode: (code: string) => string;
  /** The names of the workspaces the person is in that require two factor (AC-885). */
  readonly requiredBy: (userId: string) => Promise<readonly string[]>;
  readonly now?: () => number;
}

/** What freshness needs: the session's last verification, and the clock. */
export interface FreshnessDeps {
  readonly identity: Pick<IdentityStore, 'sessionVerification'>;
  readonly now?: () => number;
}

/** What a wrong code answers, for every method alike. */
export const CODE_INVALID_MESSAGE = 'That code didn’t work. Try the newest code in your app.';
/** What an email or backup code that didn't check out answers. */
export const EMAIL_CODE_INVALID_MESSAGE = 'That code didn’t work. Check the newest email, or send a new code.';
/** What an email code answers once it ran out, was used up by wrong tries, or was never sent to this session. */
export const EMAIL_CODE_EXPIRED_MESSAGE = 'That code has expired. Send a new code.';
/** What a step up by email answers while two factor is on: the app or a passkey proves it. */
export const USE_SECOND_FACTOR = 'Two factor sign in is on: use your passkey, a code from your app or a backup code.';

/**
 * Whether the person has a second factor (spec 0033, AC-888): the
 * authenticator app, or a passkey. With one, every sensitive change is proven
 * by it, never by an email code.
 */
export async function hasSecondFactor(
  identity: Pick<IdentityStore, 'twoFactorState' | 'hasPasskey'>,
  userId: string,
): Promise<boolean> {
  return (await identity.twoFactorState(userId)).enabled || identity.hasPasskey(userId);
}
/** What an app or backup code answers while two factor is off. */
export const NO_SECOND_FACTOR = 'Two factor sign in is off: confirm with a code sent to your email.';
/** What turning two factor off answers after an email code alone (AC-885). */
export const SECOND_FACTOR_MESSAGE = 'Confirm with a code from your app or a backup code first.';
/** What a sensitive change answers on a session that hasn't proven itself lately. */
export const FRESH_MESSAGE = `Confirm it's you first: this needs a check in the last ${String(STEP_UP_MINUTES)} minutes.`;

const MINUTE = 60_000;

/** How fresh this session is: until when, and whether a second factor proved it. */
export async function sessionFreshness(deps: FreshnessDeps, caller: SessionCaller): Promise<SessionFreshness> {
  const now = (deps.now ?? Date.now)();
  const verification = await deps.identity.sessionVerification(caller.userId, caller.sessionId);
  if (verification === undefined) return { withSecondFactor: false };
  const at = Date.parse(verification.at);
  const until = at + STEP_UP_MINUTES * MINUTE;
  // A moment more than a minute ahead of the clock is never trusted.
  const fresh = !Number.isNaN(at) && until > now && at <= now + MINUTE;
  return {
    ...(fresh ? { freshUntil: new Date(until).toISOString() } : {}),
    withSecondFactor: verification.with === 'second_factor',
  };
}

/**
 * Refuses unless this session proved who it is within STEP_UP_MINUTES
 * (403 STEP_UP_REQUIRED); with `secondFactor`, unless a second factor proved
 * it (403 SECOND_FACTOR_REQUIRED, AC-885).
 */
export async function requireFresh(
  deps: FreshnessDeps,
  caller: SessionCaller,
  options: { readonly secondFactor?: boolean } = {},
): Promise<void> {
  const freshness = await sessionFreshness(deps, caller);
  if (freshness.freshUntil === undefined) throw refuse('STEP_UP_REQUIRED', FRESH_MESSAGE);
  if (options.secondFactor === true && !freshness.withSecondFactor) {
    throw refuse('SECOND_FACTOR_REQUIRED', SECOND_FACTOR_MESSAGE);
  }
}

/** Account › Security's state: two factor, backup codes left, passkeys, and this session's freshness (AC-881, AC-887). */
export async function accountSecurity(deps: StepUpDeps, caller: SessionCaller): Promise<AccountSecurity> {
  const [state, session, passkeys, requiredBy] = await Promise.all([
    deps.identity.twoFactorState(caller.userId),
    sessionFreshness(deps, caller),
    deps.identity.listPasskeys(caller.userId),
    deps.requiredBy(caller.userId),
  ]);
  const left = state.enabled ? await deps.backupCodesLeft(caller.userId) : undefined;
  return {
    twoFactor: { on: state.enabled, ...(left === undefined ? {} : { backupCodesLeft: left }) },
    passkeys: passkeys.map((each) => ({
      id: each.id,
      createdAt: each.createdAt,
      ...(each.name === undefined ? {} : { name: each.name }),
      ...(each.lastUsedAt === undefined ? {} : { lastUsedAt: each.lastUsedAt }),
    })),
    session,
    requiredBy: [...requiredBy],
  };
}

/** Emails a step up code (only while two factor is off: then the app proves it). */
export async function startStepUp(
  deps: StepUpDeps,
  caller: SessionCaller & { readonly email: string },
): Promise<{ readonly sent: true }> {
  if (await hasSecondFactor(deps.identity, caller.userId)) throw inputInvalid('method', USE_SECOND_FACTOR);
  const code = deps.mintCode();
  const now = (deps.now ?? Date.now)();
  // Sent first: a send that fails leaves the code already in the person's inbox working. A code checks out only
  // once stored, so the mail arriving a moment earlier opens nothing.
  await deps.sendCode(caller.email, code);
  await deps.identity.putStepUpCode(
    caller.sessionId,
    deps.hashCode(code),
    new Date(now + STEP_UP_CODE_MINUTES * MINUTE),
  );
  return { sent: true };
}

/**
 * Checks a step up code and makes this session fresh: an email code while
 * two factor is off, an app or backup code while it is on. 422 CODE_INVALID
 * for a wrong one.
 */
export async function verifyStepUp(
  deps: StepUpDeps,
  caller: SessionCaller,
  input: StepUpVerifyInput,
): Promise<SessionFreshness> {
  const state = await deps.identity.twoFactorState(caller.userId);
  if (input.method === 'email') {
    // A passkey counts too (AC-888): an account with one never proves itself by email alone.
    if (state.enabled || (await deps.identity.hasPasskey(caller.userId))) {
      throw inputInvalid('method', USE_SECOND_FACTOR);
    }
    if (!/^\d{6}$/.test(input.code)) throw refuse('CODE_INVALID', EMAIL_CODE_INVALID_MESSAGE);
    const checked = await deps.identity.checkStepUpCode(caller.sessionId, deps.hashCode(input.code));
    if (checked === 'missing') throw refuse('CODE_INVALID', EMAIL_CODE_EXPIRED_MESSAGE);
    if (checked !== 'ok') throw refuse('CODE_INVALID', EMAIL_CODE_INVALID_MESSAGE);
    await deps.identity.markSessionVerified(caller.userId, caller.sessionId, 'email');
  } else {
    if (!state.enabled) throw inputInvalid('method', NO_SECOND_FACTOR);
    if (input.method === 'totp' && !/^\d{6}$/.test(input.code)) throw refuse('CODE_INVALID', CODE_INVALID_MESSAGE);
    const ok = await deps.checkSecondFactor(caller.userId, input.method, input.code);
    if (!ok) throw refuse('CODE_INVALID', CODE_INVALID_MESSAGE);
    await deps.identity.markSessionVerified(caller.userId, caller.sessionId, 'second_factor');
  }
  return sessionFreshness(deps, caller);
}
