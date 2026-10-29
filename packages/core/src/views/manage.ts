// Saved views (spec 0020, milestone 2): making, renaming, sharing, laying
// out, moving, locking, choosing the default, deleting, and the view each
// member last opened. Who may do what is one pure rule (`viewRule`, in
// `@crm/contracts/views`, which the view menu disables by too); the refusals
// here word its reasons. Every write but `markViewOpened` runs inside
// `runWrite` and records the views it touched in `Change.views`, so
// `outboxHook` stores their `views` rows in the same transaction. Writes that
// change a group's positions, a count or the default take the object's row
// lock first, then the view's.
import { and, count, eq, sql } from 'drizzle-orm';
import {
  MAX_VIEW_CONFIG_BYTES,
  PERMISSIONS,
  ViewConfig,
  type View,
  type ViewKind,
  type ViewLayout,
  type ViewSummary,
  type ViewVisibility,
} from '@crm/contracts';
import { boardConfigProblem, isGroupable, type BoardAttribute, type BoardSettings } from '@crm/contracts/board';
import { mergeLayout, viewRule, type ViewAction, type ViewRuleReason } from '@crm/contracts/views';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { checkId, isUuidV7 } from '../engine/ids.ts';
import { limitsOf } from '../engine/limits.ts';
import { checkViewQuery } from '../engine/query/page.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { loadAttributes } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';
import { requirePermission } from '../access/check.ts';
import { fieldLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkObject } from '../access/visibility.ts';
import { deleteViewRecents } from '../search/recents.ts';
import {
  configOf,
  callerOf,
  listViews,
  memberOf,
  readView,
  VIEW_LOCKED,
  VIEW_NOT_FOUND,
  viewOf,
  type ViewRow,
} from './views.ts';

const { memberViewState, members, objects, views } = schema;

/**
 * Takes a share lock on the caller's own member row and refuses when they are
 * no longer active: a private view or a bookmark written while their removal
 * runs waits for it, then is refused, so the removal leaves nothing of theirs
 * (AC-490).
 */
async function stillMember(tx: WorkspaceTx, scope: EngineScope, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ status: members.status })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId)))
    .for('share');
  if (row?.status !== 'active') throw refuse('FORBIDDEN', 'You are no longer a member of this workspace.');
}

/** A view row as the reads give it, on an object. */
type ObjectViewRow = ViewRow & { readonly objectId: string };

/** The object a view write is about, read under its row lock: its plural name and its default view. */
interface LockedObject {
  readonly id: string;
  readonly pluralName: string;
  readonly defaultViewId: string | null;
}

/**
 * Takes the object's row lock for the rest of the write (creates, moves,
 * visibility changes and the default take turns on it), or `NOT_FOUND` for
 * an object that doesn't exist, is archived, or the caller can't see.
 */
async function lockObject(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  message: string,
): Promise<LockedObject> {
  const [row] = await tx
    .select({
      id: objects.id,
      pluralName: objects.pluralName,
      defaultViewId: objects.defaultViewId,
      archivedAt: objects.archivedAt,
    })
    .from(objects)
    .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId)))
    // No key update: view writers take turns, while record writes' key checks on the object never wait.
    .for('no key update');
  if (row === undefined || row.archivedAt !== null) throw refuse('NOT_FOUND', message);
  await checkObject(tx, scope.access, row.id, 'read', message);
  return row;
}

/** The view rules' reason for an action, worded as the refusal the API answers. */
function refusalFor(reason: ViewRuleReason, action: ViewAction, pluralName: string): Error {
  switch (reason) {
    case 'locked':
      return refuse('FORBIDDEN', VIEW_LOCKED);
    case 'notCreator':
      return action === 'makePrivate'
        ? refuse('FORBIDDEN', 'Only the view’s creator can make it private.')
        : refuse('NOT_FOUND', VIEW_NOT_FOUND);
    case 'default':
      return action === 'delete'
        ? refuse('VIEW_IS_DEFAULT', `This is the default view for ${pluralName}. Make another view the default first.`)
        : refuse('VIEW_IS_DEFAULT', 'The default view is shared with everyone.');
    case 'defaultFirst':
      return refuse('CONFIG_INVALID', 'The default view is always first.');
    case 'seeded':
      return refuse('FORBIDDEN', 'This view was made by the workspace, so it stays shared.');
    case 'creatorGone':
      return refuse('FORBIDDEN', 'This view’s creator has left the workspace.');
    case 'unlockFirst':
      return refuse('FORBIDDEN', 'This view is locked. Unlock it first.');
    case 'private':
      return action === 'lock'
        ? refuse('CONFIG_INVALID', 'A private view can’t be locked.')
        : refuse('CONFIG_INVALID', 'The default view must be shared with everyone.');
    case 'manage':
      return refuse('FORBIDDEN', PERMISSIONS['views.manage'].message);
    case 'already':
      return refuse('CONFIG_INVALID', 'Nothing to change.');
  }
}

