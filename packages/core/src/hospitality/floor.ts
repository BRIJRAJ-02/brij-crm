// A place's floor (spec 0065, AC-6509): its areas (up to 12) and tables (up to 300), edited as a plain list. Tables
// are added many at once ("T1 to T10, seats 2 to 4"), reordered by drag, joined with others of the same place (both
// ways, at most 10 each), taken offline, archived (it leaves online fitting and keeps its holds) and deleted (refused
// `IN_USE` while it holds future reservations; Table seating, H3, brings them, so today none do). `hospitality.manage`
// only, checked before any input is read, and only while some Hospitality app is installed. Every write takes the
// place's lock, so two editors' adds never pass each other's limit or positions.
import { HOSPITALITY_LIMITS, type Area, type DiningTable, type PlaceFloor } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import { lockKey } from '../booking/locks.ts';
import { checkId, isUuid } from '../engine/ids.ts';
import { postgresError, refuse, refuseOn } from '../engine/refusals.ts';
import { auditSetup, hospitalityMember, requireAnyApp } from './gate.ts';
import { PLACE_NOT_FOUND } from './places.ts';

const { areas, places, placeTables } = schema;

const TABLE_NOT_FOUND = 'That table doesn’t exist.';
const AREA_NOT_FOUND = 'That area doesn’t exist.';

/** The floor of one place, areas in order then tables in order (archived last). */
async function readFloorOf(tx: WorkspaceTx, workspaceId: string, placeId: string): Promise<PlaceFloor> {
  const areaRows = await tx
    .select({ id: areas.id, name: areas.name, position: areas.position })
    .from(areas)
    .where(and(eq(areas.workspaceId, workspaceId), eq(areas.placeId, placeId)))
    .orderBy(asc(areas.position), asc(areas.id));
  const tableRows = await tx
    .select({
      id: placeTables.id,
      label: placeTables.label,
      areaId: placeTables.areaId,
      minGuests: placeTables.minGuests,
      maxGuests: placeTables.maxGuests,
      online: placeTables.online,
      joins: placeTables.joins,
      position: placeTables.position,
      archivedAt: placeTables.archivedAt,
    })
    .from(placeTables)
    .where(and(eq(placeTables.workspaceId, workspaceId), eq(placeTables.placeId, placeId)))
    .orderBy(sql`${placeTables.archivedAt} is not null`, asc(placeTables.position), asc(placeTables.id));
  return {
    placeId,
    areas: areaRows.map((row): Area => ({ id: row.id, name: row.name, position: row.position })),
    tables: tableRows.map((row): DiningTable => ({
      id: row.id,
      label: row.label,
      ...(row.areaId === null ? {} : { areaId: row.areaId }),
      minGuests: row.minGuests,
      maxGuests: row.maxGuests,
      online: row.online,
      joins: [...row.joins],
      position: row.position,
      archived: row.archivedAt !== null,
    })),
  };
}

/**
 * Runs `work` on one place of the caller's workspace: `hospitality.manage` first, then the app gate, the place's
 * lock, and NOT_FOUND for a place that isn't there. Answers the place's floor after it.
 */
async function onPlace(
  scope: EngineScope,
  placeId: string,
  what: string | undefined,
  work: (tx: WorkspaceTx, by: string) => Promise<void>,
): Promise<PlaceFloor> {
  requirePermission(scope, 'hospitality.manage');
  const by = hospitalityMember(scope);
  const id = checkId(placeId, PLACE_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await requireAnyApp(tx, scope.workspaceId);
    // Only a write takes the place's lock; a read never waits behind one.
    if (what !== undefined) await lockKey(tx, `place:${scope.workspaceId}:${id}`);
    const [place] = await tx
      .select({ id: places.id })
      .from(places)
      .where(and(eq(places.workspaceId, scope.workspaceId), eq(places.id, id)));
    if (place === undefined) throw refuse('NOT_FOUND', PLACE_NOT_FOUND);
    await work(tx, by);
    // A write leaves its line in History; a read (no `what`) none.
    if (what !== undefined) await auditSetup(tx, scope, what, { placeId: id });
    return readFloorOf(tx, scope.workspaceId, id);
  });
}

