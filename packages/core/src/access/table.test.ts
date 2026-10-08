// The access table walk (spec 0009, AC-135, AC-139): every service `@crm/core`
// exports either has an entry saying what it checks, or is named here as
// taking no scope; and every entry is refused to a principal without the
// access, before anything is written.
import { sql } from 'drizzle-orm';
import { PERMISSIONS } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import * as core from '../index.ts';
import * as system from '../system.ts';
import { testScope } from '../testing.ts';
import type { EngineScope } from './mint.ts';
import { ACCESS_TABLE, type AccessEntry } from './table.ts';

/** Exported functions that take no scope: the door, pure helpers, the bootstrap (which mints its own) and the runner. */
const NO_SCOPE: ReadonlySet<string> = new Set([
  // The door and its entries mint scopes; they don't take one.
  'enterWorkspace',
  'enterWithKey',
  'enterAsActor',
  'systemScope',
  // Before any workspace: the status check, the signed in account, the bootstrap.
  'getSystemStatus',
  'getMe',
  'startWorkspace',
  'createWorkspace',
  'createUserWorkspace',
  // Pure access functions.
  'can',
  'objectLevel',
  'fieldLevel',
  'recordRule',
  'visibleAttributes',
  'filterRecordView',
  'readOnlyReason',
  'keyAccess',
  'policyKey',
  'filterEvent',
  'eventFacts',
  // Ids, cursors and refusals.
  'newId',
  'isUuidV7',
  'cursorBinding',
  'encodeCursor',
  'decodeCursor',
  'inputInvalid',
  'isInputError',
  'isRefusal',
  // The write path's own parts: hooks run inside the runner, which stays inside the package.
  'capChange',
  'cappedHook',
  'outboxHook',
  'outboxEvents',
]);

const exported = { ...core, ...system } as Record<string, unknown>;
const functions = Object.keys(exported).filter((name) => typeof exported[name] === 'function');

describe('the access table', () => {
  it('has an entry for every exported service, and none for anything else', () => {
    const unlisted = functions.filter((name) => !NO_SCOPE.has(name) && !Object.hasOwn(ACCESS_TABLE, name));
    expect(unlisted).toEqual([]);
    const stale = Object.keys(ACCESS_TABLE).filter((name) => !functions.includes(name));
    expect(stale).toEqual([]);
    const both = functions.filter((name) => NO_SCOPE.has(name) && Object.hasOwn(ACCESS_TABLE, name));
    expect(both).toEqual([]);
  });
});

const { appUrl } = inject('testDatabase');
let db: Database;
beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-table-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
/** A workspace (its owner made it) with a second member of `role`, and that member's scope. */
async function memberOf(role: 'admin' | 'member') {
  made += 1;
  const created = await core.createWorkspace(db, {
    name: 'Table',
    slug: `table-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const memberId = core.newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', ${role}, 'system', 'system')`,
    ),
  );
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: memberId }, role });
  return { ...created, ownerId: created.memberId, memberId, scope };
}

