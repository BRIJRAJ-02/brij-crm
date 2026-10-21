// The purge of a deleted workspace past its window (spec 0031, slice 7,
// AC-823), run by the worker's daily cleanup as crm_worker. Three steps, each
// safe to run again, so a call that runs out of time picks up where the last
// one stopped:
//   1. Its calendar connections are marked revoked and their syncs queued, so
//      each grant ends with the provider. It waits up to a day for those.
//   2. `crm_purge_workspace_begin` removes what the worker can't and what
//      points at its members; then every tenant table's rows go inside
//      withWorkspace, children before the rows they point at, in batches.
//   3. `crm_purge_workspace_end` removes the directory row and the workspace.
// Each function acts only on a workspace deleted and past `purge_after`, so a
// live one is never touched. Counts per table go to the log, ids and numbers
// only.
import { sql } from 'drizzle-orm';
import type { Database, WorkspaceTx } from '@crm/db';

/** Rows one delete statement removes at most. */
export const PURGE_BATCH = 5000;

/** How long the purge waits for calendar grants to end with their provider before it goes on anyway. */
const CALENDAR_GRACE = '1 day';

/** How long after `purge_after` the purge begins: a restore begun inside the window has committed by then. */
const MARGIN = '1 hour';

/** The tables the purge functions clear, and the workspace itself: never in the worker's own pass. */
const OWN_STEPS: readonly string[] = [
  'workspaces',
  'audit_events',
  'outbox',
  'workspace_milestones',
  'member_onboarding',
];

/** Where the purge logs: ids, counts and times only. */
export interface PurgeLog {
  info(message: string, fields: Record<string, unknown>): void;
}

/** What the purge needs: the worker's database, and the log. */
export interface PurgeDeps {
  readonly db: Database;
  readonly log: PurgeLog;
  /** The clock, in milliseconds; tests pass one they move. */
  readonly now?: () => number;
}

/**
 * What one call did: `done` once the workspace is gone, `more` when time ran
 * out, `waiting` while calendar grants are still ending, and `skipped` for a
 * workspace that isn't deleted and past its window (restored meanwhile).
 */
export type PurgeOutcome = 'done' | 'more' | 'waiting' | 'skipped';

/** One tenant table, by its quoted name (`regclass` text), and the tables whose rows point at it. */
interface TableEdge {
  readonly name: string;
  readonly children: readonly string[];
}

/**
 * Every tenant table the worker clears, with the foreign keys between them,
 * read from the catalog: a table added later is purged without a change here,
 * and a missing grant fails loudly at the end.
 */
async function tenantTables(tx: WorkspaceTx): Promise<readonly TableEdge[]> {
  // Names qualified and quoted by the catalog (format %I), whatever the search path; the purge functions' own tables
  // left out by their bare names.
  const tables = await tx.execute<{ name: string; relname: string }>(sql`
    select format('%I.%I', n.nspname, c.relname) as name, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped)
    order by 1
  `);
  const edges = await tx.execute<{ child: string; parent: string }>(sql`
    select distinct format('%I.%I', cn.nspname, cc.relname) as child, format('%I.%I', pn.nspname, pc.relname) as parent
    from pg_constraint k
    join pg_class cc on cc.oid = k.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = k.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
    where k.contype = 'f' and k.conrelid <> k.confrelid
  `);
  const names = tables.rows.filter((row) => !OWN_STEPS.includes(row.relname)).map((row) => row.name);
  return names.map((name) => ({
    name,
    children: edges.rows.filter((edge) => edge.parent === name && names.includes(edge.child)).map((edge) => edge.child),
  }));
}

/**
 * The tables in an order that deletes children first: each step is the
 * tables nothing left points at. A cycle (rare) comes last as one step, whose
 * tables go in one statement.
 */
export function deleteOrder(tables: readonly TableEdge[]): readonly (readonly string[])[] {
  const steps: string[][] = [];
  let left = tables.map((table) => table.name);
  while (left.length > 0) {
    const free = left.filter((name) =>
      (tables.find((table) => table.name === name)?.children ?? []).every((child) => !left.includes(child)),
    );
    if (free.length === 0) {
      steps.push(left);
      break;
    }
    for (const name of free) steps.push([name]);
    left = left.filter((name) => !free.includes(name));
  }
  return steps;
}

