// What a change to a view saves (spec 0020, spec 0021): a column change, the
// config a new view starts from, a duplicate's name, and the Table and Board
// switch. Apart from `layout.ts` so the route's loader, in the first load,
// carries only what it reads.
import {
  boardDefaults,
  isGroupable,
  type AttributeDefinition,
  type BoardSettings,
  type DraftQuery,
  type ObjectSummary,
  type View,
  type ViewConfig,
  type ViewLayout,
} from '@crm/data';
import type { ShownColumn, ShownLayout } from './layout.ts';

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

/** What a board change sets (spec 0021): the kind, the board settings, or both. */
export interface BoardPatch {
  readonly kind?: 'table' | 'board';
  readonly board?: BoardSettings;
}

/**
 * The layout a kind or board change saves (spec 0021, AC-492, AC-497): the
 * view's columns as they are, with the patch on top. A layout kept in this tab
 * (`isLocal`, a locked view the person may not change) replaces the one
 * before it, so it carries the kind and board shown now as well.
 */
export function boardLayout(view: View, patch: BoardPatch, isLocal: boolean): ViewLayout {
  const board = patch.board ?? (isLocal ? view.config.board : undefined);
  const kind = patch.kind ?? (isLocal ? view.kind : undefined);
  return {
    ...(kind === undefined ? {} : { kind }),
    columns: view.config.columns,
    pinnedCount: view.config.pinnedCount,
    ...(board === undefined ? {} : { board: { ...board, cardFields: [...board.cardFields] } }),
    // A layout kept in this tab replaces the one before it, so it carries the table's grouping too.
    ...(isLocal && view.config.groupBy !== undefined ? { groupBy: view.config.groupBy } : {}),
  };
}

/**
 * The Table and Board switch (AC-492): the kind picked, and the first time a
 * view becomes a board, or when its grouping field is no longer live, the
 * defaults (none when nothing can group, so the kind goes alone). Back to Table keeps the board settings. Undefined when the
 * view already is that kind.
 */
export function switchPatch(
  view: View,
  next: 'table' | 'board',
  attributes: readonly AttributeDefinition[],
): BoardPatch | undefined {
  if (next === view.kind) return undefined;
  // A stored grouping field no longer live (archived since, or gone) counts as none: the server refuses a board
  // grouped by it, so picking Board would only bounce back to the table (late trap #14).
  const stored = view.config.board;
  const isStoredLive =
    stored !== undefined &&
    attributes.some((attribute) => attribute.id === stored.groupByAttributeId && isGroupable(attribute));
  const defaults = next === 'board' && !isStoredLive ? boardDefaults(attributes) : undefined;
  return { kind: next, ...(defaults === undefined ? {} : { board: defaults }) };
}
