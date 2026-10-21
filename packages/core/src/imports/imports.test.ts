// Imports (spec 0040) against a real Postgres as the app login, the job
// driven slice by slice as Graphile Worker would: creating one with its
// settings checked, staging rows (the matched count), starting, the job's
// creates, fills, overwrites and skips through the engine, rows of one file
// that share a key acting on one record, refused rows, the starter only
// door, a key held by a record the member can't read, and the limits.
import { sql } from 'drizzle-orm';
import type { ImportSettings } from '@crm/contracts';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { afterAll, describe, expect, inject, it } from 'vitest';
import type { RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, getRecords, setRecordValues } from '../engine/records.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope } from '../testing.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { mergeValue } from './kind.ts';
import { createImport, getImport, listImportRefusals, stageImportRows, startImport, undoImport } from './service.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-imports-tests' });
afterAll(async () => {
  await db.close();
});

const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>(sql`select current_setting('app.workspace_id', true) as id`);
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? NO_RULES;
};
const { team, runnerFor, drive } = jobTestKit(db, ownerUrl, { rules });
const registry = jobKinds({ environment: 'local' });

async function world() {
  const t = await team(['member', 'admin', 'member']);
  const rows = await db.withWorkspace(t.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select a.id::text, a.api_slug, a.object_id::text from attributes a join objects o on o.id = a.object_id where o.api_slug = 'people'`,
    ),
  );
  const people = rows.rows[0]?.object_id ?? '';
  const attribute = (slug: string) => rows.rows.find((row) => row.api_slug === slug)?.id ?? '';
  const settings = (overrides: Partial<ImportSettings> = {}): ImportSettings => ({
    columns: [
      { header: 'Name', target: { attributeId: attribute('name') } },
      { header: 'Email', target: { attributeId: attribute('email_addresses') } },
      { header: 'Title', target: { attributeId: attribute('job_title') } },
      { header: 'Notes' },
    ],
    matchAttributeId: attribute('email_addresses'),
    onMatch: 'fill',
    onNoMatch: 'create',
    ...overrides,
  });
  const row = (rowNumber: number, name: string, email?: string, title?: string) => ({
    rowNumber,
    values: {
      [attribute('name')]: { firstName: name },
      ...(email === undefined ? {} : { [attribute('email_addresses')]: [email] }),
      ...(title === undefined ? {} : { [attribute('job_title')]: title }),
    },
  });
  const person = async (firstName: string, email: string, title?: string, owner?: string) =>
    (
      await createRecord(t.owner, {
        objectId: people,
        values: {
          [attribute('name')]: { firstName },
          [attribute('email_addresses')]: [email],
          ...(title === undefined ? {} : { [attribute('job_title')]: title }),
          ...(owner === undefined ? {} : { [attribute('owner')]: { type: 'member', id: owner } }),
        },
      })
    ).recordId;
  return { ...t, people, attribute, settings, row, person };
}

type World = Awaited<ReturnType<typeof world>>;

/** People by email, with their job title, as the owner reads them. */
async function byEmail(w: World) {
  const found = await testQuery<{ email: string; title: string | null; n: number }>(
    ownerUrl,
    `select e.text_value as email, max(t.text_value) as title, count(distinct r.id)::int as n
     from records r
     join "values" e on e.record_id = r.id and e.attribute_id = $2 and e.active_until is null and not e.is_cleared
     left join "values" t on t.record_id = r.id and t.attribute_id = $3 and t.active_until is null and not t.is_cleared
     where r.workspace_id = $1 and r.deleted_at is null group by e.text_value order by 1`,
    [w.workspaceId, w.attribute('email_addresses'), w.attribute('job_title')],
  );
  return Object.fromEntries(found.map((each) => [each.email, { title: each.title, n: each.n }]));
}

/** Creates, stages, starts and drives an import to its end, answering its view. */
async function runImport(w: World, scope: World['owner'], settings: ImportSettings, rows: ReturnType<World['row']>[]) {
  const id = newId();
  await createImport(scope, {
    id,
    objectId: w.people,
    fileName: 'people.csv',
    rowCount: rows.length,
    errorRows: 0,
    settings,
  });
  const staged = await stageImportRows(scope, { importId: id, rows }, [outboxHook()]);
  const started = await startImport(scope, registry, id, [outboxHook()]);
  expect(started.status).toBe('started');
  expect(started.jobId).toBeDefined();
  const outcomes = await drive(runnerFor(registry), w.workspaceId, started.jobId ?? '');
  expect(outcomes.at(-1)).toBe('succeeded');
  return { id, staged, view: await getImport(scope, id) };
}

describe('imports (AC-1117 to AC-1127)', () => {
  it('creates new people, fills an existing one, and makes one record of rows sharing an email', async () => {
    const w = await world();
    await w.person('Ada', 'ada@example.com');
    const { staged, view } = await runImport(w, w.owner, w.settings(), [
      w.row(2, 'Ada', 'ADA@example.com', 'Engineer'),
      w.row(3, 'Bob', 'bob@example.com', 'Designer'),
      w.row(4, 'Bob again', 'bob@example.com', 'Lead'),
      w.row(5, 'Cy'),
    ]);
    expect(staged).toEqual({ staged: 4, matched: 1 });
    expect(view.counts).toMatchObject({ created: 2, updated: 1, skipped: 1, refused: 0 });
    // Ada's empty title was filled; Bob's second row met the record his first made, and fill kept "Designer", so it changed nothing.
    expect(await byEmail(w)).toEqual({
      'ada@example.com': { title: 'Engineer', n: 1 },
      'bob@example.com': { title: 'Designer', n: 1 },
    });
    expect(view.canUndo).toBe(true);
    expect(view.undoUntil).toBeDefined();
  });

  it('fills only empty fields, overwrites with Overwrite, and changes nothing with Skip', async () => {
    const w = await world();
    await w.person('Ada', 'ada@example.com', 'Engineer');
    const fill = await runImport(w, w.owner, w.settings(), [w.row(2, 'Ada', 'ada@example.com', 'Manager')]);
    expect(fill.view.counts).toMatchObject({ updated: 0, skipped: 1 });
    expect((await byEmail(w))['ada@example.com']?.title).toBe('Engineer');
    const skip = await runImport(w, w.owner, w.settings({ onMatch: 'skip' }), [
      w.row(2, 'Ada', 'ada@example.com', 'Manager'),
    ]);
    expect(skip.view.counts).toMatchObject({ skipped: 1 });
    expect((await byEmail(w))['ada@example.com']?.title).toBe('Engineer');
    const overwrite = await runImport(w, w.owner, w.settings({ onMatch: 'overwrite' }), [
      w.row(2, 'Ada', 'ada@example.com', 'Manager'),
      w.row(3, 'Ed', 'ed@example.com'),
    ]);
    expect(overwrite.view.counts).toMatchObject({ updated: 1, created: 1 });
    expect((await byEmail(w))['ada@example.com']?.title).toBe('Manager');
  });

  it('skips rows that match nothing with Skip, and always creates without a match attribute', async () => {
    const w = await world();
    await w.person('Ada', 'ada@example.com');
    const skipped = await runImport(w, w.owner, w.settings({ onNoMatch: 'skip' }), [
      w.row(2, 'Ada', 'ada@example.com', 'Engineer'),
      w.row(3, 'Bob', 'bob@example.com'),
    ]);
    expect(skipped.view.counts).toMatchObject({ updated: 1, skipped: 1, created: 0 });
    const columns = w.settings().columns.filter((column) => column.header !== 'Email');
    const always = await runImport(w, w.owner, { columns, onMatch: 'fill', onNoMatch: 'create' }, [
      { rowNumber: 2, values: { [w.attribute('name')]: { firstName: 'Cy' } } },
      { rowNumber: 3, values: { [w.attribute('name')]: { firstName: 'Cy' } } },
    ]);
    expect(always.view.counts).toMatchObject({ created: 2 });
  });

  it('refuses a row the engine refuses, says why, and carries on', async () => {
    const w = await world();
    const { id, view } = await runImport(w, w.owner, w.settings(), [
      w.row(2, 'Ada', 'ada@example.com'),
      w.row(3, 'Bob', 'not an email'),
      { rowNumber: 4, values: { [w.attribute('email_addresses')]: ['nameless@example.com'] } },
      w.row(5, 'Cy', 'cy@example.com'),
    ]);
    expect(view.counts).toMatchObject({ created: 2, refused: 2 });
    const refused = await listImportRefusals(w.owner, { importId: id });
    expect(refused.rows.map((row) => row.rowNumber)).toEqual([3, 4]);
    for (const row of refused.rows) expect(row.message).not.toBe('');
  });

  it('never matches a record the member can’t read, and never names it', async () => {
    const w = await world();
    const own: AccessRules = {
      levels: [],
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
    const hidden = await w.person('Secret', 'secret@example.com', 'Spy', w.ownerId);
    const { id, staged, view } = await runImport(w, member, w.settings({ onMatch: 'overwrite' }), [
      w.row(2, 'Mine', 'secret@example.com', 'Imported'),
    ]);
    // The preview's count says nothing of it, and the row is refused as a create on a taken value.
    expect(staged.matched).toBe(0);
    expect(view.counts).toMatchObject({ refused: 1, updated: 0 });
    const [refusal] = (await listImportRefusals(member, { importId: id })).rows;
    expect(refusal?.message).not.toContain('Secret');
    const [record] = await getRecords(w.owner, { ids: [hidden] });
    expect(record?.values[w.attribute('job_title')]).toBe('Spy');
  });

  it('lets only the starter stage and start, and the starter or jobs.manage read it', async () => {
    const w = await world();
    const id = newId();
    await createImport(w.member, {
      id,
      objectId: w.people,
      fileName: 'people.csv',
      rowCount: 1,
      errorRows: 0,
      settings: w.settings(),
    });
    const other = w.as(w.ids[2] ?? '', 'member');
    expect(await refusalOf(getImport(other, id))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(stageImportRows(w.admin, { importId: id, rows: [w.row(2, 'Ada')] }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await getImport(w.admin, id)).id).toBe(id);
    expect(await refusalOf(startImport(w.member, registry, id))).toMatchObject({ code: 'CONFIG_INVALID' });
    // A retried create answers the same import.
    expect(
      (
        await createImport(w.member, {
          id,
          objectId: w.people,
          fileName: 'people.csv',
          rowCount: 1,
          errorRows: 0,
          settings: w.settings(),
        })
      ).id,
    ).toBe(id);
  });

  it('checks the settings against the object and refuses a read only member', async () => {
    const w = await world();
    const create = (scope: World['owner'], settings: ImportSettings) =>
      createImport(scope, { id: newId(), objectId: w.people, fileName: 'a.csv', rowCount: 1, errorRows: 0, settings });
    const twice: ImportSettings = {
      ...w.settings(),
      columns: [
        { header: 'A', target: { attributeId: w.attribute('job_title') } },
        { header: 'B', target: { attributeId: w.attribute('job_title') } },
      ],
      matchAttributeId: undefined,
    };
    expect(await refusalOf(create(w.owner, twice))).toMatchObject({ code: 'CONFIG_INVALID' });
    const notUnique = { ...w.settings(), matchAttributeId: w.attribute('job_title') };
    expect(await refusalOf(create(w.owner, notUnique))).toMatchObject({ code: 'CONFIG_INVALID' });
    const system: ImportSettings = {
      ...w.settings(),
      columns: [{ header: 'Made', target: { attributeId: w.attribute('created_at') } }],
      matchAttributeId: undefined,
    };
    expect(await refusalOf(create(w.owner, system))).toMatchObject({ code: 'CONFIG_INVALID' });
    const readOnly: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'read' },
      ],
      records: [],
    };
    expect(await refusalOf(create(rescope(w.member, { rules: readOnly }), w.settings()))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('holds the limits: rows past the file, a staged row too large, a fourth unfinished import', async () => {
    const w = await world();
    const id = newId();
    await createImport(w.owner, {
      id,
      objectId: w.people,
      fileName: 'a.csv',
      rowCount: 1,
      errorRows: 0,
      settings: w.settings(),
    });
    expect(await refusalOf(stageImportRows(w.owner, { importId: id, rows: [w.row(3, 'Ada')] }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    const big = { rowNumber: 2, values: { [w.attribute('job_title')]: 'x'.repeat(70_000) } };
    expect(await refusalOf(stageImportRows(w.owner, { importId: id, rows: [big] }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    const unnamed = { rowNumber: 2, values: { [w.attribute('owner')]: { type: 'member', id: w.ownerId } } };
    expect(await refusalOf(stageImportRows(w.owner, { importId: id, rows: [unnamed] }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
    for (let n = 0; n < 2; n += 1) {
      await createImport(w.owner, {
        id: newId(),
        objectId: w.people,
        fileName: 'a.csv',
        rowCount: 1,
        errorRows: 0,
        settings: w.settings(),
      });
    }
    expect(
      await refusalOf(
        createImport(w.owner, {
          id: newId(),
          objectId: w.people,
          fileName: 'a.csv',
          rowCount: 1,
          errorRows: 0,
          settings: w.settings(),
        }),
      ),
    ).toMatchObject({ code: 'LIMIT_REACHED' });
  });

  it('answers a second start with the import as it is, and takes no rows after it', async () => {
    const w = await world();
    const id = newId();
    await createImport(w.owner, {
      id,
      objectId: w.people,
      fileName: 'a.csv',
      rowCount: 2,
      errorRows: 0,
      settings: w.settings(),
    });
    await stageImportRows(w.owner, { importId: id, rows: [w.row(2, 'Ada', 'ada@example.com')] });
    // The same chunk again changes nothing.
    expect(await stageImportRows(w.owner, { importId: id, rows: [w.row(2, 'Ada', 'ada@example.com')] })).toEqual({
      staged: 0,
      matched: 0,
    });
    const first = await startImport(w.owner, registry, id);
    const again = await startImport(w.owner, registry, id);
    expect(again.jobId).toBe(first.jobId);
    expect(await refusalOf(stageImportRows(w.owner, { importId: id, rows: [w.row(3, 'Bob')] }))).toMatchObject({
      code: 'IMPORT_STARTED',
    });
  });
});

describe('undo (AC-1128, AC-1129)', () => {
  /** The live people's emails, and the trashed ones with their batch. */
  async function trash(w: World) {
    return testQuery<{ email: string; batch: string | null }>(
      ownerUrl,
      `select e.text_value as email, r.deleted_batch_id::text as batch from records r
       join "values" e on e.record_id = r.id and e.attribute_id = $2 and e.active_until is null and not e.is_cleared
       where r.workspace_id = $1 and r.deleted_at is not null order by 1`,
      [w.workspaceId, w.attribute('email_addresses')],
    );
  }

  it('trashes what it created, puts back what it changed, and keeps a value edited since', async () => {
    const w = await world();
    await w.person('Ada', 'ada@example.com', 'Engineer');
    const bob = await w.person('Bob', 'bob@example.com', 'Designer');
    const { id } = await runImport(w, w.owner, w.settings({ onMatch: 'overwrite' }), [
      w.row(2, 'Ada', 'ada@example.com', 'Manager'),
      w.row(3, 'Bob', 'bob@example.com', 'Lead'),
      w.row(4, 'Cy', 'cy@example.com', 'Intern'),
    ]);
    // Someone changes Bob's title after the import: undo keeps theirs.
    await setRecordValues(w.owner, { recordId: bob, values: { [w.attribute('job_title')]: { value: 'Chief' } } });
    const undoing = await undoImport(w.owner, registry, id, [outboxHook()]);
    expect(undoing.status).toBe('undone');
    expect(undoing.canUndo).toBe(false);
    const outcomes = await drive(runnerFor(registry), w.workspaceId, undoing.undoJobId ?? '');
    expect(outcomes.at(-1)).toBe('succeeded');
    expect(await byEmail(w)).toEqual({
      'ada@example.com': { title: 'Engineer', n: 1 },
      'bob@example.com': { title: 'Chief', n: 1 },
    });
    expect(await trash(w)).toEqual([{ email: 'cy@example.com', batch: id }]);
    const view = await getImport(w.owner, id);
    expect(view.counts).toMatchObject({ undone: 2, updated: 1 });
    expect((await listImportRefusals(w.owner, { importId: id })).rows).toEqual([
      { rowNumber: 3, code: 'VERSION_CHANGED', message: '1 value changed since, kept.' },
    ]);
    // Asking again answers the undo already started.
    expect((await undoImport(w.owner, registry, id)).undoJobId).toBe(undoing.undoJobId);
  });

  it('refuses while the import is unstarted or running, after its window, and for someone else', async () => {
    const w = await world();
    const id = newId();
    await createImport(w.owner, {
      id,
      objectId: w.people,
      fileName: 'a.csv',
      rowCount: 1,
      errorRows: 0,
      settings: w.settings(),
    });
    await stageImportRows(w.owner, { importId: id, rows: [w.row(2, 'Ada', 'ada@example.com')] });
    expect(await refusalOf(undoImport(w.owner, registry, id))).toMatchObject({ code: 'IMPORT_RUNNING' });
    await startImport(w.owner, registry, id);
    expect(await refusalOf(undoImport(w.owner, registry, id))).toMatchObject({ code: 'IMPORT_RUNNING' });
    expect(await refusalOf(undoImport(w.member, registry, id))).toMatchObject({ code: 'NOT_FOUND' });
    const done = await runImport(w, w.owner, w.settings(), [w.row(2, 'Bob', 'bob@example.com')]);
    await testQuery(ownerUrl, `update imports set undo_until = now() - interval '1 minute' where id = $1`, [done.id]);
    expect(await refusalOf(undoImport(w.owner, registry, done.id))).toMatchObject({ code: 'IMPORT_UNDO_CLOSED' });
  });
});

describe('mergeValue (decision 2)', () => {
  const single = { isMulti: false };
  const multi = { isMulti: true };
  it('fills an empty value, keeps a held one, and overwrites with Overwrite', () => {
    expect(mergeValue(single, 'New', null, 'fill')).toBe('New');
    expect(mergeValue(single, 'New', 'Old', 'fill')).toBeUndefined();
    expect(mergeValue(single, 'New', 'Old', 'overwrite')).toBe('New');
    expect(mergeValue(single, 'Same', 'Same', 'overwrite')).toBeUndefined();
  });
  it('never clears, and adds a list’s new items beside the held ones', () => {
    expect(mergeValue(single, null, 'Old', 'overwrite')).toBeUndefined();
    expect(mergeValue(multi, ['b', 'c'], ['a', 'b'], 'fill')).toEqual(['a', 'b', 'c']);
    expect(mergeValue(multi, ['a'], ['a'], 'overwrite')).toBeUndefined();
  });
});
