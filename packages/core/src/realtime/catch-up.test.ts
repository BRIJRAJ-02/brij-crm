// Catch up (spec 0007, AC-72, AC-73, AC-88) against a real Postgres as the
// app role: the head, the collapse of real writes' rows, the reset when the
// outbox no longer holds the range or it is too long, and the caller's own
// audience filtering every row.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import type { AccessRules } from '../access/policy.ts';
import { defineAttribute } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, setValues } from '../engine/records.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { CHANGE_CAP } from '../engine/write.ts';
import { testScope } from '../testing.ts';
import { catchUp, CATCH_UP_MAX_ROWS, workspaceHead } from './catch-up.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-catch-up-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `catch-up-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const people = created.objects.people ?? '';
  const names = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string }>(sql`select id from attributes where object_id = ${people} and api_slug = 'name'`),
  );
  return { ...created, scope, people, name: names.rows[0]?.id ?? '' };
}

/** `count` records rows for `objectId`, numbered after `from`, stored as the owner (as writes would have). */
async function rows(workspaceId: string, objectId: string, from: number, count: number): Promise<void> {
  await testQuery(
    ownerUrl,
    `insert into outbox (workspace_id, seq, kind, object_id, record_ids)
     select $1, $2::bigint + n, 'records', $3, array[gen_random_uuid()] from generate_series(1, $4::int) n`,
    [workspaceId, from, objectId, count],
  );
  await testQuery(ownerUrl, 'update workspace_counters set outbox_seq = $2 where workspace_id = $1', [
    workspaceId,
    from + count,
  ]);
}

const person = (name: string) => ({ firstName: name, lastName: 'Test' });

describe('catch up', () => {
  it('answers the head and nothing else when the caller is up to date', async () => {
    const { scope, people } = await workspace();
    expect(await workspaceHead(scope)).toBe(0);
    expect(await catchUp(scope, { after: 0 })).toEqual({ head: 0, reset: false, events: [] });
    await createRecord(scope, { objectId: people }, [outboxHook()]);
    expect(await workspaceHead(scope)).toBe(1);
    expect(await catchUp(scope, { after: 1 })).toEqual({ head: 1, reset: false, events: [] });
  });

  it('collapses what was missed into one event per kind and object, with the last seq, and no mutation id', async () => {
    const { scope, people, name } = await workspace();
    const mutationId = newId();
    const { recordId: ada } = await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [
      outboxHook({ mutationId }),
    ]);
    const { attributeId } = await defineAttribute(
      scope,
      { objectId: people, apiSlug: 'nickname', title: 'Nickname', type: 'text' },
      [outboxHook()],
    );
    const { recordId: grace } = await createRecord(scope, { objectId: people }, [outboxHook()]);
    await setValues(scope, { recordId: ada, values: { [name]: { value: person('Augusta') } } }, [outboxHook()]);

    const missed = await catchUp(scope, { after: 0 });
    expect(missed.head).toBe(4);
    expect(missed.reset).toBe(false);
    expect(missed.events).toEqual([
      { seq: 2, at: expect.any(String) as string, kind: 'definitions', objectId: people, attributeIds: [attributeId] },
      {
        seq: 4,
        at: expect.any(String) as string,
        kind: 'records',
        objectId: people,
        recordIds: [ada, grace],
        attributeIds: [name],
      },
    ]);
    // From part way: only what came after.
    expect((await catchUp(scope, { after: 3 })).events).toEqual([
      expect.objectContaining({ seq: 4, kind: 'records', recordIds: [ada] }),
    ]);
  });

  it('answers reset when the rows after the watermark were pruned, but not from the oldest kept', async () => {
    const { scope, people, workspaceId } = await workspace();
    await rows(workspaceId, people, 0, 5);
    await testQuery(ownerUrl, 'delete from outbox where workspace_id = $1 and seq <= 2', [workspaceId]);
    expect(await catchUp(scope, { after: 0 })).toEqual({ head: 5, reset: true, events: [] });
    expect(await catchUp(scope, { after: 1 })).toEqual({ head: 5, reset: true, events: [] });
    const kept = await catchUp(scope, { after: 2 });
    expect(kept.reset).toBe(false);
    expect(kept.events).toEqual([expect.objectContaining({ seq: 5, kind: 'records' })]);
    expect(kept.events[0]?.kind === 'records' && kept.events[0].recordIds).toHaveLength(3);
  });

  it('answers reset more than 5,000 rows behind, and reads exactly 5,000 a page at a time, going coarse', async () => {
    const { scope, people, workspaceId } = await workspace();
    await rows(workspaceId, people, 0, CATCH_UP_MAX_ROWS + 1);
    expect(await catchUp(scope, { after: 0 })).toEqual({ head: CATCH_UP_MAX_ROWS + 1, reset: true, events: [] });
    const read = await catchUp(scope, { after: 1 });
    expect(read.reset).toBe(false);
    // 5,000 records of one object, past the cap of 1,000: one coarse event.
    expect(CATCH_UP_MAX_ROWS).toBeGreaterThan(CHANGE_CAP);
    expect(read.events).toEqual([
      expect.objectContaining({ seq: CATCH_UP_MAX_ROWS + 1, kind: 'records', recordIds: [], coarse: true }),
    ]);
  });

  it('answers reset to a watermark ahead of the head (another history)', async () => {
    const { scope } = await workspace();
    expect(await catchUp(scope, { after: 3 })).toEqual({ head: 0, reset: true, events: [] });
  });

  it('leaves out every row the caller’s audience may read nothing of, with no stub (AC-88)', async () => {
    const { scope, people, memberId, workspaceId, objects } = await workspace();
    const companies = objects.companies ?? '';
    await createRecord(scope, { objectId: people }, [outboxHook()]);
    await createRecord(scope, { objectId: companies }, [outboxHook()]);
    const rules: AccessRules = {
      levels: [
        { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: people }, level: 'none' },
      ],
      records: [],
    };
    const restricted = testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member', rules });
    const missed = await catchUp(restricted, { after: 0 });
    expect(missed.head).toBe(2);
    expect(missed.events).toEqual([expect.objectContaining({ seq: 2, kind: 'records', objectId: companies })]);
    expect(JSON.stringify(missed)).not.toContain(people);
  });
});

