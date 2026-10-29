// `@crm/contracts/views` (spec 0020): what a saved view runs, worked out from
// what it stores. Plain TypeScript with no Zod, so the browser's first load
// and the engine share one rule for each: which attributes sort
// (`isSortable`), the filter and sorts that actually run today
// (`effectiveQuery`), the columns a table shows (`effectiveColumns`), and the
// draft a URL carries (`encodeDraft`, `decodeDraftText`). The stored config is
// never rewritten by these: an attribute archived today and restored tomorrow
// brings the view back exactly as it was.
import type { FilterCondition, FilterGroup } from './values/filters.ts';
import type { SortRule } from './values/sorts.ts';

/** What the view rules need to know of an attribute (an `AttributeDefinition`, or the engine's own). */
export interface ViewAttribute {
  readonly id: string;
  readonly type: string;
  readonly isSystem: boolean;
  readonly apiSlug: string;
  readonly position: number;
  readonly isArchived: boolean;
}

/**
 * The attribute types a view sorts by: exactly the ones the engine's
 * `compileSorts` has a key for. Long text has none (it is never compared as a
 * whole), and every system attribute sorts by its own column.
 */
export const SORTABLE_TYPES: ReadonlySet<string> = new Set([
  'text',
  'email',
  'domain',
  'url',
  'personal_name',
  'phone',
  'file',
  'number',
  'rating',
  'currency',
  'location',
  'date',
  'timestamp',
  'interaction',
  'checkbox',
  'select',
  'status',
  'actor_reference',
  'record_reference',
]);

/**
 * Whether a view may sort by `attribute` (spec 0020, AC-465): the one rule
 * the engine's `compileSorts`, the SortBuilder's attribute list and the
 * config check all call, so they can't disagree.
 */
export function isSortable(attribute: Pick<ViewAttribute, 'type' | 'isSystem'>): boolean {
  return attribute.isSystem || SORTABLE_TYPES.has(attribute.type);
}

/** The system attribute every record has and every view falls back to sorting by, newest first. */
export const CREATED_AT_SLUG = 'created_at';

/** The record's Created at among an object's attributes. */
export function createdAtOf<T extends Pick<ViewAttribute, 'isSystem' | 'apiSlug'>>(
  attributes: readonly T[],
): T | undefined {
  return attributes.find((attribute) => attribute.isSystem && attribute.apiSlug === CREATED_AT_SLUG);
}

/** A view's question: its filter and its sorts, saved or drafted. */
export interface ViewQueryShape {
  readonly filter?: FilterGroup | undefined;
  readonly sorts: readonly SortRule[];
}

/**
 * The attributes on the far side of a relation (`relation` is the record
 * reference a `through` condition follows): the list, `pending` while the
 * definitions store loads them, `unchecked` when this reader doesn't know
 * the far object (the condition is kept as it is, and the server checks it
 * as it runs), or undefined when the far side can't be read (the condition
 * is then dropped as unavailable).
 */
export type FarAttributes = (relation: ViewAttribute) => readonly ViewAttribute[] | 'pending' | 'unchecked' | undefined;

/** What runs: the effective filter and sorts, and the archived attributes left out (by id). */
export type EffectiveQuery =
  | {
      readonly status: 'ready';
      readonly filter?: FilterGroup;
      readonly sorts: readonly SortRule[];
      /** Archived attributes the member may see that were left out: the Callout names them (AC-480). */
      readonly skipped: readonly string[];
      /** True when anything was left out, archived, deleted or hidden alike (AC-467's Callout). */
      readonly dropped: boolean;
    }
  | { readonly status: 'pending' };

const isGroupItem = (item: FilterCondition | FilterGroup): item is FilterGroup => 'conjunction' in item;

/**
 * The filter and sorts that run for a saved or drafted query (spec 0020,
 * view config): a condition, or a sort, naming an attribute (or a relation
 * along its path) that is archived, deleted or not visible is left out; a
 * group left empty goes, and an empty top level group means no filter. Empty
 * sorts run as Created at, newest first (spec 0006, AC-57), while the stored
 * sorts stay empty. `pending` while a through path's far attributes load.
 */