/** Refuses `action` on `row` unless the view rules allow it; answers whether there is anything to do. */
function check(scope: EngineScope, action: ViewAction, row: ObjectViewRow, pluralName = 'this object'): boolean {
  const reason = viewRule(action, callerOf(scope), {
    visibility: row.visibility,
    creatorMemberId: row.creatorMemberId ?? undefined,
    isLocked: row.isLocked,
    isDefault: row.defaultViewId === row.id,
  });
  if (reason === 'already') return false;
  if (reason !== undefined) throw refusalFor(reason, action, pluralName);
  return true;
}

/** Runs a write that may clash on a view name: either unique index answers `NAME_TAKEN` on `name`. */
async function nameGuard<T>(pluralName: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'views_shared_name') {
      throw refuseOn('NAME_TAKEN', `A shared view with this name exists on ${pluralName}.`, 'name');
    }
    if (pg?.code === '23505' && pg.constraint === 'views_private_name') {
      throw refuseOn('NAME_TAKEN', 'You already have a view with this name.', 'name');
    }
    if (pg?.code === '23514' && pg.constraint === 'views_config') {
      throw refuse('CONFIG_INVALID', 'This view has too many settings to save.');
    }
    throw error;
  }
}

/** The group a view sits in: the object's shared views, or one member's private ones. */
function groupOf(scope: EngineScope, objectId: string, visibility: ViewVisibility, creator: string | null) {
  return and(
    eq(views.workspaceId, scope.workspaceId),
    eq(views.parentId, objectId),
    eq(views.visibility, visibility),
    ...(visibility === 'private' && creator !== null ? [eq(views.creatorMemberId, creator)] : []),
  );
}

/**
 * Refuses a group that is full, then answers the position after its last
 * (`LIMIT_REACHED` past 100 shared views on an object, or 50 private views
 * of one member on it). Read under the object's row lock.
 */
async function nextPosition(
  tx: WorkspaceTx,
  scope: EngineScope,
  object: LockedObject,
  visibility: ViewVisibility,
  creator: string | null,
): Promise<number> {
  const [row] = await tx
    .select({ count: count(), last: sql<number | null>`max(${views.position})::int` })
    .from(views)
    .where(groupOf(scope, object.id, visibility, creator));
  const limits = limitsOf(scope);
  const held = row?.count ?? 0;
  if (visibility === 'workspace' && held >= limits.sharedViewsPerObject) {
    throw refuse(
      'LIMIT_REACHED',
      `There can be at most ${String(limits.sharedViewsPerObject)} shared views on ${object.pluralName}. Delete one first.`,
    );
  }
  if (visibility === 'private' && held >= limits.privateViewsPerObject) {
    throw refuse(
      'LIMIT_REACHED',
      `You can keep at most ${String(limits.privateViewsPerObject)} private views on ${object.pluralName}. Delete one first.`,
    );
  }
  return row?.last === null || row?.last === undefined ? (visibility === 'workspace' ? 1 : 0) : row.last + 1;
}

/** The ids of the object's attributes this caller sees, live ones only unless `archived` too. */
async function visibleAttributeIds(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
): Promise<{ readonly live: ReadonlySet<string>; readonly any: ReadonlySet<string> }> {
  const all = [...(await loadAttributes(tx, objectId)).values()].filter(
    (attribute) => fieldLevel(scope.access, { id: attribute.id, objectId }) !== 'hidden',
  );
  return {
    live: new Set(
      all.filter((attribute) => attribute.archivedAt === null && attribute.archivedBy === null).map((a) => a.id),
    ),
    any: new Set(all.map((attribute) => attribute.id)),
  };
}

