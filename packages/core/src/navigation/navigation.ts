// The sidebar (spec 0034): each member's own choices for it in a workspace,
// stored in one `member_nav_prefs` row, read resolved through the access door
// (`readNav`) and changed one operation at a time under the row's lock
// (`changeNav`). The order, hiding and starring rules are the pure
// `applyNavOp` from `@crm/contracts/navigation`, which the browser runs too
// before the answer comes. Nothing the member can't read leaves here: items
// for objects, views or records they can't read today stay in the row (they
// come back with access, AC-939) but never reach the answer, and starring
// asks for read access first. Only ids that point at nothing at all (a view
// deleted, a record purged) are pruned, on the next write (AC-940).
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { NavFavourite, NavState } from '@crm/contracts';
import {
  applyNavOp,
  DEFAULT_NAV_PREFS,
  EMPTY_NAV_UNIVERSE,
  NAV_ITEM_KINDS,
  NAV_PAGES,
  NAV_SCHEDULING_PAGES,
  NAV_SECTIONS,
  navKey,
  pruneNavItems,
  type NavItemPref,
  type NavOperation,
  type NavPage,
  type NavPrefs,
  type NavSectionKey,
  type NavUniverse,
} from '@crm/contracts/navigation';
import { HUES, OBJECT_ICONS, type Hue, type ObjectIcon } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { touched } from '../engine/definitions.ts';
import { uuidList } from '../engine/ids.ts';
import { readRecords } from '../engine/records.ts';
import { refuse } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { memberOf, seesView } from '../views/views.ts';
import type { RemovalEffect } from '../members/removal-effect.ts';

const { lists, memberNavPrefs, members, objects, records, views } = schema;

/** The one answer for starring something that doesn't exist or that the caller can't read (AC-934). */
export const NAV_ITEM_NOT_FOUND = 'That view or record doesn’t exist, or you can’t see it.';

const isKind = (value: unknown): value is NavItemPref['kind'] =>
  typeof value === 'string' && (NAV_ITEM_KINDS as readonly string[]).includes(value);
/** A stored id the reads can use: a page's key, or a uuid for anything else (the input schema allows no other). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fitsKind = (kind: NavItemPref['kind'], id: string) =>
  kind === 'page' ? (NAV_PAGES as readonly string[]).includes(id) : UUID.test(id);
const isSection = (value: unknown): value is NavSectionKey =>
  typeof value === 'string' && (NAV_SECTIONS as readonly string[]).includes(value);

/**
 * The stored row as `NavPrefs`, read defensively: an item of an unknown kind
 * or shape, an id that is neither a page's key nor a uuid, or a section name
 * the code doesn't know, is skipped rather than failing the read (a
 * downgrade, a bug), so a sidebar always draws and the next write drops it.
 */
export function prefsOf(stored: {
  readonly items: unknown;
  readonly sections: unknown;
  readonly rail: boolean;
}): NavPrefs {
  const items = Array.isArray(stored.items)
    ? stored.items.flatMap((value: unknown): NavItemPref[] => {
        if (typeof value !== 'object' || value === null) return [];
        const { kind, id, pinned, hidden } = value as Record<string, unknown>;
        if (!isKind(kind) || typeof id !== 'string' || !fitsKind(kind, id)) return [];
        return [
          { kind, id, ...(pinned === true ? { pinned: true } : {}), ...(hidden === true ? { hidden: true } : {}) },
        ];
      })
    : [];
  const sections = typeof stored.sections === 'object' && stored.sections !== null ? stored.sections : {};
  const { order, folded } = sections as Record<string, unknown>;
  return {
    items,
    sections: {
      order: Array.isArray(order) ? order.filter(isSection) : DEFAULT_NAV_PREFS.sections.order,
      folded: Array.isArray(folded) ? folded.filter(isSection) : [],
    },
    rail: stored.rail,
  };
}

/** The caller's row, or undefined when they have none; `for update` when a write changes it. */
async function readRow(tx: WorkspaceTx, scope: EngineScope, memberId: string, lock: boolean) {
  const query = tx
    .select({
      items: memberNavPrefs.items,
      sections: memberNavPrefs.sections,
      rail: memberNavPrefs.rail,
      version: memberNavPrefs.version,
    })
    .from(memberNavPrefs)
    .where(and(eq(memberNavPrefs.workspaceId, scope.workspaceId), eq(memberNavPrefs.memberId, memberId)));
  const [row] = lock ? await query.for('update') : await query;
  return row;
}

