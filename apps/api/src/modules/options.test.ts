// The option writes and a cell's new option (spec 0012, milestone 3): owners
// and admins make a select with its first options, add, change, move, archive
// and restore options, and make one from a cell in the record's own write;
// each refusal answers with its status, and a member gets 403 for all of it.
// Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '@crm/core';
import { rpcClient, signIn, signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, NOT_A_MEMBER, refusal, refusalsOf } from '../../test/workspace.ts';

const { ownerUrl } = inject('testDatabase');
let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

/** A select "Tier" on People with Silver and Gold. */
async function tierOn(m: Member) {
  return m.client.attributes.create({
    workspace: m.slug,
    objectId: m.people.id,
    id: newId(),
    title: 'Tier',
    type: 'select',
    options: [
      { id: newId(), label: 'Silver', hue: 'gray' },
      { id: newId(), label: 'Gold', hue: 'yellow' },
    ],
    mutationId: newId(),
  });
}

/** A second person in the workspace with the member role, and their client. */
async function plainMember(m: Member) {
  const { cookie, email } = await signIn(app);
  const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
  await testQuery(
    ownerUrl,
    `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
     values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
    [m.workspace.id, newId(), user?.id, email],
  );
  return rpcClient(app, cookie);
}

const outboxCount = async (workspaceId: string) =>
  (
    await testQuery<{ n: number }>(ownerUrl, 'select count(*)::int as n from outbox where workspace_id = $1', [
      workspaceId,
    ])
  )[0]?.n;

describe('a select or status made with its options (AC-230)', () => {
  it('answers the attribute with its options inline, in order', async () => {
    const m = await memberWithWorkspace(app);
    const tier = await tierOn(m);
    expect(tier.options?.map((option) => [option.label, option.hue, option.position])).toEqual([
      ['Silver', 'gray', 0],
      ['Gold', 'yellow', 1],
    ]);
  });

  it('refuses a target time that is not whole days from 1 to 365 as bad input', async () => {
    const m = await memberWithWorkspace(app);
    const stage = (targetTimeInStage: string) =>
      m.client.attributes.create({
        workspace: m.slug,
        objectId: m.people.id,
        id: newId(),
        title: 'Stage',
        type: 'status',
        options: [{ id: newId(), label: 'Lead', hue: 'gray', outcome: 'open', targetTimeInStage }],
        mutationId: newId(),
      });
    expect(await refusal(() => stage('P366D'))).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(await refusal(() => stage('PT4H'))).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    await expect(stage('P365D')).resolves.toMatchObject({ options: [{ targetTimeInStage: 'P365D' }] });
  });
});

describe('the option writes (AC-236, AC-237)', () => {
  it('adds an option with the next hue, changes, moves, archives and restores it', async () => {
    const m = await memberWithWorkspace(app);
    const tier = await tierOn(m);
    const id = newId();
    const write = { workspace: m.slug, mutationId: newId() };
    const platinum = await m.client.options.create({ ...write, attributeId: tier.id, id, label: 'Platinum' });
    expect(platinum).toEqual({ id, label: 'Platinum', hue: 'lime', position: 2, isArchived: false });
    expect(await m.client.options.update({ ...write, optionId: id, label: 'Diamond', hue: 'sky' })).toMatchObject({
      label: 'Diamond',
      hue: 'sky',
    });
    const order = await m.client.options.reorder({ ...write, optionId: id, position: 0 });
    expect(order.map((option) => option.label)).toEqual(['Diamond', 'Silver', 'Gold']);
    expect(await m.client.options.archive({ ...write, optionId: id })).toMatchObject({ isArchived: true });
    expect(await m.client.options.restore({ ...write, optionId: id })).toMatchObject({ isArchived: false });
  });

  it('refuses a taken label 422 on the label, and an unknown option 404', async () => {
    const m = await memberWithWorkspace(app);
    const tier = await tierOn(m);
    const taken = await failure(() =>
      m.client.options.create({
        workspace: m.slug,
        attributeId: tier.id,
        id: newId(),
        label: 'gold',
        mutationId: newId(),
      }),
    );
    expect({ code: taken.code, status: taken.status }).toEqual({ code: 'CONFIG_INVALID', status: 422 });
    expect(refusalsOf(taken)).toEqual([
      {
        code: 'CONFIG_INVALID',
        message: 'An option with that label already exists. Pick another label.',
        field: 'label',
      },
    ]);
    expect(
      await refusal(() => m.client.options.archive({ workspace: m.slug, optionId: newId(), mutationId: newId() })),
    ).toEqual({ code: 'NOT_FOUND', status: 404, message: 'That option does not exist.' });
  });

  it('answers a non member as every workspace procedure does', async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const tier = await tierOn(a);
    expect(
      await refusal(() =>
        b.client.options.create({
          workspace: a.slug,
          attributeId: tier.id,
          id: newId(),
          label: 'X',
          mutationId: newId(),
        }),
      ),
    ).toEqual(NOT_A_MEMBER);
    // Another workspace's option is unknown here.
    expect(
      await refusal(() =>
        b.client.options.archive({ workspace: b.slug, optionId: tier.options?.[0]?.id ?? '', mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('a new option from a cell (AC-238)', () => {
  it('makes and sets it in records.setValues, with two echoes: the record and the definitions', async () => {
    const m = await memberWithWorkspace(app);
    const tier = await tierOn(m);
    const recordId = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: recordId,
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const optionId = newId();
    const written = await m.client.records.setValues({
      workspace: m.slug,
      recordId,
      values: { [tier.id]: { value: { newOption: { id: optionId, label: 'Platinum' } } } },
      mutationId: newId(),
    });
    expect(written.values[tier.id]).toBe(optionId);
    expect(written.echoes).toBe(2);
    const listed = await m.client.attributes.list({ workspace: m.slug, objectId: m.people.id });
    expect(listed.find((each) => each.id === tier.id)?.options?.map((option) => option.label)).toEqual([
      'Silver',
      'Gold',
      'Platinum',
    ]);
  });

  it('refuses a member 403 FORBIDDEN for a new option and every option write, storing nothing', async () => {
    const m = await memberWithWorkspace(app);
    const tier = await tierOn(m);
    const recordId = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id: recordId,
      values: { [m.attribute('name')]: { firstName: 'Ada' } },
      mutationId: newId(),
    });
    const member = await plainMember(m);
    const before = await outboxCount(m.workspace.id);
    const optionId = tier.options?.[0]?.id ?? '';
    const writes = [
      () =>
        member.records.setValues({
          workspace: m.slug,
          recordId,
          values: { [tier.id]: { value: { newOption: { id: newId(), label: 'Platinum' } } } },
          mutationId: newId(),
        }),
      () =>
        member.options.create({
          workspace: m.slug,
          attributeId: tier.id,
          id: newId(),
          label: 'X',
          mutationId: newId(),
        }),
      () => member.options.update({ workspace: m.slug, optionId, label: 'X', mutationId: newId() }),
      () => member.options.reorder({ workspace: m.slug, optionId, position: 1, mutationId: newId() }),
      () => member.options.archive({ workspace: m.slug, optionId, mutationId: newId() }),
      () => member.options.restore({ workspace: m.slug, optionId, mutationId: newId() }),
    ];
    for (const write of writes) {
      expect(await refusal(write)).toEqual({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Only workspace owners and admins can change objects and attributes.',
      });
    }
    expect(await outboxCount(m.workspace.id)).toBe(before);
    // The member may still set an existing option: only making one needs schema.manage.
    const set = await member.records.setValues({
      workspace: m.slug,
      recordId,
      values: { [tier.id]: { value: optionId } },
      mutationId: newId(),
    });
    expect(set.values[tier.id]).toBe(optionId);
  });
});
