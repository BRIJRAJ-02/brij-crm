// Likely duplicates through the API (spec 0049, AC-4904, AC-4907, AC-4908): a
// check names a visible match, the list pages the pair, Not a duplicate and its
// Undo work by procedure, a stranger to the workspace gets nothing, and the
// check stops at 60 a minute per member. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { newId } from '@crm/core';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, refusal } from '../../test/workspace.ts';

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

describe('records.duplicates', () => {
  it('checks, lists, dismisses and restores a pair, and refuses a stranger', async () => {
    const m = await memberWithWorkspace(app);
    const attributes = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
    const name = attributes.find((attribute) => attribute.apiSlug === 'name')?.id ?? '';
    const make = async () => {
      const id = newId();
      await m.client.records.create({
        workspace: m.slug,
        objectId: m.companies.id,
        id,
        values: { [name]: 'Massive Dynamic' },
        mutationId: newId(),
      });
      return id;
    };
    const older = await make();
    const newer = await make();
    const check = await m.client.records.duplicates.check({
      workspace: m.slug,
      objectId: m.companies.id,
      values: { [name]: 'massive dynamic, inc' },
    });
    expect(check.matches.map((match) => match.reason)).toEqual(['name', 'name']);
    const list = await m.client.records.duplicates.list({ workspace: m.slug, objectId: m.companies.id });
    expect(list.pairs.map((pair) => [pair.a.recordId, pair.b.recordId, pair.reason])).toEqual([[newer, older, 'name']]);
    expect(list.cursor).toBeUndefined();
    const pair = { workspace: m.slug, objectId: m.companies.id, recordIds: [newer, older] as [string, string] };
    expect(await m.client.records.duplicates.dismiss({ ...pair, mutationId: newId() })).toEqual({ dismissed: true });
    expect((await m.client.records.duplicates.list({ workspace: m.slug, objectId: m.companies.id })).pairs).toEqual([]);
    expect(await m.client.records.duplicates.restore({ ...pair, mutationId: newId() })).toEqual({ restored: true });
    expect(
      (await m.client.records.duplicates.list({ workspace: m.slug, objectId: m.companies.id, recordId: older })).pairs,
    ).toHaveLength(1);

    const stranger = await memberWithWorkspace(app);
    expect(
      await refusal(() => stranger.client.records.duplicates.list({ workspace: m.slug, objectId: m.companies.id })),
    ).toMatchObject({ status: 404 });
  });

  it('answers 60 checks a minute per member, then RATE_LIMITED', async () => {
    const m = await memberWithWorkspace(app);
    const input = { workspace: m.slug, objectId: m.companies.id, values: {} };
    for (let index = 0; index < 60; index += 1) await m.client.records.duplicates.check(input);
    expect(await refusal(() => m.client.records.duplicates.check(input))).toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    });
  });
});
