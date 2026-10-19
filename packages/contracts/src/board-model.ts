// `@crm/contracts/board` (spec 0021): the rules a board view shares between
// the browser and the engine. Plain TypeScript with no Zod, so the records
// layer and the view screen use them without loading the schema library:
// which attributes group a board (`isGroupable`), the defaults a view gets the
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
}

/** Whether a board may group by `attribute`: a live status, or a live select holding one value (AC-508). */
export function isGroupable(attribute: Omit<BoardAttribute, 'isSystem' | 'isPrimary' | 'position'>): boolean {
  if (attribute.isArchived) return false;
  return attribute.type === 'status' || (attribute.type === 'select' && !attribute.isMulti);
}

const byPosition = (a: BoardAttribute, b: BoardAttribute) => a.position - b.position;

/** An object's attributes a board may group by: its status attributes by position, then its single selects. */
export function groupableAttributes<T extends BoardAttribute>(attributes: readonly T[]): readonly T[] {
  const live = attributes.filter(isGroupable).sort(byPosition);
  return [...live.filter((each) => each.type === 'status'), ...live.filter((each) => each.type === 'select')];
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
  if (groupBy === undefined || !isGroupable(groupBy)) return 'Boards group by a status or single select field.';
  if (config.cardFields.length > BOARD_MAX_CARD_FIELDS) {
    return `A card shows at most ${String(BOARD_MAX_CARD_FIELDS)} fields.`;
  }
  if (new Set(config.cardFields).size !== config.cardFields.length) return 'Each field shows on a card once.';
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
export function groupCondition(groupBy: string, optionId: string | null): FilterCondition {
  return optionId === null
    ? { attributeId: groupBy, operator: 'is_empty' }
    : { attributeId: groupBy, operator: 'is', value: optionId };
}

/** One column's whole filter: the view's effective filter and the column's condition, both. */
export function columnFilter(filter: FilterGroup | undefined, groupBy: string, optionId: string | null): FilterGroup {
  const condition = groupCondition(groupBy, optionId);
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
