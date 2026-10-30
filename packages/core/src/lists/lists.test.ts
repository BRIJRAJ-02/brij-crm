// Lists and entries on real Postgres (spec 0048): making a Blank and a
// Pipeline list (fields, views, the default), the name and slug rules, who may
// make and manage a list, adding with a client id (replay, another object's
// record, "Each record once"), entry windows with their records, membership,
// batch removal and restore with per entry outcomes, a list's views through
// the views service, and a list board's columns.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import {
  archiveAttributes,
  createAttribute,
  editAttribute,
  listListAttributes,
  moveAttribute,
} from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { createRecord } from '../engine/records.ts';
import { queryGroups } from '../engine/query/groups.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { testScope } from '../testing.ts';
import { createView, setDefaultView } from '../views/manage.ts';
import { getView, listViews } from '../views/views.ts';
import { createOption } from '../attributes/options.ts';
import {
  addListEntries,
  addListEntry,
  archiveList,
  countEntries,
  createList,
  editEntry,
  entriesForRecord,
  entryMembership,
  getList,
  listLists,
  queryEntries,
  readEntryPage,
  removeEntries,
  restoreEntries,
  restoreList,
  updateList,
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

  it('keeps a restore refused for a unique value out whole: the count stays true (savepoint per entry)', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Crew',
      template: 'blank',
    });
    const code = await createAttribute(world.owner, {
      objectId: world.people,
      listId: list.id,
      id: newId(),
      title: 'Code',
      type: 'text',
      isUnique: true,
    });
    const ada = await world.person('Ada');
    const bo = await world.person('Bo');
    const first = (
      await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: ada, values: { [code.id]: 'T1' } })
    ).entry.id;
    await removeEntries(world.owner, { entryIds: [first] });
    await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: bo, values: { [code.id]: 'T1' } });
    const restored = await restoreEntries(world.owner, { entryIds: [first] });
    expect(restored[0]?.refusal?.code).toBe('UNIQUE_CONFLICT');
    expect(await countEntries(world.owner, { listId: list.id })).toEqual({ count: 1, atLeast: false });
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

  it('adds many to a Pipeline set based, each new entry starting at Lead with its own version and sort key', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.companies,
      name: 'Batch deals',
      template: 'pipeline',
    });
    const stage = (await listListAttributes(world.owner, list.id)).find((field) => field.title === 'Stage');
    const [lead] = stage?.options ?? [];
    const made = [];
    for (const name of ['A', 'B', 'C', 'D']) made.push(await world.company(name));
    const answer = await addListEntries(world.owner, { listId: list.id, recordIds: made });
    expect(answer.added).toHaveLength(4);
    const read = await readEntryPage(
      world.owner,
      answer.added.map((each) => each.entryId),
    );
    expect(read.entries.map((entry) => entry.values[stage?.id ?? ''])).toEqual([
      lead?.id,
      lead?.id,
      lead?.id,
      lead?.id,
    ]);
    const versions = new Set(read.entries.map((entry) => entry.versions[stage?.id ?? '']));
    expect(versions.size).toBe(4);
    const board = await queryGroups(world.owner, {
      listId: list.id,
      groupBy: stage?.id ?? '',
      groupIds: [lead?.id ?? null],
    });
    expect(board.groups[0]?.count).toBe(4);
    expect((await countEntries(world.owner, { listId: list.id })).count).toBe(4);
  });
});

