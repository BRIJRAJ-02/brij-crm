// What a board view shows (spec 0021), worked out from the object's
// attributes and the view's stored board settings, with no I/O: the grouping
// attribute, its columns in order (the "No <attribute>" column first, then
// every option by position, archived ones among them), and the card fields;
// or why there is no board to show (nothing to group by, an archived
// grouping attribute, too many options). A checkbox groups into Not checked
// and Checked, and a member field into one column per member: both as
// options of their own, so the board and the grouped table draw them as
// they draw a select's.
import {
  BOARD_MAX_COLUMNS,
  CHECKBOX_COLUMNS,
  boardColumnIds,
  boardDefaults,
  groupKindOf,
  isGroupable,
  liveOptionCount,
  type AttributeDefinition,
  type AttributeOption,
  type BoardSettings,
  type GroupKind,
  type MemberSummary,
} from '@crm/data';
import { strings } from './strings.ts';

/** A board's columns and cards, ready to load. */
export interface BoardPlan {
  readonly kind: 'board';
  /** The grouping attribute, its `options` the columns' (a checkbox's two states, or the members, made here). */
  readonly groupBy: AttributeDefinition;
  readonly groupKind: GroupKind;
  readonly settings: BoardSettings;
  /** `null` (no value) first, then the options by position, archived ones too. */
  readonly columnIds: readonly (string | null)[];
  readonly archivedIds: readonly string[];
  /** The live currency field each column header totals, when the view sets one. */
  readonly total?: AttributeDefinition;
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
 * groupable field, else the defaults (the first status, else the first single
 * select, member field or checkbox; AC-492). `members` are a member field's
 * columns. A stored grouping attribute that was
 * archived says so rather than quietly grouping by another.
 */
export function planBoard(
  attributes: readonly AttributeDefinition[],
  stored: BoardSettings | undefined,
  members: readonly Pick<MemberSummary, 'id' | 'name'>[] = [],
): BoardOutcome {
  const byId = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const storedGroup = stored === undefined ? undefined : byId.get(stored.groupByAttributeId);
  if (storedGroup?.isArchived === true) return { kind: 'group-archived', id: storedGroup.id, title: storedGroup.title };
  const isStored = storedGroup !== undefined && isGroupable(storedGroup);
  const settings = isStored ? stored : boardDefaults(attributes);
  if (settings === undefined) return { kind: 'nothing-to-group' };
  const field = byId.get(settings.groupByAttributeId);
  const groupKind = field === undefined ? undefined : groupKindOf(field);
  if (field === undefined || groupKind === undefined) return { kind: 'nothing-to-group' };
  const options = columnOptions(field, groupKind, members);
  const groupBy = groupKind === 'option' ? field : { ...field, options: [...options] };
  const live = liveOptionCount(options);
  if (live > BOARD_MAX_COLUMNS) return { kind: 'too-many', title: groupBy.title, count: live };
  const cardFields = settings.cardFields.flatMap((id) => {
    const field = byId.get(id);
    return field === undefined || field.isArchived || field.isPrimary || field.id === groupBy.id ? [] : [field];
  });
  const total = settings.totalAttributeId === undefined ? undefined : byId.get(settings.totalAttributeId);
  return {
    kind: 'board',
    groupBy,
    groupKind,
    ...(total === undefined || total.isArchived || total.type !== 'currency' ? {} : { total }),
    settings,
    // A checkbox has no "No" column: an empty one is Not checked.
    columnIds: groupKind === 'checkbox' ? CHECKBOX_COLUMNS : boardColumnIds(options),
    archivedIds: options.filter((option) => option.isArchived).map((option) => option.id),
    cardFields,
    isStored,
    isStandIn: stored !== undefined && !isStored,
  };
}

/** The columns' options: the attribute's own, a checkbox's two states, or the members by name. */
function columnOptions(
  attribute: AttributeDefinition,
  kind: GroupKind,
  members: readonly Pick<MemberSummary, 'id' | 'name'>[],
): readonly AttributeOption[] {
  if (kind === 'option') return attribute.options ?? [];
  if (kind === 'checkbox') {
    return [
      { id: 'unchecked', label: strings.unchecked, hue: 'gray', position: 0, isArchived: false },
      { id: 'checked', label: strings.checked, hue: 'green', position: 1, isArchived: false },
    ];
  }
  return [...members]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((member, position) => ({ id: member.id, label: member.name, hue: 'gray', position, isArchived: false }));
}
