// Saved views on real Postgres (spec 0020, milestone 1): the default view
// every object gets, the switcher's order, who sees which view, saving a
// query with its version check, lock and config checks, the outbox row each
// save stores, and the facts the relay filters `views` events by.
import { sql } from 'drizzle-orm';
import { AttributeType } from '@crm/contracts';
import { isSortable } from '@crm/contracts/views';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { baseLevel, compileSorts, type CompileContext } from '../engine/query/compile.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { AttributeDef } from '../engine/values.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createAttribute } from '../attributes/attributes.ts';
import { createObject } from '../objects/objects.ts';
import { systemScope } from '../access/door.ts';
import { SYSTEM_ACCESS, type AccessRules } from '../access/policy.ts';
import { rescope, testScope } from '../testing.ts';
import { viewFacts } from './facts.ts';
import { getView, listViews, saveViewQuery, VIEW_LOCKED, VIEW_NOT_FOUND } from './views.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-views-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace (its owner Ada), a second member Bea, People's attributes by slug, and People's default view. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Views',
    slug: `views-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const { workspaceId } = created;
  const owner = testScope({ db, workspaceId, actor: { type: 'member', id: created.memberId } });
  const beaId = newId();
  await db.withWorkspace(workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${workspaceId}, ${beaId}, 'Bea Ruiz', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const bea = testScope({ db, workspaceId, actor: { type: 'member', id: beaId }, role: 'member' });
  const people = created.objects.people ?? '';
  const rows = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select id::text, api_slug, object_id::text from attributes`,
    ),
  );
  const attribute = (slug: string, objectId = people) =>
    rows.rows.find((row) => row.api_slug === slug && row.object_id === objectId)?.id ?? '';
  const defaultOf = async (objectId: string) => {
    const result = await db.withWorkspace(workspaceId, (tx) =>
      tx.execute<{ id: string }>(sql`select default_view_id::text as id from objects where id = ${objectId}`),
    );
    return result.rows[0]?.id ?? '';
  };
  return { ...created, owner, bea, beaId, people, attribute, defaultOf, peopleView: await defaultOf(people) };
}
type World = Awaited<ReturnType<typeof workspace>>;

/** Inserts a view straight into the table (milestone 2 brings `createView`). */
async function insertView(
  w: World,
  fields: { name: string; visibility: 'private' | 'workspace'; position: number; creator?: string; locked?: boolean },
): Promise<string> {
  const id = newId();
  const config = JSON.stringify({ columns: [], showNewAttributes: false, pinnedCount: 1, sorts: [] });
  await db.withWorkspace(w.workspaceId, (tx) =>
    tx.execute(
      sql`insert into views (workspace_id, id, object_id, name, visibility, creator_member_id, position, config, is_locked, locked_by_member_id, locked_at, created_by_type, updated_by_type) values (${w.workspaceId}, ${id}, ${w.people}, ${fields.name}, ${fields.visibility}, ${fields.creator ?? null}, ${fields.position}, ${config}::jsonb, ${fields.locked === true}, ${fields.locked === true ? w.memberId : null}, ${fields.locked === true ? sql`now()` : null}, 'system', 'system')`,
    ),
  );
  return id;
}

async function refusalOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('It was let through.');
}

const outboxOf = (w: World) =>
  db
    .withWorkspace(w.workspaceId, (tx) =>
      tx.execute<{ kind: string; object_id: string; item_ids: string[]; mutation_id: string | null }>(
        sql`select kind::text, object_id::text, item_ids::text[], mutation_id::text from outbox order by seq`,
      ),
    )
    .then((result) => result.rows);

