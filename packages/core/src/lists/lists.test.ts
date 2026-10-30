// Lists and entries on real Postgres (spec 0048): making a Blank and a
// Pipeline list (fields, views, the default), the name and slug rules, who may
// make and manage a list, adding with a client id (replay, another object's
// record, "Each record once"), entry windows with their records, membership,
// batch removal and restore with per entry outcomes, a list's views through
// the views service, and a list board's columns.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { createAttribute, listListAttributes } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { queryGroups } from '../engine/query/groups.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { createView, setDefaultView } from '../views/manage.ts';
import { getView, listViews } from '../views/views.ts';
import {
  addListEntry,
  countEntries,
  createList,
  editEntry,
  entryMembership,
  listLists,
  queryEntries,
  readEntryPage,
  removeEntries,
  restoreEntries,
} from './lists.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-lists-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace (its owner Ada), two members Bea and Cy, and People's and Companies' name attributes. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Lists',
    slug: `lists-${String(made)}-${String(Date.now())}`,
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
  const companies = created.objects.companies ?? '';
  const rows = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select id::text, api_slug, object_id::text from attributes where object_id is not null`,
    ),
  );
  const attribute = (slug: string, objectId: string) =>
    rows.rows.find((row) => row.api_slug === slug && row.object_id === objectId)?.id ?? '';
  const person = async (firstName: string) =>
    (await createRecord(owner, { objectId: people, values: { [attribute('name', people)]: { firstName } } })).recordId;
  const company = async (name: string) =>
    (await createRecord(owner, { objectId: companies, values: { [attribute('name', companies)]: name } })).recordId;
  return { ...created, owner, bea, cy, people, companies, attribute, person, company };
}

/** The refusal a promise ends with. */
async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('making lists (AC-4801 to AC-4805, AC-4834)', () => {
  it('makes a Blank list with Added, Added by and one default table view, each record once', async () => {
    const world = await workspace();
    const list = await createList(world.bea.scope, {
      id: newId(),
      objectId: world.people,
      name: 'Hiring',
      template: 'blank',
    });
    expect(list).toMatchObject({
      apiSlug: 'hiring',
      name: 'Hiring',
      icon: 'list',
      hue: 'gray',
      allowsDuplicates: false,
      isArchived: false,
      canWrite: true,
      canManage: true,
      createdByMemberId: world.bea.id,
    });
    const fields = await listListAttributes(world.bea.scope, list.id);
    expect(fields.map((field) => [field.title, field.isSystem, field.listId])).toEqual([
      ['Added', true, list.id],
      ['Added by', true, list.id],
    ]);
    const views = await listViews(world.bea.scope, world.people, list.id);
    expect(views.views.map((view) => [view.name, view.kind, view.listId])).toEqual([['All entries', 'table', list.id]]);
    expect(views.defaultViewId).toBe(list.defaultViewId);
    const view = await getView(world.bea.scope, list.defaultViewId ?? '');
    expect(view.config.sorts).toEqual([{ attributeId: fields[0]?.id, direction: 'descending' }]);
  });

  it('makes a Pipeline with Stage and Owner, its board grouped by Stage as the default, then All entries', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.companies,
      name: 'Sales pipeline',
      template: 'pipeline',
    });
    const fields = await listListAttributes(world.owner, list.id);
    const stage = fields.find((field) => field.title === 'Stage');
    const owner = fields.find((field) => field.title === 'Owner');
    expect(stage?.options?.map((option) => [option.label, option.outcome])).toEqual([
      ['Lead', 'open'],
      ['Qualified', 'open'],
      ['Proposal', 'open'],
      ['Won', 'won'],
      ['Lost', 'lost'],
    ]);
    expect(stage?.isRequired).toBe(false);
    expect(stage?.defaultValue).toEqual({ kind: 'static', value: stage?.options?.[0]?.id });
    expect(owner?.type).toBe('actor_reference');
    const views = await listViews(world.owner, world.companies, list.id);
    expect(views.views.map((view) => [view.name, view.kind])).toEqual([
      ['Pipeline', 'board'],
      ['All entries', 'table'],
    ]);
    const board = await getView(world.owner, list.defaultViewId ?? '');
    expect(board.config.board?.groupByAttributeId).toBe(stage?.id);
    // A new entry lands in Lead.
    const acme = await world.company('Acme');
    const added = await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: acme });
    expect(added.entry.values[stage?.id ?? '']).toBe(stage?.options?.[0]?.id);
  });

  it('refuses a name another list holds, ignoring case, and suffixes the API name on a slug clash', async () => {
    const world = await workspace();
    await createList(world.owner, { id: newId(), objectId: world.people, name: 'Events', template: 'blank' });
    expect(
      await refusalOf(
        createList(world.owner, { id: newId(), objectId: world.companies, name: 'events', template: 'blank' }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: 'A list named events already exists.', field: 'name' });
    const second = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Events!',
      template: 'blank',
    });
    expect(second.apiSlug).toBe('events_2');
  });

  it('answers a retried create with the list already made', async () => {
    const world = await workspace();
    const id = newId();
    const first = await createList(world.bea.scope, { id, objectId: world.people, name: 'Mine', template: 'blank' });
    const again = await createList(world.bea.scope, { id, objectId: world.people, name: 'Mine', template: 'blank' });
    expect(again.id).toBe(first.id);
    expect((await listLists(world.bea.scope)).filter((list) => list.name === 'Mine')).toHaveLength(1);
  });

  it('lets its maker and admins manage a list, and no other member (AC-4834)', async () => {
    const world = await workspace();
    const list = await createList(world.bea.scope, {
      id: newId(),
      objectId: world.people,
      name: 'Bea’s list',
      template: 'blank',
    });
    const asCy = (await listLists(world.cy.scope)).find((each) => each.id === list.id);
    expect(asCy).toMatchObject({ canManage: false, canWrite: true });
    expect((await listLists(world.owner)).find((each) => each.id === list.id)?.canManage).toBe(true);
    expect(
      await refusalOf(
        createAttribute(world.cy.scope, {
          objectId: world.people,
          listId: list.id,
          id: newId(),
          title: 'Priority',
          type: 'number',
        }),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: 'Only Bea Ruiz, owners and admins can change this list.' });
    const made = await createAttribute(world.bea.scope, {
      objectId: world.people,
      listId: list.id,
      id: newId(),
      title: 'Priority',
      type: 'number',
    });
    expect(made).toMatchObject({ title: 'Priority', listId: list.id, objectId: world.people });
  });
});

describe('entries (AC-4809, AC-4813 to AC-4818)', () => {
  it('adds with a client id, answers a retry with the same entry, and refuses a second add and another object', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Crew',
      template: 'blank',
    });
    const ada = await world.person('Ada');
    const id = newId();
    const added = await addListEntry(world.owner, { id, listId: list.id, recordId: ada });
    expect(added.entry).toMatchObject({ id, listId: list.id, recordId: ada });
    expect(added.record?.id).toBe(ada);
    const retried = await addListEntry(world.owner, { id, listId: list.id, recordId: ada });
    expect(retried.entry.id).toBe(id);
    expect(await refusalOf(addListEntry(world.owner, { id: newId(), listId: list.id, recordId: ada }))).toEqual({
      code: 'ENTRY_EXISTS',
      message: 'That record is already in this list.',
    });
    const acme = await world.company('Acme');
    expect(await refusalOf(addListEntry(world.owner, { id: newId(), listId: list.id, recordId: acme }))).toEqual({
      code: 'CONFIG_INVALID',
      message: "That record can't go in this list; it holds another object's records.",
    });
    const other = await world.person('Bo');
    expect(await refusalOf(addListEntry(world.owner, { id, listId: list.id, recordId: other }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'That entry id is already used.',
    });
    expect(await entryMembership(world.owner, { listId: list.id, recordIds: [ada, other] })).toEqual([ada]);
  });

  it('reads windows newest first with their records, counts, edits list fields, and reads entries by id', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Crew',
      template: 'blank',
    });
    const fields = await listListAttributes(world.owner, list.id);
    const added = fields.find((field) => field.title === 'Added')?.id ?? '';
    const note = await createAttribute(world.owner, {
      objectId: world.people,
      listId: list.id,
      id: newId(),
      title: 'Note',
      type: 'text',
    });
    const ids: string[] = [];
    for (const name of ['Ada', 'Bo', 'Cy']) {
      const recordId = await world.person(name);
      ids.push((await addListEntry(world.owner, { id: newId(), listId: list.id, recordId })).entry.id);
    }
    const page = await queryEntries(world.owner, {
      listId: list.id,
      sorts: [{ attributeId: added, direction: 'descending' }],
    });
    expect(page.entries.map((entry) => entry.id)).toEqual([...ids].reverse());
    expect(page.records).toHaveLength(3);
    expect(await countEntries(world.owner, { listId: list.id })).toEqual({ count: 3, atLeast: false });
    const edited = await editEntry(world.owner, {
      entryId: ids[0] ?? '',
      values: { [note.id]: { value: 'Call back' } },
    });
    expect(edited.entry.values[note.id]).toBe('Call back');
    expect(Object.keys(edited.written)).toEqual([note.id]);
    const read = await readEntryPage(world.owner, [ids[0] ?? '']);
    expect(read.entries[0]?.versions[note.id]).toBe(edited.written[note.id]);
  });

  it('removes and restores in a batch, per entry, a blocked restore staying out (AC-4818)', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Crew',
      template: 'blank',
    });
    const ada = await world.person('Ada');
    const bo = await world.person('Bo');
    const first = (await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: ada })).entry.id;
    const second = (await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: bo })).entry.id;
    const removed = await removeEntries(world.owner, { entryIds: [first, second] });
    expect(removed.map((outcome) => outcome.refusal)).toEqual([undefined, undefined]);
    expect(await countEntries(world.owner, { listId: list.id })).toEqual({ count: 0, atLeast: false });
    // Ada goes in again meanwhile: her old entry can't come back to an "Each record once" list.
    await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: ada });
    const restored = await restoreEntries(world.owner, { entryIds: [first, second] });
    expect(restored.map((outcome) => outcome.refusal?.code)).toEqual(['ENTRY_EXISTS', undefined]);
    expect(await countEntries(world.owner, { listId: list.id })).toEqual({ count: 2, atLeast: false });
  });

  it('answers a list over an object the member can’t see as unknown, and refuses writes on a read only one', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Crew',
      template: 'blank',
    });
    const ada = await world.person('Ada');
    const rule = (level: string) => ({
      levels: [
        {
          subject: { type: 'role' as const, role: 'member' },
          target: { type: 'object' as const, objectId: world.people },
          level,
        },
      ],
      records: [],
    });
    const hidden = testScope({
      db,
      workspaceId: world.workspaceId,
      actor: { type: 'member', id: world.bea.id },
      role: 'member',
      rules: rule('none'),
    });
    const reader = testScope({
      db,
      workspaceId: world.workspaceId,
      actor: { type: 'member', id: world.bea.id },
      role: 'member',
      rules: rule('read'),
    });
    expect((await listLists(hidden)).some((each) => each.id === list.id)).toBe(false);
    expect(await refusalOf(queryEntries(hidden, { listId: list.id }))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listLists(reader)).find((each) => each.id === list.id)?.canWrite).toBe(false);
    expect(await refusalOf(addListEntry(reader, { id: newId(), listId: list.id, recordId: ada }))).toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('a list’s views and board (AC-4808, AC-4820)', () => {
  it('makes, reads and defaults a list view through the views service', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Crew',
      template: 'blank',
    });
    const view = await createView(world.owner, {
      id: newId(),
      objectId: world.people,
      listId: list.id,
      name: 'Mine',
      kind: 'table',
      visibility: 'workspace',
      config: { columns: [], showNewAttributes: true, pinnedCount: 1, sorts: [] },
    });
    expect(view.listId).toBe(list.id);
    const views = await setDefaultView(world.owner, { objectId: world.people, listId: list.id, viewId: view.id });
    expect(views[0]?.id).toBe(view.id);
    // The object's own views never show a list's.
    expect((await listViews(world.owner, world.people)).views.some((each) => each.id === view.id)).toBe(false);
  });

  it('groups a Pipeline’s entries by its Stage, counting each column', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.companies,
      name: 'Deals',
      template: 'pipeline',
    });
    const stage = (await listListAttributes(world.owner, list.id)).find((field) => field.title === 'Stage');
    const [lead, qualified] = stage?.options ?? [];
    const acme = await world.company('Acme');
    const globex = await world.company('Globex');
    await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: acme });
    await addListEntry(world.owner, {
      id: newId(),
      listId: list.id,
      recordId: globex,
      values: { [stage?.id ?? '']: qualified?.id },
    });
    const board = await queryGroups(world.owner, {
      listId: list.id,
      groupBy: stage?.id ?? '',
      groupIds: [lead?.id ?? null, qualified?.id ?? null],
    });
    expect(board.groups.map((group) => [group.count, group.entries?.map((entry) => entry.recordId)])).toEqual([
      [1, [acme]],
      [1, [globex]],
    ]);
  });
});
