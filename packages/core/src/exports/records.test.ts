// Records exports (spec 0040, AC-1130 to AC-1135) against a real Postgres:
// the job writes only what the member may see (a record rule and a hidden
// field), guards formula like text, writes the name first, and only the
// starter reads the file; past the limit it refuses before anything starts.
// Its snapshot keeps every row once though records change between batches.
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { afterAll, describe, expect, inject, it } from 'vitest';
import type { RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { createRecord, setRecordValues } from '../engine/records.ts';
import { deleteRecords } from '../engine/trash.ts';
import { exportFile, exportPart } from '../forms/export.ts';
import { jobKinds } from '../jobs/kinds/index.ts';
import { rescope } from '../testing.ts';
import { jobTestKit, refusalOf } from '../../test/jobs-kit.ts';
import { getRecordsExport, recordsFileName, startRecordsExport, tooLarge } from './records.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
const db = createDatabase({ url: appUrl, applicationName: 'crm-exports-tests' });
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

/** The file a finished export holds, as its starter downloads it. */
async function fileOf(scope: Parameters<typeof exportFile>[0], exportId: string): Promise<string> {
  const file = await exportFile(scope, { exportId });
  let text = '';
  for (let part = 0; part < file.parts; part += 1) text += await exportPart(scope, { exportId, part });
  return text;
}

describe('records exports', () => {
  it('writes what the member sees, name first, guarded, for the starter alone', async () => {
    const w = await world();
    await w.person('Ada', 'ada@example.com', '=1+1', w.memberId);
    await w.person('Bob', 'bob@example.com', 'Designer', w.memberId);
    await w.person('Secret', 'secret@example.com', 'Spy', w.ownerId);
    // The member sees only records they own, and never the email.
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
      sorts: [{ attributeId: w.attribute('job_title'), direction: 'ascending' }],
      timeZone: 'UTC',
    });
    expect(started.fileName).toMatch(/^People - Unsaved view - \d{4}-\d{2}-\d{2}\.csv$/u);
    const run = runnerFor(registry);
    const outcomes = await drive(run, w.workspaceId, started.jobId);
    expect(outcomes.at(-1)).toBe('succeeded');
    expect((await getRecordsExport(member, { exportId: started.id })).rowCount).toBe(2);
    const text = await fileOf(member, started.id);
    expect(text).toBe("﻿Name,Job title\r\nAda Test,'=1+1\r\nBob Test,Designer\r\n");
    // Nobody else reads it.
    expect(await refusalOf(getRecordsExport(w.owner, { exportId: started.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(exportFile(w.owner, { exportId: started.id }))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('exports only the picked records the member may read, in the order picked, with one BOM at the start', async () => {
    const w = await world();
    const ada = await w.person('Ada', 'ada@example.com', 'Analyst', w.memberId);
    const bob = await w.person('Bob', 'bob@example.com', 'Designer', w.memberId);
    await w.person('Cy', 'cy@example.com', 'Chemist', w.memberId);
    const secret = await w.person('Secret', 'secret@example.com', 'Spy', w.ownerId);
    // The member sees only records they own.
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
    const started = await startRecordsExport(member, registry, {
      id: newId(),
      objectId: w.people,
      attributeIds: [w.attribute('job_title')],
      // The hidden record, a missing id and a repeat are simply absent; Cy was not picked.
      recordIds: [bob.recordId, secret.recordId, newId(), ada.recordId, bob.recordId],
      timeZone: 'UTC',
    });
    expect(started.fileName).toMatch(/^People - Selected - \d{4}-\d{2}-\d{2}\.csv$/u);
    expect((await drive(runnerFor(registry), w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    expect((await getRecordsExport(member, { exportId: started.id })).rowCount).toBe(2);
    const text = await fileOf(member, started.id);
    expect(text).toBe('﻿Name,Job title\r\nBob Test,Designer\r\nAda Test,Analyst\r\n');
    expect(text.split('﻿')).toHaveLength(2);
    rulesByWorkspace.delete(w.workspaceId);
  });

  it('writes every record of its snapshot once, in its order, though records change between batches (late trap #40)', async () => {
    const w = await world();
    rulesByWorkspace.delete(w.workspaceId);
    // 205 records, so the file takes two batches of 200.
    const label = (index: number) => String(index).padStart(3, '0');
    const made: string[] = [];
    for (let index = 0; index < 205; index += 1) {
      const { recordId } = await w.person(`P${label(index)}`, `p${label(index)}@example.com`, `T${label(index)}`);
      made.push(recordId);
    }
    const started = await startRecordsExport(w.owner, registry, {
      id: newId(),
      objectId: w.people,
      attributeIds: [w.attribute('job_title')],
      sorts: [{ attributeId: w.attribute('job_title'), direction: 'ascending' }],
      timeZone: 'UTC',
    });
    // One batch a slice: the snapshot, then the first 200 rows; the records change before the last 5 are written.
    const run = runnerFor(registry, undefined, { sliceMs: 0 });
    for (let slice = 0; slice < 2; slice += 1) {
      expect(await run.runner.runSlice({ workspaceId: w.workspaceId, jobId: started.jobId })).not.toBe('succeeded');
    }
    const title = (recordId: string | undefined, value: string) =>
      setRecordValues(w.owner, { recordId: recordId ?? '', values: { [w.attribute('job_title')]: { value } } });
    // Paged by keyset, P000 would come round again past the cursor and P200 would fall behind it, unwritten.
    await title(made[0], 'T999');
    await title(made[200], 'A');
    await deleteRecords(w.owner, { objectId: w.people, recordIds: [made[201] ?? ''], batchId: newId() });
    await w.person('Added', 'added@example.com', 'T150b');
    expect((await drive(run, w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    const lines = (await fileOf(w.owner, started.id)).split('\r\n').slice(1, -1);
    // Each once, in the snapshot's order: P000 as it was when written, P200 as it is now, P201 gone, Added absent.
    const expected = Array.from({ length: 205 }, (_, index) => index)
      .filter((index) => index !== 201)
      .map((index) => `P${label(index)} Test,${index === 200 ? 'A' : `T${label(index)}`}`);
    expect(lines).toEqual(expected);
    expect((await getRecordsExport(w.owner, { exportId: started.id })).rowCount).toBe(204);
    // The snapshot cleared itself as the file was written.
    const left = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from job_items where job_id = ${started.jobId}::uuid`),
    );
    expect(left.rows[0]?.n).toBe(0);
  }, 120_000);

  it('leaves out a snapshot record the member can no longer see when it is written', async () => {
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
    await w.person('Ada', 'ada@example.com', 'Analyst', w.memberId);
    const bob = await w.person('Bob', 'bob@example.com', 'Designer', w.memberId);
    await w.person('Secret', 'secret@example.com', 'Spy', w.ownerId);
    const started = await startRecordsExport(member, registry, {
      id: newId(),
      objectId: w.people,
      attributeIds: [w.attribute('job_title')],
      timeZone: 'UTC',
    });
    const run = runnerFor(registry, undefined, { sliceMs: 0 });
    // The snapshot holds Ada and Bob (Secret is outside the rule); then Bob moves to the owner.
    expect(await run.runner.runSlice({ workspaceId: w.workspaceId, jobId: started.jobId })).not.toBe('succeeded');
    await setRecordValues(w.owner, {
      recordId: bob.recordId,
      values: { [w.attribute('owner')]: { value: { type: 'member', id: w.ownerId } } },
    });
    expect((await drive(run, w.workspaceId, started.jobId)).at(-1)).toBe('succeeded');
    expect(await fileOf(member, started.id)).toBe('﻿Name,Job title\r\nAda Test,Analyst\r\n');
    expect((await getRecordsExport(member, { exportId: started.id })).rowCount).toBe(1);
  });

  it('refuses a view past the limit with its count, and an object the member can’t see', async () => {
    const w = await world();
    rulesByWorkspace.delete(w.workspaceId);
    await w.person('Ada', 'ada@example.com', 'Engineer');
    const hidden = rescope(w.member, {
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    const start = (scope: typeof w.owner) =>
      startRecordsExport(scope, registry, { id: newId(), objectId: w.people, attributeIds: [], timeZone: 'UTC' });
    expect(await refusalOf(start(hidden))).toMatchObject({ code: 'NOT_FOUND' });
    // Past 100,000 rows is too many to make here; the refusal's words are checked on their own.
    expect(tooLarge('240,000', 'People')).toBe(
      'This view has 240,000 people. Export at most 100,000 at a time; narrow the filter.',
    );
    expect((await start(w.owner)).id).toBeDefined();
  });

  it('names the file from safe parts', () => {
    expect(recordsFileName('Deals', 'Q3 / "big"', '2026-10-21')).toBe('Deals - Q3 big - 2026-10-21.csv');
  });
});
