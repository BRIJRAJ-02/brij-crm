// Saved views (spec 0020): an object's views as the switcher lists them (with
// the one the member last opened), one view whole, and saving a draft as a
// view's filter and sorts for everyone who sees it; `manage.ts` holds the
// other writes and shares the reads here. Every read goes through the scope the door made;
// the save runs inside `runWrite` and records the view in `Change.views`, so
// `outboxHook` stores its `views` row in the same transaction.
import { and, asc, eq, isNotNull, or, sql } from 'drizzle-orm';
import {
  MAX_VIEW_CONFIG_BYTES,
  ViewConfig,
  type FilterGroup,
  type SortRules,
  type View,
  type ViewsList,
  type ViewSummary,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { checkViewQuery } from '../engine/query/page.ts';
import {
  isArchivedNow,
  loadAttributes,
  loadAttributesById,
  loadListAttributes,
  type AttributeDef,
} from '../engine/values.ts';
import { postgresError, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { can, fieldLevel, isOpen, objectLevel, type Access } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { attributeVisible, checkList, checkObject } from '../access/visibility.ts';
import {
  filterAttributeIds,
  mergeFilter,
  mergeSorts,
  seenFilter,
  viewRule,
  type ViewRuleCaller,
} from '@crm/contracts/views';
import { defaultViewConfig } from './seed.ts';

const { lists, memberViewState, members, objects, views } = schema;

/** What every call naming a view the caller can't see answers, whichever reason it was (AC-463). */
export const VIEW_NOT_FOUND = "This view doesn't exist or isn't shared with you.";

/** What a write to a locked view answers to someone without `views.manage` (AC-476). */
export const VIEW_LOCKED = 'This view is locked. Ask an owner or admin to unlock it.';

/** The columns every view read selects. */
export const VIEW_COLUMNS = {
  id: views.id,
  // A list's view (spec 0048) reads as one on the list's object, naming its list too.
  objectId: sql<string | null>`coalesce(${views.objectId}, ${lists.objectId})`,
  listId: views.listId,
  name: views.name,
  kind: views.kind,
  visibility: views.visibility,
  creatorMemberId: views.creatorMemberId,
  position: views.position,
  config: views.config,
  version: views.version,
  queryVersion: views.queryVersion,
  querySavedAt: views.querySavedAt,
  querySavedByMemberId: views.querySavedByMemberId,
  isLocked: views.isLocked,
  lockedByMemberId: views.lockedByMemberId,
  defaultViewId: sql<string | null>`coalesce(${objects.defaultViewId}, ${lists.defaultViewId})`,
} as const;

/** What every view read joins: its object, or its list (spec 0048), for the parent's default view. */
export const viewParents = {
  objects: and(eq(objects.workspaceId, views.workspaceId), eq(objects.id, views.objectId)),
  lists: and(eq(lists.workspaceId, views.workspaceId), eq(lists.id, views.listId)),
};

/** A view's parent: its object, and its list when it is a list's view (spec 0048). */
export interface ViewParent {
  readonly objectId: string;
  readonly listId: string | null;
}

/** The id a view's group, positions and last opened bookmark are keyed by: its list's, else its object's. */
export const parentIdOf = (parent: ViewParent): string => parent.listId ?? parent.objectId;

/** The change a view write records: its list's views, else its object's. */
export const viewChange = (viewId: string, parent: ViewParent) =>
  parent.listId === null
    ? { viewId, objectId: parent.objectId }
    : { viewId, objectId: parent.objectId, listId: parent.listId };

/**
 * The attributes a view may name: its object's, and for a list's view the
 * list's own too (spec 0048, AC-4807), by id.
 */
export async function parentAttributes(
  tx: WorkspaceTx,
  parent: ViewParent,
): Promise<ReadonlyMap<string, AttributeDef>> {
  const own = await loadAttributes(tx, parent.objectId);
  if (parent.listId === null) return own;
  return new Map([...(await loadListAttributes(tx, parent.listId)), ...own]);
}

/**
 * Refuses `NOT_FOUND` (with `message`) unless the caller may read the list a
 * view belongs to: live, and its object readable (decision 2).
 */
export async function checkViewList(
  tx: WorkspaceTx,
  scope: EngineScope,
  listId: string,
  message: string,
): Promise<{
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly defaultViewId: string | null;
}> {
  const [list] = await tx
    .select({
      id: lists.id,
      objectId: lists.objectId,
      name: lists.name,
      defaultViewId: lists.defaultViewId,
      archivedAt: lists.archivedAt,
      objectArchivedAt: objects.archivedAt,
    })
    .from(lists)
    .innerJoin(objects, and(eq(objects.workspaceId, lists.workspaceId), eq(objects.id, lists.objectId)))
    .where(and(eq(lists.workspaceId, scope.workspaceId), eq(lists.id, listId)));
  if (list === undefined || list.archivedAt !== null || list.objectArchivedAt !== null) {
    throw refuse('NOT_FOUND', message);
  }
  checkList(scope.access, list, 'read', message);
  return list;
}

/** One view row as the reads select it, with its object's default view. */
export interface ViewRow {
  readonly id: string;
  readonly objectId: string | null;
  /** A list's view (spec 0048): its list; `objectId` is then the list's object. */
  readonly listId: string | null;
  readonly name: string;
  readonly kind: 'table' | 'board';
  readonly visibility: 'private' | 'workspace';
  readonly creatorMemberId: string | null;
  readonly position: number;
  readonly config: unknown;
  readonly version: number;
  readonly queryVersion: number;
  readonly querySavedAt: Date | null;
  readonly querySavedByMemberId: string | null;
  readonly isLocked: boolean;
  readonly lockedByMemberId: string | null;
  readonly defaultViewId: string | null;
}

/** The caller's member id, when a member calls (an API key sees shared views only). */
export const memberOf = (scope: EngineScope): string | undefined =>
  scope.actor.type === 'member' && scope.actor.id !== null ? scope.actor.id : undefined;

/** Whether the caller sees a view by who made it: shared, or their own private one (spec 0020, the rules table). */
export function seesView(caller: string | undefined, view: Pick<ViewRow, 'visibility' | 'creatorMemberId'>): boolean {
  return view.visibility === 'workspace' || (caller !== undefined && view.creatorMemberId === caller);
}

/**
 * Whether the caller may change what a view runs and shows (save its query;
 * from milestone 2 rename, move, lay out, delete): a private view's creator; on
 * a shared view anyone, unless it is locked, which needs `views.manage`.
 * Answers the refusal's message, or undefined when allowed.
 */
export function editRefusal(
  scope: EngineScope,
  view: Pick<ViewRow, 'visibility' | 'isLocked' | 'creatorMemberId'>,
): string | undefined {
  const reason = viewRule('edit', callerOf(scope), {
    visibility: view.visibility,
    creatorMemberId: view.creatorMemberId ?? undefined,
    isLocked: view.isLocked,
    isDefault: false,
  });
  if (reason === 'locked') return VIEW_LOCKED;
  return reason === undefined ? undefined : VIEW_NOT_FOUND;
}

/** The caller as the view rules see them: their member id, and whether they hold `views.manage`. */
export function callerOf(scope: EngineScope): ViewRuleCaller {
  return { memberId: memberOf(scope), canManage: can(scope.access, 'views.manage') };
}

/** A stored config as it parses, or the default config when it doesn't (a bug, a downgrade): never an error. */
export function configOf(stored: unknown): ViewConfig {
  const parsed = ViewConfig.safeParse(stored);
  return parsed.success ? parsed.data : defaultViewConfig(undefined);
}

/**
 * The config as this caller may see it: columns, card fields, the table's
 * grouping, and filter conditions and sorts naming an attribute hidden from
 * them left out (AC-479). Filter conditions and sorts used to go to them whole,
 * values included: a viewer with Salary hidden was sent "Salary contains
 * senior" (security review, 28 October 2026). Every field the filter names is
 * judged on its own object (`filterShown`). The stored config
 * keeps everything, and a save puts back what the viewer wasn't sent
 * (`mergeFilter`, `mergeSorts`).
 */
function visibleConfig(
  access: Access,
  objectId: string,
  config: ViewConfig,
  filterShown: ReadonlySet<string>,
): ViewConfig {
  if (isOpen(access)) return config;
  const shown = (id: string) => fieldLevel(access, { id, objectId }) !== 'hidden';
  const columns = config.columns.filter((column) => shown(column.attributeId));
  const filter = seenFilter(config.filter, filterShown);
  const sorts = config.sorts.filter((sort) => shown(sort.attributeId));
  // A grouping attribute hidden from them groups nothing for them: their table is one list.
  const { groupBy, filter: _filter, ...rest } = config;
  const kept = { ...rest, sorts, ...(filter === undefined ? {} : { filter }) };
  const grouped = groupBy !== undefined && shown(groupBy) ? { ...kept, groupBy } : kept;
  if (config.board === undefined) return { ...grouped, columns };
  return { ...grouped, columns, board: { ...config.board, cardFields: config.board.cardFields.filter(shown) } };
}

/**
 * The attributes a view's filter names that the caller may see, each judged on its own object: this one's, or the
 * far object a `through` condition reaches. Judging a far field on the view's object instead let one on an object
 * hidden from the caller read as visible. A field gone for good is in neither set: it shows no one anything.
 */
async function filterFieldsShown(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  config: ViewConfig,
): Promise<ReadonlySet<string>> {
  const named = filterAttributeIds(config.filter);
  if (named.length === 0 || isOpen(access)) return new Set(named);
  const found = await loadAttributesById(tx, named);
  return new Set(
    [...found.values()].flatMap((attribute) =>
      // A list's own field follows its list's field rules (spec 0048); the view's read checked the list itself.
      (attribute.listId !== null && attributeVisible(access, attribute)) ||
      (attribute.objectId !== null &&
        objectLevel(access, attribute.objectId) !== 'none' &&
        fieldLevel(access, { id: attribute.id, objectId: attribute.objectId }) !== 'hidden')
        ? [attribute.id]
        : [],
    ),
  );
}

export function summaryOf(row: ViewRow & { readonly objectId: string }): ViewSummary {
  return {
    id: row.id,
    objectId: row.objectId,
    ...(row.listId === null ? {} : { listId: row.listId }),
    name: row.name,
    kind: row.kind,
    visibility: row.visibility,
    position: row.position,
    isDefault: row.defaultViewId === row.id,
    isLocked: row.isLocked,
    ...(row.lockedByMemberId === null ? {} : { lockedBy: row.lockedByMemberId }),
    ...(row.creatorMemberId === null ? {} : { creatorMemberId: row.creatorMemberId }),
    version: row.version,
  };
}

export async function viewOf(
  tx: WorkspaceTx,
  access: Access,
  row: ViewRow & { readonly objectId: string },
): Promise<View> {
  const config = configOf(row.config);
  return {
    ...summaryOf(row),
    config: visibleConfig(access, row.objectId, config, await filterFieldsShown(tx, access, row.objectId, config)),
    queryVersion: row.queryVersion,
    ...(row.querySavedByMemberId === null ? {} : { querySavedBy: row.querySavedByMemberId }),
    ...(row.querySavedAt === null ? {} : { querySavedAt: row.querySavedAt.toISOString() }),
  };
}

export const onObject = (row: ViewRow): row is ViewRow & { readonly objectId: string } => row.objectId !== null;

/**
 * One view the caller may see, read inside `tx` (`for update` when a write
 * changes it), or `NOT_FOUND` with one message for every reason: unknown,
 * another member's private view, on an object they can't see, or on a list
 * (#51).
 */
export async function readView(
  tx: WorkspaceTx,
  scope: EngineScope,
  viewId: string,
  lock: boolean,
): Promise<ViewRow & { readonly objectId: string }> {
  const query = tx
    .select(VIEW_COLUMNS)
    .from(views)
    .leftJoin(objects, viewParents.objects)
    .leftJoin(lists, viewParents.lists)
    .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, viewId)));
  // No key update: it serialises view writers, and never blocks a member_view_state row's key check on it.
  const [row] = lock ? await query.for('no key update', { of: views }) : await query;
  if (row === undefined || !onObject(row) || !seesView(memberOf(scope), row)) {
    throw refuse('NOT_FOUND', VIEW_NOT_FOUND);
  }
  await checkObject(tx, scope.access, row.objectId, 'read', VIEW_NOT_FOUND);
  if (row.listId !== null) await checkViewList(tx, scope, row.listId, VIEW_NOT_FOUND);
  return row;
}

