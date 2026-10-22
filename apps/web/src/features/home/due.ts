// Home's My tasks (spec 0041): the open tasks assigned to me that are due
// today or overdue. My tasks' open list comes earliest due first, with undated
// tasks last, so the due ones are the list's first run. Pure.

/** A task as far as Home's due rule reads it. */
interface Dated {
  readonly dueOn?: string;
}

/** Whether a task is due: on or before `today` (both `YYYY-MM-DD`). */
export function isDue(task: Dated, today: string): boolean {
  return task.dueOn !== undefined && task.dueOn <= today;
}

/**
 * How many of the list's first items are due, reading at most `limit` + 1 of
 * them (enough to say whether there are more than `limit`). `getItem` answers
 * undefined past what is loaded, which ends the run.
 */
export function duePrefix(
  getItem: (index: number) => Dated | undefined,
  count: number,
  today: string,
  limit: number,
): number {
  let due = 0;
  while (due < Math.min(count, limit + 1)) {
    const task = getItem(due);
    if (task === undefined || !isDue(task, today)) break;
    due += 1;
  }
  return due;
}
