// Bulk deletes, restores and the trash (spec 0022, milestone 1). A trashed
// record is a `records` row with `deleted_at` set (spec 0004): a delete of
// many records moves them all in one write, each carrying the delete's batch
// id, so undoing it restores exactly that batch; a restore brings records back
// one savepoint each, so one record whose unique value was taken meanwhile
// stays in the trash while the rest come back. The trash lists every trashed
// record the principal may see, newest first, by keyset.
//
// Locks follow one order for every caller: records in id order (`for no key
// update`), then the workspace counter row last, as every write takes it.
import { sql, type SQL } from 'drizzle-orm';
import type { EngineRefusal } from '@crm/contracts/values';
import type { WorkspaceTx } from '@crm/db';
import { farReferences, liveEntries } from './deletion.ts';
import { checkId, isUuid, uuidArray } from './ids.ts';
import { limitsOf, RESTORE_WINDOW, takeRecordSlots } from './limits.ts';
import { readRecords, type RecordView } from './records.ts';
import { isRefusal, refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { hideRecordsKeys, setRecordKeysLive } from './sort-keys.ts';
import { holdUniqueKeys, releaseUniqueKeys } from './unique.ts';
import {
  runWrite,
  type AfterWrite,
  type EntryRef,
  type RecordRef,
  type ReferenceChange,
  type WriteContext,
} from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { isOpen, objectLevel, type Access } from '../access/policy.ts';
import { checkObject, farVisibleSql, UNKNOWN_OBJECT, visibleRecords } from '../access/visibility.ts';

/** The most records one inline delete or restore changes (spec 0022): more is refused `CONFIG_INVALID`. */
export const MAX_INLINE_RECORDS = 500;

/** What a bulk change of more than 500 records answers until jobs take it (spec 0022, milestone 3). */
export const TOO_MANY_INLINE = 'Changes to more than 500 records arrive soon.';

/** The most rows one page of the trash answers. */
export const MAX_TRASH_PAGE = 200;

/** Where the trash's count stops: past it, "10,000+". */
export const TRASH_COUNT_CAP = 10_000;

/** What a restore of a record past the window, purged or never seen answers. */
const EXPIRED = 'That record was deleted more than 30 days ago.';

/** What undoing a delete answers when none of its records is still in the trash. */
const BATCH_GONE = 'Nothing from that delete is still in the trash.';

/** One record's outcome in a bulk delete. */
export interface DeleteOutcome {
  readonly recordId: string;
  /**
   * `deleted` by this call (or by an earlier try of it with the same batch),
   * `already-deleted` by another delete (with `RECORD_DELETED`), or `refused`
   * (`NOT_FOUND`: unknown, of another object, or hidden from the principal).
   */
  readonly state: 'deleted' | 'already-deleted' | 'refused';
  readonly refusal?: EngineRefusal;
}

/** One record's outcome in a restore. */
export interface RestoreOutcome {
  readonly recordId: string;
  /** `restored` by this call, `live` already (a retry, or restored elsewhere), or `refused` with why. */
  readonly state: 'restored' | 'live' | 'refused';
  readonly refusal?: EngineRefusal;
}

/** The input ids, checked and canonical, each once, in the order asked; 1 to 500 of them. */
function inlineIds(given: readonly string[], message: string): readonly string[] {
  if (given.length === 0) throw refuse('CONFIG_INVALID', 'Choose at least one record.');
  const ids = [...new Set(given.map((id) => checkId(id, message)))];
  if (ids.length > MAX_INLINE_RECORDS) throw refuse('CONFIG_INVALID', TOO_MANY_INLINE);
  return ids;
}

/** Live entries of many records at once: their unique keys are held with their records'. */
async function entriesOf(tx: WorkspaceTx, refs: readonly RecordRef[]): Promise<readonly EntryRef[]> {
  if (refs.length === 0) return [];
  const objectOf = new Map(refs.map((ref) => [ref.recordId, ref.objectId]));
  const rows = await tx.execute<{ id: string; list_id: string; record_id: string }>(sql`
    select id::text, list_id::text, record_id::text from list_entries
    where record_id = any(${uuidArray(refs.map((ref) => ref.recordId))}) and deleted_at is null
    order by record_id, id
  `);
  return rows.rows.map((row) => ({
    entryId: row.id,
    listId: row.list_id,
    recordId: row.record_id,
    objectId: objectOf.get(row.record_id) ?? '',
  }));
}

/**
 * Moves up to 500 records of one object to the trash in one write (spec
 * 0022, AC-524, AC-525): object `write` is checked once for the call (403
 * `FORBIDDEN` on an object the principal may only read, nothing deleted);
 * each record is then deleted, already in the trash, or refused `NOT_FOUND`
 * (unknown, of another object, or outside the principal's record rule). Every
 * record deleted carries `batchId`, so a retry with the same batch answers
 * `deleted` again and changes nothing (AC-540), and undoing it restores
 * exactly that batch. One outbox row per object, as for any write.
 */
export async function deleteRecords(
  scope: EngineScope,
  input: { readonly objectId: string; readonly recordIds: readonly string[]; readonly batchId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly DeleteOutcome[]> {
  const objectId = checkId(input.objectId, UNKNOWN_OBJECT);
  const batchId = checkId(input.batchId, 'Give the delete a batch id.');
  const ids = inlineIds(input.recordIds, 'That record does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await checkObject(tx, scope.access, objectId, 'read');
      await checkObject(tx, scope.access, objectId, 'write');
      // One order for every caller, so two bulk deletes over the same records never deadlock.
      const locked = await tx.execute<{ id: string; deleted: boolean; batch: string | null }>(sql`
        select id::text, deleted_at is not null as deleted, deleted_batch_id::text as batch from records
        where object_id = ${objectId}::uuid and id = any(${uuidArray(ids)})
        order by id for no key update
      `);
      const seen = await visibleRecords(
        tx,
        scope.access,
        locked.rows.map((row) => ({ objectId, recordId: row.id })),
      );
      const rows = new Map(locked.rows.filter((row) => seen.has(row.id)).map((row) => [row.id, row]));
      const live = [...rows.values()].filter((row) => !row.deleted).map((row) => row.id);
      if (live.length > 0) {
        const by = actorRow(scope.actor);
        await tx.execute(sql`
          update records set deleted_at = clock_timestamp(), deleted_by_type = ${by.type}::actor_type,
            deleted_by_id = ${by.id}::uuid, deleted_by_member_id = ${by.memberId}::uuid,
            deleted_batch_id = ${batchId}::uuid, revision = revision + 1
          where id = any(${uuidArray(live)})
        `);
        const refs = live.map((recordId) => ({ recordId, objectId }));
        const entries = await entriesOf(tx, refs);
        const references: ReferenceChange[] = [];
        const coarse = new Set<string>();
        // Each record's far references, cut at the cap per relationship end (spec 0007, AC-83).
        for (const ref of refs) {
          const far = await farReferences(tx, ref);
          for (const each of far.references) references.push(each);
          for (const each of far.coarseObjects) coarse.add(each);
        }
        await holdUniqueKeys(tx, [...live, ...entries.map((entry) => entry.entryId)]);
        await hideRecordsKeys(tx, live);
        // Last, as every write takes the counter row.
        await takeRecordSlots(tx, scope, -live.length);
        context.record({ deletedRecords: refs, hiddenEntries: entries, references, coarseObjects: [...coarse] });
      }
      const isLive = new Set(live);
      return ids.map((recordId): DeleteOutcome => {
        const row = rows.get(recordId);
        if (row === undefined) {
          return { recordId, state: 'refused', refusal: { code: 'NOT_FOUND', message: 'That record does not exist.' } };
        }
        if (isLive.has(recordId) || row.batch === batchId) return { recordId, state: 'deleted' };
        return {
          recordId,
          state: 'already-deleted',
          refusal: { code: 'RECORD_DELETED', message: 'That record was already deleted.' },
        };
      });
    },
    hooks,
  );
  return result;
}

/** A trashed record's row as a restore reads it under its lock. */
type LockedTrash = {
  readonly id: string;
  readonly object_id: string;
  readonly deleted: boolean;
  readonly expired: boolean;
};

/** An object's plural name, for the read only refusal. */
async function pluralNames(tx: WorkspaceTx, objectIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
  if (objectIds.length === 0) return new Map();
  const rows = await tx.execute<{ id: string; name: string }>(
    sql`select id::text, plural_name as name from objects where id = any(${uuidArray(objectIds)})`,
  );
  return new Map(rows.rows.map((row) => [row.id, row.name]));
}

/**
 * Restores locked rows inside a write, in id order, each in its own
 * savepoint: hidden and unknown records answer `NOT_FOUND`, an object the
 * principal may only read `FORBIDDEN` (spec 0009's words), a record past the
 * window `NOT_FOUND`, one whose unique value another record took meanwhile
 * `UNIQUE_CONFLICT` (naming only attributes the principal sees), and records
 * past the workspace's free record slots `LIMIT_REACHED`. The counter row is
 * taken last; when creates elsewhere took the slots in between, the whole
 * call refuses `LIMIT_REACHED` and restores nothing, which a retry resolves.
 */
async function restoreLocked(
  context: WriteContext,
  ids: readonly string[],
  locked: readonly LockedTrash[],
): Promise<readonly RestoreOutcome[]> {
  const { tx, scope } = context;
  const { access } = scope;
  const seen = await visibleRecords(
    tx,
    access,
    locked.map((row) => ({ objectId: row.object_id, recordId: row.id })),
  );
  const rows = new Map(locked.filter((row) => seen.has(row.id)).map((row) => [row.id, row]));
  const readOnly = isOpen(access)
    ? new Set<string>()
    : new Set([...rows.values()].map((row) => row.object_id).filter((id) => objectLevel(access, id) === 'read'));
  const names = await pluralNames(tx, [...readOnly]);
  // The free slots, read without the counter row's lock: every write takes it last, and so does this one.
  const counters = await tx.execute<{ live: number }>(
    sql`select live_records as live from workspace_counters where workspace_id = ${scope.workspaceId}::uuid`,
  );
  const limit = limitsOf(scope).liveRecords;
  let free = limit - (counters.rows[0]?.live ?? 0);
  const full = `Your workspace holds ${limit.toLocaleString('en')} records, the most it can. Delete some before restoring.`;
  const outcomes = new Map<string, RestoreOutcome>();
  let restored = 0;
  for (const id of [...ids].sort()) {
    const row = rows.get(id);
    if (row === undefined || (row.deleted && row.expired)) {
      outcomes.set(id, { recordId: id, state: 'refused', refusal: { code: 'NOT_FOUND', message: EXPIRED } });
      continue;
    }
    if (readOnly.has(row.object_id)) {
      const message = `You can view ${names.get(row.object_id) ?? 'these records'} but not change them.`;
      outcomes.set(id, { recordId: id, state: 'refused', refusal: { code: 'FORBIDDEN', message } });
      continue;
    }
    if (!row.deleted) {
      outcomes.set(id, { recordId: id, state: 'live' });
      continue;
    }
    if (free <= 0) {
      outcomes.set(id, { recordId: id, state: 'refused', refusal: { code: 'LIMIT_REACHED', message: full } });
      continue;
    }
    const ref = { recordId: id, objectId: row.object_id };
    const done = await context.perRecord(async (part) => {
      const entries = await liveEntries(part.tx, ref);
      const far = await farReferences(part.tx, ref);
      await releaseUniqueKeys(part.tx, access, [id, ...entries.map((entry) => entry.entryId)]);
      await part.tx.execute(sql`
        update records set deleted_at = null, deleted_by_type = null, deleted_by_id = null,
          deleted_by_member_id = null, deleted_batch_id = null, revision = revision + 1
        where id = ${id}::uuid
      `);
      await setRecordKeysLive(part.tx, id, true);
      part.record({ restoredRecords: [ref], shownEntries: entries, ...far });
    });
    if (done.ok) {
      restored += 1;
      free -= 1;
      outcomes.set(id, { recordId: id, state: 'restored' });
    } else {
      const [refusal] = done.refusals;
      outcomes.set(id, {
        recordId: id,
        state: 'refused',
        refusal: refusal ?? { code: 'UNIQUE_CONFLICT', message: 'Another record now has one of its unique values.' },
      });
    }
  }
  if (restored > 0) {
    try {
      // Last, as every write takes the counter row.
      await takeRecordSlots(tx, scope, restored);
    } catch (error) {
      if (isRefusal(error) && error.refusal.code === 'LIMIT_REACHED') throw refuse('LIMIT_REACHED', full);
      throw error;
    }
  }
  return ids.map(
    (id) => outcomes.get(id) ?? { recordId: id, state: 'refused', refusal: { code: 'NOT_FOUND', message: EXPIRED } },
  );
}

/** Locks rows for a restore, in id order (at most `limit`): the records `where` names, wherever their object. */
function lockForRestore(tx: WorkspaceTx, where: SQL, limit?: number) {
  return tx.execute<LockedTrash>(sql`
    select id::text, object_id::text, deleted_at is not null as deleted,
      coalesce(deleted_at < now() - ${RESTORE_WINDOW}::interval, false) as expired
    from records where ${where}
    order by id ${limit === undefined ? sql`` : sql`limit ${limit}`} for no key update
  `);
}

/**
 * Brings up to 500 records of any objects back from the trash in one write
 * (spec 0022, AC-534), each in its own savepoint, so one that can't come back
 * stays in the trash with its reason while the rest return with their links,
 * entries, history and unique values. Answers each record in the order asked.
 */
export async function restoreRecords(
  scope: EngineScope,
  input: { readonly recordIds: readonly string[] },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly RestoreOutcome[]> {
  const ids = inlineIds(input.recordIds, EXPIRED);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const locked = await lockForRestore(context.tx, sql`id = any(${uuidArray(ids)})`);
      return restoreLocked(context, ids, locked.rows);
    },
    hooks,
  );
  return result;
}

/**
 * Undoes a delete (spec 0022, AC-526): restores the records still in the
 * trash with that delete's batch id, and only those (a record restored and
 * deleted again since carries another batch). Records the principal can't
 * see are left out unnamed. `NOT_FOUND` when none is left; more than 500
 * (only a delete job makes such a batch) waits for milestone 3's jobs.
 */
export async function restoreBatch(
  scope: EngineScope,
  input: { readonly batchId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly RestoreOutcome[]> {
  const batchId = checkId(input.batchId, BATCH_GONE);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      // Through `records_trash_batch`; one past the limit, to know the batch is too big.
      const locked = await lockForRestore(
        tx,
        sql`deleted_batch_id = ${batchId}::uuid and deleted_at is not null`,
        MAX_INLINE_RECORDS + 1,
      );
      const seen = await visibleRecords(
        tx,
        scope.access,
        locked.rows.map((row) => ({ objectId: row.object_id, recordId: row.id })),
      );
      const rows = locked.rows.filter((row) => seen.has(row.id));
      if (rows.length === 0) throw refuse('NOT_FOUND', BATCH_GONE);
      if (locked.rows.length > MAX_INLINE_RECORDS) throw refuse('CONFIG_INVALID', TOO_MANY_INLINE);
      return restoreLocked(
        context,
        rows.map((row) => row.id),
        rows,
      );
    },
    hooks,
  );
  return result;
}

/** One record in the trash, as the trash lists it. */
export interface TrashEntry {
  readonly recordId: string;
  readonly objectId: string;
  /** Its name and look (spec 0004, AC-19): "Unnamed <singular>" when the name is empty or hidden from the reader. */
  readonly display: RecordView['display'];
  readonly deletedAt: string;
  readonly deletedBy: { readonly type: 'member' | 'api_key' | 'automation' | 'system'; readonly id: string | null };
  /** When the daily cleanup removes it for good: 30 days after the delete. */
  readonly expiresAt: string;
}

/** A page of the trash, and the cursor for the next when there are more. */
export interface TrashPage {
  readonly items: readonly TrashEntry[];
  readonly nextCursor?: string;
}

/** A page cursor: the last row's delete time (Postgres's JSON text, to the microsecond) and id. */
function encodeTrashCursor(at: string, id: string): string {
  return Buffer.from(JSON.stringify([at, id]), 'utf8').toString('base64url');
}

/** The keyset a cursor names, or `FILTER_INVALID` when it doesn't decode. */
function decodeTrashCursor(cursor: string): { readonly at: string; readonly id: string } {
  const bad = () => refuse('FILTER_INVALID', "That page of the trash can't be read. Start again from the top.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw bad();
  const [at, id] = parsed as unknown[];
  // Postgres's JSON form of the time, to the microsecond: checked here, so only a valid one reaches the cast.
  const shape = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
  if (typeof at !== 'string' || !shape.test(at) || Number.isNaN(Date.parse(at)) || !isUuid(id)) throw bad();
  return { at, id };
}

/**
 * The condition that keeps the trashed records the principal may see (spec
 * 0009): never an object at `none`, and on an object with a record rule only
 * those inside it. Undefined under the open policy. One object when given.
 */
async function trashScope(tx: WorkspaceTx, access: Access, objectId: string | undefined): Promise<SQL> {
  const parts: SQL[] = [sql`r.deleted_at is not null`];
  if (objectId !== undefined) {
    await checkObject(tx, access, objectId, 'read');
    parts.push(sql`r.object_id = ${objectId}::uuid`);
  }
  if (!isOpen(access)) {
    const objects = await tx.execute<{ id: string }>(sql`select id::text from objects`);
    const visible = farVisibleSql(access, objectId === undefined ? objects.rows.map((row) => row.id) : [objectId], 'r');
    if (visible !== undefined) parts.push(visible);
  }
  return sql.join(parts, sql` and `);
}

/**
 * A page of the trash (spec 0022, AC-533): the trashed records of every
 * object the principal may read (or of one), most recently deleted first, by
 * keyset (`deleted_at` desc, `id` desc), through `records_trash_time` or
 * `records_trash_object`. Records the principal can't see are absent; a
 * hidden name reads "Unnamed <singular>", like an empty one.
 */
export async function queryTrash(
  scope: EngineScope,
  input: { readonly objectId?: string; readonly cursor?: string; readonly limit?: number } = {},
): Promise<TrashPage> {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRASH_PAGE) {
    throw refuse('CONFIG_INVALID', `Ask for 1 to ${String(MAX_TRASH_PAGE)} rows.`);
  }
  const objectId = input.objectId === undefined ? undefined : checkId(input.objectId, UNKNOWN_OBJECT);
  const after = input.cursor === undefined ? undefined : decodeTrashCursor(input.cursor);
  return inWorkspace(scope, async (tx) => {
    const where = await trashScope(tx, scope.access, objectId);
    const keyset =
      after === undefined ? sql`true` : sql`(r.deleted_at, r.id) < (${after.at}::timestamptz, ${after.id}::uuid)`;
    const found = await tx.execute<{
      id: string;
      object_id: string;
      at: string;
      deleted_at: string;
      expires_at: string;
      by_type: 'member' | 'api_key' | 'automation' | 'system';
      by_id: string | null;
    }>(sql`
      select r.id::text, r.object_id::text, to_json(r.deleted_at) #>> '{}' as at,
        to_char(r.deleted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as deleted_at,
        to_char((r.deleted_at + ${RESTORE_WINDOW}::interval) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as expires_at,
        r.deleted_by_type::text as by_type, r.deleted_by_id::text as by_id
      from records r
      where ${where} and ${keyset}
      order by r.deleted_at desc, r.id desc
      limit ${limit + 1}
    `);
    const rows = found.rows.slice(0, limit);
    const views = await readRecords(
      tx,
      scope.access,
      rows.map((row) => row.id),
      { trashed: true, attributeIds: [], visibleAlready: true },
    );
    const displays = new Map(views.map((view) => [view.id, view.display]));
    const items = rows.flatMap((row): TrashEntry[] => {
      const display = displays.get(row.id);
      if (display === undefined) return [];
      return [
        {
          recordId: row.id,
          objectId: row.object_id,
          display,
          deletedAt: row.deleted_at,
          deletedBy: { type: row.by_type, id: row.by_type === 'system' ? null : row.by_id },
          expiresAt: row.expires_at,
        },
      ];
    });
    const last = rows.at(-1);
    return found.rows.length > limit && last !== undefined
      ? { items, nextCursor: encodeTrashCursor(last.at, last.id) }
      : { items };
  });
}

/** How many records the trash holds for the principal (or of one object): exact up to 10,000, then `atLeast`. */
export async function countTrash(
  scope: EngineScope,
  input: { readonly objectId?: string } = {},
): Promise<{ readonly count: number; readonly atLeast: boolean }> {
  const objectId = input.objectId === undefined ? undefined : checkId(input.objectId, UNKNOWN_OBJECT);
  return inWorkspace(scope, async (tx) => {
    const where = await trashScope(tx, scope.access, objectId);
    const counted = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from (select 1 from records r where ${where} limit ${TRASH_COUNT_CAP + 1}) capped
    `);
    const n = counted.rows[0]?.n ?? 0;
    return n > TRASH_COUNT_CAP ? { count: TRASH_COUNT_CAP, atLeast: true } : { count: n, atLeast: false };
  });
}