/** A label already in the place, as the unique index refuses it, worded on `field`. */
async function labelGuard<T>(field: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failed = postgresError(error);
    if (failed?.code === '23505' && failed.constraint === 'place_tables_label') {
      throw refuseOn('NAME_TAKEN', 'This place already has a table with that label.', field);
    }
    if (failed?.code === '23505' && failed.constraint === 'areas_name') {
      throw refuseOn('NAME_TAKEN', 'This place already has an area with that name.', field);
    }
    throw error;
  }
}

/** Refuses an area that isn't one of this place's. */
async function checkArea(tx: WorkspaceTx, workspaceId: string, placeId: string, areaId: string): Promise<void> {
  const [row] = await tx
    .select({ id: areas.id })
    .from(areas)
    .where(and(eq(areas.workspaceId, workspaceId), eq(areas.placeId, placeId), eq(areas.id, areaId)));
  if (row === undefined) throw refuseOn('NOT_FOUND', AREA_NOT_FOUND, 'areaId');
}

/** One table of this place, locked for the change, or NOT_FOUND. */
async function tableOf(tx: WorkspaceTx, workspaceId: string, placeId: string, tableId: string) {
  const id = checkId(tableId, TABLE_NOT_FOUND);
  const [row] = await tx
    .select({
      id: placeTables.id,
      joins: placeTables.joins,
      archivedAt: placeTables.archivedAt,
      minGuests: placeTables.minGuests,
      maxGuests: placeTables.maxGuests,
    })
    .from(placeTables)
    .where(and(eq(placeTables.workspaceId, workspaceId), eq(placeTables.placeId, placeId), eq(placeTables.id, id)))
    .for('update');
  if (row === undefined) throw refuse('NOT_FOUND', TABLE_NOT_FOUND);
  return row;
}

/** One place's areas and tables (AC-6509), for `hospitality.manage`. */
export async function readFloor(scope: EngineScope, input: { readonly placeId: string }): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, undefined, () => Promise.resolve());
}

/** Adds an area (up to 12 a place) or renames one; a name already in the place is `NAME_TAKEN`. */
export async function saveArea(
  scope: EngineScope,
  input: { readonly placeId: string; readonly areaId?: string; readonly id?: string; readonly name: string },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'area.saved', async (tx, by) => {
    const name = input.name.trim();
    if (input.areaId !== undefined) {
      const areaId = checkId(input.areaId, AREA_NOT_FOUND);
      await checkArea(tx, scope.workspaceId, input.placeId, areaId);
      await labelGuard('name', () =>
        tx
          .update(areas)
          .set({ name })
          .where(and(eq(areas.workspaceId, scope.workspaceId), eq(areas.id, areaId))),
      );
      return;
    }
    const id = input.id !== undefined && isUuid(input.id) ? input.id.toLowerCase() : undefined;
    if (id !== undefined) {
      const [again] = await tx
        .select({ id: areas.id })
        .from(areas)
        .where(and(eq(areas.workspaceId, scope.workspaceId), eq(areas.id, id)));
      if (again !== undefined) return;
    }
    const [counted] = await tx
      .select({ n: count() })
      .from(areas)
      .where(and(eq(areas.workspaceId, scope.workspaceId), eq(areas.placeId, input.placeId)));
    const position = counted?.n ?? 0;
    if (position >= HOSPITALITY_LIMITS.areasPerPlace) {
      throw refuse('LIMIT_REACHED', `A place takes up to ${String(HOSPITALITY_LIMITS.areasPerPlace)} areas.`);
    }
    await labelGuard('name', () =>
      tx.insert(areas).values({
        workspaceId: scope.workspaceId,
        ...(id === undefined ? {} : { id }),
        placeId: input.placeId,
        name,
        position,
        createdByMemberId: by,
      }),
    );
  });
}

