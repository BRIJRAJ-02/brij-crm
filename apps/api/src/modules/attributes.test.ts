// attributes.list and the attribute writes (spec 0005, AC-34; spec 0012,
// milestone 2): a member reads an object's columns; owners and admins create
// one with a client id, edit, move, archive and restore it (both ends of a
// relationship together). Real session, real Postgres.
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

describe('attributes.list', () => {
  it("answers a live object's attributes in position order, system ones first and marked", async () => {
    const { attributes, people } = await memberWithWorkspace(app);
    expect(attributes.slice(0, 6).map((each) => [each.apiSlug, each.isSystem])).toEqual([
      ['record_id', true],
      ['created_at', true],
      ['created_by', true],
      ['updated_at', true],
      ['updated_by', true],
      ['name', false],
    ]);
    const positions = attributes.map((each) => each.position);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(attributes.find((each) => each.apiSlug === 'email_addresses')).toEqual({
      id: expect.any(String) as string,
      apiSlug: 'email_addresses',
      title: 'Email addresses',
      type: 'email',
      isMulti: true,
      isRequired: false,
      isUnique: true,
      isSystem: false,
      config: {},
      position: expect.any(Number) as number,
      // Spec 0012's widened definition.
      objectId: people.id,
      isPrimary: false,
      isArchived: false,
      // Spec 0013: Required and rules, inline.
      validation: { required: 'never', rules: [] },
    });
  });

  it('refuses an unknown object with NOT_FOUND, and a malformed id as bad input', async () => {
    const { client, slug } = await memberWithWorkspace(app);
    expect(await refusal(() => client.attributes.list({ workspace: slug, objectId: newId() }))).toEqual({
      code: 'NOT_FOUND',
      status: 404,
      message: 'That object does not exist.',
    });
    expect(await refusal(() => client.attributes.list({ workspace: slug, objectId: 'people' }))).toMatchObject({
      code: 'INPUT_INVALID',
      status: 400,
    });
  });
});