/** Refuses a layout naming an attribute that isn't one of the object's the caller sees (`CONFIG_INVALID`). */
function checkLayoutIds(
  layout: Pick<ViewLayout, 'columns' | 'board' | 'groupBy'>,
  visible: ReadonlySet<string>,
  pluralName: string,
): void {
  const ids = [
    ...layout.columns.map((column) => column.attributeId),
    ...(layout.board === undefined ? [] : [layout.board.groupByAttributeId, ...layout.board.cardFields]),
    ...(typeof layout.groupBy === 'string' ? [layout.groupBy] : []),
  ];
  if (ids.some((id) => !visible.has(id.toLowerCase()))) {
    throw refuse('CONFIG_INVALID', `That attribute isn’t on ${pluralName}.`);
  }
}

/**
 * Refuses board settings a board can't show (spec 0021, `boardConfigProblem`,
 * `CONFIG_INVALID`): grouped by anything but a live status or single select
 * of the object, more than 6 card fields, one twice, or the primary one. It
 * judges what the caller sent against the attributes they see.
 */
async function checkBoard(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  board: BoardSettings | undefined,
): Promise<void> {
  if (board === undefined) return;
  const problem = boardConfigProblem(board, await boardAttributes(tx, scope, objectId));
  if (problem !== undefined) throw refuse('CONFIG_INVALID', problem);
}

/** Refuses a table grouped by anything but a live status or single select of the object (`CONFIG_INVALID`). */
async function checkGroupBy(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  groupBy: string | null | undefined,
): Promise<void> {
  if (typeof groupBy !== 'string') return;
  const attribute = (await boardAttributes(tx, scope, objectId)).find((each) => each.id === groupBy.toLowerCase());
  if (attribute === undefined || !isGroupable(attribute)) {
    throw refuse('CONFIG_INVALID', 'Tables group by a status or single select field.');
  }
}

/** The object's attributes the caller sees, as the board rules read them. */
async function boardAttributes(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<BoardAttribute[]> {
  const [object] = await tx
    .select({ primaryAttributeId: objects.primaryAttributeId })
    .from(objects)
    .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId)));
  return [...(await loadAttributes(tx, objectId)).values()]
    .filter((attribute) => fieldLevel(scope.access, { id: attribute.id, objectId }) !== 'hidden')
    .map((attribute) => ({
      id: attribute.id,
      type: attribute.type,
      isMulti: attribute.isMulti,
      isSystem: attribute.isSystem,
      isPrimary: attribute.id === object?.primaryAttributeId,
      isArchived: attribute.archivedAt !== null || attribute.archivedBy !== null,
      position: attribute.position,
    }));
}

/** A layout with every attribute id in its canonical (lower case) spelling, so stored ids match the attributes'. */
function canonicalLayout<L extends Pick<ViewLayout, 'columns' | 'board' | 'groupBy'>>(layout: L): L {
  return {
    ...layout,
    ...(typeof layout.groupBy === 'string' ? { groupBy: layout.groupBy.toLowerCase() } : {}),
    columns: layout.columns.map((column) => ({ ...column, attributeId: column.attributeId.toLowerCase() })),
    ...(layout.board === undefined
      ? {}
      : {
          board: {
            ...layout.board,
            groupByAttributeId: layout.board.groupByAttributeId.toLowerCase(),
            cardFields: layout.board.cardFields.map((id) => id.toLowerCase()),
          },
        }),
  };
}

/** Refuses a config past 64 kB, serialised. */
function checkSize(config: ViewConfig): void {
  if (new TextEncoder().encode(JSON.stringify(config)).length > MAX_VIEW_CONFIG_BYTES) {
    throw refuse('CONFIG_INVALID', 'This view has too many settings to save.');
  }
}

/** An object's plural name, for a refusal's words. */
async function pluralOf(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<string> {
  const [object] = await tx
    .select({ pluralName: objects.pluralName })
    .from(objects)
    .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId)));
  return object?.pluralName ?? 'this object';
}

/** One view as it reads now, inside the write. */
const reread = async (tx: WorkspaceTx, scope: EngineScope, viewId: string): Promise<View> =>
  viewOf(tx, scope.access, await readView(tx, scope, viewId, false));

/** A new view (AC-472). */
export interface CreateViewInput {
  /** The UUID v7 the browser minted once per dialog: the retry key. */
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly kind: ViewKind;
  readonly visibility: ViewVisibility;
  readonly config: ViewConfig;
}

