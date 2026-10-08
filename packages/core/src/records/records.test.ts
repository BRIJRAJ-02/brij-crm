// The People table's record services against a real Postgres: a write's read
// back and a window's read back reuse the attribute definitions their
// statement already loaded, rather than loading them a second time.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, schema, type Database, type WorkspaceTx } from '@crm/db';
import { createWorkspace } from '../engine/workspaces.ts';
import { addRecord, editRecord, queryRecords } from './records.ts';
import { newId } from '../engine/ids.ts';
import { testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-records-service-tests' });
});
afterAll(async () => {
  await db.close();
});

/**
 * `db`, counting every select that reads the attributes table in any of its
 * transactions: the builder's `from` is watched, so each load counts once.
 */
function countingAttributeLoads(): { readonly db: Database; readonly loads: () => number } {
  let loads = 0;
  const watch = (tx: WorkspaceTx): WorkspaceTx =>
    new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== 'select') return Reflect.get(target, property, receiver) as unknown;
        return (...args: Parameters<WorkspaceTx['select']>) => {
          const builder = target.select(...args);
          return new Proxy(builder, {
            get(inner, key) {
              const value: unknown = Reflect.get(inner, key, inner);
              if (key !== 'from' || typeof value !== 'function') {
                return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(inner) : value;
              }
              return (table: unknown, ...rest: unknown[]) => {
                if (table === schema.attributes) loads += 1;
                return (value as (...a: unknown[]) => unknown).call(inner, table, ...rest);
              };
            },
          });
        };
      },
    });
  return {
    db: { ...db, withWorkspace: (workspaceId, work) => db.withWorkspace(workspaceId, (tx) => work(watch(tx))) },
    loads: () => loads,
  };
}

let made = 0;
async function people(database: Database) {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Records',
    slug: `records-service-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({
    db: database,
    workspaceId: created.workspaceId,
    actor: { type: 'member', id: created.memberId },
  });
  const objectId = created.objects.people;
  if (objectId === undefined) throw new Error('No People object.');
  return { scope, objectId };
}

describe('reading back what a statement wrote or found', () => {
  it('loads the object attributes once for a create, an edit and a window', async () => {
    const counting = countingAttributeLoads();
    const { scope, objectId } = await people(counting.db);
    const before = counting.loads();
    const created = await addRecord(scope, { objectId, id: newId() });
    expect(counting.loads() - before).toBe(1);

    const editing = counting.loads();
    await editRecord(scope, { recordId: created.id, values: {} });
    expect(counting.loads() - editing).toBe(1);

    const querying = counting.loads();
    const page = await queryRecords(scope, { objectId });
    expect(page.records.map((record) => record.id)).toEqual([created.id]);
    expect(counting.loads() - querying).toBe(1);
  });
});
