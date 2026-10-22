// New meeting's With (spec 0027's follow up): People as the member types, through the record picker's search, which
// answers each person's first email the member may see. None when they can't see People.
import type { DataLayer, ObjectSummary, RecordSearch } from '@crm/data';

/** How many people one search asks for: a few have no email and are left out, so more than the list shows. */
const ASKED = 12;

/** A maker of With's search over People, or undefined when People isn't an object the member may see. */
export function peopleSearchOf(
  data: DataLayer,
  slug: string,
  objects: readonly ObjectSummary[] | undefined,
): (() => RecordSearch) | undefined {
  const people = objects?.find((object) => object.standardKey === 'people' && !object.isArchived);
  return people === undefined ? undefined : () => data.records.search(slug, { objectId: people.id, limit: ASKED });
}