type Service = (scope: EngineScope, ...rest: unknown[]) => Promise<unknown>;
const service = (name: string) => exported[name] as Service;

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (core.isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const entries = Object.entries(ACCESS_TABLE) as [string, AccessEntry][];

describe('the walk: a principal without the access is refused', () => {
  const byPermission = entries.filter(
    (entry): entry is [string, { readonly permission: core.Access['permissions'][number] }] => 'permission' in entry[1],
  );

  it.each(byPermission)('%s refuses a member without %o, FORBIDDEN with the catalog sentence', async (name, entry) => {
    const { scope } = await memberOf('member');
    expect(await refusalOf(service(name)(scope, {}))).toEqual({
      code: 'FORBIDDEN',
      message: PERMISSIONS[entry.permission].message,
    });
  });

  it.each(entries.filter(([, entry]) => 'ownerRules' in entry).map(([name]) => name))(
    '%s refuses a member acting on someone else',
    async (name) => {
      const { scope, ownerId } = await memberOf('member');
      expect(await refusalOf(service(name)(scope, { memberId: ownerId, role: 'member' }))).toMatchObject({
        code: 'FORBIDDEN',
      });
    },
  );

  it.each(entries.filter(([, entry]) => 'system' in entry).map(([name]) => name))(
    '%s refuses anyone but the system',
    async (name) => {
      const { scope } = await memberOf('admin');
      await expect(service(name)(scope)).rejects.toThrow(/Only the system/);
    },
  );

  it.each(entries.filter(([, entry]) => 'anyMember' in entry).map(([name]) => name))(
    '%s answers any member',
    async (name) => {
      const { scope } = await memberOf('member');
      await expect(Promise.resolve(service(name)(scope))).resolves.toBeDefined();
    },
  );

  // Data levels (spec 0009, milestone 2): each data service, called by a principal at less than the level it
  // needs on People (and its list), answers as absent (a read) or refuses the change (a write).
  const dataEntries = entries.flatMap(([name, entry]) => ('data' in entry ? [[name, entry.data] as const] : []));

  it('has a case for every data entry, and none for anything else', () => {
    expect(dataEntries.map(([name]) => name).sort()).toEqual(Object.keys(DATA_CASES).sort());
  });

  it.each(dataEntries)('%s answers as absent to a principal at less than %s', async (name, level) => {
    const world = await dataWorld();
    const test = DATA_CASES[name];
    if (test === undefined) throw new Error(`${name} has no case.`);
    const scope = level === 'read' ? world.hidden : world.readOnly;
    const outcome = await settle(test.call(scope, world));
    if (test.expect === 'empty') {
      expect(outcome).toMatchObject({ ok: true });
      expect((test.leaves ?? none)(outcome.ok ? outcome.value : undefined, world)).toBe(true);
    } else {
      expect(outcome).toMatchObject({ ok: false, refusal: { code: test.expect } });
    }
    // The owner (the open policy) is let through the same call.
    const asOwner = await settle(test.call(world.owner, world));
    expect(asOwner.ok || !['NOT_FOUND', 'FORBIDDEN'].includes(asOwner.refusal.code)).toBe(true);
  });
});

/** A workspace whose People object a member can't see, and one where they may only read it (and its list). */
async function dataWorld() {
  const { scope: memberScope, workspaceId, objects, ownerId } = await memberOf('member');
  const people = objects.people ?? '';
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
  const attributes = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string }>(
      sql`select id::text, api_slug from attributes where object_id = ${people}`,
    ),
  );
  const attribute = (slug: string) => attributes.rows.find((row) => row.api_slug === slug)?.id ?? '';
  const stage = (
    await core.defineAttribute(owner, { objectId: people, apiSlug: 'stage', title: 'Stage', type: 'status' })
  ).attributeId;
  const recordId = (await core.createRecord(owner, { objectId: people, values: { [attribute('job_title')]: 'Pilot' } }))
    .recordId;
  const { listId } = await core.defineList(owner, { objectId: people, apiSlug: 'crew', name: 'Crew' });
  const { entryId } = await core.addEntry(owner, { listId, recordId });
  const member = memberScope.actor;
  const objectRule = (objectId: string, level: string) => ({
    subject: { type: 'role' as const, role: 'member' },
    target: { type: 'object' as const, objectId },
    level,
  });
  const hidden = testScope({
    db,
    workspaceId,
    actor: member,
    role: 'member',
    rules: { levels: [objectRule(people, 'none')], records: [] },
  });
  const readOnly = testScope({
    db,
    workspaceId,
    actor: member,
    role: 'member',
    rules: { levels: [objectRule(people, 'read'), objectRule(listId, 'read')], records: [] },
  });
  return {
    owner,
    hidden,
    readOnly,
    people,
    name: attribute('name'),
    jobTitle: attribute('job_title'),
    stage,
    recordId,
    listId,
    entryId,
  };
}
type DataWorld = Awaited<ReturnType<typeof dataWorld>>;

type Outcome =
  | { readonly ok: true; readonly value: unknown; readonly refusal?: undefined }
  | { readonly ok: false; readonly refusal: { readonly code: string } };

/** A call's result, or its refusal (a batch's first refused record counts as its refusal). */
async function settle(call: Promise<unknown>): Promise<Outcome> {
  try {
    const value = await call;
    if (Array.isArray(value) && value.length === 1) {
      const [only] = value as unknown[];
      if (typeof only === 'object' && only !== null && 'ok' in only && only.ok === false && 'refusals' in only) {
        const [first] = only.refusals as { code: string }[];
        if (first !== undefined) return { ok: false, refusal: first };
      }
    }
    return { ok: true, value };
  } catch (error) {
    if (core.isRefusal(error)) return { ok: false, refusal: error.refusal };
    throw error;
  }
}

interface DataCase {
  readonly call: (scope: EngineScope, world: DataWorld) => Promise<unknown>;
  /** A refusal code, or `empty`: answered, with the hidden thing left out (`leaves`). */
  readonly expect: 'NOT_FOUND' | 'FORBIDDEN' | 'empty';
  readonly leaves?: (value: unknown, world: DataWorld) => boolean;
}

const none = (value: unknown) => Array.isArray(value) && value.length === 0;
const empty = (call: DataCase['call'], leaves: DataCase['leaves'] = none): DataCase => ({
  call,
  expect: 'empty',
  leaves,
});
const refused = (code: 'NOT_FOUND' | 'FORBIDDEN', call: DataCase['call']): DataCase => ({ call, expect: code });
const named = (world: DataWorld) => ({ [world.name]: { value: 'Renamed' } });

