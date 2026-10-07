// attributes.list and attributes.create (spec 0005, AC-34, AC-37): a member
// reads an object's columns and adds one, whose API name the server derives
// from the title; a taken name refuses on the title field, and a retry after a
// lost response answers the attribute already made. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { newId } from '@crm/core';
import { rpcClient, signInApp, testConnections } from '../../test/sign-in.ts';
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
    const { attributes } = await memberWithWorkspace(app);
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

describe('attributes.create', () => {
  it('derives the API name from the title, answers the definition, and the column joins the list at the end', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const made = await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      title: '  Lead score ',
      type: 'number',
      mutationId: newId(),
    });
    expect(made).toEqual({
      id: expect.any(String) as string,
      apiSlug: 'lead_score',
      title: 'Lead score',
      type: 'number',
      isMulti: false,
      isRequired: false,
      isUnique: false,
      isSystem: false,
      config: { display: 'plain' },
      position: expect.any(Number) as number,
    });
    const listed = await client.attributes.list({ workspace: slug, objectId: people.id });
    expect(listed.at(-1)).toEqual(made);

    const accented = await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      title: 'Café — 2nd visit?',
      type: 'date',
      mutationId: newId(),
    });
    expect(accented.apiSlug).toBe('cafe_2nd_visit');
    const numeric = await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      title: '2027 goals',
      type: 'long_text',
      mutationId: newId(),
    });
    expect(numeric.apiSlug).toBe('attribute_2027_goals');
  });

  it('answers a retry of the same create (a lost response) with the attribute already made', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const input = { workspace: slug, objectId: people.id, title: 'Tier', type: 'rating' as const };
    const first = await client.attributes.create({ ...input, mutationId: newId() });
    const again = await client.attributes.create({ ...input, mutationId: newId() });
    expect(again).toEqual(first);
    const listed = await client.attributes.list({ workspace: slug, objectId: people.id });
    expect(listed.filter((each) => each.apiSlug === 'tier')).toHaveLength(1);
  });

  it('refuses a taken name with SLUG_TAKEN on the title field: another title, another type, or one it did not make', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    await client.attributes.create({
      workspace: slug,
      objectId: people.id,
      title: 'Lead score',
      type: 'number',
      mutationId: newId(),
    });
    const taken = {
      code: 'SLUG_TAKEN',
      status: 409,
      message: "There's already an attribute with that name here. Pick another name.",
    };
    for (const [title, type] of [
      ['Lead-score', 'number'],
      ['Lead score', 'text'],
      // The template's own Job title (text), made by the system, not by this member.
      ['Job title', 'text'],
    ] as const) {
      const error = await failure(() =>
        client.attributes.create({ workspace: slug, objectId: people.id, title, type, mutationId: newId() }),
      );
      expect({ code: error.code, status: error.status, message: error.message }, title).toEqual(taken);
      expect(refusalsOf(error)).toEqual([{ code: 'SLUG_TAKEN', message: taken.message, field: 'title' }]);
    }
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

  it('refuses bad input before the engine: an empty title, a type the loop does not offer, a missing mutation id', async () => {
    const { client, slug, people } = await memberWithWorkspace(app);
    const base = { workspace: slug, objectId: people.id, title: 'Score', type: 'number' as const, mutationId: newId() };
    expect(await refusal(() => client.attributes.create({ ...base, title: '   ' }))).toMatchObject({
      code: 'INPUT_INVALID',
      status: 400,
    });
    expect(
      await refusal(() => client.attributes.create({ ...base, type: 'select' as unknown as 'number' })),
    ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(
      await refusal(() => client.attributes.create({ ...base, mutationId: undefined as unknown as string })),
    ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
    expect(await refusal(() => client.attributes.create({ ...base, objectId: newId() }))).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('answers a non member and no session the same way as every workspace procedure', async () => {
    const a = await memberWithWorkspace(app);
    const b = await memberWithWorkspace(app);
    const create = { workspace: a.slug, objectId: a.people.id, title: 'Sneaky', type: 'text' as const };
    expect(await refusal(() => b.client.attributes.list({ workspace: a.slug, objectId: a.people.id }))).toEqual(
      NOT_A_MEMBER,
    );
    expect(await refusal(() => b.client.attributes.create({ ...create, mutationId: newId() }))).toEqual(NOT_A_MEMBER);
    expect(await refusal(() => rpcClient(app).attributes.create({ ...create, mutationId: newId() }))).toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    const listed = await a.client.attributes.list({ workspace: a.slug, objectId: a.people.id });
    expect(listed.map((each) => each.apiSlug)).not.toContain('sneaky');
  });
});