describe('list settings, archive and restore (AC-4829 to AC-4832)', () => {
  it('renames, retiles and keeps the API name; another member is refused with the maker’s name', async () => {
    const world = await workspace();
    const list = await createList(world.bea.scope, {
      id: newId(),
      objectId: world.people,
      name: 'Hiring',
      template: 'blank',
    });
    const changed = await updateList(world.bea.scope, {
      listId: list.id,
      name: 'Recruiting',
      icon: 'users',
      hue: 'blue',
    });
    expect(changed).toMatchObject({ name: 'Recruiting', apiSlug: 'hiring', icon: 'users', hue: 'blue' });
    expect(await refusalOf(updateList(world.cy.scope, { listId: list.id, name: 'Mine now' }))).toEqual({
      code: 'FORBIDDEN',
      message: 'Only Bea Ruiz, owners and admins can change this list.',
    });
    const other = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Events',
      template: 'blank',
    });
    expect(await refusalOf(updateList(world.owner, { listId: other.id, name: 'recruiting' }))).toMatchObject({
      code: 'CONFIG_INVALID',
      message: 'A list named recruiting already exists.',
    });
    // An admin changes any list (AC-4834).
    expect((await updateList(world.owner, { listId: list.id, name: 'Talent' })).name).toBe('Talent');
  });

  it('refuses turning Each record once on while a record is in twice, naming the count to an open reader', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Visits',
      template: 'blank',
      allowsDuplicates: true,
    });
    const ada = await world.person('Ada');
    const bob = await world.person('Bob');
    for (const recordId of [ada, ada, bob]) await addListEntry(world.owner, { id: newId(), listId: list.id, recordId });
    expect(await refusalOf(updateList(world.owner, { listId: list.id, allowsDuplicates: false }))).toMatchObject({
      code: 'CONFIG_INVALID',
      message: '1 record is in this list more than once. Remove the extra entries first.',
    });
    const page = await queryEntries(world.owner, { listId: list.id });
    const extra = page.entries.find((entry) => entry.recordId === ada)?.id ?? '';
    await removeEntries(world.owner, { entryIds: [extra] });
    expect((await updateList(world.owner, { listId: list.id, allowsDuplicates: false })).allowsDuplicates).toBe(false);
  });

  it('archives a list out of every read and entry write, and restores it with its entries', async () => {
    const world = await workspace();
    const list = await createList(world.bea.scope, {
      id: newId(),
      objectId: world.people,
      name: 'Old',
      template: 'blank',
    });
    const ada = await world.person('Ada');
    await addListEntry(world.bea.scope, { id: newId(), listId: list.id, recordId: ada });
    expect(await refusalOf(archiveList(world.cy.scope, { listId: list.id }))).toMatchObject({ code: 'FORBIDDEN' });
    const [entry] = (await queryEntries(world.bea.scope, { listId: list.id })).entries;
    const note = await createAttribute(world.owner, {
      objectId: world.people,
      listId: list.id,
      id: newId(),
      title: 'Note',
      type: 'text',
    });
    const archived = await archiveList(world.bea.scope, { listId: list.id });
    expect(archived.isArchived).toBe(true);
    // Its entries' fields can't change while it is archived, as entries can't be added.
    expect(
      await refusalOf(editEntry(world.bea.scope, { entryId: entry?.id ?? '', values: { [note.id]: { value: 'x' } } })),
    ).toEqual({ code: 'NOT_FOUND', message: 'That list is archived. Restore it first.' });
    expect((await listLists(world.cy.scope)).some((each) => each.id === list.id)).toBe(false);
    expect(
      (await listLists(world.bea.scope, { includeArchived: true })).find((each) => each.id === list.id)?.isArchived,
    ).toBe(true);
    expect(await refusalOf(addListEntry(world.bea.scope, { id: newId(), listId: list.id, recordId: ada }))).toEqual({
      code: 'NOT_FOUND',
      message: 'That list is archived. Restore it first.',
    });
    expect(await refusalOf(updateList(world.bea.scope, { listId: list.id, name: 'Older' }))).toMatchObject({
      code: 'NOT_FOUND',
    });
    // Its record page shows no card while it is archived (AC-4831).
    expect(await entriesForRecord(world.bea.scope, { recordId: ada })).toEqual([]);
    const restored = await restoreList(world.bea.scope, { listId: list.id });
    expect(restored.isArchived).toBe(false);
    expect((await countEntries(world.bea.scope, { listId: list.id })).count).toBe(1);
    expect((await getList(world.cy.scope, list.id)).name).toBe('Old');
  });
});