/** Ends the workspace's calendar grants: true while some are still ending (within the grace). */
async function endCalendarGrants(db: Database, workspaceId: string): Promise<boolean> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const marked = await tx.execute<{ id: string }>(sql`
      update calendar_connections
      set status = 'revoked', updated_at = now(), updated_by_type = 'system', updated_by_id = null,
        updated_by_member_id = null
      where workspace_id = ${workspaceId}::uuid and status <> 'revoked'
      returning id::text as id
    `);
    for (const row of marked.rows) await tx.execute(sql`select crm_enqueue_calendar_sync(${row.id}::uuid)`);
    const waiting = await tx.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1 from calendar_connections
        where workspace_id = ${workspaceId}::uuid and updated_at > now() - ${CALENDAR_GRACE}::interval
      )
      -- However often a revoke retries, the wait ends a day after the purge could first begin.
      and exists (
        select 1 from workspaces where id = ${workspaceId}::uuid
          and purge_after > now() - ${MARGIN}::interval - ${CALENDAR_GRACE}::interval
      ) as waiting
    `);
    return waiting.rows[0]?.waiting === true;
  });
}

/** Every delete checks again that the workspace is still deleted and past the margin, so a restore stops it. */
const stillDeleted = (workspaceId: string) =>
  sql`exists (select 1 from workspaces where id = ${workspaceId}::uuid and deleted_at is not null
    and purge_after <= now() - ${MARGIN}::interval)`;

/** One batch from one table: how many rows went. A self reference a batch can't respect goes in one statement. */
async function deleteBatch(db: Database, log: PurgeLog, workspaceId: string, name: string): Promise<number> {
  const table = sql.raw(name);
  try {
    return await db.withWorkspace(workspaceId, async (tx) => {
      const done = await tx.execute(sql`
        delete from ${table} where workspace_id = ${workspaceId}::uuid and ${stillDeleted(workspaceId)}
          and ctid = any (array(select ctid from ${table} where workspace_id = ${workspaceId}::uuid limit ${PURGE_BATCH}))
      `);
      return done.rowCount ?? 0;
    });
  } catch (error) {
    if (!isForeignKeyError(error)) throw error;
    // A self reference a batch cut through: the table in one statement (logged, as it ignores the deadline).
    log.info('workspace.purge.whole_table', { workspaceId, table: name });
    return db.withWorkspace(workspaceId, async (tx) => {
      const done = await tx.execute(
        sql`delete from ${table} where workspace_id = ${workspaceId}::uuid and ${stillDeleted(workspaceId)}`,
      );
      return done.rowCount ?? 0;
    });
  }
}

/** A cycle's tables, all in one statement, so their foreign keys are checked once at its end. */
async function deleteTogether(db: Database, workspaceId: string, names: readonly string[]): Promise<number> {
  const parts = names.map(
    (name, index) =>
      sql`${sql.raw(`d${String(index)}`)} as (delete from ${sql.raw(name)} where workspace_id = ${workspaceId}::uuid and ${stillDeleted(workspaceId)} returning 1)`,
  );
  const counts = names.map((_, index) => sql.raw(`(select count(*) from d${String(index)})`));
  return db.withWorkspace(workspaceId, async (tx) => {
    const done = await tx.execute<{ total: string }>(
      sql`with ${sql.join(parts, sql`, `)} select (${sql.join(counts, sql` + `)})::text as total`,
    );
    return Number(done.rows[0]?.total ?? 0);
  });
}

/** Whether a database error is a foreign key violation (23503), directly or as a driver's cause. */
function isForeignKeyError(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined;
  return (
    code(error) === '23503' ||
    (typeof error === 'object' && error !== null && 'cause' in error && code(error.cause) === '23503')
  );
}

/**
 * Purges one workspace past its window, until it is gone or `deadline` (in
 * the clock's milliseconds) passes. Safe to call again: each step skips what
 * an earlier call finished.
 */
export async function purgeWorkspace(deps: PurgeDeps, workspaceId: string, deadline: number): Promise<PurgeOutcome> {
  const now = deps.now ?? Date.now;
  const { db } = deps;
  const due = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ due: boolean }>(sql`
      select exists (select 1 from workspaces where id = ${workspaceId}::uuid and deleted_at is not null
        and purge_after <= now() - ${MARGIN}::interval) as due
    `),
  );
  if (due.rows[0]?.due !== true) return 'skipped';
  if (await endCalendarGrants(db, workspaceId)) {
    deps.log.info('workspace.purge.waiting', { workspaceId, for: 'calendar' });
    return 'waiting';
  }
  await db.withWorkspace(workspaceId, (tx) => tx.execute(sql`select crm_purge_workspace_begin(${workspaceId}::uuid)`));
  const steps = deleteOrder(await db.withWorkspace(workspaceId, tenantTables));
  const counts: Record<string, number> = {};
  for (const step of steps) {
    if (step.length > 1) {
      counts[step.join('+')] = await deleteTogether(db, workspaceId, step);
      continue;
    }
    const [name] = step;
    if (name === undefined) continue;
    for (;;) {
      if (now() > deadline) {
        deps.log.info('workspace.purge', { workspaceId, counts, done: false });
        return 'more';
      }
      const gone = await deleteBatch(db, deps.log, workspaceId, name);
      if (gone > 0) counts[name] = (counts[name] ?? 0) + gone;
      if (gone < PURGE_BATCH) break;
    }
  }
  const ended = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ gone: boolean }>(sql`select crm_purge_workspace_end(${workspaceId}::uuid) as gone`),
  );
  deps.log.info('workspace.purge', { workspaceId, counts, done: true });
  return ended.rows[0]?.gone === true ? 'done' : 'more';
}