export function effectiveQuery(
  query: ViewQueryShape,
  attributes: readonly ViewAttribute[],
  farAttributes: FarAttributes = () => undefined,
): EffectiveQuery {
  const skipped = new Set<string>();
  // Written from the walk's closures, so a plain object rather than two lets.
  const seen = { dropped: false, pending: false };
  /** Whether `id` is live on this level; notes an archived one as skipped. */
  const live = (level: readonly ViewAttribute[], id: string): ViewAttribute | undefined => {
    const attribute = level.find((each) => each.id === id);
    if (attribute === undefined) {
      seen.dropped = true;
      return undefined;
    }
    if (attribute.isArchived) {
      seen.dropped = true;
      skipped.add(attribute.id);
      return undefined;
    }
    return attribute;
  };
  const keepCondition = (level: readonly ViewAttribute[], condition: FilterCondition): boolean => {
    if (condition.operator !== 'through') return live(level, condition.attributeId) !== undefined;
    let current = level;
    for (const relationId of condition.path) {
      const relation = live(current, relationId);
      if (relation === undefined) return false;
      const far = farAttributes(relation);
      if (far === 'pending') {
        seen.pending = true;
        return false;
      }
      if (far === 'unchecked') return true;
      if (far === undefined) {
        seen.dropped = true;
        return false;
      }
      current = far;
    }
    return keepCondition(current, condition.condition);
  };
  const keepGroup = (group: FilterGroup): FilterGroup | undefined => {
    const conditions = group.conditions.flatMap((item): (FilterCondition | FilterGroup)[] => {
      if (isGroupItem(item)) {
        const kept = keepGroup(item);
        return kept === undefined ? [] : [kept];
      }
      return keepCondition(attributes, item) ? [item] : [];
    });
    return conditions.length === 0 ? undefined : { conjunction: group.conjunction, conditions };
  };
  const filter = query.filter === undefined ? undefined : keepGroup(query.filter);
  if (seen.pending) return { status: 'pending' };
  const sorts = query.sorts.filter((sort) => {
    const attribute = live(attributes, sort.attributeId);
    if (attribute === undefined) return false;
    if (isSortable(attribute)) return true;
    seen.dropped = true;
    return false;
  });
  const createdAt = createdAtOf(attributes);
  const running: readonly SortRule[] =
    sorts.length > 0 || createdAt === undefined ? sorts : [{ attributeId: createdAt.id, direction: 'descending' }];
  return {
    status: 'ready',
    ...(filter === undefined ? {} : { filter }),
    sorts: running,
    skipped: [...skipped],
    dropped: seen.dropped,
  };
}

/** One column as a view stores it. */
export interface StoredColumn {
  readonly attributeId: string;
  readonly width?: number | undefined;
  readonly isHidden?: boolean | undefined;
}

/** The layout part of a view's config. */
export interface StoredLayout {
  readonly columns: readonly StoredColumn[];
  readonly showNewAttributes: boolean;
  readonly pinnedCount: number;
}

/** One column the table shows: the attribute, its stored width (the field set's otherwise), and whether hidden. */
export interface EffectiveColumn {
  readonly attributeId: string;
  readonly width?: number;
  readonly isHidden: boolean;
}

/** The most columns a view pins: the name and up to four more. */
export const MAX_PINNED = 5;

/**
 * The columns a table shows for a view (spec 0020, effective columns): its
 * stored columns in order, without archived, deleted or hidden attributes;
 * then every live attribute it doesn't list, by position, shown when the view
 * shows new attributes (a non system one, or Created at) and hidden
 * otherwise; the primary attribute first and shown whatever is stored; and
 * the pinned count clamped to the shown columns, never below 1.
 */
export function effectiveColumns(
  layout: StoredLayout,
  attributes: readonly ViewAttribute[],
  primaryAttributeId: string | undefined,
): { readonly columns: readonly EffectiveColumn[]; readonly pinnedCount: number } {
  const liveById = new Map(attributes.filter((each) => !each.isArchived).map((each) => [each.id, each]));
  const listed = new Set<string>();
  const stored = layout.columns.flatMap((column): EffectiveColumn[] => {
    if (!liveById.has(column.attributeId) || listed.has(column.attributeId)) return [];
    listed.add(column.attributeId);
    return [
      {
        attributeId: column.attributeId,
        ...(column.width === undefined ? {} : { width: column.width }),
        isHidden: column.isHidden === true,
      },
    ];
  });
  const createdAt = createdAtOf(attributes);
  const fresh = [...liveById.values()]
    .filter((attribute) => !listed.has(attribute.id))
    // Settings' order: the object's own attributes by position, then the system ones (Created at among them).
    .sort((a, b) => Number(a.isSystem) - Number(b.isSystem) || a.position - b.position)
    .map((attribute): EffectiveColumn => ({
      attributeId: attribute.id,
      isHidden: !(layout.showNewAttributes && (!attribute.isSystem || attribute.id === createdAt?.id)),
    }));
  const all = [...stored, ...fresh];
  const primaryAt = primaryAttributeId === undefined ? -1 : all.findIndex((c) => c.attributeId === primaryAttributeId);
  const primary = all[primaryAt];
  const columns =
    primary === undefined
      ? all
      : [{ ...primary, isHidden: false }, ...all.slice(0, primaryAt), ...all.slice(primaryAt + 1)];
  const shown = columns.filter((column) => !column.isHidden).length;
  const pinnedCount = Math.max(1, Math.min(layout.pinnedCount, MAX_PINNED, shown));
  return { columns, pinnedCount };
}

