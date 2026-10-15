// views.list, views.get and views.saveQuery (spec 0020, milestone 1) through
// the real app: a member reads their object's default view and saves a
// query; a stale save answers 409 VIEW_CHANGED naming who saved, a forced
// one replaces it; a filter the object can't run is 422; a non member and an
// unknown view get the same NOT_FOUND as an unknown workspace. A real session
// against a real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { memberWithWorkspace, NOT_A_MEMBER, refusal } from '../../test/workspace.ts';

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

describe('views', () => {
  it('lists People’s default view, reads it whole, and saves a query for everyone', async () => {
    const m = await memberWithWorkspace(app);
    const list = await m.client.views.list({ workspace: m.slug, objectId: m.people.id });
    expect(list.views).toEqual([
      expect.objectContaining({ name: 'All People', isDefault: true, visibility: 'workspace', kind: 'table' }),
    ]);
    const viewId = list.views[0]?.id ?? '';
    expect(list.defaultViewId).toBe(viewId);
    const view = await m.client.views.get({ workspace: m.slug, viewId });
    expect(view).toMatchObject({ queryVersion: 1, config: { columns: [], showNewAttributes: true, pinnedCount: 1 } });
    const filter = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: m.attribute('job_title'), operator: 'contains' as const, value: 'pilot' }],
    };
    const saved = await m.client.views.saveQuery({
      workspace: m.slug,
      viewId,
      filter,
      sorts: [],
      baseQueryVersion: 1,
      mutationId: newId(),
    });
    expect(saved).toMatchObject({ queryVersion: 2, config: { filter, sorts: [] } });
    expect(await m.client.views.get({ workspace: m.slug, viewId })).toEqual(saved);
  });

  it('answers 409 VIEW_CHANGED to a stale save, and lets Replace through', async () => {
    const m = await memberWithWorkspace(app);
    const [view] = (await m.client.views.list({ workspace: m.slug, objectId: m.people.id })).views;
    const viewId = view?.id ?? '';
    const save = (baseQueryVersion: number, force?: boolean) =>
      m.client.views.saveQuery({
        workspace: m.slug,
        viewId,
        sorts: [],
        baseQueryVersion,
        ...(force === undefined ? {} : { force }),
        mutationId: newId(),
      });
    await save(1);
    expect(await refusal(() => save(1))).toEqual({
      code: 'VIEW_CHANGED',
      status: 409,
      message: 'Ada changed this view’s filters since you started.',
    });
    await expect(save(1, true)).resolves.toMatchObject({ queryVersion: 3 });
  });

  it('refuses a filter on another object’s attribute (422) and an unknown view (404)', async () => {
    const m = await memberWithWorkspace(app);
    const [view] = (await m.client.views.list({ workspace: m.slug, objectId: m.people.id })).views;
    const companies = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
    const other = companies.find((attribute) => attribute.apiSlug === 'name')?.id ?? '';
    expect(
      await refusal(() =>
        m.client.views.saveQuery({
          workspace: m.slug,
          viewId: view?.id ?? '',
          filter: { conjunction: 'and', conditions: [{ attributeId: other, operator: 'is_not_empty' }] },
          sorts: [],
          baseQueryVersion: 1,
          mutationId: newId(),
        }),
      ),
    ).toMatchObject({ code: 'FILTER_INVALID', status: 422 });
    expect(await refusal(() => m.client.views.get({ workspace: m.slug, viewId: newId() }))).toEqual({
      code: 'NOT_FOUND',
      status: 404,
      message: 'This view doesn’t exist or isn’t shared with you.'.replaceAll('’', "'"),
    });
  });

  it('answers a non member as an unknown workspace', async () => {
    const owner = await memberWithWorkspace(app);
    const stranger = await memberWithWorkspace(app);
    const [view] = (await owner.client.views.list({ workspace: owner.slug, objectId: owner.people.id })).views;
    expect(await refusal(() => stranger.client.views.get({ workspace: owner.slug, viewId: view?.id ?? '' }))).toEqual(
      NOT_A_MEMBER,
    );
    expect(
      await refusal(() => stranger.client.views.list({ workspace: owner.slug, objectId: owner.people.id })),
    ).toEqual(NOT_A_MEMBER);
  });
});
