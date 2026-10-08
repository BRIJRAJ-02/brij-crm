// The outbox hook (spec 0005, AC-39) against a real Postgres as the app role:
// one row per object a write touched, numbered per workspace with no gaps in
// commit order, nothing for a refused or empty write, definitions rows for
// attribute changes, and coarse rows past the cap.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createOutboxReader, openDirectConnection, type Database } from '@crm/db';
import { archiveAttribute, defineAttribute, updateAttribute } from './definitions.ts';
import { newId } from './ids.ts';
import { defineList } from './lists.ts';
import { outboxHook } from './outbox.ts';
import { isRefusal } from './refusals.ts';
import { createRecord, setValues } from './records.ts';
import type { Actor, EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import { CHANGE_CAP, runWrite, type AfterWrite } from './write.ts';
import { testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-outbox-tests' });
});
afterAll(async () => {
  await db.close();
});

let slugs = 0;
async function workspace() {
  slugs += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `outbox-${String(slugs)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const actor: Actor = { type: 'member', id: created.memberId };
  const scope = testScope({ db, workspaceId: created.workspaceId, actor });
  const people = created.objects.people ?? '';
  const names = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string }>(sql`select id from attributes where object_id = ${people} and api_slug = 'name'`),
  );
  return { ...created, scope, people, name: names.rows[0]?.id ?? '' };
}

interface Row extends Record<string, unknown> {
  seq: number;
  kind: string;
  object_id: string;
  record_ids: string[];
  attribute_ids: string[];
  coarse: boolean;
  mutation_id: string | null;
}

async function rowsOf(scope: EngineScope): Promise<Row[]> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<Row>(
      sql`select seq::int as seq, kind, object_id, record_ids, attribute_ids, coarse, mutation_id from outbox order by seq`,
    ),
  );
  return result.rows;
}

async function counterOf(scope: EngineScope): Promise<number> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ seq: number }>(sql`select outbox_seq::int as seq from workspace_counters`),
  );
  return result.rows[0]?.seq ?? -1;
}

const person = (name: string) => ({ firstName: name, lastName: 'Test' });

describe('the outbox hook', () => {
  it('stores nothing for a new workspace', async () => {
    const { scope } = await workspace();
    expect(await rowsOf(scope)).toEqual([]);
    expect(await counterOf(scope)).toBe(0);
  });

  it('stores one row per write with the next number, the records and attributes it touched, and the mutation id', async () => {
    const { scope, people, name } = await workspace();
    const mutationId = newId();
    const { recordId } = await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [
      outboxHook({ mutationId }),
    ]);
    await setValues(scope, { recordId, values: { [name]: { value: person('Grace') } } }, [outboxHook()]);
    expect(await rowsOf(scope)).toEqual([
      {
        seq: 1,
        kind: 'records',
        object_id: people,
        record_ids: [recordId],
        attribute_ids: [name],
        coarse: false,
        mutation_id: mutationId,
      },
      {
        seq: 2,
        kind: 'records',
        object_id: people,
        record_ids: [recordId],
        attribute_ids: [name],
        coarse: false,
        mutation_id: null,
      },
    ]);
    expect(await counterOf(scope)).toBe(2);
  });

  it('refuses a mutation id that is not a uuid before anything runs', () => {
    expect(() => outboxHook({ mutationId: 'nope' })).toThrow(TypeError);
  });

  it('stores nothing for a refused write, nor for one a later hook rolls back', async () => {
    const { scope, people, name } = await workspace();
    await expect(
      createRecord(scope, { objectId: people, values: { [name]: { firstName: 42 } } }, [outboxHook()]),
    ).rejects.toSatisfy(isRefusal);
    const failing: AfterWrite = () => Promise.reject(new Error('The audit log is down.'));
    await expect(
      createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook(), failing]),
    ).rejects.toThrow('The audit log is down.');
    expect(await rowsOf(scope)).toEqual([]);
    expect(await counterOf(scope)).toBe(0);
    // The next write still gets 1: no gap.
    await createRecord(scope, { objectId: people }, [outboxHook()]);
    expect((await rowsOf(scope)).map((row) => row.seq)).toEqual([1]);
  });

  it('stores nothing for an empty change, or one that only touched list entries', async () => {
    const { scope } = await workspace();
    await runWrite(scope, () => Promise.resolve(), [outboxHook()]);
    await runWrite(
      scope,
      (context) => {
        context.record({ createdEntries: [newId()], hiddenEntries: [newId()] });
        return Promise.resolve();
      },
      [outboxHook()],
    );
    expect(await rowsOf(scope)).toEqual([]);
    expect(await counterOf(scope)).toBe(0);
  });

  it('numbers concurrent writes consecutively, with no gaps or repeats', async () => {
    const { scope, people } = await workspace();
    const writes = 20;
    await Promise.all(Array.from({ length: writes }, () => createRecord(scope, { objectId: people }, [outboxHook()])));
    expect((await rowsOf(scope)).map((row) => row.seq)).toEqual(Array.from({ length: writes }, (_, i) => i + 1));
  });

  it('numbers in commit order: a write waits at the counter row until the one before it commits', async () => {
    const { scope, people } = await workspace();
    let reached = (): void => undefined;
    const atGate = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const holding: AfterWrite = async () => {
      reached();
      await gate;
    };
    const first = createRecord(scope, { objectId: people }, [outboxHook(), holding]);
    await atGate;
    let secondDone = false;
    const second = createRecord(scope, { objectId: people }, [outboxHook()]).then((result) => {
      secondDone = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(secondDone).toBe(false);
    open();
    const [a, b] = await Promise.all([first, second]);
    const rows = await rowsOf(scope);
    expect(rows.map((row) => [row.seq, row.record_ids])).toEqual([
      [1, [a.recordId]],
      [2, [b.recordId]],
    ]);
  });

  it('stores a definitions row when attributes are added, changed or archived', async () => {
    const { scope, people } = await workspace();
    const { attributeId } = await defineAttribute(
      scope,
      { objectId: people, apiSlug: 'nickname', title: 'Nickname', type: 'text' },
      [outboxHook()],
    );
    await updateAttribute(scope, { attributeId, title: 'Known as' }, [outboxHook()]);
    await archiveAttribute(scope, attributeId, [outboxHook()]);
    // Archiving it again changes nothing, so it stores nothing.
    await archiveAttribute(scope, attributeId, [outboxHook()]);
    const rows = await rowsOf(scope);
    expect(rows.map((row) => [row.seq, row.kind, row.object_id, row.attribute_ids, row.record_ids])).toEqual([
      [1, 'definitions', people, [attributeId], []],
      [2, 'definitions', people, [attributeId], []],
      [3, 'definitions', people, [attributeId], []],
    ]);
    // A list's own attributes aren't published yet: no screen shows lists.
    const { listId } = await defineList(scope, { objectId: people, apiSlug: 'pipeline', name: 'Pipeline' });
    await defineAttribute(scope, { listId, apiSlug: 'stage', title: 'Stage', type: 'text' }, [outboxHook()]);
    expect(await rowsOf(scope)).toHaveLength(3);
  });

  it('writes a coarse row with no ids for an object past the cap, beside the fine rows', async () => {
    const { scope, people, objects } = await workspace();
    // Another object of the workspace (an outbox row names a real one).
    const other = Object.values(objects).find((objectId) => objectId !== people) ?? '';
    const many = Array.from({ length: CHANGE_CAP + 1 }, () => ({ recordId: newId(), objectId: people }));
    const few = [newId(), newId()];
    await runWrite(
      scope,
      (context) => {
        context.record({
          deletedRecords: many,
          restoredRecords: few.map((recordId) => ({ recordId, objectId: other })),
          definitions: [{ objectId: other, attributeIds: [newId()] }],
        });
        return Promise.resolve();
      },
      [outboxHook()],
    );
    const rows = await rowsOf(scope);
    const byKind = (kind: string, objectId: string) =>
      rows.find((row) => row.kind === kind && row.object_id === objectId);
    expect(rows).toHaveLength(3);
    expect(byKind('records', people)).toMatchObject({ record_ids: [], coarse: true });
    expect(byKind('records', other)).toMatchObject({ record_ids: few, coarse: false });
    expect(byKind('definitions', other)?.attribute_ids).toHaveLength(1);
    expect(rows.map((row) => row.seq).sort()).toEqual([1, 2, 3]);
  });

  it('notifies crm_outbox with the workspace on commit, and not for a refused write', async () => {
    const { scope, people, name } = await workspace();
    const reader = createOutboxReader(
      await openDirectConnection({ url: appUrl, applicationName: 'crm-outbox-tests-listen' }),
    );
    try {
      const heard: string[] = [];
      await reader.listen((workspaceId) => heard.push(workspaceId));
      await expect(
        createRecord(scope, { objectId: people, values: { [name]: { firstName: 42 } } }, [outboxHook()]),
      ).rejects.toSatisfy(isRefusal);
      await createRecord(scope, { objectId: people }, [outboxHook()]);
      await expect.poll(() => heard.filter((id) => id === scope.workspaceId).length).toBe(1);
    } finally {
      await reader.close();
    }
  });

  it('takes the counter, stores the rows and notifies in one statement', async () => {
    const { scope, people } = await workspace();
    const calls: string[] = [];
    const hook = outboxHook();
    const counting: AfterWrite = (change, tx) =>
      hook(
        change,
        new Proxy(tx, {
          get(target, property, receiver) {
            if (
              typeof property === 'string' &&
              ['execute', 'insert', 'update', 'select', 'delete'].includes(property)
            ) {
              calls.push(property);
            }
            return Reflect.get(target, property, receiver) as unknown;
          },
        }),
      );
    await createRecord(scope, { objectId: people }, [counting]);
    expect(calls).toEqual(['execute']);
    expect((await rowsOf(scope)).map((row) => row.seq)).toEqual([1]);
    expect(await counterOf(scope)).toBe(1);
  });

  it('stamps created_at when the row is written, not when the transaction began', async () => {
    const { scope, people } = await workspace();
    let began = '';
    const slow: AfterWrite = async (_change, tx) => {
      const result = await tx.execute<{ began: string }>(sql`select now()::text as began`);
      began = result.rows[0]?.began ?? '';
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    await createRecord(scope, { objectId: people }, [slow, outboxHook()]);
    const result = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ late: number }>(
        sql`select extract(epoch from created_at - ${began}::timestamptz) * 1000 as late from outbox`,
      ),
    );
    expect(Number(result.rows[0]?.late)).toBeGreaterThanOrEqual(250);
  });

  it('names the member whose write stored the row, and nobody for the system (spec 0007, AC-77)', async () => {
    const { scope, people, memberId } = await workspace();
    await createRecord(scope, { objectId: people }, [outboxHook()]);
    const system = testScope({ db, workspaceId: scope.workspaceId, actor: { type: 'system', id: null } });
    await createRecord(system, { objectId: people }, [outboxHook()]);
    const result = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ seq: number; actor: string | null; list: string | null; items: string[] }>(
        sql`select seq::int as seq, actor_member_id as actor, list_id as list, item_ids as items from outbox order by seq`,
      ),
    );
    expect(result.rows).toEqual([
      { seq: 1, actor: memberId, list: null, items: [] },
      { seq: 2, actor: null, list: null, items: [] },
    ]);
  });
});