/** Deletes an area; its tables stay in the place with no area. */
export async function deleteArea(
  scope: EngineScope,
  input: { readonly placeId: string; readonly areaId: string },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'area.deleted', async (tx) => {
    const areaId = checkId(input.areaId, AREA_NOT_FOUND);
    await checkArea(tx, scope.workspaceId, input.placeId, areaId);
    await tx.delete(areas).where(and(eq(areas.workspaceId, scope.workspaceId), eq(areas.id, areaId)));
  });
}

/** How many live tables the place has, and the next position after them. */
async function liveTables(tx: WorkspaceTx, workspaceId: string, placeId: string) {
  const [row] = await tx
    .select({ n: count(), last: sql<number | null>`max(${placeTables.position})` })
    .from(placeTables)
    .where(
      and(eq(placeTables.workspaceId, workspaceId), eq(placeTables.placeId, placeId), isNull(placeTables.archivedAt)),
    );
  return { n: row?.n ?? 0, next: (row?.last ?? -1) + 1 };
}

/**
 * Adds tables at once (AC-6509): the labels given (the screen makes "T1 to T10"), one area, the seats and online.
 * Refused `NAME_TAKEN` naming the first label the place already has, and `LIMIT_REACHED` past 300 live tables.
 */
export async function addTables(
  scope: EngineScope,
  input: {
    readonly placeId: string;
    readonly labels: readonly string[];
    readonly areaId?: string;
    readonly minGuests: number;
    readonly maxGuests: number;
    readonly online?: boolean;
  },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'tables.added', async (tx, by) => {
    const labels = input.labels.map((label) => label.trim());
    const seen = new Set<string>();
    for (const label of labels) {
      if (seen.has(label.toLowerCase())) throw refuseOn('NAME_TAKEN', `${label} is in the list twice.`, 'labels');
      seen.add(label.toLowerCase());
    }
    if (input.areaId !== undefined) await checkArea(tx, scope.workspaceId, input.placeId, input.areaId);
    const live = await liveTables(tx, scope.workspaceId, input.placeId);
    if (live.n + labels.length > HOSPITALITY_LIMITS.tablesPerPlace) {
      throw refuse('LIMIT_REACHED', `A place takes up to ${String(HOSPITALITY_LIMITS.tablesPerPlace)} tables.`);
    }
    const taken = await tx
      .select({ label: placeTables.label })
      .from(placeTables)
      .where(
        and(
          eq(placeTables.workspaceId, scope.workspaceId),
          eq(placeTables.placeId, input.placeId),
          isNull(placeTables.archivedAt),
          inArray(sql`lower(${placeTables.label})`, [...seen]),
        ),
      )
      .limit(1);
    if (taken[0] !== undefined) {
      throw refuseOn('NAME_TAKEN', `This place already has a table ${taken[0].label}.`, 'labels');
    }
    await labelGuard('labels', () =>
      tx.insert(placeTables).values(
        labels.map((label, index) => ({
          workspaceId: scope.workspaceId,
          placeId: input.placeId,
          label,
          ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
          minGuests: input.minGuests,
          maxGuests: input.maxGuests,
          online: input.online ?? true,
          position: live.next + index,
          createdByMemberId: by,
          updatedByMemberId: by,
        })),
      ),
    );
  });
}

