// Records exports (spec 0040, AC-1130 to AC-1135) against a real Postgres:
// the job writes only what the member may see (a record rule and a hidden
// field), guards formula like text, writes the name first, and only the
// starter reads the file; past the limit it refuses before anything starts.
import { sql } from 'drizzle-orm';
import { createDatabase } from '@crm/db';
import { afterAll, describe, expect, inject, it } from 'vitest';
import type { RuleSource } from '../access/door.ts';
import { NO_RULES, type AccessRules } from '../access/policy.ts';
import { newId } from '../engine/ids.ts';
import { createRecord, setRecordValues } from '../engine/records.ts';
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

  it('says a sorted export saw records change while it was written, and an unsorted one never (late trap #40)', async () => {
    const w = await world();
    const ada = await w.person('Ada', 'ada@example.com', 'Analyst');
    await w.person('Bob', 'bob@example.com', 'Designer');
    const resultOf = async (jobId: string) =>
      (
        await db.withWorkspace(w.workspaceId, (tx) =>
          tx.execute<{ result: Record<string, unknown> | null }>(
            sql`select result from jobs where id = ${jobId}::uuid`,
          ),
        )
      ).rows[0]?.result;
    const start = (sorted: boolean) =>
      startRecordsExport(w.owner, registry, {
        id: newId(),
        objectId: w.people,
        attributeIds: [w.attribute('job_title')],
        ...(sorted ? { sorts: [{ attributeId: w.attribute('job_title'), direction: 'ascending' as const }] } : {}),
        timeZone: 'UTC',
      });
    const sorted = await start(true);
    const plain = await start(false);
    // A record's sorted value changes after the exports started, before they are written.
    await setRecordValues(w.owner, {
      recordId: ada.recordId,
      values: { [w.attribute('job_title')]: { value: 'Zoologist' } },
    });
    const run = runnerFor(registry);
    expect((await drive(run, w.workspaceId, sorted.jobId)).at(-1)).toBe('succeeded');
    expect((await drive(run, w.workspaceId, plain.jobId)).at(-1)).toBe('succeeded');
    expect(await resultOf(sorted.jobId)).toMatchObject({ changedWhileWritten: true });
    expect(await resultOf(plain.jobId)).not.toHaveProperty('changedWhileWritten');
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
