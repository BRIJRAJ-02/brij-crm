// Saved views (spec 0020): a named filter, sort and column layout on one
// object, shared with the workspace or kept private, with one default view
// per object. The config's shape is checked here on every read and write; the
// rules for what a view runs (`effectiveQuery`, `effectiveColumns`) live in
// `view-model.ts`, without Zod, so the browser's first load can use them.
import { oc } from '@orpc/contract';
import * as z from 'zod';
import { decodeDraftText, MAX_PINNED } from './view-model.ts';
import { AGGREGATE_FNS } from './values/aggregates.ts';
import { FilterGroup } from './values/filters.ts';
import { SortRules } from './values/sorts.ts';
import { WorkspaceScoped } from './workspaces.ts';
import { Uuid } from './values/ids.ts';

/** The most columns one view lists. */
export const MAX_VIEW_COLUMNS = 250;

/** The most bytes a view's config takes, serialised (`CONFIG_INVALID` past it). */
export const MAX_VIEW_CONFIG_BYTES = 65_536;

/**
 * One column of a view: the attribute, its width in pixels (the grid clamps it), whether it is hidden, and the
 * calculation its footer shows (`records.aggregate`; the engine checks it fits the type).
 */
export const ViewColumn = z.strictObject({
  attributeId: Uuid,
  width: z.number().int().min(1).max(2000).optional(),
  isHidden: z.boolean().optional(),
  calc: z.enum(AGGREGATE_FNS).optional(),
});
/** One column of a view. */
export type ViewColumn = z.infer<typeof ViewColumn>;

/**
 * A board's settings (#21 fills them): the grouping attribute, the fields on each card, empty columns, and the
 * currency field each column header totals (the CRM flow pass).
 */
export const BoardConfig = z.strictObject({
  groupByAttributeId: Uuid,
  cardFields: z.array(Uuid).max(6),
  showEmptyColumns: z.boolean(),
  totalAttributeId: Uuid.optional(),
});
/** A board's settings. */
export type BoardConfig = z.infer<typeof BoardConfig>;

const columnsOnce = (columns: readonly ViewColumn[]) =>
  new Set(columns.map((column) => column.attributeId)).size === columns.length;

/**
 * What one view stores: its columns (each attribute at most once), whether
 * attributes it doesn't list show at the end, how many columns are pinned,
 * its filter and sorts, for a board its settings, and for a grouped table
 * its grouping attribute. Unknown keys are
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
  /**
   * A table's rows in runs under a status or single select (13 Oct reference
   * batch 4), read through the board's per group windows; absent, one list.
   */
  groupBy: Uuid.optional(),
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
  /** A table's grouping attribute; `null` sets it back to one list, absent leaves it as it is. */
  groupBy: Uuid.nullable().optional(),
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
  id: Uuid,
  objectId: Uuid,
  name: z.string(),
  kind: ViewKind,
  visibility: ViewVisibility,
  position: z.number().int(),
  isDefault: z.boolean(),
  isLocked: z.boolean(),
  lockedBy: Uuid.optional(),
  creatorMemberId: Uuid.optional(),
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
  querySavedBy: Uuid.optional(),
  querySavedAt: z.iso.datetime({ offset: true }).optional(),
});
/** One view whole. */
export type View = z.infer<typeof View>;

/** An object's views. */
export const ListViewsInput = WorkspaceScoped.extend({ objectId: Uuid });
/** An object's views. */
export type ListViewsInput = z.infer<typeof ListViewsInput>;

/**
 * An object's views in switcher order (the default first, then the shared
 * ones by position, then the caller's private ones), with the default's id
 * when the caller may see it.
 */
export const ViewsList = z.object({
  views: z.array(ViewSummary),
  defaultViewId: Uuid.optional(),
  lastOpenedViewId: Uuid.optional(),
});
/** An object's views in switcher order. */
export type ViewsList = z.infer<typeof ViewsList>;

/** One view. */
export const GetViewInput = WorkspaceScoped.extend({ viewId: Uuid });
/** One view. */
export type GetViewInput = z.infer<typeof GetViewInput>;

/**
 * A draft saved as the view's filter and sorts (AC-468). `baseQueryVersion`
 * is the view's `queryVersion` when the draft began: someone else's save
 * since answers 409 `VIEW_CHANGED`, unless `force` (Replace).
 */
