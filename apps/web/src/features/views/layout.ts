// A view's columns (spec 0020, effective columns and the layout): what the
// table shows for a view and the attributes it reads. Plain functions with no
// React or library imports, so the route's loader (in the first load) reads the
// same columns the screen shows. What a change saves lives in `edits.ts`, which
// only the screens load.
import { effectiveColumns, type AggregateFn, type AttributeDefinition, type ObjectSummary, type View } from '@crm/data';
import { avatarAttribute, listedAttributes } from '../workspace/columns.ts';

/** One column the table shows: the attribute, whether hidden, and its width when the view keeps one. */
export interface ShownColumn {
  readonly id: string;
  readonly isHidden: boolean;
  readonly width?: number;
  /** The calculation its footer shows (the CRM flow pass). */
  readonly calc?: AggregateFn;
}

/** A view's columns and how many are pinned. */
export interface ShownLayout {
  readonly columns: readonly ShownColumn[];
  readonly pinnedCount: number;
}

/** Whether a view still opens as its object's seeded default does: no columns saved, new attributes shown. */
const isUnsaved = (view: View) => view.config.columns.length === 0 && view.config.showNewAttributes;

/**
 * The columns a table shows for a view. A view with no saved columns that
 * shows new attributes (each object's seeded default view, until its first
 * column change) opens with the object's opening columns (owner decision,
 * 8 October 2026); every other view runs `effectiveColumns`: its columns in
 * order without archived or hidden attributes, then the attributes it
 * doesn't list (shown only on a view that shows new ones), the name first.
 */
export function viewColumns(
  view: View | undefined,
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
): ShownLayout {
  if (view === undefined || isUnsaved(view)) {
    const live = attributes.filter((attribute) => !attribute.isArchived);
    return {
      columns: listedAttributes(object, live).map(({ definition, isHidden }) => ({ id: definition.id, isHidden })),
      pinnedCount: Math.max(1, view?.config.pinnedCount ?? 1),
    };
  }
  const effective = effectiveColumns(view.config, attributes, object.primaryAttributeId);
  return {
    columns: effective.columns.map((column) => ({
      id: column.attributeId,
      isHidden: column.isHidden,
      ...(column.width === undefined ? {} : { width: column.width }),
      ...(column.calc === undefined ? {} : { calc: column.calc }),
    })),
    pinnedCount: effective.pinnedCount,
  };
}

/** The attributes a view reads (spec 0006, AC-55): its shown columns, and the row's picture. */
export function viewReadIds(
  layout: ShownLayout,
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
): readonly string[] {
  const shown = layout.columns.filter((column) => !column.isHidden).map((column) => column.id);
  const avatar = avatarAttribute(object, attributes);
  return avatar === undefined || shown.includes(avatar.id) ? shown : [...shown, avatar.id];
}
