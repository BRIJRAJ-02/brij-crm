// Record merge (spec 0049, AC-4910 to AC-4917, AC-4919), against a real
// Postgres as the app role: values by pick and united, links re-pointed with
// no doubles, entries and attached rows moved, history kept, the merged
// record trashed out of sight with its address leading on, and every refusal
// changing nothing.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { getActivity } from './activity.ts';
import { defineAttribute } from './definitions.ts';
import { restoreRecord } from './deletion.ts';
import { getHistory } from './history.ts';
import { newId } from './ids.ts';
import { addEntry, defineList, getRecordEntries } from './lists.ts';
import { mergeRecords, previewMerge } from './merge.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { isRefusal } from './refusals.ts';
import type { Actor } from './scope.ts';
import { queryTrash, restoreRecords } from './trash.ts';
import type { AfterWrite, Change } from './write.ts';
import { createWorkspace } from './workspaces.ts';
import { readTrashedRecord } from '../records/records.ts';
import { saveNote } from '../notes/notes.ts';
import { createTask } from '../tasks/tasks.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
let owner: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-merge-tests' });
  owner = createDatabase({ url: ownerUrl, applicationName: 'crm-merge-tests-owner' });
});
afterAll(async () => {
  await db.close();
  await owner.close();
});

let made = 0;
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Merge',
    slug: `merge-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Brij', email: 'brij@example.com' },
  });
  const actor: Actor = { type: 'member', id: created.memberId };
  const scope = testScope({ db, workspaceId: created.workspaceId, actor });
  const rows = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; object_id: string; api_slug: string }>(
      sql`select id::text, object_id::text, api_slug from attributes where object_id is not null`,
    ),
  );
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const deals = created.objects.deals ?? '';
  const attribute = (objectId: string, slug: string) =>
    rows.rows.find((row) => row.object_id === objectId && row.api_slug === slug)?.id ?? '';
  return {
    ...created,
    scope,
    people,
    companies,
    deals,
    person: (slug: string) => attribute(people, slug),
    company: (slug: string) => attribute(companies, slug),
    deal: (slug: string) => attribute(deals, slug),
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function person(w: World, firstName: string, extra: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { [w.person('name')]: { firstName, lastName: 'Doe' }, ...extra };
  return (await createRecord(w.scope, { objectId: w.people, values })).recordId;
}

async function company(w: World, name: string) {
  return (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: name } })).recordId;
}

async function revisions(w: World, keep: string, merge: string) {
  const views = await getRecords(w.scope, { ids: [keep, merge] });
  return { keep: views[0]?.revision ?? -1, merge: views[1]?.revision ?? -1 };
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

async function count(w: World, statement: ReturnType<typeof sql>): Promise<number> {
  const rows = await db.withWorkspace(w.workspaceId, (tx) => tx.execute<{ n: number }>(statement));
  return rows.rows[0]?.n ?? -1;
}

describe('mergeRecords', () => {
  it('moves values, links, notes, tasks and entries onto the kept record, and trashes the merged one (AC-4910 to AC-4915)', async () => {
    const w = await world();
    const acme = await company(w, 'Acme');
    const jane = await person(w, 'Jane', {
      // A free mail address, so filing (spec 0059) leaves the kept record's Company empty.
      [w.person('email_addresses')]: ['jane@gmail.com'],
      [w.person('job_title')]: 'CTO',
    });
    const janeD = await person(w, 'Jane D.', {
      [w.person('email_addresses')]: ['jd@acme.com', 'j.doe@acme.com'],
      [w.person('job_title')]: 'Chief',
      [w.person('phone_numbers')]: [{ number: '+447700900123', country: 'GB' }],
      [w.person('company')]: { objectId: w.companies, recordId: acme },
    });
    // The merged record's own history: its job title changed once.
    await setValues(w.scope, { recordId: janeD, values: { [w.person('job_title')]: { value: 'Chief Tech' } } });
    await saveNote(w.scope, { id: newId(), recordId: janeD, title: 'Met at the fair' });
    await createTask(w.scope, { id: newId(), title: 'Follow up', recordIds: [janeD] });
    const { listId } = await defineList(w.scope, { objectId: w.people, apiSlug: 'leads', name: 'Leads' });
    await addEntry(w.scope, { listId, recordId: janeD });

    const preview = await previewMerge(w.scope, { objectId: w.people, keepId: jane, mergeId: janeD });
    // Name and job title differ and are offered; emails, phones and the empty Company are not.
    expect(preview.rows.map((row) => row.attributeId).sort()).toEqual([w.person('job_title'), w.person('name')].sort());
    expect(preview.rows.every((row) => row.preselected === 'keep')).toBe(true);
    expect(preview.moved).toEqual({ links: 1, entries: 1, items: 2, notes: 1 });
    expect(preview.tooLarge).toBe(false);

    const result = await mergeRecords(w.scope, {
      objectId: w.people,
      keepId: jane,
      mergeId: janeD,
      picks: { [w.person('job_title')]: 'merge' },
      revisions: await revisions(w, jane, janeD),
    });
    expect(result).toMatchObject({ recordId: jane, mergedId: janeD, replayed: false, moved: preview.moved });

    const [kept] = await getRecords(w.scope, { ids: [jane] });
    expect(kept?.values[w.person('name')]).toMatchObject({ firstName: 'Jane' });
    expect(kept?.values[w.person('job_title')]).toBe('Chief Tech');
    expect(kept?.values[w.person('email_addresses')]).toEqual(['jane@gmail.com', 'jd@acme.com', 'j.doe@acme.com']);
    expect(kept?.values[w.person('phone_numbers')]).toEqual([{ number: '+447700900123', country: 'GB' }]);
    expect(kept?.values[w.person('company')]).toEqual({ objectId: w.companies, recordId: acme });
    expect(kept?.revision).toBe(result.revision);
    // The merged record is gone from every read, and its entry, note and task are the kept record's.
    expect(await getRecords(w.scope, { ids: [janeD] })).toEqual([]);
    expect((await getRecordEntries(w.scope, { recordId: jane })).map((entry) => entry.listId)).toEqual([listId]);
    expect(await count(w, sql`select count(*)::int as n from notes where record_id = ${jane}::uuid`)).toBe(1);
    expect(await count(w, sql`select count(*)::int as n from task_records where record_id = ${jane}::uuid`)).toBe(1);
    expect(
      await count(
        w,
        sql`select count(*)::int as n from record_links where active_until is null and (from_record_id = ${janeD}::uuid or to_record_id = ${janeD}::uuid)`,
      ),
    ).toBe(0);
    // History shows both: the kept record's CTO, the merged record's Chief, then Chief Tech.
    const history = await getHistory(w.scope, { recordId: jane, attributeId: w.person('job_title') });
    expect(history.length).toBeGreaterThanOrEqual(3);
    // Trashed with merged_into, listed in no trash, never restored, and its address leads on.
    expect(JSON.stringify(await queryTrash(w.scope, {}))).not.toContain(janeD);
    expect(await refusalOf(restoreRecord(w.scope, { recordId: janeD }))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await restoreRecords(w.scope, { recordIds: [janeD] }))[0]).toMatchObject({ state: 'refused' });
    const trashed = await readTrashedRecord(w.scope, janeD);
    expect(trashed.mergedInto).toMatchObject({ recordId: jane, display: { name: 'Jane Doe' } });
    expect(trashed.record.display.name).toBe('Jane D. Doe');
    // The timeline names the merge; one audit row names both records.
    const activity = await getActivity(w.scope, { recordId: jane });
    expect(activity.entries.find((entry) => entry.kind === 'merged')).toMatchObject({
      actor: { type: 'member', id: w.memberId },
      fromRefs: [{ recordId: janeD, name: 'Jane D. Doe' }],
    });
    const audit = await count(
      w,
      sql`select count(*)::int as n from audit_events where action = 'record.merged' and target_id = ${jane} and before ->> 'mergedRecordId' = ${janeD}`,
    );
    expect(audit).toBe(1);
  });

  it('keeps one entry in a list that allows a record once, one link to a shared deal, and drops the link between them (AC-4913)', async () => {
    const w = await world();
    const jane = await person(w, 'Jane');
    const janeD = await person(w, 'Jane D.');
    const { listId } = await defineList(w.scope, {
      objectId: w.people,
      apiSlug: 'once',
      name: 'Once',
      allowsDuplicates: false,
    });
    await defineAttribute(w.scope, { listId, apiSlug: 'note', title: 'Note', type: 'text' });
    const noteId = await count(w, sql`select 0 as n`).then(() =>
      db.withWorkspace(w.workspaceId, async (tx) => {
        const rows = await tx.execute<{ id: string }>(
          sql`select id::text from attributes where list_id = ${listId}::uuid and api_slug = 'note'`,
        );
        return rows.rows[0]?.id ?? '';
      }),
    );
    const kept = await addEntry(w.scope, { listId, recordId: jane });
    await addEntry(w.scope, { listId, recordId: janeD, values: { [noteId]: 'From Jane D.' } });
    const deal = (
      await createRecord(w.scope, {
        objectId: w.deals,
        values: {
          [w.deal('name')]: 'Big deal',
          [w.deal('associated_people')]: [
            { objectId: w.people, recordId: jane },
            { objectId: w.people, recordId: janeD },
          ],
        },
      })
    ).recordId;
    const changes: Change[] = [];
    const capture: AfterWrite = (change) => {
      changes.push(change);
      return Promise.resolve();
    };
    const result = await mergeRecords(
      w.scope,
      { objectId: w.people, keepId: jane, mergeId: janeD, revisions: await revisions(w, jane, janeD) },
      [capture],
    );
    expect(result.moved).toMatchObject({ links: 1, entries: 1 });
    // The change names the merged record, and the far deal whose side changed (AC-4915).
    expect(changes[0]?.deletedRecords).toEqual([{ recordId: janeD, objectId: w.people }]);
    expect(changes[0]?.references.map((each) => each.recordId)).toContain(deal);
    const entries = await getRecordEntries(w.scope, { recordId: jane });
    expect(entries.map((entry) => entry.id)).toEqual([kept.entryId]);
    expect(entries[0]?.values[noteId]).toBe('From Jane D.');
    const [dealView] = await getRecords(w.scope, { ids: [deal] });
    expect(dealView?.values[w.deal('associated_people')]).toEqual([{ objectId: w.people, recordId: jane }]);
    expect(await count(w, sql`select entry_count as n from lists where id = ${listId}::uuid`)).toBe(1);
  });

  it('refuses a stale dialog, the same or a trashed record, other objects and too much, changing nothing (AC-4917)', async () => {
    const w = await world();
    const jane = await person(w, 'Jane');
    const janeD = await person(w, 'Jane D.');
    const stale = await revisions(w, jane, janeD);
    await setValues(w.scope, { recordId: jane, values: { [w.person('job_title')]: { value: 'CTO' } } });
    const pair = { objectId: w.people, keepId: jane, mergeId: janeD };
    expect(await refusalOf(mergeRecords(w.scope, { ...pair, revisions: stale }))).toEqual({
      code: 'CONFLICT',
      message: 'Jane Doe changed while you were merging. Review it again.',
    });
    expect(await getRecords(w.scope, { ids: [janeD] })).toHaveLength(1);
    expect(await refusalOf(mergeRecords(w.scope, { ...pair, mergeId: jane }))).toMatchObject({ code: 'INVALID' });
    const acme = await company(w, 'Acme');
    expect(await refusalOf(mergeRecords(w.scope, { ...pair, mergeId: acme }))).toMatchObject({ code: 'INVALID' });
    expect(await refusalOf(mergeRecords(w.scope, { ...pair, mergeId: newId() }))).toMatchObject({ code: 'NOT_FOUND' });

    // 10,001 notifications on the merged record: refused before any write.
    await owner.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`
        insert into notes (workspace_id, id, record_id, content, created_by_type, created_by_id, created_by_member_id,
          updated_by_type, updated_by_id, updated_by_member_id)
        select ${w.workspaceId}::uuid, gen_random_uuid(), ${janeD}::uuid, '{"type":"doc","content":[]}'::jsonb,
          'member', ${w.memberId}::uuid, ${w.memberId}::uuid, 'member', ${w.memberId}::uuid, ${w.memberId}::uuid
        from generate_series(1, 10001)
      `),
    );
    const now = await revisions(w, jane, janeD);
    expect(await refusalOf(mergeRecords(w.scope, { ...pair, revisions: now }))).toEqual({
      code: 'MERGE_TOO_LARGE',
      message: 'Too much is attached to merge in one go.',
    });
    expect((await previewMerge(w.scope, pair)).tooLarge).toBe(true);
    expect(await getRecords(w.scope, { ids: [janeD] })).toHaveLength(1);
  });

  it('answers a retry of a landed merge again, and a merged record as gone to anyone else (AC-4917)', async () => {
    const w = await world();
    const jane = await person(w, 'Jane');
    const janeD = await person(w, 'Jane D.');
    const input = { objectId: w.people, keepId: jane, mergeId: janeD, revisions: await revisions(w, jane, janeD) };
    await mergeRecords(w.scope, input);
    expect(await mergeRecords(w.scope, input)).toMatchObject({ replayed: true, recordId: jane });
    const other = rescope(w.scope, { actor: { type: 'member', id: newId() } });
    expect(await refusalOf(mergeRecords(other, input))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('takes a unique email from the merged record, and fills a hidden field only when the kept one is empty (AC-4911, AC-4912)', async () => {
    const w = await world();
    const jane = await person(w, 'Jane', { [w.person('timezone')]: 'Europe/London' });
    const janeD = await person(w, 'Jane D.', {
      [w.person('email_addresses')]: ['jane@acme.com'],
      [w.person('timezone')]: 'Asia/Kolkata',
      [w.person('job_title')]: 'CTO',
    });
    const hiding = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: w.people, attributeId: w.person('timezone') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    const preview = await previewMerge(hiding, { objectId: w.people, keepId: jane, mergeId: janeD });
    expect(preview.rows.map((row) => row.attributeId)).not.toContain(w.person('timezone'));
    await mergeRecords(hiding, {
      objectId: w.people,
      keepId: jane,
      mergeId: janeD,
      picks: { [w.person('timezone')]: 'merge' },
      revisions: await revisions(w, jane, janeD),
    });
    const [kept] = await getRecords(w.scope, { ids: [jane] });
    expect(kept?.values[w.person('timezone')]).toBe('Europe/London');
    expect(kept?.values[w.person('job_title')]).toBe('CTO');
    expect(kept?.values[w.person('email_addresses')]).toEqual(['jane@acme.com']);
    // The unique value is the kept record's alone: a third record can't take it.
    expect(await refusalOf(person(w, 'Other', { [w.person('email_addresses')]: ['jane@acme.com'] }))).toMatchObject({
      code: 'UNIQUE_CONFLICT',
    });
  });

  it('refuses a member who may only read the object, and answers a hidden record as missing (AC-4919)', async () => {
    const w = await world();
    const jane = await person(w, 'Jane');
    const janeD = await person(w, 'Jane D.');
    const pair = { objectId: w.people, keepId: jane, mergeId: janeD };
    const readOnly = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'read' },
        ],
        records: [],
      },
    });
    expect(await refusalOf(mergeRecords(readOnly, pair))).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(previewMerge(readOnly, pair))).toMatchObject({ code: 'FORBIDDEN' });
    // A record rule hiding both (another member's records) answers exactly as an unknown id.
    const ruled = rescope(w.scope, {
      actor: { type: 'member', id: newId() },
      role: 'member',
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: w.people,
            attributeId: w.person('created_by'),
            kind: 'own',
          },
        ],
      },
    });
    expect(await refusalOf(mergeRecords(ruled, pair))).toEqual(
      await refusalOf(mergeRecords(ruled, { ...pair, mergeId: newId() })),
    );
    expect(await getRecords(w.scope, { ids: [janeD] })).toHaveLength(1);
  });
});
