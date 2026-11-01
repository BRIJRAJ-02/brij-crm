// Data out (lane wip/crm-dataio) against a real Postgres: a view exported as an
// Excel workbook under exactly the CSV's access rules, and the owner's full
// workspace export: owners only, one at a time, every object's records, the
// lists, notes, tasks and comments and a manifest in one zip in the file
// store, downloadable by its starter alone; with no store it fails plainly.
import { sql } from 'drizzle-orm';
import { strFromU8, unzipSync } from 'fflate';
import { createDatabase } from '@crm/db';
import { afterAll, describe, expect, inject, it } from 'vitest';
import type { RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { createComment } from '../comments/comments.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { deleteRecords } from '../engine/trash.ts';
import { exportFile, exportPart } from '../forms/export.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { saveNote } from '../notes/notes.ts';
import { createTask } from '../tasks/tasks.ts';
import { rescope, testScope } from '../testing.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { startRecordsExport } from './records.ts';
import { startWorkspaceExport, WORKSPACE_EXPORT_RUNNING, type WorkspaceExportStore } from './workspace.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-dataio-tests' });
afterAll(async () => {
  await db.close();
});

const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};
const { team, runnerFor, drive } = jobTestKit(db, ownerUrl, { rules });

/** A file store in memory: what the job put, by path. */
function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const store: WorkspaceExportStore = {
    put(pathname, body) {
      if (files.has(pathname)) return Promise.reject(new Error('A file is already stored there.'));
      files.set(pathname, body);
      return Promise.resolve();
    },
    remove(pathnames) {
      for (const pathname of pathnames) files.delete(pathname);
      return Promise.resolve();
    },
  };
  return { files, store };
}