export const SaveViewQueryInput = WorkspaceScoped.extend({
  viewId: Uuid,
  filter: FilterGroup.optional(),
  sorts: SortRules,
  baseQueryVersion: z.number().int().min(1),
  force: z.boolean().optional(),
  mutationId: Uuid,
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

/** A view's name: 1 to 100 characters once trimmed. */
export const ViewName = z
  .string()
  .trim()
  .min(1, 'Give the view a name.')
  .max(100, 'A view name is at most 100 characters.');

/**
 * A new view (AC-472). `id` is a UUID v7 the browser mints once per dialog:
 * the same create again by the same member on the same object answers the
 * view already made; the id held by anything else answers 409 `ID_TAKEN`.
 */
export const CreateViewInput = WorkspaceScoped.extend({
  id: Uuid,
  objectId: Uuid,
  name: ViewName,
  kind: ViewKind,
  visibility: ViewVisibility,
  config: ViewConfig,
  mutationId: Uuid,
});
/** A new view. */
export type CreateViewInput = z.infer<typeof CreateViewInput>;

/** A rename, or a change of who sees the view (Share with everyone, Make private). */
export const UpdateViewInput = WorkspaceScoped.extend({
  viewId: Uuid,
  name: ViewName.optional(),
  visibility: ViewVisibility.optional(),
  mutationId: Uuid,
});
/** A rename, or a change of who sees the view. */
export type UpdateViewInput = z.infer<typeof UpdateViewInput>;

/** A column change saved at once, for everyone on the view (AC-470). */
export const SetViewLayoutInput = WorkspaceScoped.extend({
  viewId: Uuid,
  layout: ViewLayout,
  mutationId: Uuid,
});
/** A column change. */
export type SetViewLayoutInput = z.infer<typeof SetViewLayoutInput>;

/** Swaps a view with its neighbour in its group (the shared views, or the caller's private ones). */
export const MoveViewInput = WorkspaceScoped.extend({
  viewId: Uuid,
  direction: z.enum(['up', 'down']),
  mutationId: Uuid,
});
/** Swaps a view with its neighbour. */
export type MoveViewInput = z.infer<typeof MoveViewInput>;

/** Locks or unlocks a shared view (`views.manage`, AC-475). */
export const SetViewLockedInput = WorkspaceScoped.extend({
  viewId: Uuid,
  locked: z.boolean(),
  mutationId: Uuid,
});
/** Locks or unlocks a shared view. */
export type SetViewLockedInput = z.infer<typeof SetViewLockedInput>;

/** Makes a shared view the object's default (`views.manage`, AC-475). */
export const SetDefaultViewInput = WorkspaceScoped.extend({
  objectId: Uuid,
  viewId: Uuid,
  mutationId: Uuid,
});
/** Makes a shared view the object's default. */
export type SetDefaultViewInput = z.infer<typeof SetDefaultViewInput>;

/** Deletes a view for good (AC-474): never the default. */
export const DeleteViewInput = WorkspaceScoped.extend({ viewId: Uuid, mutationId: Uuid });
/** Deletes a view. */
export type DeleteViewInput = z.infer<typeof DeleteViewInput>;

/** A delete's answer. */
export const ViewDeleted = z.object({ deleted: z.literal(true) });
/** A delete's answer. */
export type ViewDeleted = z.infer<typeof ViewDeleted>;

/** The view the caller just opened, kept as their last one for its object (AC-478). */
export const MarkViewOpenedInput = WorkspaceScoped.extend({ viewId: Uuid });
/** The view the caller just opened. */
export type MarkViewOpenedInput = z.infer<typeof MarkViewOpenedInput>;

/**
 * Saved views (spec 0020). `list` answers an object's views the caller may
 * see (404 for an object they can't), with the one they last opened; `get`
 * one view, or 404 `NOT_FOUND` for one that doesn't exist or isn't theirs to
 * see, never saying which. Every write but `markOpened` stores one `views`
 * event per object it touched. `saveQuery` saves a filter and sorts for
 * everyone who sees the view: 403 `FORBIDDEN` on a view the caller may not
 * change, 409 `VIEW_CHANGED` when someone saved since the draft began, 422
 * `FILTER_INVALID` or `CONFIG_INVALID` for a filter or sort the view's object
 * can't run. `create` answers 409 `NAME_TAKEN` (on `name`), `LIMIT_REACHED`
 * or `ID_TAKEN`; `update` 403, 409 `NAME_TAKEN` or `VIEW_IS_DEFAULT`;
 * `setLayout` 403 on a locked view; `setLocked` and `setDefault` need
 * `views.manage` and a shared view; `delete` answers 409 `VIEW_IS_DEFAULT`
 * for the object's default view.
 */
export const viewsContract = {
  list: oc.input(ListViewsInput).output(ViewsList),
  get: oc.input(GetViewInput).output(View),
  saveQuery: oc.input(SaveViewQueryInput).output(View),
  create: oc.input(CreateViewInput).output(View),
  update: oc.input(UpdateViewInput).output(View),
  setLayout: oc.input(SetViewLayoutInput).output(View),
  move: oc.input(MoveViewInput).output(z.array(ViewSummary)),
  setLocked: oc.input(SetViewLockedInput).output(View),
  setDefault: oc.input(SetDefaultViewInput).output(z.array(ViewSummary)),
  delete: oc.input(DeleteViewInput).output(ViewDeleted),
  markOpened: oc.input(MarkViewOpenedInput).output(z.void()),
};
