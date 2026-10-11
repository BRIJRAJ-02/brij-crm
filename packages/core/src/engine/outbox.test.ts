// The outbox hook (spec 0005, AC-39) against a real Postgres as the app role:
// one row per object a write touched, numbered per workspace with no gaps in
// commit order, nothing for a refused or empty write, definitions rows for
// attribute changes, and coarse rows past the cap.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createOutboxReader, openDirectConnection, type Database } from '@crm/db';
import { MAX_LIFECYCLE_IDS } from '@crm/contracts';
import { removeMember, setMemberRole } from '../members/members.ts';
import { deleteRecord, purgeDeleted, restoreRecord } from './deletion.ts';
import {
  archiveAttribute,
  defineAttribute,
  defineObject,
  setObjectArchived,
  updateAttribute,
  updateObject,
} from './definitions.ts';
import { newId } from './ids.ts';
import { addEntry, defineList, removeEntry, restoreEntry } from './lists.ts';
import { defineOption, updateOption } from './options.ts';
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

/** Every column a row's kind may fill, by `seq`. */
interface Details extends Record<string, unknown> {
  seq: number;
  kind: string;
  object_id: string | null;
  list_id: string | null;
  record_ids: string[];
  attribute_ids: string[];
  item_ids: string[];
  created_ids: string[];
  deleted_ids: string[];
  restored_ids: string[];
  coarse: boolean;
}

async function detailsOf(scope: EngineScope): Promise<Details[]> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<Details>(
      sql`select seq::int as seq, kind, object_id, list_id, record_ids, attribute_ids, item_ids, created_ids,
        deleted_ids, restored_ids, coarse from outbox order by seq`,
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
    await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook()]);
    expect((await rowsOf(scope)).map((row) => row.seq)).toEqual([1]);
  });

  it('stores nothing for an empty change', async () => {
    const { scope } = await workspace();
    await runWrite(scope, () => Promise.resolve(), [outboxHook()]);
    expect(await rowsOf(scope)).toEqual([]);
    expect(await counterOf(scope)).toBe(0);
  });

  it('numbers concurrent writes consecutively, with no gaps or repeats', async () => {
    const { scope, people, name } = await workspace();
    const writes = 20;
    await Promise.all(
      Array.from({ length: writes }, () =>
        createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook()]),
      ),
    );
    expect((await rowsOf(scope)).map((row) => row.seq)).toEqual(Array.from({ length: writes }, (_, i) => i + 1));
  });

  it('numbers in commit order: a write waits at the counter row until the one before it commits', async () => {
    const { scope, people, name } = await workspace();
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
    const first = createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook(), holding]);
    await atGate;
    let secondDone = false;
    const second = createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook()]).then(
      (result) => {
        secondDone = true;
        return result;
      },
    );
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
    // A list's own attributes are a row naming the list (spec 0007, AC-81).
    const { listId } = await defineList(scope, { objectId: people, apiSlug: 'pipeline', name: 'Pipeline' });
    const stage = await defineAttribute(scope, { listId, apiSlug: 'stage', title: 'Stage', type: 'text' }, [
      outboxHook(),
    ]);
    expect((await detailsOf(scope)).at(-1)).toMatchObject({
      kind: 'definitions',
      object_id: null,
      list_id: listId,
      attribute_ids: [stage.attributeId],
    });
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
      await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook()]);
      await expect.poll(() => heard.filter((id) => id === scope.workspaceId).length).toBe(1);
    } finally {
      await reader.close();
    }
  });

  it('takes the counter, stores the rows and notifies in one statement', async () => {
    const { scope, people, name } = await workspace();
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
    await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [counting]);
    expect(calls).toEqual(['execute']);
    expect((await rowsOf(scope)).map((row) => row.seq)).toEqual([1]);
    expect(await counterOf(scope)).toBe(1);
  });

  it('stamps created_at when the row is written, not when the transaction began', async () => {
    const { scope, people, name } = await workspace();
    let began = '';
    const slow: AfterWrite = async (_change, tx) => {
      const result = await tx.execute<{ began: string }>(sql`select now()::text as began`);
      began = result.rows[0]?.began ?? '';
      await new Promise((resolve) => setTimeout(resolve, 300));
    };
    await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [slow, outboxHook()]);
    const result = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ late: number }>(
        sql`select extract(epoch from created_at - ${began}::timestamptz) * 1000 as late from outbox`,
      ),
    );
    expect(Number(result.rows[0]?.late)).toBeGreaterThanOrEqual(250);
  });

  it('names the member whose write stored the row, and nobody for the system (spec 0007, AC-77)', async () => {
    const { scope, people, memberId, name } = await workspace();
    await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook()]);
    const system = testScope({ db, workspaceId: scope.workspaceId, actor: { type: 'system', id: null } });
    await createRecord(system, { objectId: people, values: { [name]: person('Ada') } }, [outboxHook()]);
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