/** `value` as JSON with every object's keys in order and nothing undefined, so two spellings of one value match. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([name, item]) => `${JSON.stringify(name)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

/** A query as one string: an empty filter is no filter, so the two spell the same query. */
export function queryKey(query: ViewQueryShape): string {
  const filter = query.filter === undefined || query.filter.conditions.length === 0 ? undefined : query.filter;
  return canonicalJson({ filter, sorts: query.sorts });
}

/** Whether two queries ask the same thing (a draft equal to the saved query is no draft). */
export function sameQuery(a: ViewQueryShape, b: ViewQueryShape): boolean {
  return queryKey(a) === queryKey(b);
}

/** The longest draft a link carries, encoded (spec 0020, AC-466); past it the draft stays out of the URL. */
export const DRAFT_LINK_MAX = 6000;

/** A draft for the URL: its canonical JSON, UTF-8, base64url without padding. */
export function encodeDraft(query: ViewQueryShape): string {
  const bytes = new TextEncoder().encode(queryKey(query));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The longest draft text read back: anything longer can't have come from this app. */
const MAX_DRAFT_TEXT = 200_000;

/**
 * A draft's text back to JSON, unchecked: undefined when it isn't base64url
 * or doesn't decode to JSON. `decodeDraft` (`@crm/contracts`) checks its shape.
 */
export function decodeDraftText(text: string): unknown {
  if (text.length === 0 || text.length > MAX_DRAFT_TEXT || !/^[A-Za-z0-9_-]+$/.test(text)) return undefined;
  try {
    const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/** What the view rules need to know of a view (a `ViewSummary`, or the engine's row). */
export interface ViewRuleView {
  readonly visibility: 'private' | 'workspace';
  /** Absent for a view the workspace seeded (each object's default view). */
  readonly creatorMemberId?: string | undefined;
  readonly isLocked: boolean;
  readonly isDefault: boolean;
}

/** Who is asking: their member id (absent for an API key), and whether they hold `views.manage`. */
export interface ViewRuleCaller {
  readonly memberId?: string | undefined;
  readonly canManage: boolean;
  /** Whether a member is still in the workspace (the screen's members list); the server's caller always is. */
  readonly isActiveMember?: (memberId: string) => boolean;
}

/** What one asks to do to a view (spec 0020, the rules table). */
export type ViewAction = 'edit' | 'move' | 'delete' | 'share' | 'makePrivate' | 'lock' | 'setDefault';

/**
 * Why an action is refused, as a key each side words itself (the server its
 * refusal, the view menu its disabled reason): `locked` (a locked view, for
 * someone without `views.manage`), `notCreator` (only the creator may),
 * `default` (the default view can't be deleted or made private),
 * `defaultFirst` (the default view never moves), `seeded` (the workspace made
 * it, so it stays shared), `creatorGone` (its creator left the workspace),
 * `unlockFirst`, `private` (only a shared view can be locked or be the
 * default), `manage` (needs `views.manage`), and `already` (nothing to do).
 */
export type ViewRuleReason =
  | 'locked'
  | 'notCreator'
  | 'default'
  | 'defaultFirst'
  | 'seeded'
  | 'creatorGone'
  | 'unlockFirst'
  | 'private'
  | 'manage'
  | 'already';

/**
 * Whether `caller` may do `action` to `view` (spec 0020, the rules table),
 * the one rule the engine refuses by and the view menu disables by: undefined
 * when allowed, else why not. Seeing a private view at all is the creator's
 * alone, which the reads decide before any action.
 */
export function viewRule(action: ViewAction, caller: ViewRuleCaller, view: ViewRuleView): ViewRuleReason | undefined {
  const isCreator = caller.memberId !== undefined && view.creatorMemberId === caller.memberId;
  const edit = (): ViewRuleReason | undefined => {
    if (view.visibility === 'private') return isCreator ? undefined : 'notCreator';
    return view.isLocked && !caller.canManage ? 'locked' : undefined;
  };
  switch (action) {
    case 'edit':
      return edit();
    case 'move':
      return view.isDefault ? 'defaultFirst' : edit();
    case 'delete':
      return edit() ?? (view.isDefault ? 'default' : undefined);
    case 'share':
      if (view.visibility === 'workspace') return 'already';
      return isCreator ? undefined : 'notCreator';
    case 'makePrivate': {
      if (view.visibility === 'private') return 'already';
      if (view.isDefault) return 'default';
      const creator = view.creatorMemberId;
      if (creator === undefined) return 'seeded';
      if (!isCreator && caller.isActiveMember !== undefined && !caller.isActiveMember(creator)) return 'creatorGone';
      if (!isCreator) return 'notCreator';
      return view.isLocked ? 'unlockFirst' : undefined;
    }
    case 'lock':
      if (view.visibility === 'private') return 'private';
      return caller.canManage ? undefined : 'manage';
    case 'setDefault':
      if (view.visibility === 'private') return 'private';
      if (!caller.canManage) return 'manage';
      return view.isDefault ? 'already' : undefined;
  }
}

/** Whether two conditions say the same thing, whatever order their keys were written in. */
function sameCondition(left: FilterCondition, right: FilterCondition): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  const read = (condition: FilterCondition, key: string): unknown => (condition as Record<string, unknown>)[key];
  return keys.every((key) => JSON.stringify(read(left, key)) === JSON.stringify(read(right, key)));
}

/**
 * Whether two stored filters are the same tree. Structural rather than
 * `JSON.stringify`, which would answer no for the same filter with its keys
 * in another order.
 */
function sameFilter(left: FilterGroup | undefined, right: FilterGroup | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.conjunction !== right.conjunction || left.conditions.length !== right.conditions.length) return false;
  return left.conditions.every((item, at) => {
    const other = right.conditions[at];
    if (other === undefined) return false;
    if (isGroupItem(item) || isGroupItem(other)) {
      return isGroupItem(item) && isGroupItem(other) && sameFilter(item, other);
    }
    return sameCondition(item, other);
  });
}

/**
 * Every attribute one condition names: a `through` condition's relations, hop by hop, then the field it reaches on
 * the far object. A condition is seen only when every one of them is: a far field hidden from the saver never
 * reached their screen, however visible the relation leading to it (security review, 28 October 2026).
 */
function conditionIds(condition: FilterCondition): readonly string[] {
  return condition.operator === 'through'
    ? [...condition.path, ...conditionIds(condition.condition)]
    : [condition.attributeId];
}

/** Every attribute a filter names, along `through` paths too: what the server reads to tell seen from unseen. */
export function filterAttributeIds(group: FilterGroup | undefined): readonly string[] {
  if (group === undefined) return [];
  return [
    ...new Set(group.conditions.flatMap((item) => (isGroupItem(item) ? filterAttributeIds(item) : conditionIds(item)))),
  ];
}

/** The stored filter with every condition the saver can't see taken out: what their screen showed them. */
function asSeen(group: FilterGroup, visibleIds: ReadonlySet<string>): FilterGroup | undefined {
  const conditions = group.conditions.flatMap((item): (FilterCondition | FilterGroup)[] => {
    if (isGroupItem(item)) {
      const kept = asSeen(item, visibleIds);
      return kept === undefined ? [] : [kept];
    }
    return conditionIds(item).every((id) => visibleIds.has(id)) ? [item] : [];
  });
  return conditions.length === 0 ? undefined : { conjunction: group.conjunction, conditions };
}

/** Whether a stored filter holds a condition on an attribute outside `visibleIds` (hidden from the saver, or archived). */
export function hasUnseenConditions(stored: FilterGroup | undefined, visibleIds: ReadonlySet<string>): boolean {
  if (stored === undefined) return false;
  return !sameFilter(stored, asSeen(stored, visibleIds));
}

/** What a save may do with a filter whose stored form holds conditions the saver never saw. */
export type FilterMerge =
  { readonly kind: 'keep'; readonly filter: FilterGroup | undefined } | { readonly kind: 'blocked' };

/**
 * The filter a save should store, for a view whose stored filter holds
 * conditions the saver's screen leaves out (27 October 2026): on an attribute
 * hidden from them, or archived. Their screen is built from `effectiveQuery`,
 * which leaves those conditions out, so what they send back is the filter
 * without them, and writing that deleted, for everyone and for good, a
 * condition they never touched. One flipped sort used to be enough to widen a
 * shared view permanently.
 *
 * `mergeLayout` solves the same problem for columns by putting the unseen
 * ones back. A filter can't be merged that way: the stored tree may be an
 * `or`, and grafting the saver's branch onto it would change what the view
 * asks rather than restore it. So:
 *
 * - the saver left the filter alone (what they sent is exactly what they were
 *   shown) → store the filter as it was, every condition kept;
 * - they changed it, and a condition is on an attribute hidden from them →
 *   `blocked`: they may not delete what they can't see, and the caller says so;
 * - they changed it, and the conditions left out are only on archived
 *   attributes they can see → store what they sent. The view's Callout told
 *   them, "Saving a new filter removes it for good" (spec 0020, AC-480).
 *
 * `seeable` are the attributes the saver may see, archived or not, on this
 * object and on every far object a `through` condition reaches
 * (`filterAttributeIds`); `live` those of them not archived.
 */
export function mergeFilter(
  stored: FilterGroup | undefined,
  incoming: FilterGroup | undefined,
  ids: { readonly seeable: ReadonlySet<string>; readonly live: ReadonlySet<string> },
): FilterMerge {
  if (!hasUnseenConditions(stored, ids.live)) return { kind: 'keep', filter: incoming };
  const seen = stored === undefined ? undefined : asSeen(stored, ids.live);
  if (sameFilter(seen, incoming)) return { kind: 'keep', filter: stored };
  return hasUnseenConditions(stored, ids.seeable) ? { kind: 'blocked' } : { kind: 'keep', filter: incoming };
}

/**
 * The sorts a save should store (spec 0020, AC-480). A sort on an attribute archived or hidden from the saver
 * never reached their screen, so what they send back leaves it out, and storing that loses it for good: a view
 * sorted on an archived field came back without its sort on restore, after any save at all. So a saver who left
 * the sorts as they were shown keeps the stored list, every sort in its place; one who changed them stores what
 * they sent. A sort, unlike a condition, never widens what a view shows, so nothing is refused.
 */
export function mergeSorts(
  stored: readonly SortRule[],
  incoming: readonly SortRule[],
  live: ReadonlySet<string>,
): readonly SortRule[] {
  const seen = stored.filter((sort) => live.has(sort.attributeId));
  if (seen.length === stored.length) return incoming;
  const same =
    seen.length === incoming.length &&
    seen.every(
      (sort, at) => sort.attributeId === incoming[at]?.attributeId && sort.direction === incoming[at].direction,
    );
  return same ? stored : incoming;
}

/**
 * A layout saved by someone who can't see every column (spec 0020,
 * `mergeLayout`): their columns in their order, with each stored column they
 * can't see (hidden from them, or archived) and didn't name put back right
 * after the column that preceded it when stored (or at the start), in stored
 * order; a predecessor the writer removed gives way to the nearest earlier
 * one they kept. The pinned count grows by the kept columns that land inside
 * the pinned edge. `visibleIds` are the attributes the writer sees, live.
 */
export function mergeLayout<C extends StoredColumn>(
  stored: readonly C[],
  incoming: { readonly columns: readonly C[]; readonly pinnedCount: number },
  visibleIds: ReadonlySet<string>,
): { readonly columns: readonly C[]; readonly pinnedCount: number } {
  const named = new Set(incoming.columns.map((column) => column.attributeId));
  // Each kept column with the nearest column before it in the stored order that the incoming layout still has.
  const kept: { readonly column: C; readonly after: string | undefined }[] = [];
  let lastNamed: string | undefined;
  for (const column of stored) {
    if (named.has(column.attributeId)) {
      lastNamed = column.attributeId;
      continue;
    }
    if (visibleIds.has(column.attributeId)) continue;
    kept.push({ column, after: lastNamed });
  }
  if (kept.length === 0) return { columns: incoming.columns, pinnedCount: incoming.pinnedCount };
  const result: C[] = [];
  let pinnedCount = incoming.pinnedCount;
  let incomingPlaced = 0;
  const placeAfter = (after: string | undefined) => {
    for (const each of kept) {
      if (each.after !== after) continue;
      // Inside the pinned edge: fewer of the writer's pinned columns placed so far than they pinned.
      if (incomingPlaced < incoming.pinnedCount) pinnedCount += 1;
      result.push(each.column);
    }
  };
  placeAfter(undefined);
  for (const column of incoming.columns) {
    result.push(column);
    incomingPlaced += 1;
    placeAfter(column.attributeId);
  }
  return { columns: result, pinnedCount: Math.min(pinnedCount, MAX_PINNED) };
}