/** Every data entry of the access table, called as the principal it is about. */
const DATA_CASES: Readonly<Record<string, DataCase>> = {
  // Reads, by a principal at `none` on People: absent.
  listObjects: empty(
    (scope) => core.listObjects(scope),
    (value, world) => Array.isArray(value) && !value.some((object: { id: string }) => object.id === world.people),
  ),
  listObjectAttributes: refused('NOT_FOUND', (scope, world) => core.listObjectAttributes(scope, world.people)),
  listAttributes: empty((scope, world) => core.listAttributes(scope, world.people)),
  listOptions: empty((scope, world) => core.listOptions(scope, world.stage)),
  getRecords: empty((scope, world) => core.getRecords(scope, { ids: [world.recordId] })),
  readRecordsById: empty((scope, world) => core.readRecordsById(scope, [world.recordId])),
  queryRecords: refused('NOT_FOUND', (scope, world) => core.queryRecords(scope, { objectId: world.people })),
  queryPage: refused('NOT_FOUND', (scope, world) => core.queryPage(scope, { objectId: world.people })),
  countMatches: refused('NOT_FOUND', (scope, world) => core.countMatches(scope, { objectId: world.people })),
  getHistory: refused('NOT_FOUND', (scope, world) =>
    core.getHistory(scope, { recordId: world.recordId, attributeId: world.jobTitle }),
  ),
  getValuesAsOf: refused('NOT_FOUND', (scope, world) =>
    core.getValuesAsOf(scope, { recordId: world.recordId, at: new Date().toISOString() }),
  ),
  getTimeInStages: refused('NOT_FOUND', (scope, world) =>
    core.getTimeInStages(scope, { recordId: world.recordId, attributeId: world.stage }),
  ),
  getEntries: empty((scope, world) => core.getEntries(scope, { ids: [world.entryId] })),
  getRecordEntries: empty((scope, world) => core.getRecordEntries(scope, { recordId: world.recordId })),
  // Writes, by a principal who may only read People and its list: 403.
  createRecord: refused('FORBIDDEN', (scope, world) => core.createRecord(scope, { objectId: world.people })),
  addRecord: refused('FORBIDDEN', (scope, world) =>
    core.addRecord(scope, { objectId: world.people, id: core.newId() }),
  ),
  setValues: refused('FORBIDDEN', (scope, world) =>
    core.setValues(scope, { recordId: world.recordId, values: named(world) }),
  ),
  setRecordValues: refused('FORBIDDEN', (scope, world) =>
    core.setRecordValues(scope, { recordId: world.recordId, values: named(world) }),
  ),
  setValuesBatch: refused('FORBIDDEN', (scope, world) =>
    core.setValuesBatch(scope, { items: [{ recordId: world.recordId, values: named(world) }] }),
  ),
  editRecord: refused('FORBIDDEN', (scope, world) =>
    core.editRecord(scope, { recordId: world.recordId, values: named(world) }),
  ),
  deleteRecord: refused('FORBIDDEN', (scope, world) => core.deleteRecord(scope, { recordId: world.recordId })),
  restoreRecord: refused('FORBIDDEN', (scope, world) => core.restoreRecord(scope, { recordId: world.recordId })),
  addEntry: refused('FORBIDDEN', (scope, world) =>
    core.addEntry(scope, { listId: world.listId, recordId: world.recordId }),
  ),
  removeEntry: refused('FORBIDDEN', (scope, world) => core.removeEntry(scope, { entryId: world.entryId })),
  restoreEntry: refused('FORBIDDEN', (scope, world) => core.restoreEntry(scope, { entryId: world.entryId })),
};

describe('schema writes (AC-135)', () => {
  const attributeCount = (workspaceId: string, objectId: string) =>
    db
      .withWorkspace(workspaceId, (tx) =>
        tx.execute<{ count: number }>(sql`select count(*)::int as count from attributes where object_id = ${objectId}`),
      )
      .then((result) => result.rows[0]?.count);
  const outboxCount = (workspaceId: string) =>
    db
      .withWorkspace(workspaceId, (tx) => tx.execute<{ count: number }>(sql`select count(*)::int as count from outbox`))
      .then((result) => result.rows[0]?.count);

  it('refuses a member’s Add attribute and writes no attribute and no outbox row; an admin’s succeeds', async () => {
    const asMember = await memberOf('member');
    const people = asMember.objects.people ?? '';
    const before = await attributeCount(asMember.workspaceId, people);
    const outboxBefore = await outboxCount(asMember.workspaceId);
    const hooks = [core.outboxHook({ mutationId: core.newId() })];
    expect(
      await refusalOf(core.addAttribute(asMember.scope, { objectId: people, title: 'Nickname', type: 'text' }, hooks)),
    ).toEqual({ code: 'FORBIDDEN', message: 'Only workspace owners and admins can change objects and attributes.' });
    expect(await attributeCount(asMember.workspaceId, people)).toBe(before);
    expect(await outboxCount(asMember.workspaceId)).toBe(outboxBefore);

    const asAdmin = await memberOf('admin');
    const made = await core.addAttribute(asAdmin.scope, {
      objectId: asAdmin.objects.people ?? '',
      title: 'Nickname',
      type: 'text',
    });
    expect(made.title).toBe('Nickname');
  });
});
