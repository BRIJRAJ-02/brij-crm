// relationships.create and relationships.update (spec 0014, milestone 1):
// an owner makes a relationship with a client id and renames both sides;
// each refusal answers with its status and the side it is about; a lost
// answer's retry gets the relationship already made; a member gets 403 and
// nothing is written; attributes.list carries each side's relationship.
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

const counts = async (workspaceId: string) =>
  (
    await testQuery<{ attributes: number; relationships: number; outbox: number }>(
      ownerUrl,
      `select (select count(*)::int from attributes where workspace_id = $1) as attributes,
        (select count(*)::int from relationships where workspace_id = $1) as relationships,
        (select count(*)::int from outbox where workspace_id = $1) as outbox`,
      [workspaceId],
    )
  )[0];

const investors = (m: Member, id = newId()) => ({
  workspace: m.slug,
  id,
  cardinality: 'many_to_many' as const,
  from: { objectId: m.companies.id, title: 'Investors' },
  to: { objectId: m.people.id, title: 'Investments' },
  mutationId: newId(),
});

describe('relationships.create (AC-282 to AC-286)', () => {
  it('makes both sides with derived API names, and attributes.list carries the relationship on each', async () => {
    const m = await memberWithWorkspace(app);
    const made = await m.client.relationships.create(investors(m));
    expect(made).toMatchObject({
      cardinality: 'many_to_many',
      from: { objectId: m.companies.id, title: 'Investors', apiSlug: 'investors', isMulti: true },
      to: { objectId: m.people.id, title: 'Investments', apiSlug: 'investments', isMulti: true },
    });
    const listed = await m.client.attributes.list({ workspace: m.slug, objectId: m.people.id });
    expect(listed.find((each) => each.id === made.to.id)?.relationship).toEqual({
      id: made.relationshipId,
      cardinality: 'many_to_many',
      side: 'to',
      targetObjectIds: [m.companies.id],
      pairedAttributeId: made.from.id,
      pairedTitle: 'Investors',
      farHoldsOne: false,
    });
  });

  it('answers a retried create with the relationship already made, whatever its mutation id', async () => {
    const m = await memberWithWorkspace(app);
    const id = newId();
    const first = await m.client.relationships.create(investors(m, id));
    const before = await counts(m.workspace.id);
    const again = await m.client.relationships.create(investors(m, id));
    expect(again).toEqual(first);
    expect(await counts(m.workspace.id)).toEqual(before);
    expect(
      await refusal(() => m.client.relationships.create({ ...investors(m, id), cardinality: 'one_to_one' })),
    ).toEqual({
      code: 'ID_TAKEN',
      status: 409,
      message: 'This relationship was already created as first sent. Close the dialog to see it.',
    });
  });

  it('refuses a taken name on the side it is about, 409, leaving neither side behind', async () => {
    const m = await memberWithWorkspace(app);
    const before = await counts(m.workspace.id);
    const error = await failure(() =>
      m.client.relationships.create({
        ...investors(m),
        from: { objectId: m.companies.id, title: 'Team' },
      }),
    );
    expect([error.code, error.status]).toEqual(['SLUG_TAKEN', 409]);
    expect(refusalsOf(error)).toEqual([
      {
        code: 'SLUG_TAKEN',
        message: 'Companies already has an attribute with this name. Pick another.',
        field: 'from.title',
      },
    ]);
    expect(await counts(m.workspace.id)).toEqual(before);
  });

  it('refuses equal names on a self relationship 422, an archived object 404, and a missing side as bad input', async () => {
    const m = await memberWithWorkspace(app);
    const self = await failure(() =>
      m.client.relationships.create({
        ...investors(m),
        from: { objectId: m.people.id, title: 'Mentor' },
        to: { objectId: m.people.id, title: 'mentor' },
      }),
    );
    expect([self.code, self.status, refusalsOf(self)[0]?.field]).toEqual(['CONFIG_INVALID', 422, 'to.title']);
    await m.client.objects.archive({ workspace: m.slug, objectId: m.companies.id, mutationId: newId() });
    expect(await refusal(() => m.client.relationships.create(investors(m)))).toEqual({
      code: 'NOT_FOUND',
      status: 404,
      message: 'That object is archived. Restore it first.',
    });
    // A one way reference can't be made here: the other side is required (AC-286).
    const { to: _to, ...oneWay } = investors(m);
    expect(
      await refusal(() => m.client.relationships.create(oneWay as Parameters<typeof m.client.relationships.create>[0])),
    ).toMatchObject({ code: 'INPUT_INVALID', status: 400 });
  });

  it('refuses a member 403 FORBIDDEN for both writes, and a non member as for any workspace, storing nothing (AC-285)', async () => {
    const m = await memberWithWorkspace(app);
    const made = await m.client.relationships.create(investors(m));
    const member = await plainMember(m);
    const before = await counts(m.workspace.id);
    const forbidden = {
      code: 'FORBIDDEN',
      status: 403,
      message: 'Only workspace owners and admins can change objects and attributes.',
    };
    expect(await refusal(() => member.relationships.create(investors(m)))).toEqual(forbidden);
    expect(
      await refusal(() =>
        member.relationships.update({
          workspace: m.slug,
          relationshipId: made.relationshipId,
          from: { title: 'Backers' },
          mutationId: newId(),
        }),
      ),
    ).toEqual(forbidden);
    const stranger = await memberWithWorkspace(app);
    expect(await refusal(() => stranger.client.relationships.create(investors(m)))).toEqual(NOT_A_MEMBER);
    expect(await counts(m.workspace.id)).toEqual(before);
  });
});

describe('relationships.update (AC-307)', () => {
  it('renames both sides in one write and keeps the API names', async () => {
    const m = await memberWithWorkspace(app);
    const made = await m.client.relationships.create(investors(m));
    const renamed = await m.client.relationships.update({
      workspace: m.slug,
      relationshipId: made.relationshipId,
      from: { title: 'Backers' },
      to: { title: 'Holdings' },
      mutationId: newId(),
    });
    expect([renamed.from.title, renamed.from.apiSlug, renamed.to.title, renamed.to.apiSlug]).toEqual([
      'Backers',
      'investors',
      'Holdings',
      'investments',
    ]);
    expect(
      await refusal(() =>
        m.client.relationships.update({
          workspace: m.slug,
          relationshipId: newId(),
          from: { title: 'Backers' },
          mutationId: newId(),
        }),
      ),
    ).toEqual({ code: 'NOT_FOUND', status: 404, message: 'That relationship does not exist.' });
  });
});
