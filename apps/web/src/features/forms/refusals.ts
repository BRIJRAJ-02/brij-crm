// A server refusal as the builder shows it: the first sentence and the field
// (a question id, `slug` or `name`) it is about.
import { isDataError } from '@crm/data';
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
