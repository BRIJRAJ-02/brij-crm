// What a view runs (spec 0020, view config): its saved or drafted filter and
// sorts, worked out against the object's attributes today. Plain functions
// with no React or library imports, so the view route's loader (in the first
// load) and the screen agree on what runs.
import {
  effectiveQuery,
  type AttributeDefinition,
  type DraftQuery,
  type EffectiveQuery,
  type FarAttributes,
  type View,
  type ViewQuery,
} from '@crm/data';

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
