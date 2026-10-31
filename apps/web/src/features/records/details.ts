// What the record page shows, as plain functions with no React or library
// imports, so the route's loader (in the first load) can warm the record with
// the same attributes the page then shows (spec 0017, value sourcing).
import type { AttributeDefinition, ObjectSummary, RecordRef, RecordView } from '@crm/data';
import type { RecordTab } from './params.ts';

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

/** One side of the record that holds many records, for a related section and its Overview card (spec 0017). */
export interface RelatedSide {
  readonly attribute: AttributeDefinition;
  /** The object its records come from: their noun ("people") and pages. */
  readonly farObject: ObjectSummary;
  /**
   * The name attributes of every object its records may come from (a side can link to several), so its section
   * reads a held record again when that record's name changes, whichever object it belongs to.
   */
  readonly farNameAttributeIds: readonly string[];
}

/**
 * The record's related sections (spec 0017, AC-375): every live, visible,
 * non system record reference that holds many, in attribute order, whose far
 * object the person can see (one they can't leaves its section out, as a
 * hidden attribute is). `attributes.list` and `objects.list` answer only what
 * the person may see.
 */
export function relatedSides(
  attributes: readonly AttributeDefinition[],
  objects: readonly ObjectSummary[],
): readonly RelatedSide[] {
  return attributes
    .filter((attribute) => attribute.type === 'record_reference' && attribute.isMulti && !attribute.isSystem)
    .toSorted((a, b) => a.position - b.position)
    .flatMap((attribute) => {
      const targetIds = attribute.relationship?.targetObjectIds ?? [];
      const farObject = objects.find((object) => object.id === targetIds[0]);
      if (farObject === undefined) return [];
      const farNameAttributeIds = targetIds.flatMap(
        (id) => objects.find((object) => object.id === id)?.primaryAttributeId ?? [],
      );
      return [{ attribute, farObject, farNameAttributeIds }];
    });
}

/** Whether a value has something in it: not null, not blank text, not an empty list. */
export const isFilled = (value: unknown): boolean =>
  value !== null &&
  value !== undefined &&
  !(typeof value === 'string' && value.trim() === '') &&
  !(Array.isArray(value) && value.length === 0);

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
