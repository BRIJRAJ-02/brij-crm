// Bulk delete, undo by batch and the trash at the API (spec 0022, milestone
// 1): the statuses each refusal travels with, a retried delete changing
// nothing twice, the trash listing and restoring, and a member who may only
// read an object refused. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { newId, type AccessRules, type RuleSource } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];
const rulesByWorkspace = new Map<string, AccessRules>();
const rules: RuleSource = async (tx) => {
  const { rows } = await tx.execute<{ id: string | null }>("select current_setting('app.workspace_id', true) as id");
  return rulesByWorkspace.get(rows[0]?.id ?? '') ?? { levels: [], records: [] };
};

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }, {}, { rules }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

async function people(m: Member, names: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const firstName of names) {
    const id = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id,
      values: { [m.attribute('name')]: { firstName } },
      mutationId: newId(),
    });
    ids.push(id);
  }
  return ids;
}

describe('records.deleteMany and records.restoreBatch', () => {
  it('deletes, answers a retry the same and changes nothing, and undoes by batch (AC-525, AC-526, AC-540)', async () => {
    const m = await memberWithWorkspace(app);
    const ids = await people(m, ['Ada', 'Bob', 'Cy']);
    const batchId = newId();
    const input = { workspace: m.slug, objectId: m.people.id, recordIds: ids.slice(0, 2), batchId };
    const first = await m.client.records.deleteMany({ ...input, mutationId: newId() });
    expect(first.results.map((result) => result.state)).toEqual(['deleted', 'deleted']);
    expect(first.echoes).toBe(1);
    const again = await m.client.records.deleteMany({ ...input, mutationId: newId() });
    expect(again.results.map((result) => result.state)).toEqual(['deleted', 'deleted']);
    expect(again.echoes).toBe(0);
    expect(await m.client.records.count({ workspace: m.slug, objectId: m.people.id })).toEqual({
      count: 1,
      atLeast: false,
    });
    const undone = await m.client.records.restoreBatch({ workspace: m.slug, batchId, mutationId: newId() });
    expect(undone.mode).toBe('inline');
    expect(undone.results.map((result) => result.state)).toEqual(['restored', 'restored']);
    expect(
      await refusal(() => m.client.records.restoreBatch({ workspace: m.slug, batchId, mutationId: newId() })),
    ).toEqual({ code: 'NOT_FOUND', status: 404, message: 'Nothing from that delete is still in the trash.' });
  });

  it('refuses more than 500 records 422 CONFIG_INVALID (AC-539)', async () => {
    const m = await memberWithWorkspace(app);
    const recordIds = Array.from({ length: 501 }, () => newId());
    expect(
      await refusal(() =>
        m.client.records.deleteMany({
          workspace: m.slug,
          objectId: m.people.id,
          recordIds,
          batchId: newId(),
          mutationId: newId(),
        }),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', status: 422, message: 'Changes to more than 500 records arrive soon.' });
  });
});

describe('the trash (AC-533, AC-534)', () => {
  it('lists and counts the trash, and restores with a refusal per record on a read only object', async () => {
    const owner = await memberWithWorkspace(app);
    const [ada, bob] = await people(owner, ['Ada', 'Bob']);
    await owner.client.records.deleteMany({
      workspace: owner.slug,
      objectId: owner.people.id,
      recordIds: [ada ?? '', bob ?? ''],
      batchId: newId(),
      mutationId: newId(),
    });
    const page = await owner.client.trash.query({ workspace: owner.slug });
    expect(page.items.map((item) => item.display.name).sort()).toEqual(['Ada', 'Bob']);
    expect(await owner.client.trash.count({ workspace: owner.slug })).toEqual({ count: 2, atLeast: false });
    expect(await refusal(() => owner.client.trash.query({ workspace: owner.slug, cursor: 'nonsense' }))).toMatchObject({
      code: 'FILTER_INVALID',
      status: 422,
    });

    // A member who may only read People sees the trash, but each restore is refused with the read only words.
    const { cookie, email } = await signIn(app);
    const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
      [owner.workspace.id, newId(), user?.id, email],
    );
    rulesByWorkspace.set(owner.workspace.id, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'object', objectId: owner.people.id },
          level: 'read',
        },
      ],
      records: [],
    });
    const member = rpcClient(app, cookie);
    expect((await member.trash.query({ workspace: owner.slug })).items).toHaveLength(2);
    const restored = await member.trash.restore({ workspace: owner.slug, recordIds: [ada ?? ''], mutationId: newId() });
    expect(restored.results).toEqual([
      {
        recordId: ada,
        state: 'refused',
        refusal: { code: 'FORBIDDEN', message: 'You can view People but not change them.' },
      },
    ]);
    expect(
      await refusal(() =>
        member.records.deleteMany({
          workspace: owner.slug,
          objectId: owner.people.id,
          recordIds: [newId()],
          batchId: newId(),
          mutationId: newId(),
        }),
      ),
    ).toEqual({ code: 'FORBIDDEN', status: 403, message: 'You can view People but not change them.' });
    rulesByWorkspace.delete(owner.workspace.id);
    const back = await owner.client.trash.restore({
      workspace: owner.slug,
      recordIds: [ada ?? ''],
      mutationId: newId(),
    });
    expect(back.results).toEqual([{ recordId: ada, state: 'restored' }]);
  });
});
