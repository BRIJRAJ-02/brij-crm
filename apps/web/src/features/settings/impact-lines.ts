// What an attribute's uses and counts say on its settings (flow pass, 30 October 2026): the archive confirm's one
// "Used by" line, and the links under Required and Unique. Pure, so they test in Node.
import { draftParam, type AttributeImpact } from '@crm/data';
import { strings } from './attribute-strings.ts';

/** How many, with the noun's plural when it isn't one: "2 filters", "1 sort". */
const counted = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/**
 * "Used by: Pipeline (group by), 2 filters, Lead form, 1 rule": a view grouped by it by name (archiving it ungroups
 * that board), the other views' filters and sorts counted, forms by name, other attributes' rules counted.
 * Undefined when nothing uses it.
 */
export function usedByLine(impact: AttributeImpact): string | undefined {
  const grouped = impact.views
    .filter((view) => view.uses.includes('group'))
    .map((view) => strings.groupedBy(view.name));
  const filters = impact.views.filter((view) => view.uses.includes('filter')).length;
  const sorts = impact.views.filter((view) => view.uses.includes('sort')).length;
  const parts = [
    ...grouped,
    ...(filters === 0 ? [] : [counted(filters, 'filter', 'filters')]),
    ...(sorts === 0 ? [] : [counted(sorts, 'sort', 'sorts')]),
    ...impact.forms.map((form) => form.name),
    ...(impact.rules === 0 ? [] : [counted(impact.rules, 'rule', 'rules')]),
  ];
  return parts.length === 0 ? undefined : strings.usedBy(parts.join(', '));
}

/** The object's table filtered to the records with no value for the attribute: Required's "N records are empty". */
export function emptyRecordsHref(tableHref: string, attributeId: string): string {
  const draft = draftParam({
    filter: { conjunction: 'and', conditions: [{ attributeId, operator: 'is_empty' }] },
    sorts: [],
  });
  return draft === undefined ? tableHref : `${tableHref}?draft=${draft}`;
}

/**
 * The object's table filtered to these records by their Record ID (the Change type step's records whose values
 * don't convert): at most 100, as a filter's list takes. The table itself when the filter can't be written.
 */
export function recordsHref(tableHref: string, recordIdAttributeId: string, recordIds: readonly string[]): string {
  if (recordIds.length === 0) return tableHref;
  const draft = draftParam({
    filter: {
      conjunction: 'and',
      conditions: [{ attributeId: recordIdAttributeId, operator: 'is_any_of', values: recordIds.slice(0, 100) }],
    },
    sorts: [],
  });
  return draft === undefined ? tableHref : `${tableHref}?draft=${draft}`;
}
