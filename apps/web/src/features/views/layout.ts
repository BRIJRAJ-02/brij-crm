// A view's columns (spec 0020, effective columns and the layout): what the
// table shows for a view, what a column change saves, the config a new view
// starts from, and the names a duplicate takes. Plain functions with no React
// or library imports, so the route's loader (in the first load) reads the same
// columns the screen shows.
import {
  effectiveColumns,
  type AttributeDefinition,
  type DraftQuery,
  type ObjectSummary,
  type View,
  type ViewConfig,
  type ViewLayout,
} from '@crm/data';
import { avatarAttribute, listedAttributes } from '../workspace/columns.ts';

/** One column the table shows: the attribute, whether hidden, and its width when the view keeps one. */
export interface ShownColumn {
  readonly id: string;
  readonly isHidden: boolean;
  readonly width?: number;
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

/** The widest a stored column may be. */
const MAX_WIDTH = 2000;

/** What a column change saves: every column in its order, its width, and whether hidden. */
export function layoutOf(columns: readonly ShownColumn[], pinnedCount: number): ViewLayout {
  return {
    columns: columns.map((column) => ({
      attributeId: column.id,
      ...(column.width === undefined ? {} : { width: Math.min(MAX_WIDTH, Math.max(1, Math.round(column.width))) }),
      ...(column.isHidden ? { isHidden: true } : {}),
    })),
    pinnedCount: Math.min(5, Math.max(1, pinnedCount)),
  };
}

/** A view's columns with an attribute added at the end, shown (an attribute made from the grid's "+", AC-471). */
export function withColumn(layout: ShownLayout, attributeId: string): ShownLayout {
  if (layout.columns.some((column) => column.id === attributeId && !column.isHidden)) return layout;
  const rest = layout.columns.filter((column) => column.id !== attributeId);
  return { ...layout, columns: [...rest, { id: attributeId, isHidden: false }] };
}

/**
 * The config a new view starts from (the create dialog, spec 0020 value
 * sourcing): with "Start from this view" its columns as the table shows them
 * and the query that runs (the draft included); without, every non system
 * attribute by position, shown, the name first, no filter, newest first.
 */
export function startingConfig(
  from: { readonly layout: ShownLayout; readonly query: DraftQuery } | undefined,
  object: ObjectSummary,
  attributes: readonly AttributeDefinition[],
): ViewConfig {
  if (from !== undefined) {
    const layout = layoutOf(from.layout.columns, from.layout.pinnedCount);
    return {
      columns: layout.columns,
      showNewAttributes: false,
      pinnedCount: layout.pinnedCount,
      ...(from.query.filter === undefined || from.query.filter.conditions.length === 0
        ? {}
        : { filter: from.query.filter }),
      sorts: [...from.query.sorts],
    };
  }
  const own = attributes
    .filter((attribute) => !attribute.isSystem && !attribute.isArchived)
    .sort(
      (a, b) =>
        Number(b.id === object.primaryAttributeId) - Number(a.id === object.primaryAttributeId) ||
        a.position - b.position,
    );
  return {
    columns: own.map((attribute) => ({ attributeId: attribute.id })),
    showNewAttributes: false,
    pinnedCount: 1,
    sorts: [],
  };
}

/**
 * A duplicate's name (spec 0020 value sourcing): "<Name> copy", then
 * "<Name> copy 2", "<Name> copy 3" while one of `taken` (ignoring case) has it,
 * cut to 100 characters.
 */
export function copyName(name: string, taken: readonly string[]): string {
  const held = new Set(taken.map((each) => each.toLocaleLowerCase()));
  const base = `${name} copy`;
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? '' : ` ${String(n)}`;
    const candidate = `${base.slice(0, 100 - suffix.length).trimEnd()}${suffix}`;
    if (!held.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
