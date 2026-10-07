// What the filter surface emits and FilterBuilder holds (spec 0003). A union
// keyed on the operator, so each operator carries its own operand. Operands
// are values of the attribute's type; the field set only emits ones that parse
// with that type's schema, and #20 checks them again where it runs them.
import * as z from 'zod';

/** Operators that compare against one value of the attribute's type (or text, for the text matches). */
export const SINGLE_VALUE_OPERATORS = [
  'is',
  'is_not',
  'contains',
  'does_not_contain',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'before',
  'after',
  'at_least',
  'at_most',
  'first_name_is',
  'last_name_is',
  'country_is',
  'locality_is',
  'region_is',
  'name_contains',
  'kind_is',
] as const;

/** Operators that take a list of 1 to 100 values (option ids, record references, members). */
export const LIST_OPERATORS = ['is_any_of', 'contains_any_of', 'contains_all_of', 'contains_none_of'] as const;

/** Operators that resolve a span of time against "today" in the viewer's time zone. */
export const RELATIVE_OPERATORS = ['within', 'within_last'] as const;

/** Operators that take no operand. */
export const BARE_OPERATORS = [
  'is_me',
  'is_empty',
  'is_not_empty',
  'is_checked',
  'is_not_checked',
  'has_files',
] as const;

/** Every filter operator. */
export const FilterOperator = z.enum([
  ...SINGLE_VALUE_OPERATORS,
  'between',
  ...LIST_OPERATORS,
  ...RELATIVE_OPERATORS,
  ...BARE_OPERATORS,
  'through',
]);
export type FilterOperator = z.infer<typeof FilterOperator>;

/** The longest attribute id a filter or sort names (ids are uuids; this only bounds what a caller sends). */
export const MAX_ATTRIBUTE_ID_LENGTH = 64;

const attributeId = z.string().trim().min(1).max(MAX_ATTRIBUTE_ID_LENGTH);

/** The most relationships one `through` condition follows, nested ones included. */
export const MAX_THROUGH_HOPS = 2;

/** How many relationships a condition follows, counting a `through` inside a `through`. */
function hopsOf(condition: FilterCondition): number {
  return condition.operator === 'through' ? condition.path.length + hopsOf(condition.condition) : 0;
}

/** A span of time: an amount of days, weeks, months or years, or a named range. */
export const RelativeRange = z.union([
  z.object({ amount: z.number().int().min(1).max(999), unit: z.enum(['day', 'week', 'month', 'year']) }),
  z.enum(['today', 'this_week', 'this_month', 'last_month']),
]);
export type RelativeRange = z.infer<typeof RelativeRange>;

/** One condition on one attribute. `through` follows a relation (Company › Country) and holds a condition on the far side. */
export type FilterCondition =
  | {
      readonly attributeId: string;
      readonly operator: (typeof SINGLE_VALUE_OPERATORS)[number];
      readonly value: unknown;
    }
  | { readonly attributeId: string; readonly operator: 'between'; readonly from: unknown; readonly to: unknown }
  | {
      readonly attributeId: string;
      readonly operator: (typeof LIST_OPERATORS)[number];
      readonly values: readonly unknown[];
    }
  | {
      readonly attributeId: string;
      readonly operator: (typeof RELATIVE_OPERATORS)[number];
      readonly range: RelativeRange;
    }
  | { readonly attributeId: string; readonly operator: (typeof BARE_OPERATORS)[number] }
  | { readonly operator: 'through'; readonly path: readonly string[]; readonly condition: FilterCondition };

