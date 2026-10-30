// `@crm/contracts/board` (spec 0021): the rules a board view shares between
// the browser and the engine. Plain TypeScript with no Zod, so the records
// layer and the view screen use them without loading the schema library:
// which attributes group a board (`isGroupable`, `groupKindOf`: options,
// a checkbox or members), how a value maps to its column and back
// (`groupKeyOf`, `groupValueOf`), the defaults a view gets the
// first time it shows as a board (`boardDefaults`), the check a stored board
// config passes (`boardConfigProblem`), and one column's filter
// (`groupCondition`, `columnFilter`).
import type { FilterCondition, FilterGroup } from './values/filters.ts';

/** The most live options a grouping attribute may have for its board to show (owner decision 3). */
export const BOARD_MAX_COLUMNS = 50;

/** How many columns one `records.groups` call reads: a board of more sends its calls one after another. */
export const BOARD_GROUPS_PER_CALL = 12;

/** The most card fields a board shows on each card, the name aside. */
export const BOARD_MAX_CARD_FIELDS = 6;

/** How many card fields a view gets the first time it shows as a board. */
export const BOARD_DEFAULT_CARD_FIELDS = 3;

/** The cards one column reads at a time: its first page, and each block after it. */
export const BOARD_BLOCK = 25;

/** The most cards one `records.groups` group answers. */
export const BOARD_MAX_GROUP_LIMIT = 50;

/** What the board rules need to know of an attribute (an `AttributeDefinition`, or the engine's own). */
export interface BoardAttribute {
  readonly id: string;
  readonly type: string;
  readonly isMulti: boolean;
  readonly isSystem: boolean;
  readonly isPrimary: boolean;
  readonly isArchived: boolean;
  readonly position: number;
}

/** A board's settings, as `BoardConfig` in `@crm/contracts` parses them. */
export interface BoardSettings {
  readonly groupByAttributeId: string;
  readonly cardFields: readonly string[];
  readonly showEmptyColumns: boolean;
  /** A currency field each column header totals, when set. */
  readonly totalAttributeId?: string;
}

/**
 * How a grouping attribute makes its columns: one per option (a status or single select), Checked and Not checked
 * (a checkbox), or one per member (a member field holding one person, such as Owner).
 */
export type GroupKind = 'option' | 'checkbox' | 'member';

/** A checkbox board's columns: Not checked (empty included) first, then Checked. */
export const CHECKBOX_COLUMNS = ['unchecked', 'checked'] as const;

/** How `attribute` makes its columns, or undefined when it can't group (AC-508, and the CRM flow pass). */
export function groupKindOf(
  attribute: Pick<BoardAttribute, 'type' | 'isMulti' | 'isArchived'> & { readonly isSystem?: boolean },
): GroupKind | undefined {
  if (attribute.isArchived) return undefined;
  if (attribute.type === 'status' || (attribute.type === 'select' && !attribute.isMulti)) return 'option';
  if (attribute.type === 'checkbox') return 'checkbox';
  // Created by and updated by can be an API key or the system, which no column holds.
  if (attribute.type === 'actor_reference' && !attribute.isMulti && attribute.isSystem !== true) return 'member';
  return undefined;
}

/**
 * Whether a board or a table may group by `attribute`: a live status, a live select holding one value (AC-508), a
 * checkbox, or a member field holding one person.
 */
export function isGroupable(
  attribute: Pick<BoardAttribute, 'type' | 'isMulti' | 'isArchived'> & { readonly isSystem?: boolean },
): boolean {
  return groupKindOf(attribute) !== undefined;
}

const byPosition = (a: BoardAttribute, b: BoardAttribute) => a.position - b.position;

/** The order kinds of grouping attribute are offered and chosen by default in. */
const GROUP_TYPES = ['status', 'select', 'actor_reference', 'checkbox'] as const;

/** An object's attributes a board may group by: statuses by position, then single selects, members, checkboxes. */
export function groupableAttributes<T extends BoardAttribute>(attributes: readonly T[]): readonly T[] {
  const live = attributes.filter(isGroupable).sort(byPosition);
  return GROUP_TYPES.flatMap((type) => live.filter((each) => each.type === type));
}

/** The column a stored value sits in: its option, member or checked state; `null` for no value. */
export function groupKeyOf(kind: GroupKind, value: unknown): string | null {
  switch (kind) {
    case 'option':
      return typeof value === 'string' ? value : null;
    case 'checkbox':
      return value === true ? 'checked' : 'unchecked';
    case 'member': {
      if (typeof value !== 'object' || value === null) return null;
      const actor = value as { readonly type?: unknown; readonly id?: unknown };
      return actor.type === 'member' && typeof actor.id === 'string' ? actor.id : null;
    }
  }
}