describe('adding many and a record’s entries (AC-4822, AC-4825)', () => {
  it('adds each record on its own: added, already in, refused; a replay answers the same entries', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Batch',
      template: 'blank',
    });
    const [a, b, c] = [await world.person('A'), await world.person('B'), await world.person('C')];
    const acme = await world.company('Acme');
    await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: b });
    const ids = [newId(), newId(), newId(), newId()];
    const answer = await addListEntries(world.owner, { listId: list.id, recordIds: [a, b, c, acme], ids });
    expect(answer.added.map((each) => each.recordId).sort()).toEqual([a, c].sort());
    expect(answer.alreadyIn).toEqual([b]);
    expect(answer.refused).toEqual([
      {
        recordId: acme,
        code: 'CONFIG_INVALID',
        message: "That record can't go in this list; it holds another object's records.",
      },
    ]);
    expect((await countEntries(world.owner, { listId: list.id })).count).toBe(3);
    const again = await addListEntries(world.owner, {
      listId: list.id,
      recordIds: [a, c],
      ids: [ids[0] ?? '', ids[2] ?? ''],
    });
    expect(again.added).toHaveLength(2);
    expect((await countEntries(world.owner, { listId: list.id })).count).toBe(3);
  });

  it('refuses a read only member, an unknown record and 501 records', async () => {
    const world = await workspace();
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Guard',
      template: 'blank',
    });
    const a = await world.person('A');
    const reader = testScope({
      db,
      workspaceId: world.workspaceId,
      actor: { type: 'member', id: world.cy.id },
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: world.people },
            level: 'read',
          },
        ],
        records: [],
      },
    });
    expect(await refusalOf(addListEntries(reader, { listId: list.id, recordIds: [a] }))).toMatchObject({
      code: 'FORBIDDEN',
    });
    const missing = await addListEntries(world.owner, { listId: list.id, recordIds: [newId()] });
    expect(missing.refused[0]?.code).toBe('NOT_FOUND');
    const tooMany = Array.from({ length: 501 }, () => newId());
    expect(await refusalOf(addListEntries(world.owner, { listId: list.id, recordIds: tooMany }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('lists a record’s entries by list name then added, in readable lists only (AC-4822)', async () => {
    const world = await workspace();
    const ada = await world.person('Ada');
    const made = [];
    for (const name of ['Zeta', 'Alpha', 'Hidden']) {
      made.push(
        await createList(world.owner, {
          id: newId(),
          objectId: world.people,
          name,
          template: 'blank',
          allowsDuplicates: true,
        }),
      );
    }
    for (const list of made) await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: ada });
    const hiddenList = made[2];
    const reader = testScope({
      db,
      workspaceId: world.workspaceId,
      actor: { type: 'member', id: world.cy.id },
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'object', objectId: hiddenList?.id ?? '' },
            level: 'none',
          },
        ],
        records: [],
      },
    });
    const entries = await entriesForRecord(reader, { recordId: ada });
    expect(entries.map((entry) => entry.listId)).toEqual([made[1]?.id, made[0]?.id]);
    const all = await entriesForRecord(world.owner, { recordId: ada });
    expect(all.map((entry) => entry.listId)).toEqual([made[1]?.id, made[2]?.id, made[0]?.id]);
    expect(await refusalOf(entriesForRecord(world.owner, { recordId: newId() }))).toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a list’s maker and its fields (AC-4834)', () => {
  it('lets its maker edit, move, archive and add options to its own fields; another member is refused', async () => {
    const world = await workspace();
    const list = await createList(world.bea.scope, {
      id: newId(),
      objectId: world.people,
      name: 'Pipe',
      template: 'pipeline',
    });
    const fields = await listListAttributes(world.bea.scope, list.id);
    const stage = fields.find((field) => field.title === 'Stage');
    const owner = fields.find((field) => field.title === 'Owner');
    expect(stage?.id).toBeDefined();
    const renamed = await editAttribute(world.bea.scope, { attributeId: stage?.id ?? '', title: 'Phase' });
    expect(renamed.title).toBe('Phase');
    const moved = await moveAttribute(world.bea.scope, { attributeId: owner?.id ?? '', position: 0 });
    expect(moved.length).toBeGreaterThan(0);
    const option = await createOption(world.bea.scope, { attributeId: stage?.id ?? '', id: newId(), label: 'Parked' });
    expect(option.label).toBe('Parked');
    const sentence = { code: 'FORBIDDEN', message: 'Only Bea Ruiz, owners and admins can change this list.' };
    expect(await refusalOf(editAttribute(world.cy.scope, { attributeId: stage?.id ?? '', title: 'Mine' }))).toEqual(
      sentence,
    );
    expect(await refusalOf(archiveAttributes(world.cy.scope, { attributeId: stage?.id ?? '' }))).toEqual(sentence);
    expect(
      await refusalOf(createOption(world.cy.scope, { attributeId: stage?.id ?? '', id: newId(), label: 'Nope' })),
    ).toEqual(sentence);
    const archived = await archiveAttributes(world.bea.scope, { attributeId: owner?.id ?? '' });
    expect(archived[0]?.isArchived).toBe(true);
  });
});