/** The ids of People's attributes by API name. */
async function attributesOf(workspaceId: string, objectId: string): Promise<Record<string, string>> {
  const result = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select id, api_slug as slug from attributes where object_id = ${objectId}`,
    ),
  );
  return Object.fromEntries(result.rows.map((row) => [row.slug, row.id]));
}

/** One outbox row, stored as the owner as a write would have, numbered `seq` (the counter follows). */
async function row(workspaceId: string, seq: number, values: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(values);
  await testQuery(
    ownerUrl,
    `insert into outbox (workspace_id, seq, ${columns.join(', ')}) values ($1, $2, ${columns.map((_, index) => `$${String(index + 3)}`).join(', ')})`,
    [workspaceId, seq, ...Object.values(values)],
  );
  await testQuery(
    ownerUrl,
    'update workspace_counters set outbox_seq = greatest(outbox_seq, $2) where workspace_id = $1',
    [workspaceId, seq],
  );
}

describe('catch up through a restricted audience (spec 0009 rules on the whole path)', () => {
  it('removes a hidden field, and leaves out a row whose only attributes are hidden', async () => {
    const { people, memberId, workspaceId } = await workspace();
    const ids = await attributesOf(workspaceId, people);
    const [ada, grace] = [newId(), newId()];
    const name = ids.name ?? '';
    const title = ids.job_title ?? '';
    await row(workspaceId, 1, { kind: 'records', object_id: people, record_ids: [ada], attribute_ids: [name, title] });
    await row(workspaceId, 2, { kind: 'records', object_id: people, record_ids: [grace], attribute_ids: [name] });
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: people, attributeId: name },
          level: 'hidden',
        },
      ],
      records: [],
    };
    const restricted = testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member', rules });
    const missed = await catchUp(restricted, { after: 0 });
    expect(missed.events).toEqual([
      {
        seq: 1,
        at: expect.any(String) as string,
        kind: 'records',
        objectId: people,
        recordIds: [ada],
        attributeIds: [title],
      },
    ]);
    expect(JSON.stringify(missed)).not.toContain(name);
    expect(JSON.stringify(missed)).not.toContain(grace);
  });

  it('makes the event coarse with no record ids under a record rule', async () => {
    const { people, memberId, workspaceId } = await workspace();
    const ids = await attributesOf(workspaceId, people);
    const ada = newId();
    await row(workspaceId, 1, {
      kind: 'records',
      object_id: people,
      record_ids: [ada],
      attribute_ids: [ids.job_title],
    });
    const rules: AccessRules = {
      levels: [],
      records: [
        { subject: { type: 'role', role: 'member' }, objectId: people, kind: 'own', attributeId: ids.owner ?? '' },
      ],
    };
    const restricted = testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member', rules });
    const missed = await catchUp(restricted, { after: 0 });
    expect(missed.events).toEqual([expect.objectContaining({ seq: 1, kind: 'records', recordIds: [], coarse: true })]);
    expect(JSON.stringify(missed)).not.toContain(ada);
  });

  it('names a job only to its starter, and never its starter or the mutation id', async () => {
    const { memberId, workspaceId } = await workspace();
    const [job, mutationId, other] = [newId(), newId(), newId()];
    await row(workspaceId, 1, { kind: 'jobs', item_ids: [job], actor_member_id: memberId, mutation_id: mutationId });
    const starter = testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member' });
    const someone = testScope({ db, workspaceId, actor: { type: 'member', id: other }, role: 'member' });
    const mine = await catchUp(starter, { after: 0 });
    expect(mine.events).toEqual([{ seq: 1, at: expect.any(String) as string, kind: 'jobs', jobIds: [job] }]);
    const theirs = await catchUp(someone, { after: 0 });
    expect(theirs.events).toEqual([
      { seq: 1, at: expect.any(String) as string, kind: 'jobs', jobIds: [], coarse: true },
    ]);
    for (const answer of [mine, theirs]) {
      expect(JSON.stringify(answer)).not.toContain(mutationId);
      expect(JSON.stringify(answer)).not.toContain('actorMemberId');
    }
    expect(JSON.stringify(theirs)).not.toContain(job);
  });
});
