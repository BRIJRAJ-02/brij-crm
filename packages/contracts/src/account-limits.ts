// Account security's limits (spec 0033), as plain TypeScript with no Zod, so
// the browser's data layer and the screens read them without the schema
// library. `account.ts` re-exports them with the schemas.

/**
 * How long a verification at sign in (or, from milestone 2, a step up) counts
 * as fresh for a sensitive change on that session (AC-896): 10 minutes.
 */
export const STEP_UP_MINUTES = 10;
