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
  // The write path's own parts: the runner checks the seal, and hooks run inside it.
  'runWrite',
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

  // Data levels are enforced at the engine's choke points in milestone 2; until then every role writes everything.
  for (const [name, entry] of entries.filter(([, each]) => 'data' in each)) {
    it.todo(`${name} answers as absent to a principal at less than ${(entry as { data: string }).data} (milestone 2)`);
  }
});

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