describe('record rules and other workspaces (AC-4836, AC-4838)', () => {
  it('leaves an entry out of rows, counts, membership and a record’s page when its record is hidden by a rule', async () => {
    const world = await workspace();
    const ownerField = await createAttribute(world.owner, {
      objectId: world.people,
      id: newId(),
      title: 'Account owner',
      type: 'actor_reference',
    });
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Mine',
      template: 'blank',
    });
    const nameField = world.attribute('name', world.people);
    const mine = (
      await createRecord(world.owner, {
        objectId: world.people,
        values: { [nameField]: { firstName: 'Mine' }, [ownerField.id]: { type: 'member', id: world.cy.id } },
      })
    ).recordId;
    const theirs = (
      await createRecord(world.owner, {
        objectId: world.people,
        values: { [nameField]: { firstName: 'Theirs' }, [ownerField.id]: { type: 'member', id: world.bea.id } },
      })
    ).recordId;
    for (const recordId of [mine, theirs]) await addListEntry(world.owner, { id: newId(), listId: list.id, recordId });
    const ruled = testScope({
      db,
      workspaceId: world.workspaceId,
      actor: { type: 'member', id: world.cy.id },
      role: 'member',
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: world.people,
            kind: 'own',
            attributeId: ownerField.id,
          },
        ],
      },
    });
    const page = await queryEntries(ruled, { listId: list.id });
    expect(page.entries.map((entry) => entry.recordId)).toEqual([mine]);
    expect((await countEntries(ruled, { listId: list.id })).count).toBe(1);
    expect(await entryMembership(ruled, { listId: list.id, recordIds: [mine, theirs] })).toEqual([mine]);
    expect(await entriesForRecord(ruled, { recordId: mine })).toHaveLength(1);
    expect(await refusalOf(entriesForRecord(ruled, { recordId: theirs }))).toMatchObject({ code: 'NOT_FOUND' });
    const all = (await queryEntries(world.owner, { listId: list.id })).entries;
    const hiddenEntry = all.find((entry) => entry.recordId === theirs)?.id ?? '';
    expect((await readEntryPage(ruled, [hiddenEntry])).entries).toEqual([]);
    // The stored count counts the hidden entry too, so it is told to no one a rule limits (decision 13).
    expect((await listLists(ruled)).find((each) => each.id === list.id)?.entryCount).toBeUndefined();
    const added = await addListEntries(ruled, { listId: list.id, recordIds: [theirs] });
    expect(added.refused[0]?.code).toBe('NOT_FOUND');
  });

  it('never tells a non reader a hidden record is already in an Each record once list', async () => {
    const world = await workspace();
    const ownerField = await createAttribute(world.owner, {
      objectId: world.people,
      id: newId(),
      title: 'Account owner',
      type: 'actor_reference',
    });
    const list = await createList(world.owner, {
      id: newId(),
      objectId: world.people,
      name: 'Once',
      template: 'blank',
    });
    const theirs = (
      await createRecord(world.owner, {
        objectId: world.people,
        values: {
          [world.attribute('name', world.people)]: { firstName: 'Theirs' },
          [ownerField.id]: { type: 'member', id: world.bea.id },
        },
      })
    ).recordId;
    await addListEntry(world.owner, { id: newId(), listId: list.id, recordId: theirs });
    const ruled = testScope({
      db,
      workspaceId: world.workspaceId,
      actor: { type: 'member', id: world.cy.id },
      role: 'member',
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: world.people,
            kind: 'own',
            attributeId: ownerField.id,
          },
        ],
      },
    });
    // The hidden record already in the list answers exactly as a record that was never there.
    const unknown = await refusalOf(addListEntry(ruled, { id: newId(), listId: list.id, recordId: newId() }));
    expect(await refusalOf(addListEntry(ruled, { id: newId(), listId: list.id, recordId: theirs }))).toEqual(unknown);
    const batch = await addListEntries(ruled, { listId: list.id, recordIds: [theirs, newId()] });
    expect(batch.alreadyIn).toEqual([]);
    expect(batch.refused.map((each) => [each.code, each.message])).toEqual([
      ['NOT_FOUND', 'That record does not exist.'],
      ['NOT_FOUND', 'That record does not exist.'],
    ]);
    expect(await entryMembership(ruled, { listId: list.id, recordIds: [theirs] })).toEqual([]);
  });

  it('answers a list from another workspace as unknown, for every new procedure', async () => {
    const mine = await workspace();
    const other = await workspace();
    const list = await createList(other.owner, {
      id: newId(),
      objectId: other.people,
      name: 'Theirs',
      template: 'blank',
    });
    const record = await mine.person('Ada');
    const unknown = { code: 'NOT_FOUND', message: 'That list does not exist.' };
    expect(await refusalOf(updateList(mine.owner, { listId: list.id, name: 'Mine' }))).toEqual(unknown);
    expect(await refusalOf(archiveList(mine.owner, { listId: list.id }))).toEqual(unknown);
    expect(await refusalOf(restoreList(mine.owner, { listId: list.id }))).toEqual(unknown);
    expect(await refusalOf(addListEntries(mine.owner, { listId: list.id, recordIds: [record] }))).toEqual(unknown);
    expect(await refusalOf(entriesForRecord(mine.owner, { recordId: other.people }))).toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