describe('default views (AC-462)', () => {
  it('gives each object of a new workspace its default view: All <plural>, shared, newest first', async () => {
    const w = await workspace();
    for (const [key, name] of [
      ['people', 'All People'],
      ['companies', 'All Companies'],
      ['deals', 'All Deals'],
    ] as const) {
      const objectId = w.objects[key] ?? '';
      const list = await listViews(w.owner, objectId);
      expect(list.views).toHaveLength(1);
      expect(list.views[0]).toMatchObject({ name, visibility: 'workspace', isDefault: true, kind: 'table' });
      expect(list.defaultViewId).toBe(await w.defaultOf(objectId));
      const view = await getView(w.owner, list.views[0]?.id ?? '');
      expect(view.config).toEqual({
        columns: [],
        showNewAttributes: true,
        pinnedCount: 1,
        sorts: [{ attributeId: w.attribute('created_at', objectId), direction: 'descending' }],
      });
      expect(view.creatorMemberId).toBeUndefined();
    }
  });

  it('gives a custom object its default view in the same write, with no views event', async () => {
    const w = await workspace();
    const before = (await outboxOf(w)).length;
    const object = await createObject(
      w.owner,
      { id: newId(), singularName: 'Project', pluralName: 'Projects', icon: 'box', hue: 'blue' },
      [outboxHook({ mutationId: newId() })],
    );
    const list = await listViews(w.owner, object.id);
    expect(list.views.map((view) => view.name)).toEqual(['All Projects']);
    const rows = (await outboxOf(w)).slice(before);
    expect(rows.map((row) => row.kind)).toEqual(['definitions']);
  });
});

describe('listViews and getView (AC-463, AC-473)', () => {
  it('lists the default first, then shared by position, then the caller’s own private views', async () => {
    const w = await workspace();
    const later = await insertView(w, { name: 'Later', visibility: 'workspace', position: 5 });
    const sooner = await insertView(w, { name: 'Sooner', visibility: 'workspace', position: 2 });
    const mine = await insertView(w, { name: 'Mine', visibility: 'private', position: 0, creator: w.memberId });
    const hers = await insertView(w, { name: 'Hers', visibility: 'private', position: 0, creator: w.beaId });
    const asOwner = await listViews(w.owner, w.people);
    expect(asOwner.views.map((view) => view.id)).toEqual([w.peopleView, sooner, later, mine]);
    const asBea = await listViews(w.bea, w.people);
    expect(asBea.views.map((view) => view.id)).toEqual([w.peopleView, sooner, later, hers]);
    expect(await getView(w.bea, hers)).toMatchObject({ name: 'Hers', visibility: 'private', creatorMemberId: w.beaId });
  });

  it('answers NOT_FOUND alike for an unknown view, another member’s private view and a hidden object', async () => {
    const w = await workspace();
    const mine = await insertView(w, { name: 'Mine', visibility: 'private', position: 0, creator: w.memberId });
    const notFound = { code: 'NOT_FOUND', message: VIEW_NOT_FOUND };
    expect(await refusalOf(getView(w.bea, mine))).toEqual(notFound);
    expect(await refusalOf(getView(w.bea, newId()))).toEqual(notFound);
    const hidden = rescope(w.bea, {
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'none' },
        ],
        records: [],
      },
    });
    expect(await refusalOf(getView(hidden, w.peopleView))).toEqual(notFound);
    expect(await refusalOf(listViews(hidden, w.people))).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('leaves columns on a hidden attribute out of what that member gets (AC-479)', async () => {
    const w = await workspace();
    const jobTitle = w.attribute('job_title');
    const name = w.attribute('name');
    await db.withWorkspace(w.workspaceId, (tx) =>
      tx.execute(
        sql`update views set config = jsonb_set(config, '{columns}', ${JSON.stringify([{ attributeId: name }, { attributeId: jobTitle, width: 200 }])}::jsonb) where id = ${w.peopleView}`,
      ),
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
    const view = await getView(rescope(w.bea, { rules }), w.peopleView);
    expect(view.config.columns).toEqual([{ attributeId: name }]);
    expect((await getView(w.owner, w.peopleView)).config.columns).toHaveLength(2);
  });
});