/**
 * Makes a view on an object the caller may read (AC-472), at the end of its
 * group, and answers it. The same create again (same id, object and creator)
 * answers the view already made and writes nothing; the id held by anything
 * else answers `ID_TAKEN`. Refuses `NAME_TAKEN` on `name` (a shared name on
 * the object, or a private name of the caller's, ignoring case),
 * `LIMIT_REACHED`, `CONFIG_INVALID` (an attribute not on the object, or past
 * 64 kB) and `FILTER_INVALID`. Only a member makes a private view.
 */
export async function createView(
  scope: EngineScope,
  input: CreateViewInput,
  hooks: readonly AfterWrite[] = [],
): Promise<View> {
  const caller = memberOf(scope);
  const objectId = checkId(input.objectId, 'That object does not exist.');
  if (!isUuidV7(input.id)) throw refuse('CONFIG_INVALID', 'The view id must be a UUID v7.');
  const id = input.id.toLowerCase();
  const name = input.name.trim();
  if (name.length === 0 || name.length > 100) {
    throw refuseOn('CONFIG_INVALID', 'A view name is 1 to 100 characters.', 'name');
  }
  if (input.visibility === 'private' && caller === undefined) {
    throw refuse('FORBIDDEN', 'Only a member can keep a private view.');
  }
  const config = ViewConfig.safeParse(canonicalLayout(input.config));
  if (!config.success) throw refuse('CONFIG_INVALID', 'This view’s settings are not valid.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const object = await lockObject(tx, scope, objectId, 'That object does not exist.');
      // A replay is found under the object's lock, before the count would see it twice.
      const [earlier] = await tx
        .select({ objectId: views.objectId, creatorMemberId: views.creatorMemberId, createdById: views.createdById })
        .from(views)
        .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, id)));
      if (earlier !== undefined) {
        const isOwnTry = earlier.objectId === object.id && earlier.createdById === (scope.actor.id ?? null);
        if (!isOwnTry) throw refuse('ID_TAKEN', 'A view with that id already exists.');
        return { view: await reread(tx, scope, id), replayed: true };
      }
      const visible = await visibleAttributeIds(tx, scope, object.id);
      checkLayoutIds(config.data, visible.any, object.pluralName);
      await checkBoard(tx, scope, object.id, config.data.board);
      await checkGroupBy(tx, scope, object.id, config.data.groupBy);
      const filter =
        config.data.filter === undefined || config.data.filter.conditions.length === 0 ? undefined : config.data.filter;
      await checkViewQuery(tx, scope, {
        objectId: object.id,
        ...(filter === undefined ? {} : { filter }),
        sorts: config.data.sorts,
      });
      const { filter: _filter, ...rest } = config.data;
      const stored: ViewConfig = { ...rest, ...(filter === undefined ? {} : { filter }) };
      checkSize(stored);
      const creator = caller ?? null;
      if (input.visibility === 'private' && creator !== null) await stillMember(tx, scope, creator);
      const position = await nextPosition(tx, scope, object, input.visibility, creator);
      const by = touched(scope);
      await nameGuard(object.pluralName, () =>
        tx.insert(views).values({
          workspaceId: scope.workspaceId,
          id,
          objectId: object.id,
          name,
          kind: input.kind,
          visibility: input.visibility,
          creatorMemberId: creator,
          position,
          config: stored,
          querySavedAt: sql`now()`,
          querySavedByMemberId: creator,
          createdByType: by.updatedByType,
          createdById: by.updatedById,
          createdByMemberId: by.updatedByMemberId,
          updatedByType: by.updatedByType,
          updatedById: by.updatedById,
          updatedByMemberId: by.updatedByMemberId,
        }),
      );
      context.record({ views: [{ viewId: id, objectId: object.id }] });
      return { view: await reread(tx, scope, id), replayed: false };
    },
    hooks,
  );
  return result.view;
}

/** A rename, or a change of who sees a view. */
export interface UpdateViewInput {
  readonly viewId: string;
  readonly name?: string | undefined;
  readonly visibility?: ViewVisibility | undefined;
}

/**
 * Renames a view, or changes who sees it (AC-477): Share with everyone (a
 * private view, its creator) or Make private (a shared view, its creator,
 * never the default or a seeded view, unlocked). A view that changes group
 * takes the position after that group's last. Refuses `FORBIDDEN` (a locked
 * view, or someone else's to make private), `NAME_TAKEN` on `name`,
 * `VIEW_IS_DEFAULT` (making the default private) and `LIMIT_REACHED`.
 */