/** One condition's shape, recursive through `through`; only parsed behind `nestingCheck`, which bounds the depth. */
const conditionShape: z.ZodType<FilterCondition> = z.lazy(() =>
  z.union([
    z.object({ attributeId, operator: z.enum(SINGLE_VALUE_OPERATORS), value: z.unknown() }),
    z.object({ attributeId, operator: z.literal('between'), from: z.unknown(), to: z.unknown() }),
    z.object({ attributeId, operator: z.enum(LIST_OPERATORS), values: z.array(z.unknown()).min(1).max(100) }),
    z.object({ attributeId, operator: z.enum(RELATIVE_OPERATORS), range: RelativeRange }),
    z.object({ attributeId, operator: z.enum(BARE_OPERATORS) }),
    z.object({
      operator: z.literal('through'),
      path: z.array(attributeId).min(1).max(MAX_THROUGH_HOPS),
      condition: conditionShape,
    }),
  ]),
);

/** How deep groups may nest inside one another. */
export const MAX_FILTER_DEPTH = 3;

/** The most conditions and groups one group holds. */
export const MAX_GROUP_CONDITIONS = 50;

/** The most conditions one filter holds, across all its groups. */
export const MAX_FILTER_CONDITIONS = 100;

/** Conditions joined by "and" or "or". Groups nest at most three deep. */
export interface FilterGroup {
  readonly conjunction: 'and' | 'or';
  readonly conditions: readonly (FilterCondition | FilterGroup)[];
}

function leavesOf(group: FilterGroup): number {
  return group.conditions.reduce((total, item) => total + ('conjunction' in item ? leavesOf(item) : 1), 0);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const TOO_DEEP = `Groups can nest at most ${String(MAX_FILTER_DEPTH)} deep.`;
const TOO_MANY_HOPS = `A filter follows at most ${String(MAX_THROUGH_HOPS)} relationships.`;

/**
 * Walks a filter or condition as sent, with a stack and no recursion, and
 * refuses one whose groups nest past `MAX_FILTER_DEPTH` or whose `through`
 * conditions nest past `MAX_THROUGH_HOPS` (each follows at least one
 * relationship). It runs before the recursive schemas, so a filter nested a
 * thousand deep is refused here as bad input rather than overflowing the
 * stack in the parse. Anything not shaped like a group or a condition is
 * left for the schemas to refuse.
 */
function nestingCheck(groupDepth: number) {
  return (value: unknown, context: z.RefinementCtx): void => {
    const stack: { value: unknown; groups: number; hops: number }[] = [{ value, groups: groupDepth, hops: 0 }];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      const item = next.value;
      if (!isObject(item)) continue;
      if (Array.isArray(item.conditions)) {
        const groups = next.groups + 1;
        if (groups > MAX_FILTER_DEPTH) {
          context.addIssue({ code: 'custom', message: TOO_DEEP });
          return;
        }
        for (const inner of item.conditions as unknown[]) stack.push({ value: inner, groups, hops: 0 });
      } else if (item.operator === 'through') {
        const hops = next.hops + 1;
        if (hops > MAX_THROUGH_HOPS) {
          context.addIssue({ code: 'custom', message: TOO_MANY_HOPS });
          return;
        }
        stack.push({ value: item.condition, groups: next.groups, hops });
      }
    }
  };
}

const condition = conditionShape.refine((value) => hopsOf(value) <= MAX_THROUGH_HOPS, { error: TOO_MANY_HOPS });

/** One condition on one attribute, its `through` nesting checked before it is parsed. */
export const FilterCondition: z.ZodType<FilterCondition> = z.unknown().superRefine(nestingCheck(0)).pipe(condition);

const group: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    conjunction: z.enum(['and', 'or']),
    conditions: z
      .array(z.union([group, condition]))
      .max(MAX_GROUP_CONDITIONS, { error: `A group holds at most ${String(MAX_GROUP_CONDITIONS)} conditions.` }),
  }),
);

/**
 * A filter: groups nest at most three deep, checked without recursion before
 * the parse, and hold at most 100 conditions in all.
 */
export const FilterGroup: z.ZodType<FilterGroup> = z
  .unknown()
  .superRefine(nestingCheck(0))
  .pipe(
    group.refine((value) => leavesOf(value) <= MAX_FILTER_CONDITIONS, {
      error: `A filter holds at most ${String(MAX_FILTER_CONDITIONS)} conditions.`,
    }),
  );
