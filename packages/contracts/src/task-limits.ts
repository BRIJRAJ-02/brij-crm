// The tasks' limits (spec 0019), as plain TypeScript with no Zod, so the
// browser's lazily loaded tasks store and the screens read them without the
// schema library. `tasks.ts` re-exports them with the schemas.

/** The longest task title, in characters, after trimming its ends. */
export const TASK_TITLE_MAX = 2_000;

/** The most records one task links, hidden ones included. */
export const TASK_RECORDS_MAX = 20;

/** A page of tasks when the caller names no limit. */
export const TASK_PAGE = 50;

/** The most tasks one page answers. */
export const TASK_PAGE_MAX = 100;

/** The most tasks one `tasks.get` reads. */
export const TASK_GET_MAX = 100;

/** How far a list's count goes before it says "at least" (shown as "10,000+"). */
export const TASK_COUNT_CAP = 10_000;
