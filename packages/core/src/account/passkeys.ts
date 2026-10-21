// Passkeys (spec 0033, milestone 3, AC-887 to AC-889): the person's own list,
// renaming and removing one, and a step up by passkey. Adding a passkey and
// signing in with one go through sign in's own routes (the API's auth
// module), never here. Nothing here sees a key: checking a passkey's answer
// is handed in, as checking an app code is.
import type {
  AccountPasskey,
  PasskeyRequestOptions,
  RemovePasskeyInput,
  RenamePasskeyInput,
  SessionFreshness,
  StepUpPasskeyInput,
} from '@crm/contracts';
import type { IdentityStore } from '@crm/db';
import { inputInvalid, refuse } from '../engine/refusals.ts';
import type { SessionCaller } from './sessions.ts';
import { requireFresh, sessionFreshness } from './step-up.ts';

/** What the passkey procedures need. */
export interface PasskeyDeps {
  readonly identity: Pick<
    IdentityStore,
    | 'listPasskeys'
    | 'renamePasskey'
    | 'removePasskey'
    | 'twoFactorState'
    | 'sessionVerification'
    | 'markSessionVerified'
    | 'recordSecurityEvent'
  >;
  /** A step up's challenge for this session and the person's passkeys, or undefined when they have none. */
  readonly passkeyOptions: (caller: SessionCaller) => Promise<PasskeyRequestOptions | undefined>;
  /** Checks a passkey's answer to this session's challenge (used up either way). Never throws for a wrong one. */
  readonly checkPasskey: (caller: SessionCaller, response: StepUpPasskeyInput['response']) => Promise<boolean>;
  readonly now?: () => number;
}

/** What a passkey step up answers when the person has none. */
export const NO_PASSKEY = 'You have no passkey yet: confirm another way.';
/** What a passkey that didn't check out answers. */
export const PASSKEY_INVALID_MESSAGE = 'That passkey didn’t work. Try again, or confirm another way.';
/** What renaming or removing a passkey that isn't the person's (or is gone) answers. */
export const UNKNOWN_PASSKEY = 'That passkey isn’t on your account any more.';

/** A step up's challenge (AC-896): the browser asks for one of the person's passkeys. */
export async function passkeyStepUpOptions(
  deps: PasskeyDeps,
  caller: SessionCaller,
): Promise<{ readonly options: PasskeyRequestOptions }> {
  const options = await deps.passkeyOptions(caller);
  if (options === undefined) throw inputInvalid('method', NO_PASSKEY);
  return { options };
}

/**
 * Checks a passkey's answer and makes this session fresh. A passkey counts as
 * a second factor (owner decision 3), so it can also turn two factor off.
 * 422 CODE_INVALID for an answer that didn't check out.
 */
export async function verifyPasskeyStepUp(
  deps: PasskeyDeps,
  caller: SessionCaller,
  input: StepUpPasskeyInput,
): Promise<SessionFreshness> {
  if (!(await deps.checkPasskey(caller, input.response))) throw refuse('CODE_INVALID', PASSKEY_INVALID_MESSAGE);
  await deps.identity.markSessionVerified(caller.userId, caller.sessionId, 'second_factor');
  return sessionFreshness(deps, caller);
}

/** Renames one of the caller's passkeys (a session is enough: a label changes no access). */
export async function renameMyPasskey(
  deps: PasskeyDeps,
  caller: SessionCaller,
  input: RenamePasskeyInput,
): Promise<AccountPasskey> {
  if (!(await deps.identity.renamePasskey(caller.userId, input.id, input.name))) {
    throw refuse('NOT_FOUND', UNKNOWN_PASSKEY);
  }
  const renamed = (await deps.identity.listPasskeys(caller.userId)).find((each) => each.id === input.id);
  if (renamed === undefined) throw refuse('NOT_FOUND', UNKNOWN_PASSKEY);
  return {
    id: renamed.id,
    createdAt: renamed.createdAt,
    ...(renamed.name === undefined ? {} : { name: renamed.name }),
    ...(renamed.lastUsedAt === undefined ? {} : { lastUsedAt: renamed.lastUsedAt }),
  };
}

/**
 * Removes one of the caller's passkeys (AC-887): needs a fresh step up, by a
 * second factor while two factor is on, since a passkey is one. Kept in the
 * security history.
 */
export async function removeMyPasskey(
  deps: PasskeyDeps,
  caller: SessionCaller,
  input: RemovePasskeyInput,
): Promise<{ readonly ok: true }> {
  const state = await deps.identity.twoFactorState(caller.userId);
  await requireFresh(deps, caller, { secondFactor: state.enabled });
  if (!(await deps.identity.removePasskey(caller.userId, input.id))) throw refuse('NOT_FOUND', UNKNOWN_PASSKEY);
  await deps.identity.recordSecurityEvent({
    userId: caller.userId,
    kind: 'passkey_removed',
    sessionId: caller.sessionId,
  });
  return { ok: true };
}