describe('attributes.create (spec 0012, AC-229, AC-244)', () => {
  it('takes the client id, derives the API name from the title, and the column joins the list at the end', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const id = newId();
    const made = await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      id,
      title: '  Lead score ',
      type: 'number',
      description: 'How warm they are.',
      mutationId: newId(),
    });
    expect(made).toEqual({
      id,
      apiSlug: 'lead_score',
      title: 'Lead score',
      description: 'How warm they are.',
      type: 'number',
      isMulti: false,
      isRequired: false,
      isUnique: false,
      isSystem: false,
      config: { display: 'plain' },
      position: expect.any(Number) as number,
      objectId: people.id,
      isPrimary: false,
      isArchived: false,
      // Spec 0013: Required and rules, inline.
      validation: { required: 'never', rules: [] },
    });
    const listed = await client.attributes.list({ workspace: slug, objectId: people.id });
    expect(listed.at(-1)).toEqual(made);
    const numeric = await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      id: newId(),
      title: '2027 goals',
      type: 'long_text',
      mutationId: newId(),
    });
    expect(numeric.apiSlug).toBe('x_2027_goals');
  });

  it('takes flags, Allow multiple and a default, and a given API name', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const made = await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      id: newId(),
      title: 'Account manager',
      apiSlug: 'manager',
      type: 'actor_reference',
      isMulti: true,
      isRequired: true,
      defaultValue: { kind: 'current_user' },
      mutationId: newId(),
    });
    expect(made).toMatchObject({
      apiSlug: 'manager',
      type: 'actor_reference',
      isMulti: true,
      isRequired: true,
      defaultValue: { kind: 'current_user' },
    });
  });

  it('answers a retry with the same id with the attribute already made, and ID_TAKEN elsewhere', async () => {
    const { client, slug, people, companies } = await memberWithWorkspace(app);
    const input = { workspace: slug, objectId: people.id, id: newId(), title: 'Tier', type: 'rating' as const };
    const first = await client.attributes.create({ ...input, mutationId: newId() });
    const again = await client.attributes.create({ ...input, mutationId: newId() });
    expect(again).toEqual(first);
    const listed = await client.attributes.list({ workspace: slug, objectId: people.id });
    expect(listed.filter((each) => each.apiSlug === 'tier')).toHaveLength(1);
    expect(
      await refusal(() => client.attributes.create({ ...input, objectId: companies.id, mutationId: newId() })),
    ).toEqual({ code: 'ID_TAKEN', status: 409, message: 'An attribute with that id already exists.' });
  });

  it('refuses a taken API name with SLUG_TAKEN on the apiSlug field', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const error = await failure(() =>
      client.attributes.create({
        workspace: slug,
        objectId: people.id,
        id: newId(),
        title: 'Job title',
        type: 'text',
        mutationId: newId(),
      }),
    );
    expect({ code: error.code, status: error.status }).toEqual({ code: 'SLUG_TAKEN', status: 409 });
    expect(refusalsOf(error)).toEqual([
      { code: 'SLUG_TAKEN', message: 'An attribute here already uses this API name. Pick another.', field: 'apiSlug' },
    ]);
  });

  it('refuses an archived object NOT_FOUND, as attributes.list does, and adds nothing to it', async () => {
    const m = await memberWithWorkspace(app);
    await testQuery(ownerUrl, `update objects set archived_at = now() where id = $1`, [m.companies.id]);
    const notFound = { code: 'NOT_FOUND', status: 404, message: 'That object does not exist.' };
    expect(await refusal(() => m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id }))).toEqual(
      notFound,
    );
    expect(
      await refusal(() =>
        m.client.attributes.create({
          workspace: m.slug,
          objectId: m.companies.id,
          id: newId(),
          title: 'Ticker',
          type: 'text',
          mutationId: newId(),
        }),
      ),
    ).toEqual(notFound);
    const [row] = await testQuery<{ n: number }>(
      ownerUrl,
      `select count(*)::int as n from attributes where object_id = $1 and api_slug = 'ticker'`,
      [m.companies.id],
    );
    expect(row?.n).toBe(0);
  });

  it('refuses bad input before the engine: an empty title, a reference, a v4 id, a missing mutation id', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const base = {
      workspace: slug,
      objectId: people.id,
      id: newId(),
      title: 'Score',
      type: 'number' as const,
      mutationId: newId(),
    };
    for (const input of [
      { ...base, title: '   ' },
      { ...base, type: 'record_reference' as unknown as 'number' },
      { ...base, id: '0199d6a4-0000-4000-8000-000000000002' },
      { ...base, mutationId: undefined as unknown as string },
    ]) {
      expect(await refusal(() => client.attributes.create(input))).toMatchObject({
        code: 'INPUT_INVALID',
        status: 400,
      });
    }
    expect(await refusal(() => client.attributes.create({ ...base, objectId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

describe('attributes.update, reorder, archive and restore (spec 0012, AC-231 to AC-235)', () => {
  it('edits an attribute, clears its default, and refuses a system one', async () => {
    const m = await memberWithWorkspace(app);
    const edited = await m.client.attributes.update({
      workspace: m.slug,
      attributeId: m.attribute('job_title'),
      title: 'Role',
      description: 'What they do.',
      isRequired: true,
      defaultValue: { kind: 'static', value: 'Founder' },
      mutationId: newId(),
    });
    expect(edited).toMatchObject({
      title: 'Role',
      apiSlug: 'job_title',
      description: 'What they do.',
      isRequired: true,
      defaultValue: { kind: 'static', value: 'Founder' },
    });
    const cleared = await m.client.attributes.update({
      workspace: m.slug,
      attributeId: m.attribute('job_title'),
      description: null,
      defaultValue: null,
      mutationId: newId(),
    });
    expect(cleared.description).toBeUndefined();
    expect(cleared.defaultValue).toBeUndefined();
    expect(
      await refusal(() =>
        m.client.attributes.update({
          workspace: m.slug,
          attributeId: m.attribute('created_at'),
          title: 'Made',
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'ATTRIBUTE_READ_ONLY', status: 422 });
  });

  it('moves an attribute and answers the object’s attributes in their new order', async () => {
    const m = await memberWithWorkspace(app);
    const order = await m.client.attributes.reorder({
      workspace: m.slug,
      attributeId: m.attribute('job_title'),
      position: 0,
      mutationId: newId(),
    });
    expect(order.filter((each) => !each.isSystem)[0]?.apiSlug).toBe('job_title');
    const listed = await m.client.attributes.list({ workspace: m.slug, objectId: m.people.id });
    expect(listed.filter((each) => !each.isSystem)[0]?.apiSlug).toBe('job_title');
  });

  it('archives a relationship end with its far end, lists them only with includeArchived, and restores both', async () => {
    const m = await memberWithWorkspace(app);
    const ends = await m.client.attributes.archive({
      workspace: m.slug,
      attributeId: m.attribute('company'),
      mutationId: newId(),
    });
    expect(ends.map((each) => [each.objectId, each.apiSlug, each.isArchived])).toEqual([
      [m.people.id, 'company', true],
      [m.companies.id, 'team', true],
    ]);
    const live = await m.client.attributes.list({ workspace: m.slug, objectId: m.people.id });
    expect(live.map((each) => each.apiSlug)).not.toContain('company');
    const all = await m.client.attributes.list({ workspace: m.slug, objectId: m.people.id, includeArchived: true });
    expect(all.find((each) => each.apiSlug === 'company')?.isArchived).toBe(true);
    const restored = await m.client.attributes.restore({
      workspace: m.slug,
      attributeId: m.attribute('company'),
      mutationId: newId(),
    });
    expect(restored.map((each) => each.isArchived)).toEqual([false, false]);
  });

  it('refuses the primary attribute’s archive', async () => {
    const m = await memberWithWorkspace(app);
    expect(
      await refusal(() =>
        m.client.attributes.archive({ workspace: m.slug, attributeId: m.attribute('name'), mutationId: newId() }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', status: 422 });
  });
});

describe('the attribute writes need schema.manage (AC-242)', () => {
  it('refuses a member 403 on every write, storing no outbox row', async () => {
    const m = await memberWithWorkspace(app);
    const { cookie, email } = await signIn(app);
    const [user] = await testQuery<{ id: string }>(ownerUrl, 'select id from auth."user" where email = $1', [email]);
    await testQuery(
      ownerUrl,
      `insert into members (workspace_id, id, user_id, name, email, role, created_by_type, updated_by_type)
       values ($1, $2, $3, 'Bea', $4, 'member', 'system', 'system')`,
      [m.workspace.id, newId(), user?.id, email],
    );
    const member = rpcClient(app, cookie);
    const outbox = async () =>
      (
        await testQuery<{ n: number }>(ownerUrl, 'select count(*)::int as n from outbox where workspace_id = $1', [
          m.workspace.id,
        ])
      )[0]?.n;
    const before = await outbox();
    const attributeId = m.attribute('job_title');
    const writes = [
      () =>
        member.attributes.create({
          workspace: m.slug,
          objectId: m.people.id,
          id: newId(),
          title: 'Nickname',
          type: 'text',
          mutationId: newId(),
        }),
      () => member.attributes.update({ workspace: m.slug, attributeId, title: 'Role', mutationId: newId() }),
      () => member.attributes.reorder({ workspace: m.slug, attributeId, position: 0, mutationId: newId() }),
      () => member.attributes.archive({ workspace: m.slug, attributeId, mutationId: newId() }),
      () => member.attributes.restore({ workspace: m.slug, attributeId, mutationId: newId() }),
    ];
    for (const write of writes) {
      expect(await refusal(write)).toEqual({
        code: 'FORBIDDEN',
        status: 403,
        message: 'Only workspace owners and admins can change objects and attributes.',
      });
    }
    expect(await outbox()).toBe(before);
  });

  it('answers a non member and no session the same way as every workspace procedure', async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const create = {
      workspace: a.slug,
      objectId: a.people.id,
      id: newId(),
      title: 'Sneaky',
      type: 'text' as const,
    };
    expect(await refusal(() => b.client.attributes.list({ workspace: a.slug, objectId: a.people.id }))).toEqual(
      NOT_A_MEMBER,
    );
    expect(await refusal(() => b.client.attributes.create({ ...create, mutationId: newId() }))).toEqual(NOT_A_MEMBER);
    expect(
      await refusal(() =>
        b.client.attributes.archive({ workspace: a.slug, attributeId: a.attribute('job_title'), mutationId: newId() }),
      ),
    ).toEqual(NOT_A_MEMBER);
    expect(await refusal(() => rpcClient(app).attributes.create({ ...create, mutationId: newId() }))).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    const listed = await a.client.attributes.list({ workspace: a.slug, objectId: a.people.id });
    expect(listed.map((each) => each.apiSlug)).not.toContain('sneaky');
  });
});
