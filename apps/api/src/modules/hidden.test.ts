// Hidden means absent at the API (spec 0009, milestone 2, AC-140 to AC-143):
// the app's door takes its rules from the injected RuleSource (production's
// passes none), and a member's procedures then answer as if a hidden column
// and the records outside their record rule didn't exist, while the owner
// sees everything. Real session, real Postgres.
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
/** Each test workspace's rules, by workspace id, as #24's tables will hold them. */
const rulesByWorkspace = new Map<string, AccessRules>();

/** Reads the rules of the workspace the door's transaction is in. */
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

/** Someone else, signed in, added to `workspaceId` as a member, with their client and member id. */
async function joined(workspaceId: string) {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
  const memberId = newId();
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
    [workspaceId, memberId, user?.id, email],
  );
  return { client: rpcClient(app, cookie), memberId };
}

describe('rules at the API (AC-140 to AC-143)', () => {
  it('leaves a hidden column and the records outside a record rule out of every procedure', async () => {
    const owner = await memberWithWorkspace(app);
    const { client: member, memberId } = await joined(owner.workspace.id);
    const workspace = owner.slug;
    const person = (first: string, extra: Record<string, unknown>) =>
      owner.client.records.create({
        workspace,
        objectId: owner.people.id,
        id: newId(),
        values: { [owner.attribute('name')]: { firstName: first, lastName: 'L' }, ...extra },
        mutationId: newId(),
      });
    const mine = await person('Ada', {
      [owner.attribute('job_title')]: 'Engineer',
      [owner.attribute('owner')]: { type: 'member', id: memberId },
    });
    const theirs = await person('Bob', { [owner.attribute('job_title')]: 'Founder' });
    rulesByWorkspace.set(owner.workspace.id, {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: owner.people.id, attributeId: owner.attribute('job_title') },
          level: 'hidden',
        },
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'object', objectId: owner.companies.id },
          level: 'none',
        },
      ],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: owner.people.id,
          kind: 'own',
          attributeId: owner.attribute('owner'),
        },
      ],
    });

    const objects = await member.objects.list({ workspace });
    expect(objects.map((object) => object.id)).not.toContain(owner.companies.id);
    expect(objects.find((object) => object.id === owner.people.id)?.access).toBe('write');
    const attributes = await member.attributes.list({ workspace, objectId: owner.people.id });
    expect(attributes.map((attribute) => attribute.id)).not.toContain(owner.attribute('job_title'));
    expect(await refusal(() => member.attributes.list({ workspace, objectId: owner.companies.id }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });

    const page = await member.records.query({ workspace, objectId: owner.people.id });
    expect(page.records.map((record) => record.id)).toEqual([mine.id]);
    expect(page.records[0]?.values).not.toHaveProperty(owner.attribute('job_title'));
    expect(await member.records.count({ workspace, objectId: owner.people.id })).toEqual({
      count: 1,
      atLeast: false,
    });
    expect(await member.records.get({ workspace, ids: [theirs.id, mine.id] })).toHaveLength(1);
    expect(
      await refusal(() =>
        member.records.query({
          workspace,
          objectId: owner.people.id,
          filter: {
            conjunction: 'and',
            conditions: [{ attributeId: owner.attribute('job_title'), operator: 'is', value: 'Founder' }],
          },
        }),
      ),
    ).toMatchObject({ code: 'FILTER_INVALID', status: 422 });
    expect(
      await refusal(() =>
        member.records.setValues({
          workspace,
          recordId: theirs.id,
          values: { [owner.attribute('name')]: { value: { firstName: 'X', lastName: 'Y' } } },
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });

    // The owner sees everything.
    const all = await owner.client.records.query({ workspace, objectId: owner.people.id });
    expect(all.records.map((record) => record.id).sort()).toEqual([mine.id, theirs.id].sort());
    expect(all.records.find((record) => record.id === theirs.id)?.values[owner.attribute('job_title')]).toBe('Founder');
  });
});
