// A record's own files (#32): the Files tab on every record, beside the files a
// `file` cell holds. Both are `record_files` rows; an attachment is one with no
// attribute (migration 0153), so the two share one download route, one per
// record cap, the workspace's storage total and the daily cleanup.
//
// Access follows the record, as comments do: whoever may read it (a trashed one
// included, as its page still shows) lists its files and downloads them;
// whoever may change its object, on a live record, adds, deletes and restores.
// A record hidden from the reader answers exactly as a file that doesn't exist.
// Only members add files, so every attachment names who added it.
//
// The api stores the bytes between `prepareAttachment` (checked before a byte
// is stored) and `registerAttachment` (checked again under the workspace's
// lock, where the caps are counted, then the row and its `files` outbox row in
// one transaction). A delete is soft, for Undo: the row keeps its bytes for
// `RECORD_FILE_KEPT_DAYS`, then the daily cleanup's `record_files` phase
// removes both (`findOrphanRecordFiles`).
import {
  RECORD_FILE_KEPT_DAYS,
  RECORD_FILES_FULL,
  WORKSPACE_FILES_FULL,
  type RecordFiles,
  type RecordFileView,
} from '@crm/contracts';
import type { WorkspaceTx } from '@crm/db';
import { sql } from 'drizzle-orm';
import { checkScope } from '../access/mint.ts';
import { objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { checkRecordVisible, UNKNOWN_RECORD } from '../access/visibility.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import {
  fileCapReached,
  lockFileCaps,
  RECORD_FILES_PER_RECORD,
  UNKNOWN_RECORD_FILE,
  type FileCapRefusal,
} from './files.ts';

/** What a reader who may not change the record answers on a write. */
export const FILES_NOT_WRITABLE = 'You can’t change this record’s files.';

/** What anyone but a member answers on a write: a file names the member who added it. */
export const FILES_MEMBERS_ONLY = 'Only members can add files.';

/** Why a file can't be added now: the record is full, or the workspace is out of storage. */
export type AttachmentRefusal = FileCapRefusal;

/** The words each `AttachmentRefusal` is said with. */
export const ATTACHMENT_REFUSALS: Readonly<Record<AttachmentRefusal, string>> = {
  full: RECORD_FILES_FULL,
  storage: WORKSPACE_FILES_FULL,
};

type FileRow = {
  readonly id: string;
  readonly record_id: string;
  readonly name: string;
  readonly size: number;
  readonly content_type: string;
  readonly created_at: string;
  readonly created_by: string | null;
};

const COLUMNS = sql`f.id::text, f.record_id::text, f.name, f.size, f.content_type,
  to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at, f.created_by::text`;

function viewOf(row: FileRow): RecordFileView {
  return {
    fileId: row.id,
    recordId: row.record_id,
    name: row.name,
    size: row.size,
    contentType: row.content_type,
    createdAt: row.created_at,
    ...(row.created_by === null ? {} : { createdByMemberId: row.created_by }),
  };
}

/** The acting member, or `FORBIDDEN`. */
function memberOf(scope: EngineScope): string {
  const { actor, access } = scope;
  if (access.principal.kind !== 'member' || actor.type !== 'member' || actor.id === null) {
    throw refuse('FORBIDDEN', FILES_MEMBERS_ONLY);
  }
  return actor.id;
}

/**
 * The record's object and whether it is live, when the reader may see it (a trashed record included); else
 * `NOT_FOUND`, the same words for a record that doesn't exist and one hidden from them. `lock` takes the record
 * `for key share`, which blocks only its purge, so a file never lands on a record being removed for good.
 */
async function seenRecord(
  tx: WorkspaceTx,
  scope: EngineScope,
  recordId: string,
  message: string,
  lock = false,
): Promise<{ readonly objectId: string; readonly isLive: boolean }> {
  const found = await tx.execute<{ object_id: string; live: boolean }>(sql`
    select r.object_id::text as object_id, (r.deleted_at is null and o.archived_at is null) as live
    from records r join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id
    where r.id = ${recordId}::uuid
    ${lock ? sql`for key share of r` : sql``}
  `);
  const [row] = found.rows;
  if (row === undefined || objectLevel(scope.access, row.object_id) === 'none') throw refuse('NOT_FOUND', message);
  await checkRecordVisible(tx, scope.access, { recordId, objectId: row.object_id }, message);
  return { objectId: row.object_id, isLive: row.live };
}

/** Whether the reader may add, delete and restore files on a record they can see. */
function canChange(scope: EngineScope, record: { readonly objectId: string; readonly isLive: boolean }): boolean {
  return (
    record.isLive && scope.access.principal.kind === 'member' && objectLevel(scope.access, record.objectId) === 'write'
  );
}

/** The record for a write, or the refusal: hidden is `NOT_FOUND`, seen but not changeable `FORBIDDEN`. */
async function writableRecord(tx: WorkspaceTx, scope: EngineScope, recordId: string, lock = false): Promise<string> {
  const record = await seenRecord(tx, scope, recordId, UNKNOWN_RECORD, lock);
  if (!canChange(scope, record)) throw refuse('FORBIDDEN', FILES_NOT_WRITABLE);
  return record.objectId;
}

/** A record's files for its Files tab, newest first, and whether the reader may add or delete them. */
export async function listAttachments(scope: EngineScope, input: { readonly recordId: string }): Promise<RecordFiles> {
  checkScope(scope);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    const record = await seenRecord(tx, scope, recordId, UNKNOWN_RECORD);
    const rows = await tx.execute<FileRow>(sql`
      select ${COLUMNS} from record_files f
      where f.record_id = ${recordId}::uuid and f.attribute_id is null and f.deleted_at is null
      order by f.created_at desc, f.id
      limit ${RECORD_FILES_PER_RECORD}
    `);
    return { files: rows.rows.map(viewOf), canChange: canChange(scope, record) };
  });
}

