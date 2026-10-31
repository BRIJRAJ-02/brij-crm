// A record's Files tab (#32), against a real Postgres: adding, listing,
// deleting with Undo, the per record cap and the workspace's storage, who may
// do what (a reader lists and downloads, only a writer changes, another
// workspace and a hidden object find nothing), the `files` outbox row, and the
// daily cleanup taking a deleted file only once its Undo days are over.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { WORKSPACE_FILE_BYTES } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import {
  deleteAttachment,
  listAttachments,
  prepareAttachment,
  registerAttachment,
  restoreAttachment,
} from './attachments.ts';
import { findOrphanRecordFiles, readRecordFile, recordFilePath, RECORD_FILES_PER_RECORD } from './files.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-record-attachments-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Attachments',
    slug: `record-attachments-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const people = created.objects.people ?? '';
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  const recordId = newId();
  await query(sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type)
    values (${created.workspaceId}, ${recordId}, ${people}, 'system', 'system')`);
  return { scope, workspaceId: created.workspaceId, memberId: created.memberId, people, recordId, query };
}
type Workspace = Awaited<ReturnType<typeof workspace>>;

/** The rules a Member reads `people` through at `level`. */
const peopleAt = (people: string, level: string): AccessRules => ({
  ...NO_RULES,
  levels: [{ subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: people }, level }],
});

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

async function add(w: Workspace, size = 9, name = 'proposal.pdf') {
  const fileId = newId();
  const pathname = recordFilePath(w.workspaceId, w.recordId, fileId, '.pdf');
  expect(await prepareAttachment(w.scope, { recordId: w.recordId, size })).toBe('ok');
  const added = await registerAttachment(w.scope, {
    recordId: w.recordId,
    fileId,
    pathname,
    name,
    size,
    contentType: 'application/pdf',
  });
  if (typeof added === 'string') throw new Error(`Refused: ${added}`);
  return { ...added, pathname };
}