/** One live object the caller may read, as the sidebar shows it. */
interface NavObject {
  readonly id: string;
  readonly apiSlug: string;
  readonly singularName: string;
  readonly pluralName: string;
  readonly icon: ObjectIcon;
  readonly hue: Hue;
}

const isIcon = (icon: string): icon is ObjectIcon => (OBJECT_ICONS as readonly string[]).includes(icon);
const isHue = (hue: string): hue is Hue => (HUES as readonly string[]).includes(hue);

/** The live objects the caller may read, in the workspace's order (the door's object level, AC-939). */
async function readableObjects(tx: WorkspaceTx, scope: EngineScope): Promise<readonly NavObject[]> {
  const rows = await tx
    .select({
      id: objects.id,
      apiSlug: objects.apiSlug,
      singularName: objects.singularName,
      pluralName: objects.pluralName,
      icon: objects.icon,
      hue: objects.hue,
    })
    .from(objects)
    // Row level security keeps the read to this workspace; the filter says so too (house style).
    .where(and(eq(objects.workspaceId, scope.workspaceId), isNull(objects.archivedAt)))
    .orderBy(asc(objects.position), asc(objects.createdAt), asc(objects.id));
  return rows.flatMap((row) => {
    const { icon, hue } = row;
    if (objectLevel(scope.access, row.id) === 'none' || !isIcon(icon) || !isHue(hue)) return [];
    return [{ ...row, icon, hue }];
  });
}

/** The live lists the caller may read (spec 0048, AC-4804), oldest first: a list follows its object. */
async function readableLists(
  tx: WorkspaceTx,
  scope: EngineScope,
  readable: readonly NavObject[],
): Promise<readonly string[]> {
  const shown = new Set(readable.map((object) => object.id));
  const rows = await tx
    .select({ id: lists.id, objectId: lists.objectId })
    .from(lists)
    .where(and(eq(lists.workspaceId, scope.workspaceId), isNull(lists.archivedAt)))
    .orderBy(asc(lists.id));
  return rows.flatMap((row) =>
    shown.has(row.objectId) && objectLevel(scope.access, row.id) !== 'none' ? [row.id] : [],
  );
}

/**
 * The starred views and records the caller may read today, resolved (AC-925,
 * AC-939): a view they can see on a live object they may read, and a live
 * record they may read through the engine's record read (so one in the trash,
 * or outside a record rule, is left out). In stored order.
 */
async function resolveFavourites(
  tx: WorkspaceTx,
  scope: EngineScope,
  items: readonly NavItemPref[],
  objectsById: ReadonlyMap<string, NavObject>,
): Promise<NavFavourite[]> {
  const pinned = items.filter((item) => item.pinned === true && (item.kind === 'view' || item.kind === 'record'));
  const viewIds = pinned.filter((item) => item.kind === 'view').map((item) => item.id);
  const recordIds = pinned.filter((item) => item.kind === 'record').map((item) => item.id);
  const caller = memberOf(scope);
  const viewRows =
    viewIds.length === 0
      ? []
      : await tx
          .select({
            id: views.id,
            objectId: views.objectId,
            name: views.name,
            visibility: views.visibility,
            creatorMemberId: views.creatorMemberId,
          })
          .from(views)
          .where(and(eq(views.workspaceId, scope.workspaceId), sql`${views.id} = any(${uuidList(viewIds)})`));
  const recordViews =
    recordIds.length === 0 ? [] : await readRecords(tx, scope.access, recordIds, { attributeIds: [] });
  const resolved = new Map<string, NavFavourite>();
  for (const row of viewRows) {
    const object = row.objectId === null ? undefined : objectsById.get(row.objectId);
    if (object === undefined || !seesView(caller, row)) continue;
    resolved.set(`view:${row.id}`, favouriteOf('view', row.id, row.name, object));
  }
  for (const view of recordViews) {
    const object = objectsById.get(view.display.objectId);
    if (object === undefined) continue;
    resolved.set(`record:${view.id}`, favouriteOf('record', view.id, view.display.name, object));
  }
  return pinned.flatMap((item) => {
    const found = resolved.get(navKey(item));
    return found === undefined ? [] : [found];
  });
}

function favouriteOf(kind: 'view' | 'record', id: string, label: string, object: NavObject): NavFavourite {
  return {
    kind,
    id,
    label,
    objectId: object.id,
    objectSlug: object.apiSlug,
    objectName: object.pluralName,
    objectSingularName: object.singularName,
    icon: object.icon,
    hue: object.hue,
  };
}