/**
 * An object's views the caller may see, in switcher order: the default view
 * first, then the other shared views by position (then id), then the
 * caller's own private views by position (then id), with the default's id.
 * An object the caller can't see answers `NOT_FOUND` (AC-462, AC-473).
 */
export async function listViews(scope: EngineScope, objectId: string, listId?: string): Promise<ViewsList> {
  const caller = memberOf(scope);
  return inWorkspace(scope, async (tx) => {
    await checkObject(tx, scope.access, objectId, 'read');
    // A list's views (spec 0048): the list must be the object's, live, and readable.
    if (listId !== undefined) {
      const list = await checkViewList(tx, scope, listId, 'That list does not exist.');
      if (list.objectId !== objectId) throw refuse('NOT_FOUND', 'That list does not exist.');
    }
    const parentId = listId ?? objectId;
    // The summaries only: no config (up to 64 kB a view), which the switcher never shows.
    const { config: _config, ...summaryColumns } = VIEW_COLUMNS;
    const rows = await tx
      .select({ ...summaryColumns, config: sql<unknown>`null` })
      .from(views)
      .leftJoin(objects, viewParents.objects)
      .leftJoin(lists, viewParents.lists)
      .where(
        and(
          eq(views.workspaceId, scope.workspaceId),
          // By its parent, so the switcher's index (workspace, parent, visibility, position) answers it.
          eq(views.parentId, parentId),
          isNotNull(listId === undefined ? views.objectId : views.listId),
          caller === undefined
            ? eq(views.visibility, 'workspace')
            : or(eq(views.visibility, 'workspace'), eq(views.creatorMemberId, caller)),
        ),
      )
      .orderBy(
        // The default view, then shared, then private; each by position, then id.
        sql`${views.id} = coalesce(${objects.defaultViewId}, ${lists.defaultViewId}) desc nulls last`,
        sql`${views.visibility} = 'private'`,
        asc(views.position),
        asc(views.id),
      );
    const listed = rows.filter(onObject);
    const defaultViewId = listed.find((row) => row.defaultViewId === row.id)?.id;
    // The member's last opened view of this object (AC-478), only while it is still theirs to see.
    const [state] =
      caller === undefined
        ? []
        : await tx
            .select({ viewId: memberViewState.viewId })
            .from(memberViewState)
            .where(
              and(
                eq(memberViewState.workspaceId, scope.workspaceId),
                eq(memberViewState.memberId, caller),
                eq(memberViewState.parentId, parentId),
              ),
            );
    const lastOpenedViewId = listed.some((row) => row.id === state?.viewId) ? state?.viewId : undefined;
    return {
      views: listed.map(summaryOf),
      ...(defaultViewId === undefined ? {} : { defaultViewId }),
      ...(lastOpenedViewId === undefined ? {} : { lastOpenedViewId }),
    };
  });
}

