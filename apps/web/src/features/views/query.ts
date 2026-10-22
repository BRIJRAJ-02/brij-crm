// What a view runs (spec 0020, view config): its saved or drafted filter and
// sorts, worked out against the object's attributes today. Plain functions
// with no React or library imports, so the view route's loader (in the first
// load) and the screen agree on what runs.
import {
  CREATED_AT_SLUG,
  effectiveQuery,
  type AttributeDefinition,
  type DraftQuery,
  type EffectiveQuery,
  type FarAttributes,
  type View,
  type ViewQuery,
} from '@crm/data';

/**
 * Whether sorts ask only what every view runs anyway, Created at newest first (AC-57): none at all, or exactly
 * that one sort. Such a view shows no sort chip, as Attio, Notion and Linear leave their default order unsaid.
 */
export function isDefaultSort(
  sorts: readonly { readonly attributeId: string; readonly direction: 'ascending' | 'descending' }[],
  attributes: readonly Pick<AttributeDefinition, 'id' | 'isSystem' | 'apiSlug'>[],
): boolean {
  if (sorts.length === 0) return true;
  const [only] = sorts;
  if (sorts.length !== 1 || only === undefined || only.direction !== 'descending') return false;
  const createdAt = attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === CREATED_AT_SLUG);
  return createdAt !== undefined && only.attributeId === createdAt.id;
}

/** The sort every view runs when it asks none: Created at, newest first; none when the object has no Created at. */
export function defaultSorts(
  attributes: readonly Pick<AttributeDefinition, 'id' | 'isSystem' | 'apiSlug'>[],
): readonly { readonly attributeId: string; readonly direction: 'descending' }[] {
  const createdAt = attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === CREATED_AT_SLUG);
  return createdAt === undefined ? [] : [{ attributeId: createdAt.id, direction: 'descending' }];
}

/** A view's saved filter and sorts. */
export function savedQuery(view: View): DraftQuery {
  return { ...(view.config.filter === undefined ? {} : { filter: view.config.filter }), sorts: view.config.sorts };
}

/**
 * The object a record reference leads to, once attribute definitions carry
 * their relationship (spec 0014's `relationship.targetObjectIds`); undefined
 * until then, when a through condition is left for the server to check.
 */
export function relationTarget(definition: AttributeDefinition): string | undefined {
  const block: unknown = (definition as { readonly relationship?: unknown }).relationship;
  if (typeof block !== 'object' || block === null) return undefined;
  const targets: unknown = (block as { readonly targetObjectIds?: unknown }).targetObjectIds;
  if (!Array.isArray(targets)) return undefined;
  const first: unknown = (targets as readonly unknown[])[0];
  return typeof first === 'string' ? first : undefined;
}

/**
 * The far side of a relation for `effectiveQuery`: the far object's
 * attributes when they are loaded, `pending` while they load, and
 * `unchecked` when the reference doesn't say where it leads.
 */
export function farAttributesFrom(
  attributes: readonly AttributeDefinition[],
  loaded: (objectId: string) => readonly AttributeDefinition[] | undefined,
): FarAttributes {
  return (relation) => {
    const definition = attributes.find((each) => each.id === relation.id);
    const target = definition === undefined ? undefined : relationTarget(definition);
    if (target === undefined) return 'unchecked';
    return loaded(target) ?? 'pending';
  };
}

/** What runs for `query` on the object's attributes today (archived and unknown ones left out). */
export function runningQuery(
  query: DraftQuery,
  attributes: readonly AttributeDefinition[],
  far: FarAttributes = farAttributesFrom(attributes, () => undefined),
): EffectiveQuery {
  return effectiveQuery(query, attributes, far);
}

/** An effective query as the records layer asks it. */
export function toViewQuery(effective: Extract<EffectiveQuery, { status: 'ready' }>): ViewQuery {
  return { ...(effective.filter === undefined ? {} : { filter: effective.filter }), sorts: [...effective.sorts] };
}

/**
 * What Save writes: the filter that runs (anything left out is gone for
 * good), and the person's own sorts that still run, never the newest first
 * fallback a view with no sorts runs.
 */
export function savableQuery(query: DraftQuery, effective: Extract<EffectiveQuery, { status: 'ready' }>): DraftQuery {
  const running = new Set(effective.sorts.map((sort) => sort.attributeId));
  return {
    ...(effective.filter === undefined ? {} : { filter: effective.filter }),
    sorts: query.sorts.filter((sort) => running.has(sort.attributeId)),
  };
}

/** The views a person is opened onto from the object's address: the default, else the first in switcher order. */
/**
 * The view the command menu's Create a <object> opens (spec 0039, AC-1086):
 * the landing view when it is a table, else the default view when it is one,
 * else the first table in switcher order. A board has no new record dialog,
 * so with no table at all there is none, and the caller lands as usual.
 */
export function createView(list: {
  readonly views: readonly { readonly id: string; readonly kind: string }[];
  readonly defaultViewId?: string | undefined;
  readonly lastOpenedViewId?: string | undefined;
}): string | undefined {
  const tables = list.views.filter((view) => view.kind === 'table');
  const landing = landingView(list);
  if (tables.some((view) => view.id === landing)) return landing;
  if (tables.some((view) => view.id === list.defaultViewId)) return list.defaultViewId;
  return tables[0]?.id;
}

export function landingView(list: {
  readonly views: readonly { readonly id: string }[];
  readonly defaultViewId?: string | undefined;
  readonly lastOpenedViewId?: string | undefined;
}): string | undefined {
  const ids = new Set(list.views.map((view) => view.id));
  if (list.lastOpenedViewId !== undefined && ids.has(list.lastOpenedViewId)) return list.lastOpenedViewId;
  if (list.defaultViewId !== undefined && ids.has(list.defaultViewId)) return list.defaultViewId;
  return list.views[0]?.id;
}
