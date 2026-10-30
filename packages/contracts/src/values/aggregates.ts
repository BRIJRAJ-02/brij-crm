// A column's calculation (the CRM flow pass): what a table footer can work out
// across every record a view matches, through `records.aggregate`, never over
// the rows loaded. Plain TypeScript, so the library's footer menu and the
// engine share one list.

/** Every calculation: how many hold a value, how many are empty, and for numbers the sum, average, least and most. */
export const AGGREGATE_FNS = ['count', 'count_empty', 'sum', 'avg', 'min', 'max'] as const;
/** One calculation. */
export type AggregateFn = (typeof AGGREGATE_FNS)[number];

/** The calculations that read amounts: numbers and currency only. */
export const NUMERIC_AGGREGATES: readonly AggregateFn[] = ['sum', 'avg', 'min', 'max'];

/** The types whose amounts add up: a number, or a currency (worked out per currency). */
const NUMERIC_TYPES: ReadonlySet<string> = new Set(['number', 'currency']);

/** The calculations a column of `type` offers: counts for every type, and the amounts for numbers and currency. */
export function aggregatesFor(type: string): readonly AggregateFn[] {
  return NUMERIC_TYPES.has(type) ? AGGREGATE_FNS : ['count', 'count_empty'];
}