/** One view whole, as the caller may see it, or `NOT_FOUND` (AC-463). */
export async function getView(scope: EngineScope, viewId: string): Promise<View> {
  return inWorkspace(scope, async (tx) => viewOf(tx, scope.access, await readView(tx, scope, viewId, false)));
}

/** A draft saved as a view's query (AC-468). */
export interface SaveViewQueryInput {
  readonly viewId: string;
  readonly filter?: FilterGroup | undefined;
  readonly sorts: SortRules;
  /** The view's `queryVersion` when the draft began. */
  readonly baseQueryVersion: number;
  /** Replace a query someone else saved since (the dialog's Replace). */
  readonly force?: boolean | undefined;
}

/** The name the clash dialog shows for whoever saved last: their member name, or the workspace for a seeded view. */
async function saverName(tx: WorkspaceTx, memberId: string | null): Promise<string> {
  if (memberId === null) return 'Someone';
  const [row] = await tx.select({ name: members.name }).from(members).where(eq(members.id, memberId));
  return row?.name ?? 'Someone';
}

/**
 * Saves a filter and sorts as the view's, for everyone who sees it (AC-468):
 * `queryVersion` and `version` up by one, with who saved and when, and one
 * `views` outbox row. Refuses `NOT_FOUND` for a view the caller can't see,
 * `FORBIDDEN` on a locked view without `views.manage` (AC-476),
 * `VIEW_CHANGED` when someone saved since `baseQueryVersion` and `force` is
 * not set (AC-469), `FILTER_INVALID` for a filter or sort the object can't
 * run (an attribute not on it, archived, hidden, or not sortable), and
 * `CONFIG_INVALID` past 64 kB. A refused save writes nothing.
 */