describe('a record’s Files tab', () => {
  it('adds a file with who added it, lists it newest first, and downloads it', async () => {
    const w = await workspace();
    const first = await add(w, 9, 'first.pdf');
    const second = await add(w, 12, 'second.pdf');
    expect(second.createdByMemberId).toBe(w.memberId);
    const listed = await listAttachments(w.scope, { recordId: w.recordId });
    expect(listed.canChange).toBe(true);
    expect(listed.files.map((file) => file.name)).toEqual(['second.pdf', 'first.pdf']);
    expect((await readRecordFile(w.scope, { fileId: first.fileId })).pathname).toBe(first.pathname);
  });

  it('stores one `files` outbox row naming the record', async () => {
    const w = await workspace();
    const fileId = newId();
    await registerAttachment(
      w.scope,
      {
        recordId: w.recordId,
        fileId,
        pathname: recordFilePath(w.workspaceId, w.recordId, fileId, '.pdf'),
        name: 'a.pdf',
        size: 3,
        contentType: 'application/pdf',
      },
      [outboxHook({ mutationId: newId() })],
    );
    const rows = await w.query<{ kind: string; record_ids: string[] }>(
      sql`select kind::text, record_ids::text[] from outbox where kind = 'files'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.record_ids).toEqual([w.recordId]);
  });

  it('deletes at once, keeps the file for Undo, and brings it back', async () => {
    const w = await workspace();
    const file = await add(w);
    await deleteAttachment(w.scope, { fileId: file.fileId });
    expect((await listAttachments(w.scope, { recordId: w.recordId })).files).toEqual([]);
    expect(await refusalOf(readRecordFile(w.scope, { fileId: file.fileId }))).toMatchObject({ code: 'NOT_FOUND' });
    // A retried delete answers the same.
    await deleteAttachment(w.scope, { fileId: file.fileId });
    await restoreAttachment(w.scope, { fileId: file.fileId });
    expect((await listAttachments(w.scope, { recordId: w.recordId })).files.map((each) => each.fileId)).toEqual([
      file.fileId,
    ]);
  });

  it('refuses past the record’s cap and the workspace’s storage', async () => {
    const w = await workspace();
    expect(await prepareAttachment(w.scope, { recordId: w.recordId, size: WORKSPACE_FILE_BYTES + 1 })).toBe('storage');
    const rows = Array.from({ length: RECORD_FILES_PER_RECORD }, () => newId());
    await w.query(sql`insert into record_files (workspace_id, id, record_id, pathname, name, size, content_type)
      select ${w.workspaceId}::uuid, id, ${w.recordId}::uuid, 'records/x/' || id::text, 'f.pdf', 1, 'application/pdf'
      from unnest(${`{${rows.join(',')}}`}::uuid[]) as id`);
    expect(await prepareAttachment(w.scope, { recordId: w.recordId, size: 1 })).toBe('full');
  });

  it('refuses an Undo that would take the record past its cap', async () => {
    const w = await workspace();
    const file = await add(w);
    await deleteAttachment(w.scope, { fileId: file.fileId });
    const rows = Array.from({ length: RECORD_FILES_PER_RECORD }, () => newId());
    await w.query(sql`insert into record_files (workspace_id, id, record_id, pathname, name, size, content_type)
      select ${w.workspaceId}::uuid, id, ${w.recordId}::uuid, 'records/x/' || id::text, 'f.pdf', 1, 'application/pdf'
      from unnest(${`{${rows.join(',')}}`}::uuid[]) as id`);
    expect(await refusalOf(restoreAttachment(w.scope, { fileId: file.fileId }))).toMatchObject({
      code: 'LIMIT_REACHED',
    });
  });

  it('lets a reader list and download, and refuses them a change', async () => {
    const w = await workspace();
    const file = await add(w);
    const reader = rescope(w.scope, { role: 'member', rules: peopleAt(w.people, 'read') });
    const listed = await listAttachments(reader, { recordId: w.recordId });
    expect(listed.canChange).toBe(false);
    expect(listed.files).toHaveLength(1);
    expect((await readRecordFile(reader, { fileId: file.fileId })).name).toBe('proposal.pdf');
    expect(await refusalOf(prepareAttachment(reader, { recordId: w.recordId, size: 1 }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(deleteAttachment(reader, { fileId: file.fileId }))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('finds nothing for someone who can’t see the object, or another workspace', async () => {
    const w = await workspace();
    const other = await workspace();
    const file = await add(w);
    const blind = rescope(w.scope, { role: 'member', rules: peopleAt(w.people, 'none') });
    for (const reader of [blind, other.scope]) {
      expect(await refusalOf(listAttachments(reader, { recordId: w.recordId }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await refusalOf(readRecordFile(reader, { fileId: file.fileId }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await refusalOf(deleteAttachment(reader, { fileId: file.fileId }))).toMatchObject({ code: 'NOT_FOUND' });
      expect(await refusalOf(restoreAttachment(reader, { fileId: file.fileId }))).toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  it('refuses a change on a trashed record but still lists its files', async () => {
    const w = await workspace();
    await add(w);
    await w.query(sql`update records set deleted_at = now(), deleted_by_type = 'system' where id = ${w.recordId}`);
    const listed = await listAttachments(w.scope, { recordId: w.recordId });
    expect(listed.canChange).toBe(false);
    expect(listed.files).toHaveLength(1);
    expect(await refusalOf(prepareAttachment(w.scope, { recordId: w.recordId, size: 1 }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('the daily cleanup and attachments', () => {
  it('keeps a live file and one inside its Undo days, and takes one deleted longer ago', async () => {
    const w = await workspace();
    const live = await add(w);
    const recent = await add(w);
    const old = await add(w);
    await deleteAttachment(w.scope, { fileId: recent.fileId });
    await deleteAttachment(w.scope, { fileId: old.fileId });
    await w.query(sql`update record_files set created_at = now() - interval '40 days' where record_id = ${w.recordId}`);
    await w.query(sql`update record_files set deleted_at = now() - interval '31 days' where id = ${old.fileId}`);
    const found = await db.withWorkspace(w.workspaceId, (tx) =>
      findOrphanRecordFiles(tx, { workspaceId: w.workspaceId, limit: 50, graceHours: 24 }),
    );
    expect(found.map((row) => row.id)).toEqual([old.fileId]);
    expect(found.map((row) => row.id)).not.toContain(live.fileId);
  });
});
