// A server refusal as the builder shows it: the first sentence and the field
// (a question id, `slug` or `name`) it is about.
import { isDataError, refusalSummary } from '@crm/data';
import { strings } from './strings.ts';

/** The first refusal of a failed call: its code, sentence and field, or the plain fallback. */
export function firstRefusal(error: unknown): {
  readonly code?: string;
  readonly message: string;
  readonly field?: string;
} {
  if (!isDataError(error)) return { message: strings.failedText };
  const refusals = (
    error.data as
      | { readonly refusals?: readonly { readonly code?: string; readonly message: string; readonly field?: string }[] }
      | undefined
  )?.refusals;
  const [first] = refusals ?? [];
  if (first !== undefined) return first;
  return { code: error.code, message: error.message };
}

/**
 * What the toast says when a quiet draft save fails: only a call that never reached the server asks to check the
 * connection; a refusal says what the server refused, so it can be put right.
 */
export function saveFailureMessage(error: unknown): string {
  if (!isDataError(error) || error.code === 'API_UNAVAILABLE') return strings.saveFailed;
  return strings.saveRefused(refusalSummary(error));
}