async function world() {
  const t = await team(['member']);
  const rows = await db.withWorkspace(t.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select a.id::text, a.api_slug, a.object_id::text from attributes a join objects o on o.id = a.object_id where o.api_slug = 'people'`,
    ),
  );
  const people = rows.rows[0]?.object_id ?? '';
  const attribute = (slug: string) => rows.rows.find((row) => row.api_slug === slug)?.id ?? '';
  const person = async (firstName: string, email: string, title: string, owner?: string) =>
    createRecord(t.owner, {
      objectId: people,
      values: {
        [attribute('name')]: { firstName, lastName: 'Test' },
        [attribute('email_addresses')]: [email],
        [attribute('job_title')]: title,
        ...(owner === undefined ? {} : { [attribute('owner')]: { type: 'member', id: owner } }),
      },
    });
  return { ...t, people, attribute, person };
}

describe('a view exported to Excel', () => {
  it('holds what the CSV would, under the same rules, as typed cells with no formula guard', async () => {
    const registry = jobKinds({ environment: 'local' });
    const w = await world();
    await w.person('Ada', 'ada@example.com', '=1+1', w.memberId);
    await w.person('Secret', 'secret@example.com', 'Spy', w.ownerId);
    const own: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.people, attributeId: w.attribute('email_addresses') },
          level: 'hidden',
        },
      ],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: w.people,
          kind: 'own',
          attributeId: w.attribute('owner'),
        },
      ],
    };
    rulesByWorkspace.set(w.workspaceId, own);
    const member = rescope(w.member, { rules: own });
    const started = await startRecordsExport(member, registry, {
      id: newId(),
      objectId: w.people,
      attributeIds: [w.attribute('email_addresses'), w.attribute('job_title')],
      timeZone: 'UTC',
      format: 'xlsx',
    });
    expect(started.fileName).toMatch(/^People - Unsaved view - \d{4}-\d{2}-\d{2}\.xlsx$/u);
    expect((await drive(runnerFor(registry), w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    const file = await exportFile(member, { exportId: started.id });
    expect(file.format).toBe('xlsx');
    let rows = '';
    for (let part = 0; part < file.parts; part += 1) rows += await exportPart(member, { exportId: started.id, part });
    // The name and the title only (the email is hidden), the member's own record only, and `=1+1` left as text.
    expect(rows).toBe(
      '<row><c s="1" t="inlineStr"><is><t xml:space="preserve">Name</t></is></c><c s="1" t="inlineStr"><is><t xml:space="preserve">Job title</t></is></c></row>' +
        '<row><c t="inlineStr"><is><t xml:space="preserve">Ada Test</t></is></c><c t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c></row>',
    );
    expect(await refusalOf(exportFile(w.owner, { exportId: started.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a role without the export permission before anything starts', async () => {
    const registry = jobKinds({ environment: 'local' });
    const t = await team(['guest']);
    const guest = testScope({
      db,
      workspaceId: t.workspaceId,
      actor: { type: 'member', id: t.memberId },
      role: 'guest',
    });
    const objects = await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text from objects where api_slug = 'people'`),
    );
    expect(
      await refusalOf(
        startRecordsExport(guest, registry, {
          id: newId(),
          objectId: objects.rows[0]?.id ?? '',
          attributeIds: [],
          timeZone: 'UTC',
          format: 'xlsx',
        }),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('the full workspace export', () => {
  it('zips every object, the lists, notes, tasks and comments with a manifest, for its owner alone', async () => {
    const { files, store } = memoryStore();
    const registry = jobKinds({ environment: 'local', exportFiles: store });
    const w = await world();
    const ada = await w.person('Ada', 'ada@example.com', 'Analyst');
    await w.person('Bob', 'bob@example.com', '=HYPERLINK("x")');
    await saveNote(w.owner, {
      id: newId(),
      recordId: ada.recordId,
      title: 'Kickoff',
    });
    await createTask(w.owner, {
      id: newId(),
      title: 'Call Ada',
      recordIds: [ada.recordId],
    });
    await createComment(w.owner, {
      id: newId(),
      recordId: ada.recordId,
      body: 'Looks good',
    });

    // A member is refused; the owner starts it, and a second start while it runs is refused.
    expect(await refusalOf(startWorkspaceExport(w.member, registry, { id: newId() }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const started = await startWorkspaceExport(w.owner, registry, { id: newId() });
    expect(started.fileName).toMatch(/^Jobs - Export - \d{4}-\d{2}-\d{2}\.zip$/u);
    expect(await refusalOf(startWorkspaceExport(w.owner, registry, { id: newId() }))).toMatchObject({
      code: 'LIMIT_REACHED',
      message: WORKSPACE_EXPORT_RUNNING,
    });
    // The same id again is the same export.
    expect((await startWorkspaceExport(w.owner, registry, { id: started.id })).jobId).toBe(started.jobId);

    expect((await drive(runnerFor(registry), w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    const file = await exportFile(w.owner, { exportId: started.id });
    expect(file).toMatchObject({ format: 'zip', storagePath: `workspace-exports/${w.workspaceId}/${started.id}.zip` });
    const zip = unzipSync(files.get(file.storagePath ?? '') ?? new Uint8Array());
    const text = (path: string) => strFromU8(zip[path] ?? new Uint8Array());
    const manifest = JSON.parse(text('manifest.json')) as { files: { path: string; rows: number }[] };
    expect(manifest.files.find((each) => each.path === 'records/people.csv')?.rows).toBe(2);
    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining([
        'records/people.csv',
        'records/companies.csv',
        'relationships.csv',
        'lists.csv',
        'notes.jsonl',
        'tasks.jsonl',
        'comments.jsonl',
      ]),
    );
    const people = text('records/people.csv');
    // A byte order mark first (the decoder drops it from the text), so a spreadsheet reads UTF-8.
    expect([...(zip['records/people.csv'] ?? new Uint8Array()).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(people.startsWith('Record ID,Name,')).toBe(true);
    expect(people).toContain(`${ada.recordId},Ada Test,`);
    // A formula like value is guarded, as in a view's CSV.
    expect(people).toContain(`'=HYPERLINK(""x"")`);
    expect(text('notes.jsonl')).toContain('"title":"Kickoff"');
    expect(text('tasks.jsonl')).toContain('"title":"Call Ada"');
    expect(text('comments.jsonl')).toContain('"body":"Looks good"');
    // The chunks went once zipped; nobody but its starter gets the file.
    const left = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from export_chunks where export_id = ${started.id}::uuid`,
      ),
    );
    expect(left.rows[0]?.n).toBe(0);
    expect(await refusalOf(exportFile(w.member, { exportId: started.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('leaves the trash out, stops for a starter demoted mid run, and is no other owner’s to download', async () => {
    const { files, store } = memoryStore();
    const registry = jobKinds({ environment: 'local', exportFiles: store });
    const t = await team(['owner']);
    const other = testScope({
      db,
      workspaceId: t.workspaceId,
      actor: { type: 'member', id: t.memberId },
      role: 'owner',
    });
    const object = await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute<{ id: string; name: string }>(sql`
        select o.id::text, a.id::text as name from objects o
        join attributes a on a.object_id = o.id and a.api_slug = 'name' where o.api_slug = 'companies'`),
    );
    const companies = object.rows[0]?.id ?? '';
    const name = object.rows[0]?.name ?? '';
    await createRecord(t.owner, { objectId: companies, values: { [name]: 'Kept Co' } });
    const gone = await createRecord(t.owner, { objectId: companies, values: { [name]: 'Trashed Co' } });
    await deleteRecords(t.owner, { objectId: companies, recordIds: [gone.recordId], batchId: newId() });

    const started = await startWorkspaceExport(t.owner, registry, { id: newId() });
    expect((await drive(runnerFor(registry), t.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    const file = await exportFile(t.owner, { exportId: started.id });
    const csv = strFromU8(
      unzipSync(files.get(file.storagePath ?? '') ?? new Uint8Array())['records/companies.csv'] ?? new Uint8Array(),
    );
    expect(csv).toContain('Kept Co');
    expect(csv).not.toContain('Trashed Co');
    // Another owner of the same workspace never gets the starter's file.
    expect(await refusalOf(exportFile(other, { exportId: started.id }))).toMatchObject({ code: 'NOT_FOUND' });

    // A starter who stops being an owner while it runs: the next batch ends it, and nothing is kept.
    const again = await startWorkspaceExport(t.owner, registry, { id: newId() });
    await db.withWorkspace(t.workspaceId, (tx) =>
      tx.execute(sql`update members set role = 'member' where id = ${t.ownerId}::uuid`),
    );
    expect((await drive(runnerFor(registry), t.workspaceId, again.jobId)).at(-1)).toBe('failed');
    expect(files.size).toBe(1);
  });

  it('fails plainly where there is no file store, keeping nothing', async () => {
    const registry = jobKinds({ environment: 'local' });
    const w = await world();
    const started = await startWorkspaceExport(w.owner, registry, { id: newId() });
    expect((await drive(runnerFor(registry), w.workspaceId, started.jobId)).at(-1)).toBe('failed');
    expect(await refusalOf(exportFile(w.owner, { exportId: started.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});
