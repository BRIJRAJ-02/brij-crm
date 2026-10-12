// The timeline's records as links to their own pages (spec 0017, AC-379):
// the data layer names the records a link entry added or removed; the page
// knows each object's address, so it adds the href here. Plain functions with
// no React, so they test in Node.
import type { ActivityEntryShape, EntrySource, ObjectSummary } from '@crm/data';
import { recordHref } from './details.ts';

/** A record's page from its object's id, or undefined when the object isn't one the person can open. */
export type RecordLink = (objectId: string, recordId: string) => string | undefined;

/** Links to records of the workspace's objects, by their address, on their Overview. */
export function recordLinks(slug: string, objects: readonly ObjectSummary[]): RecordLink {
  const slugs = new Map(objects.map((object) => [object.id, object.apiSlug]));
  return (objectId, recordId) => {
    const objectSlug = slugs.get(objectId);
    return objectSlug === undefined ? undefined : recordHref(slug, objectSlug, recordId);
  };
}

/** A link entry with each named record's page; any other entry as it is. */
export function withLinks(entry: ActivityEntryShape, link: RecordLink): ActivityEntryShape {
  if (entry.kind !== 'links') return entry;
  const linked = (records: typeof entry.added) =>
    records.map((record) => {
      const href = link(record.display.objectId, record.display.recordId);
      return href === undefined ? record : { ...record, href };
    });
  return { ...entry, added: linked(entry.added), removed: linked(entry.removed) };
}

/**
 * The feed's source with link entries' records linked to their pages. Each
 * entry is linked once and kept, so the feed sees the same object for the
 * same entry and draws it again only when the entry itself changes.
 */
export function linkedSource(
  source: EntrySource,
  link: RecordLink,
  cache: WeakMap<object, ActivityEntryShape>,
): EntrySource {
  return {
    ...source,
    getItem: (index) => {
      const entry = source.getItem(index);
      if (entry === undefined || entry.kind !== 'links') return entry;
      const held = cache.get(entry);
      if (held !== undefined) return held;
      const made = withLinks(entry, link);
      cache.set(entry, made);
      return made;
    },
  };
}