/**
 * The pages above the sections the sidebar offers today: the link page and Tasks (My tasks, spec 0019). Inbox joins
 * with #28. Notes keeps its page (a record's Notes tab and Quick actions reach it) but left the sidebar (owner, 30
 * October 2026: not needed right now).
 */
const TOP_PAGES_BUILT: readonly NavPage[] = ['linkPage', 'tasks'];

/**
 * The Scheduling pages the sidebar offers: Bookings and Captures. The Roster left the sidebar (owner, 30 October
 * 2026) and is Bookings › Roster, a tab of its own (31 October 2026).
 */
const SCHEDULING_PAGES_BUILT: readonly NavPage[] = NAV_SCHEDULING_PAGES.filter((page) => page !== 'roster');

/**
 * The pages above the sections the caller has (AC-924): Tasks for every
 * member. An API key has no sidebar, so none.
 */
function topFor(scope: EngineScope): readonly NavPage[] {
  return scope.actor.type === 'member' ? TOP_PAGES_BUILT : [];
}

/**
 * The Scheduling pages the caller's role may open (AC-928): every role but a
 * guest (spec 0031; no guest role exists yet), and nothing for an API key.
 */
function schedulingFor(scope: EngineScope): readonly NavPage[] {
  return scope.actor.type === 'member' ? SCHEDULING_PAGES_BUILT : [];
}

/** The changes `applyNavOp` reads the universe for. */
const USES_UNIVERSE: ReadonlySet<NavOperation['op']> = new Set(['move', 'hide', 'show', 'star']);

/** What the caller's sidebar may show today, and the favourites resolved. */
async function universeOf(
  tx: WorkspaceTx,
  scope: EngineScope,
  prefs: NavPrefs,
): Promise<{ readonly universe: NavUniverse; readonly favourites: NavFavourite[] }> {
  const readable = await readableObjects(tx, scope);
  const objectsById = new Map(readable.map((object) => [object.id, object]));
  const favourites = await resolveFavourites(tx, scope, prefs.items, objectsById);
  return {
    universe: {
      top: topFor(scope),
      records: readable.map((object) => object.id),
      // Lists (spec 0048, AC-4804): the live ones over objects the caller reads.
      lists: [...(await readableLists(tx, scope, readable))],
      scheduling: schedulingFor(scope),
      favourites: new Set(favourites.map(navKey)),
    },
    favourites,
  };
}

/** Whether an item may leave the server: only what resolves for the reader. */
function shown(universe: NavUniverse, item: NavItemPref): boolean {
  switch (item.kind) {
    case 'object':
      return universe.records.includes(item.id);
    case 'list':
      return universe.lists.includes(item.id);
    case 'page':
      return universe.top.includes(item.id as NavPage) || universe.scheduling.includes(item.id as NavPage);
    case 'view':
    case 'record':
      return universe.favourites.has(navKey(item));
  }
}

/**
 * The caller's sidebar, resolved through the access door (AC-936, AC-939):
 * their stored choices (or the defaults), with only the items that resolve
 * for them today, the favourites with their names and objects, and which
 * pages they have. An API key, which has no sidebar, gets the defaults.
 */
export async function readNav(scope: EngineScope): Promise<NavState> {
  const caller = memberOf(scope);
  return inWorkspace(scope, async (tx) => {
    const row = caller === undefined ? undefined : await readRow(tx, scope, caller, false);
    const prefs = row === undefined ? DEFAULT_NAV_PREFS : prefsOf(row);
    const { universe, favourites } = await universeOf(tx, scope, prefs);
    return {
      items: prefs.items.filter((item) => shown(universe, item)).map((item) => ({ ...item })),
      sections: { order: [...prefs.sections.order], folded: [...prefs.sections.folded] },
      rail: prefs.rail,
      version: row?.version ?? 0,
      favourites,
      top: [...universe.top],
      scheduling: [...universe.scheduling],
    };
  });
}

/**
 * Takes a share lock on the caller's member row and refuses when they are no
 * longer active, so a change written while their removal runs waits for it,
 * then is refused, and the removal leaves no row of theirs (AC-941).
 */
