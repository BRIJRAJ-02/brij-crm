// What the view screen changes in what runs, as it changes (the CRM flow
// pass): a column header's sort and the view's search. Plain, so the node
// tests cover them; apart from `query.ts`, which the view route's loader
// holds in the first load, since only the screen needs these.
import type { AttributeDefinition, FilterGroup } from '@crm/data';
import { isDefaultSort } from './query.ts';

/** The most sorts a view keeps: contracts' `MAX_SORTS`, which the SortBuilder and the server hold it to as well. */
export const VIEW_SORTS_MAX = 5;

/**
 * A column header's Sort ascending or descending (the column menu): that column's sort goes first, in the direction
 * asked, replacing its own rule wherever it stood, and the other sorts stay after it, up to `VIEW_SORTS_MAX`. The
 * default order (Created at, newest first, asked by no sort) is not kept as a rule of its own.
 */
export function withHeaderSort(
  sorts: readonly { readonly attributeId: string; readonly direction: 'ascending' | 'descending' }[],
  rule: { readonly attributeId: string; readonly direction: 'ascending' | 'descending' },
  attributes: readonly Pick<AttributeDefinition, 'id' | 'isSystem' | 'apiSlug'>[],
): readonly { readonly attributeId: string; readonly direction: 'ascending' | 'descending' }[] {
  const others = isDefaultSort(sorts, attributes) ? [] : sorts.filter((sort) => sort.attributeId !== rule.attributeId);
  return [rule, ...others].slice(0, VIEW_SORTS_MAX);
}

/**
 * A query narrowed by the view's search (never saved): `attributeId contains text` joins the filter's top level
 * when that is an and group, else wraps it in one. No attribute or nothing typed leaves the query as it is.
 */
export function withSearch<T extends { readonly filter?: FilterGroup | undefined; readonly sorts?: unknown }>(
  query: T,
  attributeId: string | undefined,
  text: string,
): T {
  const typed = text.trim();
  if (attributeId === undefined || typed === '') return query;
  const condition = { attributeId, operator: 'contains' as const, value: typed };
  const filter: FilterGroup =
    query.filter === undefined
      ? { conjunction: 'and', conditions: [condition] }
      : query.filter.conjunction === 'and'
        ? { ...query.filter, conditions: [...query.filter.conditions, condition] }
        : { conjunction: 'and', conditions: [query.filter, condition] };
  return { ...query, filter };
}
