// How a view orders its records (spec 0003, the view bars): a list of sorts,
// the first deciding first. What SortBuilder edits, and what #20 saves with a
// view and runs.
import * as z from 'zod';

/** The most sorts one view applies. */
export const MAX_SORTS = 5;

/** One sort: an attribute and a direction. */
export const SortRule = z.object({
  attributeId: z.string().trim().min(1),
  direction: z.enum(['ascending', 'descending']),
});
export type SortRule = z.infer<typeof SortRule>;

/** A view's sorts, in order, each attribute at most once. */
export const SortRules = z
  .array(SortRule)
  .max(MAX_SORTS)
  .refine((rules) => new Set(rules.map((rule) => rule.attributeId)).size === rules.length, {
    message: 'Sort by each attribute once.',
  });
export type SortRules = z.infer<typeof SortRules>;
