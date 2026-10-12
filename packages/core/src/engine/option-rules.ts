// The checks every option write shares (spec 0004, AC-4; spec 0012, AC-236):
// a label of 1 to 100 characters, a hue from the curated set, and a target
// time as an ISO 8601 duration. Kept apart from `options.ts` so an attribute
// create (`definitions.ts`) can check its first options without a cycle.
import { HUES } from '@crm/contracts/values';
import { refuse, refuseOn } from './refusals.ts';

/** What a stage means for a status option. */
export type OptionOutcome = 'open' | 'won' | 'lost';

const DURATION = /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?)?$/;

/** A refusal on `field` of the input when one is named, else a plain one. */
const refuseAt = (message: string, field: string | undefined) =>
  field === undefined ? refuse('CONFIG_INVALID', message) : refuseOn('CONFIG_INVALID', message, field);

/** Refuses a label that is empty or longer than 100 characters once trimmed. */
export function checkLabel(label: string, field?: string): void {
  if (label.trim() === '' || label.trim().length > 100)
    throw refuseAt('Give the option a label of 1 to 100 characters.', field);
}

/** Refuses a hue outside the curated set. */
export function checkHue(hue: string, field?: string): void {
  if (!(HUES as readonly string[]).includes(hue)) throw refuseAt(`Pick one of the hues: ${HUES.join(', ')}.`, field);
}

/** Refuses a target time that isn't an ISO 8601 duration (`null` clears one). */
export function checkTarget(target: string | null | undefined, field?: string): void {
  if (target !== undefined && target !== null && !DURATION.test(target)) {
    throw refuseAt('Give the target time as an ISO 8601 duration, such as P7D for a week.', field);
  }
}

/** Whether a status stage's own settings (an outcome, a target time) were given. */
export function hasStageSettings(input: {
  readonly outcome?: OptionOutcome | undefined;
  readonly targetTimeInStage?: string | null | undefined;
}): boolean {
  return input.outcome !== undefined || (input.targetTimeInStage !== undefined && input.targetTimeInStage !== null);
}
