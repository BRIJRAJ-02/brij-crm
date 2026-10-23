// The words a screen shows for a refused write: one attribute's (`refusalFor`)
// or the whole write's (`refusalSummary`). Apart from `errors.ts` because it
// reads the safety net's sentences (`@crm/contracts/plain-words`), which only
// the app needs: the public booking page imports `errors.ts` and stays without
// them. Only first load modules import this one; the stores loaded with
// `import()` are handed `RefusalWords`, so the sentences ride in the first
// load's data chunk instead of a chunk of their own.
import { isPlainFallback } from '@crm/contracts/plain-words';
import type { DataError } from './errors.ts';

/**
 * The sentence a refused write gives one attribute: its own refusal (a taken
 * unique value, an invalid value), or its input problem, else, for a refusal
 * about nothing in particular, the whole answer's; undefined when the answer
 * is about other attributes only. The one wording a grid cell, its toast and
 * a form's field all show, so they always say the same thing.
 */
export function refusalFor(error: DataError, attributeId: string): string | undefined {
  const refusals = error.data?.refusals ?? [];
  const own = refusals.find((refusal) => refusal.attributeId === attributeId);
  if (own !== undefined) return own.message;
  const issue = error.data?.issues?.find((each) => each.path[0] === 'values' && each.path[1] === attributeId);
  if (issue !== undefined) return issue.message;
  const isAboutAttributes =
    refusals.some((refusal) => refusal.attributeId !== undefined) ||
    (error.data?.issues ?? []).some((each) => each.path[0] === 'values');
  return isAboutAttributes ? undefined : error.message;
}

/**
 * The sentence that sums up a refused write, in the same words as `refusalFor`:
 * its first refusal's, else its first input problem's, else the answer's. An
 * input problem in the safety net's words ("Add this.", `isPlainFallback`)
 * names no field, so it never stands alone in a toast: the answer's sentence
 * does.
 */
export function refusalSummary(error: DataError): string {
  const refusal = error.data?.refusals?.[0]?.message;
  if (refusal !== undefined) return refusal;
  const issue = error.data?.issues?.[0]?.message;
  return issue === undefined || isPlainFallback(issue) ? error.message : issue;
}

/** Both wordings, as the data layer hands them to the stores it loads with `import()` (records, tasks). */
export interface RefusalWords {
  readonly refusalFor: typeof refusalFor;
  readonly refusalSummary: typeof refusalSummary;
}
