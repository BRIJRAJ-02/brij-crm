// Refusals: expected failures with a stable code and a plain message (the
// `{ code, message }` shape from the house rules). They're thrown as errors so
// a transaction rolls back, and caught at the edge by `isRefusal`.
import type { EngineRefusal, EngineRefusalCode } from '@crm/contracts/values';

/** An error that carries an engine refusal. */
export type RefusalError = Error & { readonly refusal: EngineRefusal; readonly refusals: readonly EngineRefusal[] };

/** Builds the error for one refusal, or several (a write that names every bad attribute). */
export function refuse(code: EngineRefusalCode, message: string, attributeId?: string): RefusalError {
  const refusal: EngineRefusal = attributeId === undefined ? { code, message } : { code, message, attributeId };
  return refuseAll([refusal]);
}

/** Builds one error for several refusals; its `refusal` is the first. */
export function refuseAll(refusals: readonly [EngineRefusal, ...EngineRefusal[]]): RefusalError {
  const [first] = refusals;
  return Object.assign(new Error(first.message), { refusal: first, refusals });
}

/** True when an error is an engine refusal, rather than something unexpected. */
export function isRefusal(error: unknown): error is RefusalError {
  return error instanceof Error && 'refusal' in error && 'refusals' in error;
}

/** The Postgres error behind a failed query, when there is one (drizzle wraps it as `cause`). */
export function postgresError(error: unknown): { code?: string; constraint?: string; detail?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      return current as { code?: string; constraint?: string; detail?: string };
    }
    current = current.cause;
  }
  return undefined;
}

/**
 * An error that tells `runWrite` to start the transaction again, like a
 * Postgres serialisation failure (`40001`): a concurrent write changed what
 * this one read, and a fresh attempt will see it.
 */
export function writeConflict(message: string): Error {
  return Object.assign(new Error(message), { code: '40001' });
}

/** One field of a caller's input that can't be used as given, and why. */
export interface InputProblem {
  readonly field: string;
  readonly message: string;
}

/** An error about one field of the caller's input, which the API answers as `INPUT_INVALID` on that field. */
/** What a cell that moved on since the version a write names answers (spec 0006, AC-49, undo's `ifVersionId`). */
export const versionChangedMessage = (title: string): string => `${title} was changed since, so it was kept.`;

export type InputError = Error & { readonly inputProblem: InputProblem };

/**
 * Refuses one field of the input, for checks only the server can make (a
 * record id minted on a device whose clock is wrong, say). The API answers
 * 400 `INPUT_INVALID` with one issue at `field`.
 */
export function inputInvalid(field: string, message: string): InputError {
  return Object.assign(new Error(message), { inputProblem: { field, message } });
}

/** True when an error is an input problem from `inputInvalid`. */
export function isInputError(error: unknown): error is InputError {
  return error instanceof Error && 'inputProblem' in error;
}