export async function updateView(
  scope: EngineScope,
  input: UpdateViewInput,
  hooks: readonly AfterWrite[] = [],
): Promise<View> {
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  const name = input.name?.trim();
  if (name !== undefined && (name.length === 0 || name.length > 100)) {
    throw refuseOn('CONFIG_INVALID', 'A view name is 1 to 100 characters.', 'name');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const found = await readView(tx, scope, viewId, false);
      const object = await lockObject(tx, scope, found.objectId, VIEW_NOT_FOUND);
      const row = await readView(tx, scope, viewId, true);
      const changes: { name?: string; visibility?: ViewVisibility; position?: number } = {};
      if (name !== undefined && name !== row.name) {
        check(scope, 'edit', row, object.pluralName);
        changes.name = name;
      }
      if (input.visibility !== undefined && input.visibility !== row.visibility) {
        check(scope, input.visibility === 'workspace' ? 'share' : 'makePrivate', row, object.pluralName);
        changes.visibility = input.visibility;
        changes.position = await nextPosition(tx, scope, object, input.visibility, row.creatorMemberId);
      }
      if (Object.keys(changes).length === 0) return viewOf(tx, scope.access, row);
      await nameGuard(object.pluralName, () =>
        tx
          .update(views)
          .set({ ...changes, version: sql`${views.version} + 1`, ...touched(scope) })
          .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, row.id))),
      );
      context.record({ views: [{ viewId: row.id, objectId: row.objectId }] });
      return reread(tx, scope, row.id);
    },
    hooks,
  );
  return result;
}

/**
 * Saves a view's columns, pinned count and board settings at once, for
 * everyone on it (AC-470): last save wins, no version check. Columns the
 * caller can't see (or that are archived) stay where they were
 * (`mergeLayout`, AC-479). Refuses `FORBIDDEN` on a locked view without
 * `views.manage` (AC-476) and `CONFIG_INVALID` for an attribute not on the
 * object.
 */
export async function setViewLayout(
  scope: EngineScope,
  input: { readonly viewId: string; readonly layout: ViewLayout },
  hooks: readonly AfterWrite[] = [],
): Promise<View> {
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readView(tx, scope, viewId, true);
      check(scope, 'edit', row);
      const layout = canonicalLayout(input.layout);
      const visible = await visibleAttributeIds(tx, scope, row.objectId);
      const pluralName = await pluralOf(tx, scope, row.objectId);
      checkLayoutIds(layout, visible.any, pluralName);
      await checkBoard(tx, scope, row.objectId, layout.board);
      await checkGroupBy(tx, scope, row.objectId, layout.groupBy);
      const stored = configOf(row.config);
      const merged = mergeLayout(stored.columns, layout, visible.live);
      const board =
        layout.board === undefined
          ? stored.board
          : {
              ...layout.board,
              // Card fields the caller can't see stay, after theirs; theirs give way to keep them (at most 6).
              cardFields: (() => {
                const kept = (stored.board?.cardFields ?? []).filter((id) => !visible.live.has(id));
                return [...layout.board.cardFields.slice(0, Math.max(0, 6 - kept.length)), ...kept];
              })(),
            };
      // A grouping hidden from the caller stays when they change the layout; `null` clears it, a new one replaces it.
      const { groupBy: storedGroupBy, ...unGrouped } = stored;
      const groupBy =
        layout.groupBy === undefined
          ? storedGroupBy
          : layout.groupBy === null
            ? storedGroupBy !== undefined && !visible.any.has(storedGroupBy)
              ? storedGroupBy
              : undefined
            : layout.groupBy;
      const next = ViewConfig.safeParse({
        ...unGrouped,
        columns: merged.columns,
        pinnedCount: merged.pinnedCount,
        ...(board === undefined ? {} : { board }),
        ...(groupBy === undefined ? {} : { groupBy }),
      });
      if (!next.success) throw refuse('CONFIG_INVALID', 'This view’s settings are not valid.');
      checkSize(next.data);
      await nameGuard(pluralName, () =>
        tx
          .update(views)
          .set({
            config: next.data,
            ...(layout.kind === undefined ? {} : { kind: layout.kind }),
            version: sql`${views.version} + 1`,
            ...touched(scope),
          })
          .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, row.id))),
      );
      context.record({ views: [{ viewId: row.id, objectId: row.objectId }] });
      return reread(tx, scope, row.id);
    },
    hooks,
  );
  return result;
}

