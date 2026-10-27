// Files a record's `file` cells hold (27 Oct 2026), against a real Postgres:
// a `file` attribute exists now that the picker offers one; a form's file
// answer is copied into a home the record owns, so the submission's own
// upload can go without taking the record's bytes with it; a member's own
// attachment onto a cell; the download keyed on the record, refused across
// workspaces and for a hidden field; and the daily cleanup taking a file
// only once no value and no history row names it.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { FormDocument, FormQuestion, SubmitBody } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { enterPublicForm } from '../access/door.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { isRefusal } from '../engine/refusals.ts';
import { getRecords } from '../engine/records.ts';
import { SYSTEM_ACTOR } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { runWrite } from '../engine/write.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { testScope } from '../testing.ts';
import { createForm, publishForm, saveFormDraft } from '../forms/forms.ts';
import { processSubmission } from '../forms/process.ts';
import { submitForm } from '../forms/public.ts';
import { registerUpload } from '../forms/uploads.ts';
import {
  findOrphanRecordFiles,
  prepareRecordFile,
  readRecordFile,
  recordFilePath,
  registerRecordFile,
  type RecordFileStore,
} from './files.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-record-files-tests' });
});
afterAll(async () => {
  await db.close();
});

/** A store that keeps its bytes in a map, so a test sees exactly what was copied and what was removed. */
function memoryStore(): RecordFileStore & { readonly kept: Map<string, string> } {
  const kept = new Map<string, string>();
  return {
    kept,
    copy: (from, to) => {
      const found = kept.get(from);
      if (found === undefined) return Promise.reject(new Error('The file to copy is no longer stored.'));
      kept.set(to, found);
      return Promise.resolve();
    },
    remove: (pathnames) => {
      for (const pathname of pathnames) kept.delete(pathname);
      return Promise.resolve();
    },
  };
}

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Files',
    slug: `record-files-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const system = testScope({ db, workspaceId: created.workspaceId, actor: SYSTEM_ACTOR });
  const people = created.objects.people ?? '';
  const query = <T extends Record<string, unknown>>(text: ReturnType<typeof sql>) =>
    db.withWorkspace(created.workspaceId, (tx) => tx.execute<T>(text)).then((result) => result.rows);
  // A Resume field: the picker offers `file` since 27 Oct 2026, so one can exist at all.
  const resume = await createAttribute(scope, { objectId: people, id: newId(), title: 'Resume', type: 'file' });
  return { scope, system, workspaceId: created.workspaceId, people, resume, query };
}

type Workspace = Awaited<ReturnType<typeof workspace>>;

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const question = (
  changes: Partial<FormQuestion> & Pick<FormQuestion, 'id' | 'key' | 'label' | 'answerType'>,
): FormQuestion => ({ required: false, update: 'fill', ...changes });

/** A People form whose Resume question files onto the `file` attribute, published. */
async function resumeForm(w: Workspace) {
  const created = await createForm(w.scope, { id: newId(), name: 'Apply' });
  const document: FormDocument = {
    ...created.draft,
    questions: [
      ...created.draft.questions,
      question({
        id: 'resume',
        key: 'resume',
        label: 'Resume',
        answerType: 'file',
        filedOn: { objectRole: 'main', attributeId: w.resume.id },
      }),
    ],
  };
  const saved = await saveFormDraft(w.scope, { formId: created.id, document, expectedRevision: created.revision });
  return publishForm(w.scope, { formId: created.id, expectedRevision: saved.revision });
}

/** Stores a file against the form as the upload route does, and answers the id an answer names. */
async function upload(w: Workspace, publicKey: string, store: RecordFileStore & { kept: Map<string, string> }) {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  const fileId = newId();
  const pathname = `forms/${w.workspaceId}/${formId}/${fileId}.pdf`;
  store.kept.set(pathname, 'the resume bytes');
  const registered = await registerUpload(scope, {
    formId,
    fileId,
    pathname,
    name: 'resume.pdf',
    size: 17,
    contentType: 'application/pdf',
  });
  expect(registered).toBe('ok');
  return { fileId, pathname, formId };
}

const body = (answers: Record<string, unknown>): SubmitBody => ({
  idempotencyKey: newId(),
  answers,
  hidden: {},
  fillMs: 10_000,
});

/** Submits to a live form and answers the id of the submission it stored (submit itself answers no id). */
async function submit(w: Workspace, publicKey: string, answers: Record<string, unknown>): Promise<string> {
  const { scope, formId } = await enterPublicForm({ db }, publicKey);
  await submitForm(scope, jobKinds({ environment: 'local' }), {
    formId,
    body: body(answers),
    captcha: { kind: 'off' },
    answersKey: 'a-test-answers-key',
  });
  const [row] = await w.query<{ id: string }>(
    sql`select id::text from form_submissions order by received_at desc, id desc limit 1`,
  );
  if (row === undefined) throw new Error('No submission.');
  return row.id;
}

describe('a form’s file answer filed onto a record', () => {
  it('copies the bytes into a home the record owns, and the file still downloads once the upload row is gone', async () => {
    const w = await workspace();
    const store = memoryStore();
    const form = await resumeForm(w);
    const file = await upload(w, form.publicKey, store);
    const submissionId = await submit(w, form.publicKey, {
      name: 'Bea',
      email: 'bea@example.com',
      resume: { fileId: file.fileId },
    });
    await runWrite(w.system, (context) => processSubmission(context, submissionId, new Date(), store));

    const filed = await w.query<{ record_id: string; attribute_id: string; pathname: string; id: string }>(
      sql`select id::text, record_id::text, attribute_id::text, pathname from record_files`,
    );
    const row = filed[0];
    expect(filed).toHaveLength(1);
    if (row === undefined) throw new Error('No record file.');
    // A home of its own: a new id, a record path, and the form's copy untouched beside it.
    expect(row.attribute_id).toBe(w.resume.id);
    expect(row.id).not.toBe(file.fileId);
    expect(row.pathname).toBe(recordFilePath(w.workspaceId, row.record_id, row.id, '.pdf'));
    expect(store.kept.get(row.pathname)).toBe('the resume bytes');
    expect(store.kept.get(file.pathname)).toBe('the resume bytes');

    // The cell names the record's own file, never the submission's.
    const read = await getRecords(w.scope, { ids: [row.record_id] });
    const cell = read[0]?.values[w.resume.id];
    expect(cell).toEqual({ fileId: row.id, name: 'resume.pdf', size: 17, contentType: 'application/pdf' });

    // The submission and its upload go; the record's file is keyed on the record, so it still downloads.
    await db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`delete from form_uploads`));
    await db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`delete from form_submissions`));
    expect(await readRecordFile(w.scope, { fileId: row.id })).toEqual({
      pathname: row.pathname,
      name: 'resume.pdf',
      size: 17,
      contentType: 'application/pdf',
    });
  });

  it('files nothing and says so when there is no store to copy into', async () => {
    const w = await workspace();
    const store = memoryStore();
    const form = await resumeForm(w);
    const file = await upload(w, form.publicKey, store);
    const submissionId = await submit(w, form.publicKey, {
      name: 'Cal',
      email: 'cal@example.com',
      resume: { fileId: file.fileId },
    });
    await runWrite(w.system, (context) => processSubmission(context, submissionId));
    expect(await w.query(sql`select id from record_files`)).toEqual([]);
    const [submission] = await w.query<{ state: string; outcome: { refused: { message: string }[] } }>(
      sql`select state, outcome from form_submissions where id = ${submissionId}`,
    );
    expect(submission?.state).toBe('processed');
    expect(submission?.outcome.refused[0]?.message).toMatch(/can’t be filed onto a record/);
  });
});

describe('a member’s own attachment, and who may read it', () => {
  async function attached(w: Workspace) {
    const recordId = newId();
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`insert into records (workspace_id, id, object_id, created_by_type, updated_by_type)
        values (${w.workspaceId}, ${recordId}, ${w.people}, 'system', 'system')`),
    );
    const fileId = newId();
    const pathname = recordFilePath(w.workspaceId, recordId, fileId, '.pdf');
    expect(await prepareRecordFile(w.scope, { recordId, attributeId: w.resume.id })).toBe('ok');
    const value = await registerRecordFile(w.scope, {
      recordId,
      attributeId: w.resume.id,
      fileId,
      pathname,
      name: 'cv.pdf',
      size: 9,
      contentType: 'application/pdf',
    });
    return { recordId, fileId, pathname, value };
  }

  it('records the file against its cell and reads it back', async () => {
    const w = await workspace();
    const file = await attached(w);
    expect(file.value).toEqual({ fileId: file.fileId, name: 'cv.pdf', size: 9, contentType: 'application/pdf' });
    expect((await readRecordFile(w.scope, { fileId: file.fileId })).pathname).toBe(file.pathname);
  });

  it('finds nothing for another workspace’s id, or for an id that is no id at all', async () => {
    const w = await workspace();
    const other = await workspace();
    const file = await attached(w);
    expect(await refusalOf(readRecordFile(other.scope, { fileId: file.fileId }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(readRecordFile(w.scope, { fileId: 'not-an-id' }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a cell whose attribute isn’t a live file one', async () => {
    const w = await workspace();
    const file = await attached(w);
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update attributes set archived_at = now() where id = ${w.resume.id}`),
    );
    expect(
      await refusalOf(prepareRecordFile(w.scope, { recordId: file.recordId, attributeId: w.resume.id })),
    ).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('the daily cleanup’s lazy deletion', () => {
  it('keeps a file a value names, and takes one nothing names once the day has passed', async () => {
    const w = await workspace();
    const store = memoryStore();
    const form = await resumeForm(w);
    const file = await upload(w, form.publicKey, store);
    const submissionId = await submit(w, form.publicKey, {
      name: 'Dee',
      email: 'dee@example.com',
      resume: { fileId: file.fileId },
    });
    await runWrite(w.system, (context) => processSubmission(context, submissionId, new Date(), store));
    const [row] = await w.query<{ id: string; pathname: string }>(sql`select id::text, pathname from record_files`);
    if (row === undefined) throw new Error('No record file.');
    const orphans = () =>
      db.withWorkspace(w.workspaceId, (tx) =>
        findOrphanRecordFiles(tx, { workspaceId: w.workspaceId, limit: 100, graceHours: 24 }),
      );
    // Fresh: within the day's grace, so it is never swept, whatever names it.
    expect(await orphans()).toEqual([]);
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update record_files set created_at = now() - interval '3 days'`),
    );
    // Old, but the cell's live value still names it.
    expect(await orphans()).toEqual([]);

    // Cleared: the cell holds nothing now, but the history row still names the file, so it stays.
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`update values set active_until = now() where attribute_id = ${w.resume.id}`),
    );
    expect(await orphans()).toEqual([]);

    // The history goes too (an erase or a purge): now nothing names it, and the sweep takes it.
    await db.withWorkspace(w.workspaceId, (tx) => tx.execute(sql`delete from values`));
    expect(await orphans()).toEqual([{ id: row.id, pathname: row.pathname }]);
  });
});