/**
 * The object's attributes the caller may see, archived or not (`seeable`), and those of them not archived (`live`):
 * what `mergeFilter` tells apart, since an archived condition the saver can see may go with a new filter (AC-480)
 * while a hidden one may not.
 */
async function filterIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  parent: ViewParent,
  stored: ViewConfig['filter'],
): Promise<{ readonly seeable: ReadonlySet<string>; readonly live: ReadonlySet<string> }> {
  const own = await parentAttributes(tx, parent);
  // The far fields a `through` condition reaches live on other objects: each is judged on its own object, so one
  // hidden from the saver, or on an object they can't read, is unseen however visible the relation leading to it.
  const farIds = filterAttributeIds(stored).filter((id) => !own.has(id));
  const far = farIds.length === 0 ? new Map<string, AttributeDef>() : await loadAttributesById(tx, farIds);
  const attributes = [...own.values(), ...far.values()].filter(
    (attribute) =>
      // The view's own list's fields, as its field rules show them (spec 0048).
      (attribute.listId !== null && attribute.listId === parent.listId && attributeVisible(scope.access, attribute)) ||
      (attribute.objectId !== null &&
        objectLevel(scope.access, attribute.objectId) !== 'none' &&
        fieldLevel(scope.access, { id: attribute.id, objectId: attribute.objectId }) !== 'hidden'),
  );
  // A field gone for good (its object's deleted, the attribute purged) is no one's to protect: it may go like an
  // archived one, rather than refuse every later edit of the filter.
  const gone = farIds.filter((id) => !far.has(id));
  return {
    seeable: new Set([...attributes.map((attribute) => attribute.id), ...gone]),
    live: new Set(attributes.flatMap((attribute) => (isArchivedNow(attribute) ? [] : [attribute.id]))),
  };
}

