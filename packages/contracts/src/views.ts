// Saved views (spec 0020): a named filter, sort and column layout on one
// object, shared with the workspace or kept private, with one default view
// per object. The config's shape is checked here on every read and write; the
// rules for what a view runs (`effectiveQuery`, `effectiveColumns`) live in
// `view-model.ts`, without Zod, so the browser's first load can use them.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { decodeDraftText, MAX_PINNED } from './view-model.ts';
import { FilterGroup } from './values/filters.ts';
import { SortRules } from './values/sorts.ts';
import { WorkspaceScoped } from './workspaces.ts';

/** The most columns one view lists. */
export const MAX_VIEW_COLUMNS = 250;

/** The most bytes a view's config takes, serialised (`CONFIG_INVALID` past it). */
export const MAX_VIEW_CONFIG_BYTES = 65_536;

/** One column of a view: the attribute, its width in pixels (the grid clamps it), and whether it is hidden. */
export const ViewColumn = z.strictObject({
  attributeId: z.uuid(),
  width: z.number().int().min(1).max(2000).optional(),
  isHidden: z.boolean().optional(),
});
/** One column of a view. */
export type ViewColumn = z.infer<typeof ViewColumn>;

/** A board's settings (#21 fills them): the grouping attribute, the fields on each card, and empty columns. */
export const BoardConfig = z.strictObject({
  groupByAttributeId: z.uuid(),
  cardFields: z.array(z.uuid()).max(6),
  showEmptyColumns: z.boolean(),
});
/** A board's settings. */
export type BoardConfig = z.infer<typeof BoardConfig>;

const columnsOnce = (columns: readonly ViewColumn[]) =>
  new Set(columns.map((column) => column.attributeId)).size === columns.length;

/**
 * What one view stores: its columns (each attribute at most once), whether
 * attributes it doesn't list show at the end, how many columns are pinned,
 * its filter and sorts, and for a board its settings. Unknown keys are
 * refused. The engine also checks every attribute it names belongs to the
 * view's object, and each sort `isSortable`.
 */
export const ViewConfig = z.strictObject({
  columns: z
    .array(ViewColumn)
    .max(MAX_VIEW_COLUMNS)
    .refine(columnsOnce, { message: 'Each attribute is a column once.' }),
  showNewAttributes: z.boolean(),
  pinnedCount: z.number().int().min(1).max(MAX_PINNED),
  filter: FilterGroup.optional(),
  sorts: SortRules,
  board: BoardConfig.optional(),
});
/** What one view stores. */
export type ViewConfig = z.infer<typeof ViewConfig>;

/** A view's layout, as a column change saves it (milestone 2). */
export const ViewLayout = z.strictObject({
  kind: z.enum(['table', 'board']).optional(),
  columns: z
    .array(ViewColumn)
    .max(MAX_VIEW_COLUMNS)
    .refine(columnsOnce, { message: 'Each attribute is a column once.' }),
  pinnedCount: z.number().int().min(1).max(MAX_PINNED),
  board: BoardConfig.optional(),
});
/** A view's layout. */
export type ViewLayout = z.infer<typeof ViewLayout>;

/** A table or a board. */
export const ViewKind = z.enum(['table', 'board']);
/** A table or a board. */
export type ViewKind = z.infer<typeof ViewKind>;

/** Only its creator, or everyone in the workspace. */
export const ViewVisibility = z.enum(['private', 'workspace']);
/** Who sees a view. */
export type ViewVisibility = z.infer<typeof ViewVisibility>;

/**
 * A view as the switcher lists it: its id, object, name, kind, who sees it,
 * its place in its group, whether it is the object's default, whether it is
 * locked and by whom, its creator (absent for a view the workspace seeded),
 * and its version (up by one on every change).
 */
export const ViewSummary = z.object({
  id: z.uuid(),
  objectId: z.uuid(),
  name: z.string(),
  kind: ViewKind,
  visibility: ViewVisibility,
  position: z.number().int(),
  isDefault: z.boolean(),
  isLocked: z.boolean(),
  lockedBy: z.uuid().optional(),
  creatorMemberId: z.uuid().optional(),
  version: z.number().int(),
});
/** A view as the switcher lists it. */
export type ViewSummary = z.infer<typeof ViewSummary>;

/**
 * One view whole: its summary, its config, and its query's version (up by one
 * when the filter or sorts are saved) with who saved them and when.
 */
export const View = ViewSummary.extend({
  config: ViewConfig,
  queryVersion: z.number().int(),
  querySavedBy: z.uuid().optional(),
  querySavedAt: z.iso.datetime({ offset: true }).optional(),
});
/** One view whole. */
export type View = z.infer<typeof View>;

/** An object's views. */
export const ListViewsInput = WorkspaceScoped.extend({ objectId: z.uuid() });
/** An object's views. */
export type ListViewsInput = z.infer<typeof ListViewsInput>;

/**
 * An object's views in switcher order (the default first, then the shared
 * ones by position, then the caller's private ones), with the default's id
 * when the caller may see it.
 */
export const ViewsList = z.object({
  views: z.array(ViewSummary),
  defaultViewId: z.uuid().optional(),
  lastOpenedViewId: z.uuid().optional(),
});
/** An object's views in switcher order. */
export type ViewsList = z.infer<typeof ViewsList>;

/** One view. */
export const GetViewInput = WorkspaceScoped.extend({ viewId: z.uuid() });
/** One view. */
export type GetViewInput = z.infer<typeof GetViewInput>;

/**
 * A draft saved as the view's filter and sorts (AC-468). `baseQueryVersion`
 * is the view's `queryVersion` when the draft began: someone else's save
 * since answers 409 `VIEW_CHANGED`, unless `force` (Replace).
 */
export const SaveViewQueryInput = WorkspaceScoped.extend({
  viewId: z.uuid(),
  filter: FilterGroup.optional(),
  sorts: SortRules,
  baseQueryVersion: z.number().int().min(1),
  force: z.boolean().optional(),
  mutationId: z.uuid(),
});
/** A draft saved as the view's filter and sorts. */
export type SaveViewQueryInput = z.infer<typeof SaveViewQueryInput>;

/** A draft as a URL carries it, checked: its filter and sorts. */
export const ViewDraft = z.object({ filter: FilterGroup.optional(), sorts: SortRules });
/** A draft as a URL carries it. */
export type ViewDraft = z.infer<typeof ViewDraft>;

/** A draft's URL text back to a checked query, or undefined when it doesn't read as one (AC-467). */
export function decodeDraft(text: string): ViewDraft | undefined {
  const parsed = ViewDraft.safeParse(decodeDraftText(text));
  return parsed.success ? parsed.data : undefined;
}

/**
 * Saved views (spec 0020, milestone 1). `list` answers an object's views the
 * caller may see (404 for an object they can't); `get` one view, or 404
 * `NOT_FOUND` for one that doesn't exist or isn't theirs to see, never
 * saying which. `saveQuery` saves a filter and sorts for everyone who sees
 * the view and stores one `views` event: 403 `FORBIDDEN` on a view the
 * caller may not change, 409 `VIEW_CHANGED` when someone saved since the
 * draft began, 422 `FILTER_INVALID` or `CONFIG_INVALID` for a filter or sort
 * the view's object can't run.
 */
export const viewsContract = {
  list: oc.input(ListViewsInput).output(ViewsList),
  get: oc.input(GetViewInput).output(View),
  saveQuery: oc.input(SaveViewQueryInput).output(View),
};