/**
 * Swaps a view with its neighbour in its group (AC-477): the shared views
 * (the default never moves, nor is a neighbour) or the caller's private
 * ones, in switcher order, under the object's row lock. Already first or last,
 * or the default view, changes nothing. Answers the object's views in the new order.
 */
export async function moveView(
  scope: EngineScope,
  input: { readonly viewId: string; readonly direction: 'up' | 'down' },
  hooks: readonly AfterWrite[] = [],
): Promise<ViewSummary[]> {
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  const { result: objectId } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const found = await readView(tx, scope, viewId, false);
      const object = await lockObject(tx, scope, found.objectId, VIEW_NOT_FOUND);
      const row = await readView(tx, scope, viewId, true);
      // The default view always sits first: moving it changes nothing.
      if (row.id === object.defaultViewId) return object.id;
      check(scope, 'move', row, object.pluralName);
      const group = (
        await tx
          .select({ id: views.id, position: views.position })
          .from(views)
          .where(groupOf(scope, object.id, row.visibility, row.creatorMemberId))
          .orderBy(views.position, views.id)
      ).filter((each) => each.id !== object.defaultViewId);
      const at = group.findIndex((each) => each.id === row.id);
      const other = group[input.direction === 'up' ? at - 1 : at + 1];
      if (at === -1 || other === undefined) return object.id;
      const mine = group[at];
      if (mine === undefined) return object.id;
      // The two swap positions. Only when they share one (rows seeded alike) is the group numbered afresh, in one
      // statement, so a move costs two row writes however long the group is.
      const moves: { readonly id: string; readonly position: number }[] =
        mine.position !== other.position
          ? [
              { id: mine.id, position: other.position },
              { id: other.id, position: mine.position },
            ]
          : (() => {
              const order = group.map((each) => each.id);
              order[at] = other.id;
              order[input.direction === 'up' ? at - 1 : at + 1] = row.id;
              const start = row.visibility === 'workspace' ? 1 : 0;
              return order
                .map((id, index) => ({ id, position: start + index }))
                .filter((move) => group.find((each) => each.id === move.id)?.position !== move.position);
            })();
      const values = sql.join(
        moves.map((move) => sql`(${move.id}::uuid, ${move.position}::int)`),
        sql`, `,
      );
      // Only the two that swapped move a version; a renumbered neighbour keeps its body.
      await tx.execute(sql`
        update ${views} set position = moved.position,
          version = ${views.version} + case when ${views.id} in (${mine.id}::uuid, ${other.id}::uuid) then 1 else 0 end
        from (values ${values}) as moved(id, position)
        where ${views.workspaceId} = ${scope.workspaceId} and ${views.id} = moved.id`);
      const changed = [mine.id, other.id];
      context.record({ views: changed.map((id) => ({ viewId: id, objectId: object.id })) });
      return object.id;
    },
    hooks,
  );
  return [...(await listViews(scope, objectId)).views];
}

/**
 * Locks or unlocks a shared view (AC-475): `views.manage` only; a private
 * view can't be locked (`CONFIG_INVALID`). The locker is kept for the view
 * bar's "Locked by <Name>". Answers the view.
 */
export async function setViewLocked(
  scope: EngineScope,
  input: { readonly viewId: string; readonly locked: boolean },
  hooks: readonly AfterWrite[] = [],
): Promise<View> {
  requirePermission(scope, 'views.manage');
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const row = await readView(tx, scope, viewId, true);
      check(scope, 'lock', row);
      if (row.isLocked === input.locked) return viewOf(tx, scope.access, row);
      await tx
        .update(views)
        .set({
          isLocked: input.locked,
          lockedByMemberId: input.locked ? (memberOf(scope) ?? null) : null,
          lockedAt: input.locked ? sql`now()` : null,
          version: sql`${views.version} + 1`,
          ...touched(scope),
        })
        .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, row.id)));
      context.record({ views: [{ viewId: row.id, objectId: row.objectId }] });
      return reread(tx, scope, row.id);
    },
    hooks,
  );
  return result;
}

/**
 * Makes a shared view its object's default (AC-475): `views.manage` only;
 * a private view can't be the default (`CONFIG_INVALID`). The old default and
 * the new one both move a version, so every switcher reads them again.
 * Answers the object's views in the new order.
 */