/** The value a card takes moving into a column (or made from its "+"): `null` clears it. */
export function groupValueOf(kind: GroupKind, columnId: string | null): unknown {
  switch (kind) {
    case 'option':
      return columnId;
    case 'checkbox':
      return columnId === 'checked';
    case 'member':
      return columnId === null ? null : { type: 'member', id: columnId };
  }
}

/**
 * A view's board settings the first time it shows as a board (spec 0021,
 * AC-492): grouped by the object's first live status attribute by position,
 * else its first live single select; its first 3 live, non system, non
 * primary attributes other than that one as card fields; empty columns
 * shown. Undefined when nothing can group (AC-493's empty state).
 */
export function boardDefaults(attributes: readonly BoardAttribute[]): BoardSettings | undefined {
  const groupBy = groupableAttributes(attributes)[0];
  if (groupBy === undefined) return undefined;
  const cardFields = attributes
    .filter((each) => !each.isArchived && !each.isSystem && !each.isPrimary && each.id !== groupBy.id)
    .sort(byPosition)
    .slice(0, BOARD_DEFAULT_CARD_FIELDS)
    .map((each) => each.id);
  return { groupByAttributeId: groupBy.id, cardFields, showEmptyColumns: true };
}

/**
 * Why a board config can't be stored on a view of an object with
 * `attributes` (spec 0021, the config checks added to spec 0020's), or
 * undefined when it can: the grouping attribute must be a live status or
 * single select of the object; card fields are attributes of the object, at
 * most 6, each once, never the primary one.
 */
export function boardConfigProblem(config: BoardSettings, attributes: readonly BoardAttribute[]): string | undefined {
  const byId = new Map(attributes.map((each) => [each.id, each]));
  const groupBy = byId.get(config.groupByAttributeId);
  if (groupBy === undefined || !isGroupable(groupBy)) {
    return 'Boards group by a status, a single select, a checkbox or a member field.';
  }
  if (config.cardFields.length > BOARD_MAX_CARD_FIELDS) {
    return `A card shows at most ${String(BOARD_MAX_CARD_FIELDS)} fields.`;
  }
  if (new Set(config.cardFields).size !== config.cardFields.length) return 'Each field shows on a card once.';
  if (config.totalAttributeId !== undefined) {
    const total = byId.get(config.totalAttributeId);
    if (total === undefined || total.type !== 'currency' || total.isArchived)
      return 'A column totals a currency field.';
  }
  for (const id of config.cardFields) {
    const field = byId.get(id);
    if (field === undefined) return 'A card field is not a field of this object.';
    if (field.isPrimary) return 'The name always shows on a card, so it is not a card field.';
  }
  return undefined;
}

/**
 * One column's own condition (spec 0021): records holding `optionId` in the
 * grouping attribute, or with no value in it for the "No <attribute>"
 * column (`null`).
 */
export function groupCondition(groupBy: string, optionId: string | null, kind: GroupKind = 'option'): FilterCondition {
  if (kind === 'checkbox') {
    return { attributeId: groupBy, operator: optionId === 'checked' ? 'is_checked' : 'is_not_checked' };
  }
  return optionId === null
    ? { attributeId: groupBy, operator: 'is_empty' }
    : { attributeId: groupBy, operator: 'is', value: optionId };
}

/** One column's whole filter: the view's effective filter and the column's condition, both. */
export function columnFilter(
  filter: FilterGroup | undefined,
  groupBy: string,
  optionId: string | null,
  kind: GroupKind = 'option',
): FilterGroup {
  const condition = groupCondition(groupBy, optionId, kind);
  return filter === undefined || filter.conditions.length === 0
    ? { conjunction: 'and', conditions: [condition] }
    : { conjunction: 'and', conditions: [filter, condition] };
}

/** An option of the grouping attribute as the board orders its columns. */
export interface BoardOption {
  readonly id: string;
  readonly position: number;
  readonly isArchived: boolean;
}

/** A board's column ids in order: the "No <attribute>" column (`null`) first, then every option by position. */
export function boardColumnIds(options: readonly BoardOption[]): readonly (string | null)[] {
  return [null, ...[...options].sort((a, b) => a.position - b.position).map((option) => option.id)];
}

/** How many live options the grouping attribute has: past `BOARD_MAX_COLUMNS` the board shows no columns. */
export function liveOptionCount(options: readonly BoardOption[]): number {
  return options.filter((option) => !option.isArchived).length;
}