describe('saveViewQuery (AC-468, AC-469, AC-476, AC-482)', () => {
  it('saves the filter and sorts for everyone, moves both versions, and stores one views row with the mutation', async () => {
    const w = await workspace();
    const mutationId = newId();
    const filter = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: w.attribute('job_title'), operator: 'contains' as const, value: 'pilot' }],
    };
    const sorts = [{ attributeId: w.attribute('name'), direction: 'ascending' as const }];
    const before = await getView(w.bea, w.peopleView);
    const saved = await saveViewQuery(w.bea, { viewId: w.peopleView, filter, sorts, baseQueryVersion: 1 }, [
      outboxHook({ mutationId }),
    ]);
    expect(saved).toMatchObject({
      queryVersion: 2,
      version: before.version + 1,
      querySavedBy: w.beaId,
      config: { ...before.config, filter, sorts },
    });
    expect(typeof saved.querySavedAt).toBe('string');
    expect(await getView(w.owner, w.peopleView)).toEqual(saved);
    expect((await outboxOf(w)).at(-1)).toEqual({
      kind: 'views',
      object_id: w.people,
      item_ids: [w.peopleView],
      mutation_id: mutationId,
    });
    // An empty filter removes it.
    const cleared = await saveViewQuery(w.owner, {
      viewId: w.peopleView,
      filter: { conjunction: 'and', conditions: [] },
      sorts: [],
      baseQueryVersion: 2,
    });
    expect(cleared.config).not.toHaveProperty('filter');
    expect(cleared.config.sorts).toEqual([]);
  });

  it('refuses a save over someone else’s since the draft began, naming them, unless forced (Replace)', async () => {
    const w = await workspace();
    const sorts = [{ attributeId: w.attribute('name'), direction: 'ascending' as const }];
    await saveViewQuery(w.bea, { viewId: w.peopleView, sorts, baseQueryVersion: 1 });
    const outbox = (await outboxOf(w)).length;
    expect(
      await refusalOf(
        saveViewQuery(w.owner, { viewId: w.peopleView, sorts: [], baseQueryVersion: 1 }, [
          outboxHook({ mutationId: newId() }),
        ]),
      ),
    ).toEqual({
      code: 'VIEW_CHANGED',
      message: 'Bea Ruiz changed this view’s filters since you started.',
    });
    expect(await outboxOf(w)).toHaveLength(outbox);
    const replaced = await saveViewQuery(w.owner, {
      viewId: w.peopleView,
      sorts: [],
      baseQueryVersion: 1,
      force: true,
    });
    expect(replaced).toMatchObject({ queryVersion: 3, querySavedBy: w.memberId });
  });

  it('refuses a member on a locked view, lets an owner through, and keeps private views to their creator', async () => {
    const w = await workspace();
    const locked = await insertView(w, { name: 'Pipeline', visibility: 'workspace', position: 1, locked: true });
    const outbox = (await outboxOf(w)).length;
    expect(
      await refusalOf(
        saveViewQuery(w.bea, { viewId: locked, sorts: [], baseQueryVersion: 1 }, [outboxHook({ mutationId: newId() })]),
      ),
    ).toEqual({
      code: 'FORBIDDEN',
      message: VIEW_LOCKED,
    });
    expect(await outboxOf(w)).toHaveLength(outbox);
    await expect(saveViewQuery(w.owner, { viewId: locked, sorts: [], baseQueryVersion: 1 })).resolves.toMatchObject({
      queryVersion: 2,
    });
    const hers = await insertView(w, { name: 'Hers', visibility: 'private', position: 0, creator: w.beaId });
    expect(await refusalOf(saveViewQuery(w.owner, { viewId: hers, sorts: [], baseQueryVersion: 1 }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses another object’s attribute, an unsortable sort, an archived or a hidden attribute, and writes nothing', async () => {
    const w = await workspace();
    const notes = await createAttribute(w.owner, {
      objectId: w.people,
      id: newId(),
      title: 'Notes',
      type: 'long_text',
    });
    const before = await getView(w.owner, w.peopleView);
    const save = (scope: typeof w.owner, filterId: string | undefined, sortId?: string) =>
      refusalOf(
        saveViewQuery(
          scope,
          {
            viewId: w.peopleView,
            ...(filterId === undefined
              ? {}
              : { filter: { conjunction: 'and', conditions: [{ attributeId: filterId, operator: 'is_not_empty' }] } }),
            sorts: sortId === undefined ? [] : [{ attributeId: sortId, direction: 'ascending' }],
            baseQueryVersion: 1,
          },
          [outboxHook({ mutationId: newId() })],
        ),
      );
    expect(await save(w.owner, w.attribute('name', w.objects.companies))).toMatchObject({ code: 'FILTER_INVALID' });
    expect(await save(w.owner, undefined, notes.id)).toEqual({
      code: 'FILTER_INVALID',
      message: 'A long text attribute can’t be sorted.'.replace('’', "'"),
    });
    const hidden = rescope(w.bea, {
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: w.people, attributeId: w.attribute('job_title') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    expect(await save(hidden, w.attribute('job_title'))).toMatchObject({ code: 'FILTER_INVALID' });
    expect(await getView(w.owner, w.peopleView)).toEqual(before);
    expect((await outboxOf(w)).filter((row) => row.kind === 'views')).toEqual([]);
  });
});

describe('viewFacts (spec 0009’s views rule)', () => {
  it('answers each view’s visibility and creator, nothing for a gone one, and only to the system', async () => {
    const w = await workspace();
    const mine = await insertView(w, { name: 'Mine', visibility: 'private', position: 0, creator: w.memberId });
    const gone = newId();
    const facts = await viewFacts(systemScope(db, w.workspaceId), [w.peopleView, mine, gone]);
    expect(facts).toEqual({
      [w.peopleView]: { visibility: 'workspace' },
      [mine]: { visibility: 'private', ownerMemberId: w.memberId },
    });
    await expect(viewFacts(w.owner, [mine])).rejects.toThrow(/Only the system/);
  });
});

describe('isSortable and compileSorts (AC-465)', () => {
  it('agree on every attribute type and every system column', () => {
    const objectId = newId();
    const relationshipId = newId();
    const definition = (type: AttributeType, systemColumn: AttributeDef['systemColumn'] = null): AttributeDef => ({
      id: newId(),
      objectId,
      listId: null,
      apiSlug: type,
      title: type,
      type,
      isMulti: false,
      isRequired: false,
      isUnique: false,
      isSystem: systemColumn !== null,
      systemColumn,
      archivedAt: null,
      archivedBy: null,
      config: {},
      defaultValue: null,
      relationshipId: type === 'record_reference' ? relationshipId : null,
      position: 0,
      ruleCount: 0,
      rulesVersion: 0,
    });
    const all = [
      ...AttributeType.options.map((type) => definition(type)),
      ...(['id', 'created_at', 'created_by', 'updated_at', 'updated_by'] as const).map((column) =>
        definition(column === 'created_at' || column === 'updated_at' ? 'timestamp' : 'text', column),
      ),
    ];
    const context: CompileContext = {
      attributes: new Map(all.map((attribute) => [attribute.id, attribute])),
      relationships: new Map([
        [
          relationshipId,
          {
            id: relationshipId,
            fromAttributeId: all.find((each) => each.type === 'record_reference')?.id ?? '',
            toAttributeId: null,
            fromObjectId: objectId,
            toObjectIds: [newId()],
            fromSingle: true,
            toSingle: false,
          },
        ],
      ]),
      clock: {},
      actor: { type: 'system', id: null },
      access: SYSTEM_ACCESS,
    };
    for (const attribute of all) {
      const compiles = (() => {
        try {
          compileSorts(context, baseLevel({ objectId }), [{ attributeId: attribute.id, direction: 'ascending' }]);
          return true;
        } catch (error) {
          if (isRefusal(error) && error.refusal.code === 'FILTER_INVALID') return false;
          throw error;
        }
      })();
      expect(compiles, `${attribute.type} ${String(attribute.systemColumn)}`).toBe(
        isSortable({ type: attribute.type, isSystem: attribute.systemColumn !== null }),
      );
    }
  });
});