/**
 * Whether this member may add a file of `size` bytes to this record now, checked before a byte is stored: the
 * record is theirs to see and change, and neither the record's cap nor the workspace's storage would be passed.
 */
export async function prepareAttachment(
  scope: EngineScope,
  input: { readonly recordId: string; readonly size: number },
): Promise<AttachmentRefusal | 'ok'> {
  checkScope(scope);
  memberOf(scope);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  return inWorkspace(scope, async (tx) => {
    await writableRecord(tx, scope, recordId);
    return (await fileCapReached(tx, recordId, input.size)) ?? 'ok';
  });
}

/** What registering a stored attachment takes: the id and pathname the api minted, and what it checked. */
export interface RegisterAttachment {
  readonly recordId: string;
  readonly fileId: string;
  readonly pathname: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/**
 * Records a stored file on its record's Files tab, with its `files` outbox row, in one transaction. The access is
 * checked again here and the caps counted under the workspace's file lock, so two uploads at once can't both pass
 * the last of the storage. A refusal (`full`, `storage`) records nothing and the caller deletes what it stored.
 */
export async function registerAttachment(
  scope: EngineScope,
  input: RegisterAttachment,
  hooks: readonly AfterWrite[] = [],
): Promise<RecordFileView | AttachmentRefusal> {
  checkScope(scope);
  const me = memberOf(scope);
  const recordId = checkId(input.recordId, UNKNOWN_RECORD);
  const fileId = checkId(input.fileId, UNKNOWN_RECORD_FILE);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const objectId = await writableRecord(tx, scope, recordId, true);
      await lockFileCaps(tx, scope.workspaceId);
      const refused = await fileCapReached(tx, recordId, input.size);
      if (refused !== undefined) return refused;
      const inserted = await tx.execute<FileRow>(sql`
        insert into record_files as f (workspace_id, id, record_id, attribute_id, pathname, name, size, content_type,
          created_by)
        values (${scope.workspaceId}::uuid, ${fileId}::uuid, ${recordId}::uuid, null, ${input.pathname},
          ${input.name}, ${input.size}, ${input.contentType}, ${me}::uuid)
        returning ${COLUMNS}
      `);
      const [row] = inserted.rows;
      if (row === undefined) throw new Error('The file row was not stored.');
      context.record({ files: [{ recordId, objectId }] });
      return viewOf(row);
    },
    hooks,
  );
  return result;
}

/** The attachment `fileId` names, locked for its change, with its record writable by this member; else a refusal. */
async function lockedAttachment(
  tx: WorkspaceTx,
  scope: EngineScope,
  fileId: string,
): Promise<{ readonly row: FileRow & { readonly deleted: boolean }; readonly objectId: string }> {
  const found = await tx.execute<FileRow & { deleted: boolean }>(sql`
    select ${COLUMNS}, (f.deleted_at is not null) as deleted from record_files f
    where f.id = ${fileId}::uuid and f.attribute_id is null
    for no key update
  `);
  const [row] = found.rows;
  if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
  const record = await seenRecord(tx, scope, row.record_id, UNKNOWN_RECORD_FILE, true);
  if (!canChange(scope, record)) throw refuse('FORBIDDEN', FILES_NOT_WRITABLE);
  return { row, objectId: record.objectId };
}

/**
 * Deletes a file from its record's Files tab at once, keeping its bytes for Undo (`restoreAttachment`) for
 * `RECORD_FILE_KEPT_DAYS`. A retry of a delete that landed answers the same and writes nothing.
 */
export async function deleteAttachment(
  scope: EngineScope,
  input: { readonly fileId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<RecordFileView> {
  return setDeleted(scope, input.fileId, true, hooks);
}

/** Brings a deleted file back to its record's Files tab: the toast's Undo. A file already there answers as it is. */
export async function restoreAttachment(
  scope: EngineScope,
  input: { readonly fileId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<RecordFileView> {
  return setDeleted(scope, input.fileId, false, hooks);
}

async function setDeleted(
  scope: EngineScope,
  rawId: string,
  deleted: boolean,
  hooks: readonly AfterWrite[],
): Promise<RecordFileView> {
  checkScope(scope);
  memberOf(scope);
  const fileId = checkId(rawId, UNKNOWN_RECORD_FILE);
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const { row, objectId } = await lockedAttachment(tx, scope, fileId);
      if (row.deleted === deleted) return viewOf(row);
      // Back on the record, it counts again: Undo can't take a record past its cap or the workspace past its storage.
      if (!deleted) {
        await lockFileCaps(tx, scope.workspaceId);
        const refused = await fileCapReached(tx, row.record_id, row.size);
        if (refused !== undefined) throw refuse('LIMIT_REACHED', ATTACHMENT_REFUSALS[refused]);
      }
      // A restore past the kept days finds its bytes possibly gone: it reads as no file, as the cleanup will.
      await tx.execute(sql`
        update record_files set deleted_at = ${deleted ? sql`now()` : sql`null`}
        where id = ${fileId}::uuid
        ${deleted ? sql`` : sql`and deleted_at > now() - make_interval(days => ${RECORD_FILE_KEPT_DAYS})`}
      `);
      if (!deleted) {
        const back = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from record_files where id = ${fileId}::uuid and deleted_at is null`,
        );
        if ((back.rows[0]?.n ?? 0) === 0) throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
      }
      context.record({ files: [{ recordId: row.record_id, objectId }] });
      return viewOf(row);
    },
    hooks,
  );
  return result;
}
