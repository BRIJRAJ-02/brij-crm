// The Lists section's reads (spec 0048, AC-4822), shared by the record page's loader and the record panel: the
// lists over the record's object the person may read, and the record's entries in them. No React, so a route's
// loader may import it.
import type { DataLayer, EntriesLayer, ListView, RecordEntries } from '@crm/data';

/** What the Lists section reads: opened by the page's loader or the panel, shown by RecordLists. */
export interface ListSectionSource {
  readonly lists: readonly ListView[];
  readonly layer: EntriesLayer;
  readonly source: RecordEntries;
}

/** Opens the section's reads; undefined when no list the person may read sits over the object, or they fail. */
export async function readListSection(
  data: DataLayer,
  slug: string,
  objectId: string,
  recordId: string,
): Promise<ListSectionSource | undefined> {
  try {
    const lists = (await data.lists.list(slug)).filter((list) => list.objectId === objectId);
    if (lists.length === 0) return undefined;
    const layer = await data.lists.entries();
    return { lists, layer, source: layer.forRecord(slug, recordId) };
  } catch {
    return undefined;
  }
}
