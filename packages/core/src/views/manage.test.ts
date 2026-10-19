// Saved views' writes on real Postgres (spec 0020, milestone 2): create with
// its names, limits and replay, rename and visibility, layouts that keep what
// the writer can't see, moves, lock, the default, delete, the last opened
// view, and a removed member's views. Each write stores its `views` row in its
// transaction, private views included; a refused one stores none; and
// `markViewOpened` stores none at all.
import { sql } from 'drizzle-orm';
import type { ViewConfig } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { defineAttribute } from '../engine/definitions.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { removeMember } from '../members/members.ts';
import type { AccessRules } from '../access/policy.ts';
import { rescope, testScope } from '../testing.ts';
import {
  createView,
  deleteView,
  markViewOpened,
  moveView,
  setDefaultView,
  setViewLayout,
  setViewLocked,
  updateView,
} from './manage.ts';
import { getView, listViews, saveViewQuery, VIEW_LOCKED, VIEW_NOT_FOUND } from './views.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-views-manage-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace (its owner Ada), a member Bea and a member Cy, People's attributes by slug, and its default view. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Views',
    slug: `views-m-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const addMember = async (name: string) => {
    const id = newId();
    await db.withWorkspace(workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${id}, ${name}, ${`${id}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    return { id, scope: testScope({ db, workspaceId, actor: { type: 'member', id }, role: 'member' }) };
  };
  const bea = await addMember('Bea Ruiz');
  const cy = await addMember('Cy Young');
  const people = created.objects.people ?? '';
  const rows = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select id::text, api_slug, object_id::text from attributes`,
    ),
  );
  const attribute = (slug: string, objectId = people) =>
    rows.rows.find((row) => row.api_slug === slug && row.object_id === objectId)?.id ?? '';
  const list = await listViews(owner, people);
  return { ...created, owner, bea, cy, people, attribute, peopleView: list.defaultViewId ?? '' };
}
type World = Awaited<ReturnType<typeof workspace>>;

const CONFIG: ViewConfig = { columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] };

/** A view made through `createView`, with an outbox hook. */
const make = (
  scope: World['owner'],
  w: World,
  fields: { name: string; visibility: 'private' | 'workspace'; id?: string; config?: ViewConfig },
) =>
  createView(
    scope,
    {
      id: fields.id ?? newId(),
      objectId: w.people,
      name: fields.name,
      kind: 'table',
      visibility: fields.visibility,
      config: fields.config ?? CONFIG,
    },
    [outboxHook({ mutationId: newId() })],
  );

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const viewRows = (w: World) =>
  db
    .withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ object_id: string; item_ids: string[] }>(
        sql`select object_id::text, item_ids::text[] from outbox where kind = 'views' order by seq`,
      ),
    )
    .then((result) => result.rows);

const hook = () => [outboxHook({ mutationId: newId() })];

describe('createView (AC-472)', () => {
  it('makes a private view and a shared one at the end of their groups, each with its views row', async () => {
    const w = await workspace();
    const mine = await make(w.bea.scope, w, { name: 'My pilots', visibility: 'private' });
    const shared = await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    expect(mine).toMatchObject({ visibility: 'private', creatorMemberId: w.bea.id, position: 0, version: 1 });
    expect(shared).toMatchObject({ visibility: 'workspace', position: 1, isDefault: false });
    expect((await listViews(w.bea.scope, w.people)).views.map((view) => view.id)).toEqual([
      w.peopleView,
      shared.id,
      mine.id,
    ]);
    // Nobody else sees the private view.
    expect((await listViews(w.cy.scope, w.people)).views.map((view) => view.id)).toEqual([w.peopleView, shared.id]);
    expect(await viewRows(w)).toEqual([
      { object_id: w.people, item_ids: [mine.id] },
      { object_id: w.people, item_ids: [shared.id] },
    ]);
  });

  it('refuses a shared name taken on the object, and a private name the member already has, ignoring case', async () => {
    const w = await workspace();
    await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    await make(w.bea.scope, w, { name: 'Mine', visibility: 'private' });
    expect(await refusalOf(make(w.cy.scope, w, { name: 'PILOTS', visibility: 'workspace' }))).toEqual({
      code: 'NAME_TAKEN',
      message: 'A shared view with this name exists on People.',
      field: 'name',
    });
    expect(await refusalOf(make(w.bea.scope, w, { name: 'mine', visibility: 'private' }))).toEqual({
      code: 'NAME_TAKEN',
      message: 'You already have a view with this name.',
      field: 'name',
    });
    // Another member's private name is theirs alone.
    await expect(make(w.cy.scope, w, { name: 'Mine', visibility: 'private' })).resolves.toMatchObject({ name: 'Mine' });
    expect(await viewRows(w)).toHaveLength(3);
  });

  it('refuses the shared view past the limit and the private view past the limit, even when sent at once', async () => {
    const w = await workspace();
    const limited = rescope(w.bea.scope, { limits: { sharedViewsPerObject: 2, privateViewsPerObject: 1 } });
    // The default view counts as one of the shared ones.
    const tries = await Promise.allSettled([
      make(limited, w, { name: 'A', visibility: 'workspace' }),
      make(limited, w, { name: 'B', visibility: 'workspace' }),
    ]);
    expect(tries.filter((each) => each.status === 'fulfilled')).toHaveLength(1);
    const refused = tries.find((each) => each.status === 'rejected');
    expect(isRefusal(refused?.reason) ? refused.reason.refusal : undefined).toEqual({
      code: 'LIMIT_REACHED',
      message: 'There can be at most 2 shared views on People. Delete one first.',
    });
    await make(limited, w, { name: 'Mine', visibility: 'private' });
    expect(await refusalOf(make(limited, w, { name: 'Mine 2', visibility: 'private' }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'You can keep at most 1 private views on People. Delete one first.',
    });
  });

  it('answers the view already made for a retried create, and ID_TAKEN for the id from anyone else', async () => {
    const w = await workspace();
    const id = newId();
    const first = await make(w.bea.scope, w, { id, name: 'Pilots', visibility: 'private' });
    const again = await make(w.bea.scope, w, { id, name: 'Pilots', visibility: 'private' });
    expect(again).toEqual(first);
    expect(await viewRows(w)).toHaveLength(1);
    expect(await refusalOf(make(w.cy.scope, w, { id, name: 'Other', visibility: 'workspace' }))).toEqual({
      code: 'ID_TAKEN',
      message: 'A view with that id already exists.',
    });
  });

  it('refuses another object’s attribute in its columns or filter, and a hidden one', async () => {
    const w = await workspace();
    const companyName = w.attribute('name', w.objects.companies);
    expect(
      await refusalOf(
        make(w.bea.scope, w, {
          name: 'X',
          visibility: 'workspace',
          config: { ...CONFIG, columns: [{ attributeId: companyName }] },
        }),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', message: 'That attribute isn’t on People.' });
    expect(
      await refusalOf(
        make(w.bea.scope, w, {
          name: 'X',
          visibility: 'workspace',
          config: {
            ...CONFIG,
            filter: { conjunction: 'and', conditions: [{ attributeId: companyName, operator: 'is_not_empty' }] },
          },
        }),
      ),
    ).toMatchObject({ code: 'FILTER_INVALID' });
    expect(await viewRows(w)).toEqual([]);
  });
});

describe('updateView: rename, share, make private (AC-477)', () => {
  it('renames a shared view for anyone, unless locked', async () => {
    const w = await workspace();
    const view = await make(w.owner, w, { name: 'Pilots', visibility: 'workspace' });
    const renamed = await updateView(w.bea.scope, { viewId: view.id, name: '  Crew  ' }, hook());
    expect(renamed).toMatchObject({ name: 'Crew', version: 2 });
    await setViewLocked(w.owner, { viewId: view.id, locked: true }, hook());
    expect(await refusalOf(updateView(w.bea.scope, { viewId: view.id, name: 'Back' }, hook()))).toEqual({
      code: 'FORBIDDEN',
      message: VIEW_LOCKED,
    });
  });

  it('lets only the creator make a shared view private, never the default or a seeded one, and only unlocked', async () => {
    const w = await workspace();
    const view = await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    expect(await refusalOf(updateView(w.cy.scope, { viewId: view.id, visibility: 'private' }, hook()))).toEqual({
      code: 'FORBIDDEN',
      message: 'Only the view’s creator can make it private.',
    });
    expect(await refusalOf(updateView(w.owner, { viewId: w.peopleView, visibility: 'private' }, hook()))).toEqual({
      code: 'VIEW_IS_DEFAULT',
      message: 'The default view is shared with everyone.',
    });
    await setDefaultView(w.owner, { objectId: w.people, viewId: view.id }, hook());
    expect(await refusalOf(updateView(w.owner, { viewId: w.peopleView, visibility: 'private' }, hook()))).toEqual({
      code: 'FORBIDDEN',
      message: 'This view was made by the workspace, so it stays shared.',
    });
    await setDefaultView(w.owner, { objectId: w.people, viewId: w.peopleView }, hook());
    await setViewLocked(w.owner, { viewId: view.id, locked: true }, hook());
    expect(await refusalOf(updateView(w.bea.scope, { viewId: view.id, visibility: 'private' }, hook()))).toEqual({
      code: 'FORBIDDEN',
      message: 'This view is locked. Unlock it first.',
    });
    await setViewLocked(w.owner, { viewId: view.id, locked: false }, hook());
    const made = await updateView(w.bea.scope, { viewId: view.id, visibility: 'private' }, hook());
    expect(made).toMatchObject({ visibility: 'private', position: 0 });
    expect(await refusalOf(getView(w.cy.scope, view.id))).toEqual({ code: 'NOT_FOUND', message: VIEW_NOT_FOUND });
    // Shared again, it takes the place after the last shared view.
    const back = await updateView(w.bea.scope, { viewId: view.id, visibility: 'workspace' }, hook());
    expect(back).toMatchObject({ visibility: 'workspace', position: 1 });
  });
});

describe('setViewLayout (AC-470, AC-471, AC-476, AC-479)', () => {
  it('saves the columns at once, last save wins, and keeps the columns the writer can’t see in place', async () => {
    const w = await workspace();
    const name = w.attribute('name');
    const jobTitle = w.attribute('job_title');
    const email = w.attribute('email_addresses');
    await setViewLayout(
      w.owner,
      {
        viewId: w.peopleView,
        layout: {
          columns: [{ attributeId: name }, { attributeId: jobTitle, width: 220 }, { attributeId: email }],
          pinnedCount: 2,
        },
      },
      hook(),
    );
    const rules: AccessRules = {
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: w.people, attributeId: jobTitle },
          level: 'hidden',
        },
      ],
      records: [],
    };
    const restricted = rescope(w.bea.scope, { rules });
    const seen = await getView(restricted, w.peopleView);
    expect(seen.config.columns.map((column) => column.attributeId)).toEqual([name, email]);
    // Bea widens Email and pins one: Job title stays right after Name, where it was, outside her pinned edge.
    await setViewLayout(
      restricted,
      {
        viewId: w.peopleView,
        layout: { columns: [{ attributeId: name }, { attributeId: email, width: 300 }], pinnedCount: 1 },
      },
      hook(),
    );
    const stored = await getView(w.owner, w.peopleView);
    expect(stored.config.columns).toEqual([
      { attributeId: name },
      { attributeId: jobTitle, width: 220 },
      { attributeId: email, width: 300 },
    ]);
    expect(stored.config.pinnedCount).toBe(1);
    expect(stored.queryVersion).toBe(1);
    // A hidden attribute named by the writer is refused.
    expect(
      await refusalOf(
        setViewLayout(restricted, {
          viewId: w.peopleView,
          layout: { columns: [{ attributeId: jobTitle }], pinnedCount: 1 },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('refuses a member on a locked view and writes nothing', async () => {
    const w = await workspace();
    await setViewLocked(w.owner, { viewId: w.peopleView, locked: true }, hook());
    const before = (await viewRows(w)).length;
    expect(
      await refusalOf(
        setViewLayout(w.bea.scope, { viewId: w.peopleView, layout: { columns: [], pinnedCount: 2 } }, hook()),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: VIEW_LOCKED });
    expect(await viewRows(w)).toHaveLength(before);
  });
});

describe('board settings on a layout or a new view (spec 0021, boardConfigProblem)', () => {
  it('saves a board kind with its settings, and refuses settings a board can’t show', async () => {
    const w = await workspace();
    const define = async (apiSlug: string, type: 'status' | 'select', isMulti = false) =>
      (await defineAttribute(w.owner, { objectId: w.people, apiSlug, title: apiSlug, type, isMulti })).attributeId;
    const stage = await define('stage', 'status');
    const tags = await define('tags', 'select', true);
    const name = w.attribute('name');
    const jobTitle = w.attribute('job_title');
    const layout = (board: { groupByAttributeId: string; cardFields: string[] }) => ({
      kind: 'board' as const,
      columns: [],
      pinnedCount: 1,
      board: { ...board, showEmptyColumns: true },
    });
    // A multi select doesn't group a board; the name is never a card field; a field shows once.
    for (const board of [
      { groupByAttributeId: tags, cardFields: [] },
      { groupByAttributeId: stage, cardFields: [name] },
      { groupByAttributeId: stage, cardFields: [jobTitle, jobTitle] },
    ]) {
      expect(
        await refusalOf(setViewLayout(w.owner, { viewId: w.peopleView, layout: layout(board) }, hook())),
      ).toMatchObject({ code: 'CONFIG_INVALID' });
    }
    const saved = await setViewLayout(
      w.owner,
      { viewId: w.peopleView, layout: layout({ groupByAttributeId: stage, cardFields: [jobTitle] }) },
      hook(),
    );
    expect(saved.kind).toBe('board');
    expect(saved.config.board).toEqual({ groupByAttributeId: stage, cardFields: [jobTitle], showEmptyColumns: true });
    // Back to Table keeps the board, so switching again restores it (AC-492).
    const table = await setViewLayout(
      w.owner,
      { viewId: w.peopleView, layout: { kind: 'table', columns: [], pinnedCount: 1 } },
      hook(),
    );
    expect(table.kind).toBe('table');
    expect(table.config.board?.groupByAttributeId).toBe(stage);
    // A new view's board is checked the same way.
    expect(
      await refusalOf(
        make(w.owner, w, {
          name: 'Board',
          visibility: 'private',
          config: { ...CONFIG, board: { groupByAttributeId: tags, cardFields: [], showEmptyColumns: true } },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('moveView (AC-477)', () => {
  it('swaps a view with its neighbour in its group, and never moves the default', async () => {
    const w = await workspace();
    const a = await make(w.owner, w, { name: 'A', visibility: 'workspace' });
    const b = await make(w.owner, w, { name: 'B', visibility: 'workspace' });
    const c = await make(w.owner, w, { name: 'C', visibility: 'workspace' });
    const mine = await make(w.bea.scope, w, { name: 'Mine', visibility: 'private' });
    const moved = await moveView(w.bea.scope, { viewId: c.id, direction: 'up' }, hook());
    expect(moved.map((view) => view.name)).toEqual(['All People', 'A', 'C', 'B', 'Mine']);
    // Already first in its group, and the default: nothing changes.
    const rows = (await viewRows(w)).length;
    await moveView(w.bea.scope, { viewId: a.id, direction: 'up' }, hook());
    await moveView(w.bea.scope, { viewId: w.peopleView, direction: 'down' }, hook());
    await moveView(w.bea.scope, { viewId: mine.id, direction: 'up' }, hook());
    expect(await viewRows(w)).toHaveLength(rows);
    expect((await listViews(w.cy.scope, w.people)).views.map((view) => view.id)).toEqual([
      w.peopleView,
      a.id,
      c.id,
      b.id,
    ]);
  });

  it('lands every concurrent move on a distinct order', async () => {
    const w = await workspace();
    const views = [];
    for (const name of ['A', 'B', 'C', 'D']) views.push(await make(w.owner, w, { name, visibility: 'workspace' }));
    await Promise.all(views.map((view) => moveView(w.owner, { viewId: view.id, direction: 'up' }, hook())));
    const positions = (await listViews(w.owner, w.people)).views.slice(1).map((view) => view.position);
    expect(new Set(positions).size).toBe(4);
  });
});

describe('setViewLocked and setDefaultView (AC-475)', () => {
  it('needs views.manage, and a shared view', async () => {
    const w = await workspace();
    const mine = await make(w.owner, w, { name: 'Mine', visibility: 'private' });
    expect(await refusalOf(setViewLocked(w.bea.scope, { viewId: w.peopleView, locked: true }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(setViewLocked(w.owner, { viewId: mine.id, locked: true }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'A private view can’t be locked.',
    });
    expect(await refusalOf(setDefaultView(w.owner, { objectId: w.people, viewId: mine.id }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'The default view must be shared with everyone.',
    });
    const locked = await setViewLocked(w.owner, { viewId: w.peopleView, locked: true }, hook());
    expect(locked).toMatchObject({ isLocked: true, lockedBy: w.memberId });
    const shared = await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    expect(await refusalOf(setDefaultView(w.bea.scope, { objectId: w.people, viewId: shared.id }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const after = await setDefaultView(w.owner, { objectId: w.people, viewId: shared.id }, hook());
    expect(after.map((view) => [view.name, view.isDefault])).toEqual([
      ['Pilots', true],
      ['All People', false],
      ['Mine', false],
    ]);
  });
});

describe('deleteView (AC-474)', () => {
  it('deletes a view, its bookmarks with it, and refuses the default', async () => {
    const w = await workspace();
    const view = await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    await markViewOpened(w.cy.scope, { viewId: view.id });
    expect((await listViews(w.cy.scope, w.people)).lastOpenedViewId).toBe(view.id);
    expect(await deleteView(w.cy.scope, { viewId: view.id }, hook())).toEqual({ deleted: true });
    const after = await listViews(w.cy.scope, w.people);
    expect(after.views.map((each) => each.id)).toEqual([w.peopleView]);
    expect(after.lastOpenedViewId).toBeUndefined();
    expect(await refusalOf(deleteView(w.owner, { viewId: w.peopleView }, hook()))).toEqual({
      code: 'VIEW_IS_DEFAULT',
      message: 'This is the default view for People. Make another view the default first.',
    });
  });
});

describe('markViewOpened (AC-478)', () => {
  it('keeps each member’s last opened view per object, stores no outbox row, and hides one no longer theirs', async () => {
    const w = await workspace();
    const shared = await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    const before = (await viewRows(w)).length;
    await markViewOpened(w.cy.scope, { viewId: shared.id });
    await markViewOpened(w.bea.scope, { viewId: w.peopleView });
    expect((await listViews(w.cy.scope, w.people)).lastOpenedViewId).toBe(shared.id);
    expect((await listViews(w.bea.scope, w.people)).lastOpenedViewId).toBe(w.peopleView);
    expect(await viewRows(w)).toHaveLength(before);
    // Made private by its creator: Cy's bookmark no longer counts.
    await updateView(w.bea.scope, { viewId: shared.id, visibility: 'private' }, hook());
    expect((await listViews(w.cy.scope, w.people)).lastOpenedViewId).toBeUndefined();
    expect(await refusalOf(markViewOpened(w.cy.scope, { viewId: shared.id }))).toEqual({
      code: 'NOT_FOUND',
      message: VIEW_NOT_FOUND,
    });
  });
});

describe('removing a member (AC-490)', () => {
  it('deletes their private views and bookmarks in the same write, with views rows, and keeps their shared views', async () => {
    const w = await workspace();
    const one = await make(w.bea.scope, w, { name: 'One', visibility: 'private' });
    const two = await make(w.bea.scope, w, { name: 'Two', visibility: 'private' });
    const shared = await make(w.bea.scope, w, { name: 'Pilots', visibility: 'workspace' });
    await setViewLocked(w.owner, { viewId: shared.id, locked: true }, hook());
    await markViewOpened(w.bea.scope, { viewId: shared.id });
    const before = (await viewRows(w)).length;
    await removeMember(w.owner, { memberId: w.bea.id }, hook());
    const rows = (await viewRows(w)).slice(before);
    expect(rows).toEqual([{ object_id: w.people, item_ids: [one.id, two.id].sort() }]);
    const left = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text from views where creator_member_id = ${w.bea.id}`),
    );
    expect(left.rows).toEqual([{ id: shared.id }]);
    const bookmarks = await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(sql`select 1 from member_view_state where member_id = ${w.bea.id}`),
    );
    expect(bookmarks.rows).toEqual([]);
    expect(await getView(w.cy.scope, shared.id)).toMatchObject({ creatorMemberId: w.bea.id, isLocked: true });
  });
});

