/** Steps' built in copy: what is read after a step's label, and the count variant's line. */
export const strings = {
  done: '(done)',
  failed: '(failed)',
  /** The count variant: where the flow stands. */
  count: (step: number, of: number) => `Step ${String(step)} of ${String(of)}`,
} as const;
