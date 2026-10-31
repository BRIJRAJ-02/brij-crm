// Automations' limits (parity #53), as plain TypeScript with no Zod, so the browser's lazily loaded automations store
// and the screens read them without the schema library. `automations.ts` re-exports them with the schemas.

/** The most automations a workspace holds (deleted ones awaiting their Undo window not counted). */
export const AUTOMATIONS_MAX = 50;

/** The most actions one automation runs, in order. */
export const AUTOMATION_ACTIONS_MAX = 3;

/** The longest title a "create a task" action gives the task, in characters. */
export const AUTOMATION_TITLE_MAX = 200;

/** The longest message a "notify" action shows, in characters. */
export const AUTOMATION_MESSAGE_MAX = 120;

/** The furthest a "create a task" action sets the due date, in days. */
export const AUTOMATION_DUE_DAYS_MAX = 365;

/** How many runs the run log shows. */
export const AUTOMATION_RUNS_SHOWN = 50;

/** The most runs a workspace executes in a rolling hour; the rest fail with `RATE_LIMITED`. */
export const AUTOMATION_RUNS_PER_HOUR = 200;

/** Failed runs in a row after which an automation switches itself off. */
export const AUTOMATION_FAILURES_MAX = 5;

/** The most runs a workspace holds waiting: the write hook inserts no more past it. */
export const AUTOMATION_QUEUE_MAX = 1_000;

/** The most records one write queues runs for; a bigger bulk change queues the first this many. */
export const AUTOMATION_EVENTS_PER_WRITE = 200;

/** Why an automation switched itself off. */
export const AUTOMATION_OFF_REASONS = ['FAILING', 'CREATOR_GONE'] as const;

/** One reason an automation switched itself off. */
export type AutomationOffReason = (typeof AUTOMATION_OFF_REASONS)[number];

/** The statuses the run log shows (a run skipped by a condition or a stale event is never shown). */
export const AUTOMATION_RUN_STATUSES = ['queued', 'running', 'done', 'failed'] as const;

/** One status the run log shows. */
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];
