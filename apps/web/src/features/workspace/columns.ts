// Which columns an object's table shows, and the order it opens in (spec 0006,
// AC-55, AC-57). Plain functions with no React or library imports, so the
// route's loader (in the first load) can warm the view with the same columns
// and sort the screen then shows.
import type { AttributeDefinition, SortRule, ViewQuery } from '@crm/data';

/** The attributes the table shows, in order: every non system attribute by position, then the record's created at. */
export function shownAttributes(attributes: readonly AttributeDefinition[]): readonly AttributeDefinition[] {
  const own = attributes.filter((attribute) => !attribute.isSystem).sort((a, b) => a.position - b.position);
  const createdAt = createdAtOf(attributes);
  return createdAt === undefined ? own : [...own, createdAt];
}

/** The record's created at system attribute. */
function createdAtOf(attributes: readonly AttributeDefinition[]): AttributeDefinition | undefined {
  return attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === 'created_at');
}

/** Newest first (AC-57): created at, descending. None when the object has no created at (every object has). */
export function defaultSort(attributes: readonly AttributeDefinition[]): SortRule | undefined {
  const createdAt = createdAtOf(attributes);
  return createdAt === undefined ? undefined : { attributeId: createdAt.id, direction: 'descending' };
}

/** The view a sort asks for: that one sort, replacing any other (the column menu's sort is unsaved, #20 saves views). */
export function queryOf(sort: SortRule | undefined): ViewQuery {
  return sort === undefined ? {} : { sorts: [sort] };
}