/** Sets which tables `tableId` joins, both ways: each named table joins it back, each dropped one lets it go. */
async function setJoins(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
  tableId: string,
  was: readonly string[],
  wanted: readonly string[],
): Promise<void> {
  const next = [...new Set(wanted.map((id) => id.toLowerCase()))].filter((id) => id !== tableId);
  if (next.length > HOSPITALITY_LIMITS.joinsPerTable) {
    throw refuseOn('LIMIT_REACHED', `A table joins up to ${String(HOSPITALITY_LIMITS.joinsPerTable)} others.`, 'joins');
  }
  if (next.length > 0) {
    const others = await tx
      .select({ id: placeTables.id, joins: placeTables.joins })
      .from(placeTables)
      .where(
        and(
          eq(placeTables.workspaceId, workspaceId),
          eq(placeTables.placeId, placeId),
          isNull(placeTables.archivedAt),
          inArray(placeTables.id, next),
        ),
      )
      .for('update');
    if (others.length !== next.length) throw refuseOn('NOT_FOUND', 'Join only live tables of this place.', 'joins');
    const joining = others.filter((other) => !other.joins.includes(tableId));
    if (joining.some((other) => other.joins.length >= HOSPITALITY_LIMITS.joinsPerTable)) {
      throw refuseOn('LIMIT_REACHED', 'One of those tables already joins 10 others.', 'joins');
    }
    // Each newly named table joins it back, in one statement.
    if (joining.length > 0) {
      await tx
        .update(placeTables)
        .set({ joins: sql`array_append(${placeTables.joins}, ${tableId}::uuid)` })
        .where(
          and(
            eq(placeTables.workspaceId, workspaceId),
            inArray(
              placeTables.id,
              joining.map((other) => other.id),
            ),
          ),
        );
    }
  }
  const dropped = was.filter((id) => !next.includes(id));
  if (dropped.length > 0) await forget(tx, workspaceId, placeId, tableId, dropped);
  await tx
    .update(placeTables)
    .set({ joins: next })
    .where(and(eq(placeTables.workspaceId, workspaceId), eq(placeTables.id, tableId)));
}

/** Takes `tableId` out of the joins of `from` (all of its place's tables naming it when `from` is absent). */
async function forget(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
  tableId: string,
  from?: readonly string[],
): Promise<void> {
  await tx
    .update(placeTables)
    .set({ joins: sql`array_remove(${placeTables.joins}, ${tableId}::uuid)` })
    .where(
      and(
        eq(placeTables.workspaceId, workspaceId),
        eq(placeTables.placeId, placeId),
        sql`${tableId}::uuid = any(${placeTables.joins})`,
        ...(from === undefined ? [] : [inArray(placeTables.id, [...from])]),
      ),
    );
}

/**
 * Changes one table: its label (`NAME_TAKEN` when the place has it), area (`null` takes it out), seats, online, or
 * joins (kept both ways). Changing seats or joins never moves a reservation (none until H3).
 */
export async function updateTable(
  scope: EngineScope,
  input: {
    readonly placeId: string;
    readonly tableId: string;
    readonly label?: string;
    readonly areaId?: string | null;
    readonly minGuests?: number;
    readonly maxGuests?: number;
    readonly online?: boolean;
    readonly joins?: readonly string[];
  },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'table.updated', async (tx, by) => {
    const table = await tableOf(tx, scope.workspaceId, input.placeId, input.tableId);
    if (typeof input.areaId === 'string') await checkArea(tx, scope.workspaceId, input.placeId, input.areaId);
    const min = input.minGuests ?? table.minGuests;
    const max = input.maxGuests ?? table.maxGuests;
    if (min > max) throw refuseOn('CONFIG_INVALID', 'The fewest guests can’t be more than the most.', 'minGuests');
    await labelGuard('label', () =>
      tx
        .update(placeTables)
        .set({
          ...(input.label === undefined ? {} : { label: input.label.trim() }),
          ...(input.areaId === undefined ? {} : { areaId: input.areaId }),
          minGuests: min,
          maxGuests: max,
          ...(input.online === undefined ? {} : { online: input.online }),
          updatedByMemberId: by,
          updatedAt: sql`now()`,
        })
        .where(and(eq(placeTables.workspaceId, scope.workspaceId), eq(placeTables.id, table.id))),
    );
    if (input.joins !== undefined) {
      await setJoins(tx, scope.workspaceId, input.placeId, table.id, table.joins, input.joins);
    }
  });
}

