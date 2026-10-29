// What a board view shows (spec 0021), worked out from the object's
// attributes and the view's stored board settings, with no I/O: the grouping
// attribute, its columns in order (the "No <attribute>" column first, then
// every option by position, archived ones among them), and the card fields;
// or why there is no board to show (nothing to group by, an archived
// grouping attribute, too many options).
import {
  BOARD_MAX_COLUMNS,
  boardColumnIds,
  boardDefaults,
  isGroupable,
  liveOptionCount,
  type AttributeDefinition,
  type BoardSettings,
} from '@crm/data';

/** A board's columns and cards, ready to load. */
export interface BoardPlan {
  readonly kind: 'board';
  readonly groupBy: AttributeDefinition;
  readonly settings: BoardSettings;
  /** `null` (no value) first, then the options by position, archived ones too. */
  readonly columnIds: readonly (string | null)[];
  readonly archivedIds: readonly string[];
  /** The card fields that show: live, never the name, at most 6, in the view's order. */
  readonly cardFields: readonly AttributeDefinition[];
  /** Whether settings came from the view (false: the defaults, this visit, AC-492). */
  readonly isStored: boolean;
  /**
   * The view names a grouping field this reader can't group by (hidden from them, gone, or no longer groupable), so
   * the defaults stand in: said on the board, never quietly (late trap #29).
   */
  readonly isStandIn: boolean;
}

/** What a board view shows: its board, or why it can't. */
export type BoardOutcome =
  | BoardPlan
  /** The object has no status or single select attribute (AC-493). */
  | { readonly kind: 'nothing-to-group' }
  /** The grouping attribute was archived (AC-506): pick another. */
  | { readonly kind: 'group-archived'; readonly id: string; readonly title: string }
  /** More than 50 live options (AC-494). */
  | { readonly kind: 'too-many'; readonly title: string; readonly count: number };

/**
 * The board a view shows: its stored settings when they still group by a
 * live status or single select, else the defaults (the first status, else
 * the first single select; AC-492). A stored grouping attribute that was
 * archived says so rather than quietly grouping by another.
 */
export function planBoard(attributes: readonly AttributeDefinition[], stored: BoardSettings | undefined): BoardOutcome {
  const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const storedGroup = stored === undefined ? undefined : byId.get(stored.groupByAttributeId);
  if (storedGroup?.isArchived === true) return { kind: 'group-archived', id: storedGroup.id, title: storedGroup.title };
  const isStored = storedGroup !== undefined && isGroupable(storedGroup);
  const settings = isStored ? stored : boardDefaults(attributes);
  if (settings === undefined) return { kind: 'nothing-to-group' };
  const groupBy = byId.get(settings.groupByAttributeId);
  if (groupBy === undefined) return { kind: 'nothing-to-group' };
  const options = groupBy.options ?? [];
  const live = liveOptionCount(options);
  if (live > BOARD_MAX_COLUMNS) return { kind: 'too-many', title: groupBy.title, count: live };
  const cardFields = settings.cardFields.flatMap((id) => {
    const field = byId.get(id);
    return field === undefined || field.isArchived || field.isPrimary || field.id === groupBy.id ? [] : [field];
  });
  return {
    kind: 'board',
    groupBy,
    settings,
    columnIds: boardColumnIds(options),
    archivedIds: options.filter((option) => option.isArchived).map((option) => option.id),
    cardFields,
    isStored,
    isStandIn: stored !== undefined && !isStored,
  };
}