export async function setDefaultView(
  scope: EngineScope,
  input: { readonly objectId: string; readonly viewId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<ViewSummary[]> {
  requirePermission(scope, 'views.manage');
  const objectId = checkId(input.objectId, VIEW_NOT_FOUND);
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const object = await lockObject(tx, scope, objectId, VIEW_NOT_FOUND);
      const row = await readView(tx, scope, viewId, true);
      if (row.objectId !== object.id) throw refuse('NOT_FOUND', VIEW_NOT_FOUND);
      if (!check(scope, 'setDefault', row, object.pluralName)) return;
      await tx
        .update(objects)
        .set({ defaultViewId: row.id })
        .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, object.id)));
      const touchedIds = [row.id, ...(object.defaultViewId === null ? [] : [object.defaultViewId])];
      for (const id of touchedIds) {
        await tx
          .update(views)
          .set({ version: sql`${views.version} + 1`, ...touched(scope) })
          .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, id)));
      }
      context.record({ views: touchedIds.map((id) => ({ viewId: id, objectId: object.id })) });
    },
    hooks,
  );
  return [...(await listViews(scope, objectId)).views];
}

/**
 * Deletes a view for good (AC-474), with its members' last opened rows
 * (cascade): views are settings, with no trash. Refuses `VIEW_IS_DEFAULT`
 * for the object's default view and `FORBIDDEN` on a locked view without
 * `views.manage`.
 */
export async function deleteView(
  scope: EngineScope,
  input: { readonly viewId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly deleted: true }> {
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      // The object first, then the view (the one lock order): a default set meanwhile is seen, never a stale one.
      const found = await readView(tx, scope, viewId, false);
      const object = await lockObject(tx, scope, found.objectId, VIEW_NOT_FOUND);
      const row = await readView(tx, scope, viewId, true);
      check(scope, 'delete', row, object.pluralName);
      await tx.delete(views).where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, row.id)));
      // It leaves everyone's recent items too (spec 0039, AC-1092).
      await deleteViewRecents(tx, scope, row.id);
      context.record({ views: [{ viewId: row.id, objectId: row.objectId }] });
    },
    hooks,
  );
  return { deleted: true };
}

/**
 * Keeps the view the caller just opened as their last one for its object
 * (AC-478), so another browser opens the same. The member's own bookmark: no
 * outbox row, and nothing for an API key. `NOT_FOUND` for a view they can't
 * see.
 */
export async function markViewOpened(scope: EngineScope, input: { readonly viewId: string }): Promise<void> {
  const viewId = checkId(input.viewId, VIEW_NOT_FOUND);
  const caller = memberOf(scope);
  await inWorkspace(scope, async (tx) => {
    const row = await readView(tx, scope, viewId, false);
    if (caller === undefined) return;
    await stillMember(tx, scope, caller);
    await tx
      .insert(memberViewState)
      .values({ workspaceId: scope.workspaceId, memberId: caller, parentId: row.objectId, viewId: row.id })
      .onConflictDoUpdate({
        target: [memberViewState.workspaceId, memberViewState.memberId, memberViewState.parentId],
        set: { viewId: row.id, openedAt: sql`now()` },
      });
  });
}

/**
 * Inside a member's removal (spec 0009's `removeMember`, AC-490): deletes
 * their private views and their last opened rows, and records the deleted
 * views in `Change.views`, so the removal stores their `views` rows. Their
 * shared views stay, still naming them.
 */
export async function deleteMemberViews(context: WriteContext, memberId: string): Promise<void> {
  const { tx, scope } = context;
  await tx
    .delete(memberViewState)
    .where(and(eq(memberViewState.workspaceId, scope.workspaceId), eq(memberViewState.memberId, memberId)));
  const deleted = await tx
    .delete(views)
    .where(
      and(
        eq(views.workspaceId, scope.workspaceId),
        eq(views.creatorMemberId, memberId),
        eq(views.visibility, 'private'),
      ),
    )
    .returning({ id: views.id, objectId: views.objectId });
  const onObjects = deleted.flatMap((row) =>
    row.objectId === null ? [] : [{ viewId: row.id, objectId: row.objectId }],
  );
  if (onObjects.length > 0) context.record({ views: onObjects });
}

/**
 * The views' part of a removal (spec 0031, AC-814; spec 0037, AC-1440): their
 * private views and last opened rows go; their shared views stay, still
 * naming them as creator, locker and saver (history).
 */
export const viewsRemoval: RemovalEffect = {
  feature: 'views',
  constraints: ['views_creator', 'member_view_state_member'],
  run: deleteMemberViews,
};
