// Files a record's `file` cells hold (27 Oct 2026). A form's file question
// files onto a `file` attribute, and a member attaches one to a cell from the
// record page; either way the bytes get a home the record owns.
//
// Why a home of its own: a form upload's lifecycle belongs to its submission
// (`form_uploads`, #32), and the daily cleanup removes a stored file whose
// submission is gone. A Resume filed onto a record would 404 the day its
// submission was deleted. So filing copies the bytes to a record path and
// records a `record_files` row; the form's copy stays on the form's
// lifecycle, untouched.
//
// Three doors:
// - `prepareRecordFile` and `registerRecordFile`: a member attaching a file
//   to a cell they may write, on a record they may see;
// - `copyFiledFile`: filing's copy, inside the submission's own transaction;
// - `readRecordFile`: a member's download, keyed on the record (never on a
//   submission), so the file outlives the submission, and refused when the
//   field is hidden from them.
//
// Nothing here deletes bytes when a cell is cleared, overwritten, trashed or
// restored: value history still names the id, and a restore must find the
// file. The daily cleanup takes a row only once no live value and no history
// row on that cell names its id (`record_files` phase), exactly as
// `orphanUploads` waits for its submission.
import { RECORD_FILE_KEPT_DAYS, RECORD_FILES_FULL, WORKSPACE_FILE_BYTES } from '@crm/contracts';
import type { FileValue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { inWorkspace } from '../access/run.ts';
import { attributeLevel, checkRecordVisible, UNKNOWN_RECORD } from '../access/visibility.ts';
import { objectLevel } from '../access/policy.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { isArchivedNow, loadAttributes, type AttributeDef } from '../engine/values.ts';

const { recordFiles } = schema;

/** What a file that doesn't exist, or isn't the reader's to open, answers. */
export const UNKNOWN_RECORD_FILE = 'That file does not exist.';

/** What a cell the member may not attach a file to answers. */
export const CELL_NOT_WRITABLE = 'You can’t change this field.';

/** How many files one record's cells may hold at once: the cap a runaway upload loop meets. */
export const RECORD_FILES_PER_RECORD = 100;

/** What a record holding `RECORD_FILES_PER_RECORD` files already answers. */
export const TOO_MANY_RECORD_FILES = RECORD_FILES_FULL;

/** Why one more file can't be kept: its record is full, or the workspace is out of file storage. */
export type FileCapRefusal = 'full' | 'storage';

/**
 * Takes the workspace's file lock for the rest of the transaction, so two uploads at once (a cell's and a Files
 * tab's alike) can't both pass the last of a cap. Taken after the record's own lock, before counting.
 */
export async function lockFileCaps(tx: WorkspaceTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`record_files:${workspaceId}`}, 0))`);
}

/**
 * Which cap, if any, one more file of `size` bytes on `recordId` would pass: `RECORD_FILES_PER_RECORD` live files
 * on the record (cells and Files tab together), or `WORKSPACE_FILE_BYTES` of live files in the workspace (a deleted
 * file waiting out its Undo days counts again only if it is brought back). One statement, under row level security.
 */
export async function fileCapReached(
  tx: WorkspaceTx,
  recordId: string,
  size: number,
): Promise<FileCapRefusal | undefined> {
  const counted = await tx.execute<{ on_record: number; total: string }>(sql`
    select
      (select count(*)::int from record_files where record_id = ${recordId}::uuid and deleted_at is null) as on_record,
      (select coalesce(sum(size), 0)::bigint::text from record_files where deleted_at is null) as total
  `);
  const [row] = counted.rows;
  if ((row?.on_record ?? 0) >= RECORD_FILES_PER_RECORD) return 'full';
  if (Number(row?.total ?? '0') + size > WORKSPACE_FILE_BYTES) return 'storage';
  return undefined;
}

/** A stored file a member may download: where it is kept and how to name it. */
export interface ReadableRecordFile {
  readonly pathname: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** What the record store needs of blob storage, passed in so core stays free of I/O. */
export interface RecordFileStore {
  /** Copies the bytes at `from` to `to`, never overwriting; throws when `from` is gone. */
  copy(from: string, to: string): Promise<void>;
  /** Deletes stored files by pathname; one already gone is not an error. */
  remove(pathnames: readonly string[]): Promise<void>;
}

/** The record and the `file` attribute a cell names, or the refusal that says why not. */
async function fileCell(
  tx: WorkspaceTx,
  scope: EngineScope,
  recordId: string,
  attributeId: string,
  write: boolean,
): Promise<{ readonly recordId: string; readonly attribute: AttributeDef }> {
  const record = checkId(recordId, UNKNOWN_RECORD);
  const attributeKey = checkId(attributeId, UNKNOWN_RECORD_FILE);
  const found = await tx.execute<{ object_id: string }>(
    sql`select object_id::text from records where id = ${record}::uuid and deleted_at is null`,
  );
  const objectId = found.rows[0]?.object_id;
  if (objectId === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD);
  await checkRecordVisible(tx, scope.access, { recordId: record, objectId });
  if (write && objectLevel(scope.access, objectId) !== 'write') throw refuse('FORBIDDEN', CELL_NOT_WRITABLE);
  const attribute = (await loadAttributes(tx, objectId)).get(attributeKey);
  if (attribute === undefined || attribute.type !== 'file' || attribute.isSystem || isArchivedNow(attribute)) {
    throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
  }
  const level = attributeLevel(scope.access, attribute);
  if (level === 'hidden') throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
  if (write && level !== 'write') throw refuse('FORBIDDEN', CELL_NOT_WRITABLE);
  return { recordId: record, attribute };
}

/**
 * Whether this member may attach a file to this cell now, checked before a
 * byte is stored: the record is theirs to see and change, the attribute is a
 * live `file` one they may write, and the record is under its file cap.
 * `full` means nothing was checked further and the caller stores nothing.
 */
export async function prepareRecordFile(
  scope: EngineScope,
  input: { readonly recordId: string; readonly attributeId: string; readonly size?: number },
): Promise<'ok' | FileCapRefusal> {
  return inWorkspace(scope, async (tx) => {
    const cell = await fileCell(tx, scope, input.recordId, input.attributeId, true);
    return (await fileCapReached(tx, cell.recordId, input.size ?? 0)) ?? 'ok';
  });
}

/** What registering a member's record file takes: the id and pathname the api chose, and what it checked. */
export interface RegisterRecordFile {
  readonly recordId: string;
  readonly attributeId: string;
  readonly fileId: string;
  readonly pathname: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/**
 * Records a stored file against its record's cell, and answers the value the
 * cell then takes. The access is checked again here, under the workspace's
 * row level security, so the store's `put` never stands in for a check.
 * `full` means nothing was recorded and the caller deletes what it stored.
 */
export async function registerRecordFile(
  scope: EngineScope,
  input: RegisterRecordFile,
): Promise<FileValue | FileCapRefusal> {
  return inWorkspace(scope, async (tx) => {
    const cell = await fileCell(tx, scope, input.recordId, input.attributeId, true);
    await lockFileCaps(tx, scope.workspaceId);
    const refused = await fileCapReached(tx, cell.recordId, input.size);
    if (refused !== undefined) return refused;
    await tx.insert(recordFiles).values({
      ...(scope.actor.type === 'member' && scope.actor.id !== null ? { createdBy: scope.actor.id } : {}),
      workspaceId: scope.workspaceId,
      id: checkId(input.fileId, UNKNOWN_RECORD_FILE),
      recordId: cell.recordId,
      attributeId: cell.attribute.id,
      pathname: input.pathname,
      name: input.name,
      size: input.size,
      contentType: input.contentType,
    });
    return { fileId: input.fileId, name: input.name, size: input.size, contentType: input.contentType };
  });
}

/** What copying a filed file takes: the record and cell it lands on, and the stored file it comes from. */
export interface CopyFiledFile {
  readonly workspaceId: string;
  readonly recordId: string;
  readonly attributeId: string;
  readonly fileId: string;
  readonly from: string;
  readonly name: string;
  readonly size: number;
  readonly contentType: string;
}

/** Where a record's own copy of a stored file lives. */
export function recordFilePath(workspaceId: string, recordId: string, fileId: string, extension: string): string {
  return `records/${workspaceId}/${recordId}/${fileId}${extension}`;
}

/**
 * Copies a form upload's bytes to a record path and records the row, inside
 * the caller's transaction (the copy before the row, as `orphanUploads`
 * removes before it deletes: a store that fails rolls the row back and the
 * job retries, and the stray copy is swept by the cleanup, which finds no
 * value naming it). Answers the value the cell takes.
 */
export async function copyFiledFile(tx: WorkspaceTx, store: RecordFileStore, input: CopyFiledFile): Promise<FileValue> {
  const extension = /\.[a-z0-9]{1,12}$/i.exec(input.from)?.[0] ?? '';
  const pathname = recordFilePath(input.workspaceId, input.recordId, input.fileId, extension);
  await store.copy(input.from, pathname);
  await tx
    .insert(recordFiles)
    .values({
      workspaceId: input.workspaceId,
      id: input.fileId,
      recordId: input.recordId,
      attributeId: input.attributeId,
      pathname,
      name: input.name,
      size: input.size,
      contentType: input.contentType,
    })
    .onConflictDoNothing();
  return { fileId: input.fileId, name: input.name, size: input.size, contentType: input.contentType };
}

/**
 * The record files nothing names any more, oldest first, locked and skipping
 * the locked: no live value and no history row on their own cell carries the
 * id, and the row is past `graceHours` old, so a file just attached to a cell
 * whose value is still being written is never swept. The one place the rule
 * lives: the daily cleanup's `record_files` phase runs exactly this.
 */
export async function findOrphanRecordFiles(
  tx: WorkspaceTx,
  input: { readonly workspaceId: string; readonly limit: number; readonly graceHours: number },
): Promise<readonly { readonly id: string; readonly pathname: string }[]> {
  const found = await tx.execute<{ id: string; pathname: string }>(sql`
    select f.id::text, f.pathname from record_files f
    where f.workspace_id = ${input.workspaceId}
      and f.created_at < now() - make_interval(hours => ${input.graceHours})
      and (
        (f.attribute_id is not null and not exists (
          select 1 from values v
          where v.workspace_id = f.workspace_id and v.record_id = f.record_id
            and v.attribute_id = f.attribute_id and v.json_value ->> 'fileId' = f.id::text))
        -- A Files tab attachment (#32): deleted past its Undo days, or its record removed for good.
        or (f.attribute_id is null and (
          f.deleted_at < now() - make_interval(days => ${RECORD_FILE_KEPT_DAYS})
          or not exists (select 1 from records r where r.workspace_id = f.workspace_id and r.id = f.record_id))))
    order by f.created_at limit ${input.limit}
    for update skip locked
  `);
  return found.rows;
}

/**
 * The file for a member to download, or NOT_FOUND. The row names the record
 * and the attribute whose cell holds it, and both are checked now: the
 * member must be able to see that record (a trashed one included, as its
 * page still shows), and the attribute must not be hidden from them. The row
 * is read under the member's workspace, so another workspace's id finds
 * nothing. Nothing here reads a submission, so the file keeps working long
 * after the submission that brought it is gone.
 */
export async function readRecordFile(
  scope: EngineScope,
  input: { readonly fileId: string },
): Promise<ReadableRecordFile> {
  const id = checkId(input.fileId, UNKNOWN_RECORD_FILE);
  return inWorkspace(scope, async (tx) => {
    const [row] = await tx
      .select()
      .from(recordFiles)
      .where(and(eq(recordFiles.id, id), isNull(recordFiles.deletedAt)));
    if (row === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
    const found = await tx.execute<{ object_id: string }>(
      sql`select object_id::text from records where id = ${row.recordId}::uuid`,
    );
    const objectId = found.rows[0]?.object_id;
    if (objectId === undefined) throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
    // A record hidden from this member reads exactly as the file not existing.
    if (objectLevel(scope.access, objectId) === 'none') throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
    await checkRecordVisible(tx, scope.access, { recordId: row.recordId, objectId }, UNKNOWN_RECORD_FILE);
    // A Files tab attachment (#32) follows its record alone; a cell's file its field too.
    if (row.attributeId !== null) {
      const attribute = (await loadAttributes(tx, objectId)).get(row.attributeId);
      if (attribute === undefined || attributeLevel(scope.access, attribute) === 'hidden') {
        throw refuse('NOT_FOUND', UNKNOWN_RECORD_FILE);
      }
    }
    return { pathname: row.pathname, name: row.name, size: row.size, contentType: row.contentType };
  });
}
