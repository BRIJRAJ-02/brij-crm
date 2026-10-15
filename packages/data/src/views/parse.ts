// A draft's URL text checked as a query (spec 0020, AC-467): loaded with
// `import()` the first time a link carries one, so Zod stays out of the
// first load. Anything that doesn't read as a filter and sorts is refused.
import { FilterGroup, SortRules } from '@crm/contracts/values';
import { decodeDraftText } from '@crm/contracts/views';
import type { DraftQuery } from './draft.ts';

/** The draft a link carries, checked, or undefined when it can't be read. */
export function parseDraft(text: string): DraftQuery | undefined {
  const raw = decodeDraftText(text);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { filter, sorts } = raw as { readonly filter?: unknown; readonly sorts?: unknown };
  const parsedSorts = SortRules.safeParse(sorts);
  if (!parsedSorts.success) return undefined;
  if (filter === undefined) return { sorts: parsedSorts.data };
  const parsedFilter = FilterGroup.safeParse(filter);
  return parsedFilter.success ? { filter: parsedFilter.data, sorts: parsedSorts.data } : undefined;
}