/** Moves a live table to `toIndex` among the place's live tables (drag to reorder), renumbering them in order. */
export async function moveTable(
  scope: EngineScope,
  input: { readonly placeId: string; readonly tableId: string; readonly toIndex: number },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'table.moved', async (tx) => {
    const table = await tableOf(tx, scope.workspaceId, input.placeId, input.tableId);
    if (table.archivedAt !== null) throw refuse('CONFIG_INVALID', 'Bring the table back before you move it.');
    const rows = await tx
      .select({ id: placeTables.id })
      .from(placeTables)
      .where(
        and(
          eq(placeTables.workspaceId, scope.workspaceId),
          eq(placeTables.placeId, input.placeId),
          isNull(placeTables.archivedAt),
        ),
      )
      .orderBy(asc(placeTables.position), asc(placeTables.id));
    const order = rows.map((row) => row.id).filter((id) => id !== table.id);
    order.splice(Math.min(Math.max(Math.trunc(input.toIndex), 0), order.length), 0, table.id);
    await tx.execute(sql`
      update place_tables t set position = o.n - 1
      from unnest(${`{${order.join(',')}}`}::uuid[]) with ordinality as o(id, n)
      where t.workspace_id = ${scope.workspaceId} and t.id = o.id and t.position <> o.n - 1
    `);
  });
}

/** Archives a table (Rules settled: it leaves online fitting and keeps its holds). Its label is free again. */
export async function archiveTable(
  scope: EngineScope,
  input: { readonly placeId: string; readonly tableId: string },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'table.archived', async (tx, by) => {
    const table = await tableOf(tx, scope.workspaceId, input.placeId, input.tableId);
    if (table.archivedAt !== null) return;
    await tx
      .update(placeTables)
      .set({ archivedAt: sql`now()`, updatedByMemberId: by, updatedAt: sql`now()` })
      .where(and(eq(placeTables.workspaceId, scope.workspaceId), eq(placeTables.id, table.id)));
  });
}

/** Brings an archived table back, last in the list; `NAME_TAKEN` when a live table took its label meanwhile. */
export async function restoreTable(
  scope: EngineScope,
  input: { readonly placeId: string; readonly tableId: string },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'table.restored', async (tx, by) => {
    const table = await tableOf(tx, scope.workspaceId, input.placeId, input.tableId);
    if (table.archivedAt === null) return;
    const live = await liveTables(tx, scope.workspaceId, input.placeId);
    if (live.n >= HOSPITALITY_LIMITS.tablesPerPlace) {
      throw refuse('LIMIT_REACHED', `A place takes up to ${String(HOSPITALITY_LIMITS.tablesPerPlace)} tables.`);
    }
    await labelGuard('label', () =>
      tx
        .update(placeTables)
        .set({ archivedAt: null, position: live.next, updatedByMemberId: by, updatedAt: sql`now()` })
        .where(and(eq(placeTables.workspaceId, scope.workspaceId), eq(placeTables.id, table.id))),
    );
  });
}

/**
 * Deletes a table for good, and takes it out of every join. Refused `IN_USE` with a count while it holds live future
 * reservations (Rules settled); Table seating (H3) adds that count here, and until then no table holds any.
 */
export async function deleteTable(
  scope: EngineScope,
  input: { readonly placeId: string; readonly tableId: string },
): Promise<PlaceFloor> {
  return onPlace(scope, input.placeId, 'table.deleted', async (tx) => {
    const table = await tableOf(tx, scope.workspaceId, input.placeId, input.tableId);
    const holds = futureHolds();
    if (holds > 0) {
      throw refuse('IN_USE', `This table holds ${String(holds)} upcoming reservations. Archive it instead.`);
    }
    await forget(tx, scope.workspaceId, input.placeId, table.id);
    await tx
      .delete(placeTables)
      .where(and(eq(placeTables.workspaceId, scope.workspaceId), eq(placeTables.id, table.id)));
  });
}

/** A table's live future holds: none until Table seating (H3) stores reservations. */
const futureHolds = (): number => 0;