async function stillMember(tx: WorkspaceTx, scope: EngineScope, memberId: string): Promise<void> {
  const [row] = await tx
    .select({ status: members.status })
    .from(members)
    .where(and(eq(members.workspaceId, scope.workspaceId), eq(members.id, memberId)))
    .for('share');
  if (row?.status !== 'active') throw refuse('FORBIDDEN', 'You are no longer a member of this workspace.');
}

/** Refuses a star of a view or record that doesn't exist or that the caller can't read, with one answer (AC-934). */
async function checkStar(
  tx: WorkspaceTx,
  scope: EngineScope,
  op: Extract<NavOperation, { op: 'star' }>,
  objectsById: ReadonlySet<string>,
): Promise<void> {
  if (op.kind === 'view') {
    const [row] = await tx
      .select({ objectId: views.objectId, visibility: views.visibility, creatorMemberId: views.creatorMemberId })
      .from(views)
      .where(and(eq(views.workspaceId, scope.workspaceId), eq(views.id, op.id)));
    if (
      row === undefined ||
      row.objectId === null ||
      !objectsById.has(row.objectId) ||
      !seesView(memberOf(scope), row)
    ) {
      throw refuse('NOT_FOUND', NAV_ITEM_NOT_FOUND);
    }
    return;
  }
  const [found] = await readRecords(tx, scope.access, [op.id], { attributeIds: [] });
  if (found === undefined || !objectsById.has(found.display.objectId)) throw refuse('NOT_FOUND', NAV_ITEM_NOT_FOUND);
}

/**
 * Which stored views and records still exist at all, whoever may read them:
 * a deleted view or a purged record is gone for good, so its item is pruned
 * (AC-940); a record in the trash still exists, and comes back on restore.
 */
async function existing(
  tx: WorkspaceTx,
  scope: EngineScope,
  items: readonly NavItemPref[],
): Promise<ReadonlySet<string>> {
  const viewIds = items.filter((item) => item.kind === 'view').map((item) => item.id);
  const recordIds = items.filter((item) => item.kind === 'record').map((item) => item.id);
  const found = new Set<string>();
  if (viewIds.length > 0) {
    const rows = await tx
      .select({ id: views.id })
      .from(views)
      .where(and(eq(views.workspaceId, scope.workspaceId), sql`${views.id} = any(${uuidList(viewIds)})`));
    for (const row of rows) found.add(`view:${row.id}`);
  }
  if (recordIds.length > 0) {
    const rows = await tx
      .select({ id: records.id })
      .from(records)
      .where(and(eq(records.workspaceId, scope.workspaceId), sql`${records.id} = any(${uuidList(recordIds)})`));
    for (const row of rows) found.add(`record:${row.id}`);
  }
  return found;
}

/** Drops stored views and records that point at nothing (a view deleted, a record purged). */
async function pruned(tx: WorkspaceTx, scope: EngineScope, prefs: NavPrefs): Promise<NavPrefs> {
  const found = await existing(tx, scope, prefs.items);
  return pruneNavItems(prefs, (item) =>
    item.kind === 'view' || item.kind === 'record' ? found.has(navKey(item)) : true,
  );
}

/**
 * Applies one change to the caller's own sidebar (AC-937, AC-938): their row
 * is made with the defaults when missing, then locked, so two tabs changing
 * different things at the same moment both keep their change. Ids that point
 * at nothing are pruned on the way (AC-940). Stores one `nav` event naming the
 * caller and answers the row's new version. Refuses `FORBIDDEN` for an API
 * key or a member being removed, `NOT_FOUND` for starring a view or record
 * that doesn't exist or that they can't read, `NAV_LIMIT` past 50 favourites
 * or 400 items, and `CONFIG_INVALID` for hiding a favourite.
 */