describe('saving a query on a view a member made', () => {
  it('works on their private view and stores its views row', async () => {
    const w = await workspace();
    const mine = await make(w.bea.scope, w, { name: 'Mine', visibility: 'private' });
    const saved = await saveViewQuery(
      w.bea.scope,
      { viewId: mine.id, sorts: [{ attributeId: w.attribute('name'), direction: 'ascending' }], baseQueryVersion: 1 },
      hook(),
    );
    expect(saved.queryVersion).toBe(2);
    expect((await viewRows(w)).at(-1)).toEqual({ object_id: w.people, item_ids: [mine.id] });
  });
});

describe('a member who may not act on a view (the rules, denied)', () => {
  it('finds no other member’s private view to rename, lay out, move or delete, and writes nothing', async () => {
    const w = await workspace();
    const hers = await make(w.bea.scope, w, { name: 'Hers', visibility: 'private' });
    const before = (await viewRows(w)).length;
    const notFound = { code: 'NOT_FOUND', message: VIEW_NOT_FOUND };
    expect(await refusalOf(updateView(w.cy.scope, { viewId: hers.id, name: 'Mine now' }, hook()))).toEqual(notFound);
    expect(
      await refusalOf(setViewLayout(w.cy.scope, { viewId: hers.id, layout: { columns: [], pinnedCount: 1 } }, hook())),
    ).toEqual(notFound);
    expect(await refusalOf(moveView(w.cy.scope, { viewId: hers.id, direction: 'up' }, hook()))).toEqual(notFound);
    expect(await refusalOf(deleteView(w.cy.scope, { viewId: hers.id }, hook()))).toEqual(notFound);
    expect(await refusalOf(setViewLocked(w.cy.scope, { viewId: w.peopleView, locked: true }, hook()))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(
      await refusalOf(setDefaultView(w.cy.scope, { objectId: w.people, viewId: w.peopleView }, hook())),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await viewRows(w)).toHaveLength(before);
    expect(await getView(w.bea.scope, hers.id)).toMatchObject({ name: 'Hers', version: 1 });
  });

  it('keeps a removed member’s private view and bookmark from landing after the removal', async () => {
    const w = await workspace();
    await removeMember(w.owner, { memberId: w.bea.id }, hook());
    expect(await refusalOf(make(w.bea.scope, w, { name: 'Late', visibility: 'private' }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await refusalOf(markViewOpened(w.bea.scope, { viewId: w.peopleView }))).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stores lower case attribute ids whatever the spelling sent', async () => {
    const w = await workspace();
    const name = w.attribute('name');
    const saved = await setViewLayout(
      w.owner,
      { viewId: w.peopleView, layout: { columns: [{ attributeId: name.toUpperCase() }], pinnedCount: 1 } },
      hook(),
    );
    expect(saved.config.columns).toEqual([{ attributeId: name }]);
  });
});
