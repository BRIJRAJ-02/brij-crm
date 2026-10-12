// What the record page shows, as plain functions with no React or library
// imports, so the route's loader (in the first load) can warm the record with
// the same attributes the page then shows (spec 0017, value sourcing).
import type { AttributeDefinition, ObjectSummary, RecordRef, RecordView } from '@crm/data';

/** The record page's tabs, by their address (`notes` and `tasks` join with #19). */
export const RECORD_TABS = ['overview', 'activity'] as const;
/** One of the record page's tabs. */
export type RecordTab = (typeof RECORD_TABS)[number];

/** Whether an address segment names one of the record page's tabs. */
export const isRecordTab = (tab: string): tab is RecordTab => (RECORD_TABS as readonly string[]).includes(tab);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an address segment can be a record's id: anything else names no record. */
export const isRecordId = (value: string): boolean => UUID.test(value);

/** A record's page on one of its tabs. */
export const recordHref = (slug: string, objectSlug: string, recordId: string, tab: RecordTab = 'overview') =>
  `/w/${slug}/objects/${objectSlug}/${recordId}/${tab}`;

/**
 * The attributes Details lists (spec 0017, AC-374): every live, visible, non
 * system attribute that holds one value or one record, in attribute order. A
 * relationship side that holds many records gets its own section (milestone
 * 3), so it is left out here. `attributes.list` answers only live attributes
 * the person may see.
 */
export function detailAttributes(attributes: readonly AttributeDefinition[]): readonly AttributeDefinition[] {
  return attributes
    .filter((attribute) => !attribute.isSystem && !(attribute.type === 'record_reference' && attribute.isMulti))
    .toSorted((a, b) => a.position - b.position);
}

/** A reference value's links, as a list: one link, several, or none. */
export function refsOf(value: unknown): readonly RecordRef[] {
  const list: readonly unknown[] = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return list.flatMap((each) => {
    if (typeof each !== 'object' || each === null) return [];
    const { objectId, recordId } = each as { readonly objectId?: unknown; readonly recordId?: unknown };
    return typeof objectId === 'string' && typeof recordId === 'string' ? [{ objectId, recordId }] : [];
  });
}

/** A primary value's text: a plain name, or a person's full name (or first and last). */
function nameOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object' || value === null) return '';
  const { fullName, firstName, lastName } = value as {
    readonly fullName?: unknown;
    readonly firstName?: unknown;
    readonly lastName?: unknown;
  };
  if (typeof fullName === 'string' && fullName.trim() !== '') return fullName.trim();
  return [firstName, lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .map((part) => part.trim())
    .join(' ');
}

/**
 * The record's name as the page shows it: its primary attribute as the store
 * holds it now, so an edit in Details shows in the header at once, else the
 * server's display name; "Unnamed <singular>" when empty (spec 0004, AC-19).
 */
export function recordName(record: RecordView, object: ObjectSummary, unnamed: string): string {
  const primary = object.primaryAttributeId;
  const typed = primary === undefined || !Object.hasOwn(record.values, primary) ? undefined : record.values[primary];
  const name = typed === undefined ? record.display.name : nameOf(typed);
  return name === '' ? unnamed : name;
}