describe('every kind of change (spec 0007, milestone 2)', () => {
  /** A list of people with a text attribute, and one person. */
  async function listWorld() {
    const world = await workspace();
    const { scope, people, name } = world;
    const { listId } = await defineList(scope, { objectId: people, apiSlug: 'pipeline', name: 'Pipeline' });
    const { attributeId: stage } = await defineAttribute(scope, {
      listId,
      apiSlug: 'stage',
      title: 'Stage',
      type: 'text',
    });
    const { recordId: ada } = await createRecord(scope, { objectId: people, values: { [name]: person('Ada') } });
    return { ...world, listId, stage, ada };
  }

  it('stores one entries row per list for every entry write, naming entries and their records (AC-80)', async () => {
    const { scope, people, listId, stage, ada } = await listWorld();
    const { listId: other } = await defineList(scope, { objectId: people, apiSlug: 'hiring', name: 'Hiring' });
    const hook = [outboxHook()];
    const { entryId } = await addEntry(scope, { listId, recordId: ada, values: { [stage]: 'Intro' } }, hook);
    const second = await addEntry(scope, { listId: other, recordId: ada }, hook);
    await setValues(scope, { entryId, values: { [stage]: { value: 'Won' } } }, hook);
    await removeEntry(scope, { entryId }, hook);
    await restoreEntry(scope, { entryId }, hook);
    // A delete hides both entries, and the restore shows them: one row per list, beside the records row.
    await deleteRecord(scope, { recordId: ada }, hook);
    await restoreRecord(scope, { recordId: ada }, hook);

    const rows = (await detailsOf(scope)).map((row) => ({
      kind: row.kind,
      list: row.list_id,
      object: row.object_id,
      entries: row.item_ids,
      records: row.record_ids,
      attributes: row.attribute_ids,
      coarse: row.coarse,
    }));
    const entry = (list: string, ids: string[], attributes: string[] = []) => ({
      kind: 'entries',
      list,
      object: people,
      entries: ids,
      records: [ada],
      attributes,
      coarse: false,
    });
    const record = { kind: 'records', list: null, object: people, entries: [], records: [ada], coarse: false };
    const byList: Record<string, string> = { [listId]: entryId, [other]: second.entryId };
    const both = [listId, other].sort().map((list) => entry(list, [byList[list] ?? '']));
    expect(rows).toEqual([
      entry(listId, [entryId], [stage]),
      entry(other, [second.entryId]),
      entry(listId, [entryId], [stage]),
      entry(listId, [entryId]),
      entry(listId, [entryId]),
      { ...record, attributes: [] },
      ...both,
      { ...record, attributes: [] },
      ...both,
    ]);
  });

  it('names the purged entries, and makes a list coarse past 1,000 entries in one write (AC-80)', async () => {
    const { scope, people, listId, ada } = await listWorld();
    const { entryId } = await addEntry(scope, { listId, recordId: ada });
    await removeEntry(scope, { entryId });
    await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute(sql`update list_entries set deleted_at = now() - interval '31 days' where id = ${entryId}`),
    );
    const before = (await detailsOf(scope)).length;
    await purgeDeleted(scope, {}, [outboxHook()]);
    expect((await detailsOf(scope)).slice(before)).toMatchObject([
      { kind: 'entries', list_id: listId, object_id: people, item_ids: [entryId], record_ids: [ada] },
    ]);

    const many = Array.from({ length: CHANGE_CAP + 1 }, () => ({
      entryId: newId(),
      listId,
      recordId: ada,
      objectId: people,
    }));
    await runWrite(
      scope,
      (context) => {
        context.record({ hiddenEntries: many });
        return Promise.resolve();
      },
      [outboxHook()],
    );
    expect((await detailsOf(scope)).at(-1)).toMatchObject({
      kind: 'entries',
      list_id: listId,
      item_ids: [],
      record_ids: [],
      coarse: true,
    });
  });

  it('stores a definitions row for objects, options and lists made, changed, reordered or archived (AC-81)', async () => {
    const { scope, people } = await workspace();
    const hook = [outboxHook()];
    const { objectId } = await defineObject(
      scope,
      { apiSlug: 'projects', singularName: 'Project', pluralName: 'Projects', icon: 'folder', hue: 'green' },
      hook,
    );
    await updateObject(scope, { objectId, pluralName: 'All projects' }, hook);
    await setObjectArchived(scope, { objectId, archived: true }, hook);
    await setObjectArchived(scope, { objectId, archived: false }, hook);
    const { attributeId: phase } = await defineAttribute(
      scope,
      { objectId, apiSlug: 'phase', title: 'Phase', type: 'select' },
      hook,
    );
    const { optionId } = await defineOption(scope, { attributeId: phase, label: 'Plan', hue: 'sky' }, hook);
    await defineOption(scope, { attributeId: phase, label: 'Build', hue: 'green' }, hook);
    // Renamed and moved to the end: the attribute's screens read it again.
    await updateOption(scope, { optionId, label: 'Planning', position: 1 }, hook);
    const { listId } = await defineList(scope, { objectId: people, apiSlug: 'pipeline', name: 'Pipeline' }, hook);

    const rows = (await detailsOf(scope)).map((row) => [row.kind, row.object_id, row.list_id, row.attribute_ids]);
    const whole = ['definitions', objectId, null, []];
    const attribute = ['definitions', objectId, null, [phase]];
    expect(rows).toEqual([
      whole,
      whole,
      whole,
      whole,
      attribute,
      attribute,
      attribute,
      attribute,
      ['definitions', people, listId, []],
    ]);
  });

  it('stores a members row for a role changed or a member removed, and none when refused or unchanged (AC-82)', async () => {
    const { scope, workspaceId } = await workspace();
    const memberId = newId();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${memberId}, 'Grace', 'grace@example.com', 'member', 'system', 'system')`,
      ),
    );
    const hook = [outboxHook()];
    // A member changes no roles: refused, nothing stored.
    const asMember = testScope({ db, workspaceId, actor: { type: 'member', id: memberId }, role: 'member' });
    await expect(setMemberRole(asMember, { memberId, role: 'admin' }, hook)).rejects.toSatisfy(isRefusal);
    // The role it already has: nothing changed, nothing stored.
    await setMemberRole(scope, { memberId, role: 'member' }, hook);
    expect(await detailsOf(scope)).toEqual([]);

    await setMemberRole(scope, { memberId, role: 'admin' }, hook);
    await removeMember(scope, { memberId }, hook);
    expect((await detailsOf(scope)).map((row) => [row.kind, row.object_id, row.item_ids, row.record_ids])).toEqual([
      ['members', null, [memberId], []],
      ['members', null, [memberId], []],
    ]);
  });

  it('names the records a write created, deleted and restored, and goes coarse past the cap (owner decision pending)', async () => {
    const { scope, people } = await workspace();
    const hook = [outboxHook()];
    const { recordId } = await createRecord(scope, { objectId: people }, hook);
    await deleteRecord(scope, { recordId }, hook);
    await restoreRecord(scope, { recordId }, hook);
    const lifecycle = (row: Details | undefined) => [row?.created_ids, row?.deleted_ids, row?.restored_ids];
    expect((await detailsOf(scope)).map(lifecycle)).toEqual([
      [[recordId], [], []],
      [[], [recordId], []],
      [[], [], [recordId]],
    ]);

    // At the cap every id is named; one past it, the row is coarse and names none.
    const made = (n: number) => Array.from({ length: n }, () => ({ recordId: newId(), objectId: people }));
    for (const n of [MAX_LIFECYCLE_IDS, MAX_LIFECYCLE_IDS + 1]) {
      await runWrite(
        scope,
        (context) => {
          context.record({ deletedRecords: made(n) });
          return Promise.resolve();
        },
        hook,
      );
    }
    const [atCap, past] = (await detailsOf(scope)).slice(-2);
    expect(atCap).toMatchObject({ coarse: false });
    expect(atCap?.deleted_ids).toHaveLength(MAX_LIFECYCLE_IDS);
    expect(past).toMatchObject({ coarse: true, record_ids: [], deleted_ids: [] });
  });
});