export async function changeNav(
  scope: EngineScope,
  op: NavOperation,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly version: number }> {
  const caller = memberOf(scope);
  if (caller === undefined) throw refuse('FORBIDDEN', 'Only members have a sidebar.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await stillMember(tx, scope, caller);
      const by = actorRow(scope.actor);
      // The member's first change makes their row (AC-936); a row made by another tab meanwhile is kept.
      await tx
        .insert(memberNavPrefs)
        .values({
          workspaceId: scope.workspaceId,
          memberId: caller,
          sections: { order: [...DEFAULT_NAV_PREFS.sections.order], folded: [] },
          createdByType: by.type,
          createdById: by.id,
          createdByMemberId: by.memberId,
          updatedByType: by.type,
          updatedById: by.id,
          updatedByMemberId: by.memberId,
        })
        .onConflictDoNothing();
      const row = await readRow(tx, scope, caller, true);
      if (row === undefined) throw new Error('The sidebar row vanished under its own lock.');
      const prefs = await pruned(tx, scope, prefsOf(row));
      // Only a move, a hide or show (which index into what the member sees) and a star (its cap counts the
      // favourites they see) need the universe; a fold, a section move, the rail, an unstar and a reset don't, so
      // they skip its reads.
      const { universe } = USES_UNIVERSE.has(op.op)
        ? await universeOf(tx, scope, prefs)
        : { universe: EMPTY_NAV_UNIVERSE };
      if (op.op === 'star') await checkStar(tx, scope, op, new Set(universe.records));
      const applied = applyNavOp(prefs, op, universe);
      if (!applied.ok) throw refuse(applied.refusal.code, applied.refusal.message);
      const next = applied.prefs;
      const [written] = await tx
        .update(memberNavPrefs)
        .set({
          items: next.items.map((item) => ({ ...item })),
          sections: { order: [...next.sections.order], folded: [...next.sections.folded] },
          rail: next.rail,
          version: sql`${memberNavPrefs.version} + 1`,
          ...touched(scope),
        })
        .where(and(eq(memberNavPrefs.workspaceId, scope.workspaceId), eq(memberNavPrefs.memberId, caller)))
        .returning({ version: memberNavPrefs.version });
      context.record({ nav: [caller] });
      return { version: written?.version ?? row.version + 1 };
    },
    hooks,
  );
  return result;
}

/**
 * The daily cleanup's sidebar phase (AC-940): up to `limit` stored rows after member `after`, by member id, each
 * losing its views and records that point at nothing any more (a record in the trash still exists, and stays); a
 * row that changes gets a new version, and no event, since every read already left those items out. Answers how
 * many rows it looked at, how many changed, and the last member id, where the next batch starts.
 */
export async function pruneNavRows(
  context: WriteContext,
  after: string | undefined,
  limit: number,
): Promise<{ readonly seen: number; readonly changed: number; readonly last: string | undefined }> {
  const { tx, scope } = context;
  const rows = await tx
    .select({
      memberId: memberNavPrefs.memberId,
      items: memberNavPrefs.items,
      sections: memberNavPrefs.sections,
      rail: memberNavPrefs.rail,
    })
    .from(memberNavPrefs)
    .where(
      and(
        eq(memberNavPrefs.workspaceId, scope.workspaceId),
        after === undefined ? undefined : sql`${memberNavPrefs.memberId} > ${after}::uuid`,
      ),
    )
    .orderBy(asc(memberNavPrefs.memberId))
    .limit(limit)
    .for('update', { skipLocked: true });
  // One lookup per kind for the whole batch, then each row pruned in memory, so the locks are held briefly.
  const reads = rows.map((row) => ({ row, read: prefsOf(row) }));
  const found = await existing(
    tx,
    scope,
    reads.flatMap(({ read }) => read.items),
  );
  let changed = 0;
  for (const { row, read } of reads) {
    const kept = pruneNavItems(read, (item) =>
      item.kind === 'view' || item.kind === 'record' ? found.has(navKey(item)) : true,
    );
    // Junk that `prefsOf` skipped goes too, so compare with what is stored.
    const stored = Array.isArray(row.items) ? row.items.length : 0;
    if (kept.items.length === stored) continue;
    await tx
      .update(memberNavPrefs)
      .set({
        items: kept.items.map((item) => ({ ...item })),
        version: sql`${memberNavPrefs.version} + 1`,
        ...touched(scope),
      })
      .where(and(eq(memberNavPrefs.workspaceId, scope.workspaceId), eq(memberNavPrefs.memberId, row.memberId)));
    changed += 1;
  }
  return { seen: rows.length, changed, last: rows.at(-1)?.memberId };
}

/** Inside a member's removal (spec 0009's `removeMember`, AC-941): deletes their stored sidebar. */
export async function deleteMemberNav(context: WriteContext, memberId: string): Promise<void> {
  const { tx, scope } = context;
  await tx
    .delete(memberNavPrefs)
    .where(and(eq(memberNavPrefs.workspaceId, scope.workspaceId), eq(memberNavPrefs.memberId, memberId)));
}

/** A removal (spec 0031, AC-814): their own sidebar goes (spec 0034, AC-941). */
export const navRemoval: RemovalEffect = {
  feature: 'sidebar',
  constraints: ['member_nav_prefs_member'],
  run: deleteMemberNav,
};
