// Account security's limits (spec 0033), as plain TypeScript with no Zod, so
// the browser's data layer and the screens read them without the schema
// library. `account.ts` re-exports them with the schemas.

/**
 * How long a verification at sign in (or, from milestone 2, a step up) counts
 * as fresh for a sensitive change on that session (AC-896): 10 minutes.
 */
export const STEP_UP_MINUTES = 10;

/** How long a step up email code lasts (AC-896): 10 minutes. */
export const STEP_UP_CODE_MINUTES = 10;

/** The session lengths a workspace may ask for, in days (spec 0033, milestone 4); no limit when none is set. */
export const SESSION_LENGTH_DAYS = [1, 7, 14, 30] as const;
