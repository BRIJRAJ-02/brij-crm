// Which columns an object's table shows, and the order it opens in (spec 0006,
// AC-55, AC-57). Plain functions with no React or library imports, so the
// route's loader (in the first load) can warm the view with the same columns
// and sort the screen then shows.
import type { AttributeDefinition, ObjectSummary, SortRule, ViewQuery } from '@crm/data';

/**
 * A standard object's opening columns (owner decision, 8 Oct 2026), by API
 * name and in order, until saved views (#20) let each view keep its own.
 * They lead, in this order; the object's other attributes follow by position,
 * then created at, except the ones listed as hidden, which start hidden in
 * the column list (the column menu's Hide, undone when views can show them).
 * Kept on the screen, not in the template, because it is how People opens,
 * not what a person is: the template's order still drives the record page and
 * the API, and #20 replaces this with the view's own columns.
 */
const OPENING_COLUMNS: Readonly<
  Record<string, { readonly first: readonly string[]; readonly hidden: readonly string[] }>
> = {
  people: {
    first: ['email_addresses', 'phone_numbers', 'company', 'job_title', 'primary_location', 'owner', 'last_contacted'],
    hidden: [
      'description',
      'avatar',
      'linkedin',
      'twitter',
      'facebook',
      'instagram',
      'angellist',
      'associated_deals',
      'timezone',
      'email_opt_out',
    ],
  },
};

/** The attribute a standard object's rows show as their picture in the row header (People's Avatar). */
const AVATAR_SLUG: Readonly<Record<string, string>> = { people: 'avatar' };

/** The record's created at system attribute. */
function createdAtOf(attributes: readonly AttributeDefinition[]): AttributeDefinition | undefined {
  return attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === 'created_at');
}

/** The opening layout for this object: the standard one, or none (every attribute by position). */
const openingOf = (object: ObjectSummary | undefined) =>
  object?.standardKey === undefined ? undefined : OPENING_COLUMNS[object.standardKey];

/**
 * The attributes the table lists, in order: a standard object's opening
 * columns first, then every other non system attribute by position, then the
 * record's created at. `isHidden` marks the ones it opens hidden.
 */
export function listedAttributes(
  object: ObjectSummary | undefined,
  attributes: readonly AttributeDefinition[],
): readonly { readonly definition: AttributeDefinition; readonly isHidden: boolean }[] {
  const opening = openingOf(object);
  const own = attributes.filter((attribute) => !attribute.isSystem).sort((a, b) => a.position - b.position);
  const rank = (attribute: AttributeDefinition) => {
    const at = opening?.first.indexOf(attribute.apiSlug) ?? -1;
    return at === -1 ? Number.POSITIVE_INFINITY : at;
  };
  // A stable sort: the opening columns lead in their order, the rest keep their positions.
  const ordered = [...own].sort((a, b) => rank(a) - rank(b));
  const createdAt = createdAtOf(attributes);
  const all = createdAt === undefined ? ordered : [...ordered, createdAt];
  const hidden = new Set(opening?.hidden ?? []);
  return all.map((definition) => ({ definition, isHidden: !definition.isSystem && hidden.has(definition.apiSlug) }));
}

/** The attributes the table shows on opening (the ones it reads, spec 0006, AC-55), in order. */
export function shownAttributes(
  object: ObjectSummary | undefined,
  attributes: readonly AttributeDefinition[],
): readonly AttributeDefinition[] {
  return listedAttributes(object, attributes).flatMap((each) => (each.isHidden ? [] : [each.definition]));
}

/** The attribute whose value is the row's picture in the row header (People's Avatar), read even while its column is hidden. */
export function avatarAttribute(
  object: ObjectSummary | undefined,
  attributes: readonly AttributeDefinition[],
): AttributeDefinition | undefined {
  const slug = object?.standardKey === undefined ? undefined : AVATAR_SLUG[object.standardKey];
  return slug === undefined
    ? undefined
    : attributes.find((attribute) => attribute.apiSlug === slug && attribute.type === 'url');
}

/** What a view reads: the columns shown on opening, and the row's picture. */
export function readAttributeIds(
  object: ObjectSummary | undefined,
  attributes: readonly AttributeDefinition[],
): readonly string[] {
  const avatar = avatarAttribute(object, attributes);
  const shown = shownAttributes(object, attributes).map((attribute) => attribute.id);
  return avatar === undefined || shown.includes(avatar.id) ? shown : [...shown, avatar.id];
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
