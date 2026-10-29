// The purge of a deleted workspace past its window (spec 0031, slice 7,
// AC-823), run by the worker's daily cleanup as crm_worker. Three steps, each
// safe to run again, so a call that runs out of time picks up where the last
// one stopped:
//   1. Its calendar connections' runs are queued, then the connections marked
//      revoked, so each run ends its grant with the provider (unless another
//      workspace's connection still holds the account) and deletes the row.
//      It waits up to a day for those.
//   2. `crm_purge_workspace_begin` removes what the worker can't and what
//      points at its members; then the files its form uploads and record
//      files hold go from the store, their rows with them (nothing else could
//      find those bytes once the rows were gone: late trap #84); then every
//      tenant table's rows go inside withWorkspace, children before the rows
//      they point at, in batches.
//   3. `crm_purge_workspace_end` removes the directory row and the workspace.
// Each function acts only on a workspace deleted and past `purge_after`, so a
// live one is never touched. Counts per table go to the log, ids and numbers
// only.
import { sql } from 'drizzle-orm';
import type { Database, WorkspaceTx } from '@crm/db';
import type { UploadStore } from '../forms/uploads.ts';
import { CALENDAR_SPREAD_SECONDS } from './settings.ts';

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
  /**
   * The file store its uploads and record files live in. Without one (no store configured) their rows go with the
   * rest and the purge logs how many files it couldn't remove.
   */
  readonly files?: UploadStore;
}

/** How many stored files one step removes from each table: few, since the store call runs inside the transaction. */
const FILES_BATCH = 50;

/** Whether a stored path is this workspace's own: the purge never asks the store to remove another workspace's bytes. */
function ownPath(kind: string, pathname: string, workspaceId: string): boolean {
  return pathname.startsWith(`${kind === 'upload' ? 'forms' : 'records'}/${workspaceId}/`);
}

/**
 * One batch of the workspace's stored files: from the store first, then their rows, in one transaction, so a store
 * that fails rolls the rows back and the next call tries again (a file already gone is no error). A path outside the
 * workspace's own folder is never removed: its row goes and its id is logged. Answers how many rows.
 */
async function removeStoredFiles(
  db: Database,
  store: UploadStore,
  log: PurgeLog,
  workspaceId: string,
): Promise<number> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const found = await tx.execute<{ kind: string; id: string; pathname: string }>(sql`
      (select 'upload' as kind, id::text, pathname from form_uploads
        where workspace_id = ${workspaceId}::uuid and ${stillDeleted(workspaceId)} limit ${FILES_BATCH})
      union all
      (select 'record' as kind, id::text, pathname from record_files
        where workspace_id = ${workspaceId}::uuid and ${stillDeleted(workspaceId)} limit ${FILES_BATCH})
    `);
    if (found.rows.length === 0) return 0;
    const own = found.rows.filter((row) => ownPath(row.kind, row.pathname, workspaceId));
    const foreign = found.rows.filter((row) => !ownPath(row.kind, row.pathname, workspaceId));
    if (foreign.length > 0) {
      log.info('workspace.purge.foreign_paths', { workspaceId, ids: foreign.map((row) => row.id) });
    }
    if (own.length > 0) await store.remove(own.map((row) => row.pathname));
    const ids = (kind: string) => JSON.stringify(found.rows.filter((row) => row.kind === kind).map((row) => row.id));
    await tx.execute(sql`
      delete from form_uploads where workspace_id = ${workspaceId}::uuid
        and id in (select jsonb_array_elements_text(${ids('upload')}::jsonb)::uuid)
    `);
    await tx.execute(sql`
      delete from record_files where workspace_id = ${workspaceId}::uuid
        and id in (select jsonb_array_elements_text(${ids('record')}::jsonb)::uuid)
    `);
    return found.rows.length;
  });
}

/** How many stored files the workspace still names: what a purge with no store leaves in it. */
async function storedFiles(db: Database, workspaceId: string): Promise<number> {
  const found = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ n: number }>(sql`
      select (select count(*) from form_uploads where workspace_id = ${workspaceId}::uuid)::int
        + (select count(*) from record_files where workspace_id = ${workspaceId}::uuid)::int as n
    `),
  );
  return found.rows[0]?.n ?? 0;
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

/**
 * Ends the workspace's calendar grants: true while some are still ending (within the grace). The queue function only
 * takes a connection that may sync now, so each live one is queued first (a failed one marked syncing for the
 * moment it is queued), spread a second apart as a deletion's runs are, and only then marked revoked, all in one
 * transaction, so nobody sees the moment between. Each run then ends its connection's channels and grant (the grant
 * only when no other workspace's connection holds the account) and deletes the row. An expired one goes now with its
 * tokens: its grant is already dead.
 */
async function endCalendarGrants(db: Database, workspaceId: string): Promise<boolean> {
  return db.withWorkspace(workspaceId, async (tx) => {
    await tx.execute(sql`
      update calendar_connections set status = 'syncing'
      where workspace_id = ${workspaceId}::uuid and status = 'failed'
    `);
    await tx.execute(sql`
      select crm_enqueue_calendar_sync(c.id,
        now() + (row_number() over (order by c.id) - 1) * make_interval(secs => ${CALENDAR_SPREAD_SECONDS}))
      from calendar_connections c
      where c.workspace_id = ${workspaceId}::uuid and c.status in ('syncing', 'connected')
    `);
    await tx.execute(sql`
      update calendar_connections
      set status = 'revoked', updated_at = now(), updated_by_type = 'system', updated_by_id = null,
        updated_by_member_id = null
      where workspace_id = ${workspaceId}::uuid and status in ('syncing', 'connected')
    `);
    await tx.execute(sql`
      delete from calendar_connections where workspace_id = ${workspaceId}::uuid and status = 'expired'
    `);
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
  if (deps.files === undefined) {
    const left = await storedFiles(db, workspaceId);
    if (left > 0) deps.log.info('workspace.purge.files_left', { workspaceId, files: left });
  } else {
    for (;;) {
      if (now() > deadline) {
        deps.log.info('workspace.purge', { workspaceId, counts: {}, done: false });
        return 'more';
      }
      const gone = await removeStoredFiles(db, deps.files, deps.log, workspaceId);
      if (gone === 0) break;
    }
  }
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