export async function saveViewQuery(
  scope: EngineScope,
  input: SaveViewQueryInput,
  hooks: readonly AfterWrite[] = [],
): Promise<View> {
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readView(tx, scope, input.viewId, true);
      const refusal = editRefusal(scope, row);
      if (refusal !== undefined) throw refuse(refusal === VIEW_LOCKED ? 'FORBIDDEN' : 'NOT_FOUND', refusal);
      if (input.force !== true && input.baseQueryVersion !== row.queryVersion) {
        const name = await saverName(tx, row.querySavedByMemberId);
        throw refuse('VIEW_CHANGED', `${name} changed this view’s filters since you started.`);
      }
      const sent = input.filter === undefined || input.filter.conditions.length === 0 ? undefined : input.filter;
      // A condition on a field the saver can't see never reached their screen, so what they send back leaves it
      // out. Writing that would delete it for everyone, for good (27 October 2026): one flipped sort was enough.
      const ids = await filterIds(tx, scope, row, configOf(row.config).filter);
      const merged = mergeFilter(configOf(row.config).filter, sent, ids);
      if (merged.kind === 'blocked') {
        throw refuse(
          'FORBIDDEN',
          'This view also filters on a field you can’t see, so its filter can’t be changed here. Ask an admin who can see it, or change the sorting instead.',
        );
      }
      // Only what they sent is checked: a condition put back was checked when it was stored, and compiling it
      // under this saver's access would refuse the very field they can't see.
      await checkViewQuery(tx, scope, {
        ...(row.listId === null ? { objectId: row.objectId } : { listId: row.listId }),
        ...(sent === undefined ? {} : { filter: sent }),
        sorts: input.sorts,
      });
      const filter = merged.filter;
      const { filter: _previous, ...rest } = configOf(row.config);
      // A sort on an archived or hidden field is kept through a save that left the sorts alone (AC-480).
      const sorts = mergeSorts(rest.sorts, input.sorts, ids.live);
      const config = ViewConfig.safeParse({ ...rest, ...(filter === undefined ? {} : { filter }), sorts });
      if (!config.success) throw refuse('CONFIG_INVALID', 'This view’s settings are not valid.');
      if (new TextEncoder().encode(JSON.stringify(config.data)).length > MAX_VIEW_CONFIG_BYTES) {
        throw refuse('CONFIG_INVALID', 'This view has too many settings to save.');
      }
      const saver = scope.actor.type === 'member' ? scope.actor.id : null;
      try {
        await tx
          .update(views)
          .set({
            config: config.data,
            version: sql`${views.version} + 1`,
            queryVersion: sql`${views.queryVersion} + 1`,
            querySavedAt: sql`now()`,
            querySavedByMemberId: saver,
            ...touched(scope),
          })
          .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, row.id)));
      } catch (error) {
        // The database measures the stored text, a little longer than the compact JSON checked above.
        const pg = postgresError(error);
        if (pg?.code === '23514' && pg.constraint === 'views_config') {
          throw refuse('CONFIG_INVALID', 'This view has too many settings to save.');
        }
        throw error;
      }
      context.record({ views: [viewChange(row.id, row)] });
      return viewOf(tx, scope.access, await readView(tx, scope, row.id, false));
    },
    hooks,
  );
  return result;
}
