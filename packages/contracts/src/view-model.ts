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
 * definitions store loads them, or undefined when the far side can't be
 * read (the condition is then dropped as unavailable).
 */
export type FarAttributes = (relation: ViewAttribute) => readonly ViewAttribute[] | 'pending' | undefined;

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
