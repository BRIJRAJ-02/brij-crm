// A view's draft (spec 0020, the draft in the URL): the filter and sorts a
// person changed and hasn't saved, carried in the address bar as base64url of
// their canonical JSON. Encoding and comparing are plain and in the first
// load; checking a link's draft loads Zod lazily (`parse.ts`).
import type { FilterGroup, SortRule } from '@crm/contracts';
import { DRAFT_LINK_MAX, encodeDraft, sameQuery } from '@crm/contracts/views';

/** A view's filter and sorts, saved or drafted. */
export interface DraftQuery {
  readonly filter?: FilterGroup | undefined;
  readonly sorts: readonly SortRule[];
}

/** How long after the last keystroke in a filter's operand the draft (and so the window) follows, in ms. */
export const FILTER_EDIT_MS = 300;

export { DRAFT_LINK_MAX };

/** The draft's URL text, or undefined when it is too long for a link (it then stays in the page's memory). */
export function draftParam(query: DraftQuery): string | undefined {
  const text = encodeDraft(query);
  return text.length > DRAFT_LINK_MAX ? undefined : text;
}

/** Whether two queries ask the same thing: a draft equal to the saved query is no draft. */
export function isSameQuery(a: DraftQuery, b: DraftQuery): boolean {
  return sameQuery(a, b);
}

/** A link's draft, checked: the query, or undefined when it doesn't read as one (AC-467). */
export async function readDraft(text: string): Promise<DraftQuery | undefined> {
  const { parseDraft } = await import('./parse.ts');
  return parseDraft(text);
}
