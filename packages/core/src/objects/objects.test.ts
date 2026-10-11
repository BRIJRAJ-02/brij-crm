// Objects in settings (spec 0012, milestone 1) against a real Postgres as the
// app role: the workspace's order, creating with a client id and replays,
// names unique ignoring case, the reserved API names, moving, archiving and
// restoring (with the archived by object rule on the far end's attributes),
// and usage through the caller's access.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { listObjectAttributes } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { queryPage } from '../engine/query/page.ts';
import { createRecord, setValues } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { rescope, testScope } from '../testing.ts';
import { archiveObject, createObject, editObject, listObjects, moveObject, restoreObject } from './objects.ts';
import { getUsage } from './usage.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-objects-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Objects',
    slug: `objects-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  return { ...created, scope };
}

/** A second member of the workspace, with `role`. */
async function memberIn(scope: EngineScope, role: 'admin' | 'member'): Promise<EngineScope> {
  const memberId = newId();
  await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${scope.workspaceId}, ${memberId}, 'Bea', ${`bea-${memberId}@example.com`}, ${role}, 'system', 'system')`,
    ),
  );
  return rescope(scope, { actor: { type: 'member', id: memberId }, role });
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

const projects = (id = newId()) => ({
  id,
  singularName: 'Project',
  pluralName: 'Projects',
  icon: 'folder',
  hue: 'blue',
});

async function outboxCount(scope: EngineScope): Promise<number> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from outbox where kind = 'definitions'`),
  );
  return result.rows[0]?.n ?? 0;
}

describe('the workspace order (AC-225)', () => {
  it('lists the standard objects in template order from 0, and a new object at the end', async () => {
    const { scope } = await workspace();
    const before = await listObjects(scope);
    expect(before.map((object) => [object.standardKey, object.position, object.isStandard])).toEqual([
      ['people', 0, true],
      ['companies', 1, true],
      ['deals', 2, true],
    ]);
    const made = await createObject(scope, projects());
    expect(made).toMatchObject({ apiSlug: 'projects', position: 3, isStandard: false, isArchived: false });
    expect((await listObjects(scope)).map((object) => object.apiSlug)).toEqual([
      'people',
      'companies',
      'deals',
      'projects',
    ]);
  });

  it('moves an object, the others closing up, archived ones keeping their place', async () => {
    const { scope } = await workspace();
    const made = await createObject(scope, projects());
    const companies = (await listObjects(scope)).find((object) => object.standardKey === 'companies');
    await archiveObject(scope, { objectId: companies?.id ?? '' });
    const moved = await moveObject(scope, { objectId: made.id, position: 0 });
    expect(moved.map((object) => [object.apiSlug, object.position, object.isArchived])).toEqual([
      ['projects', 0, false],
      ['people', 1, false],
      ['companies', 2, true],
      ['deals', 3, false],
    ]);
    // Past the end lands last.
    const last = await moveObject(scope, { objectId: made.id, position: 99 });
    expect(last.map((object) => object.apiSlug)).toEqual(['people', 'companies', 'deals', 'projects']);
    expect((await listObjects(scope)).map((object) => object.apiSlug)).toEqual(['people', 'deals', 'projects']);
  });
});

describe('creating an object (AC-223, AC-244, AC-245)', () => {
  it('starts with the five system attributes and a text Name as its primary attribute', async () => {
    const { scope } = await workspace();
    const made = await createObject(scope, projects());
    const attributes = await listObjectAttributes(scope, made.id);
    expect(attributes.filter((attribute) => attribute.isSystem).map((attribute) => attribute.apiSlug)).toEqual([
      'record_id',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
    ]);
    const primary = attributes.find((attribute) => attribute.isPrimary);
    expect(primary).toMatchObject({ apiSlug: 'name', title: 'Name', type: 'text', isRequired: false });
    expect(made.primaryAttributeId).toBe(primary?.id);
  });

  it('answers the same object for the same id again, writing nothing twice; another actor gets ID_TAKEN', async () => {
    const { scope } = await workspace();
    const input = projects();
    const first = await createObject(scope, input, [outboxHook({ mutationId: newId() })]);
    const again = await createObject(scope, input, [outboxHook({ mutationId: newId() })]);
    expect(again).toEqual(first);
    expect(await outboxCount(scope)).toBe(1);
    const admin = await memberIn(scope, 'admin');
    expect(await refusalOf(createObject(admin, { ...input, pluralName: 'Others', singularName: 'Other' }))).toEqual({
      code: 'ID_TAKEN',
      message: 'An object with that id already exists.',
    });
  });

  it('refuses a taken name on its field, ignoring case and including archived objects', async () => {
    const { scope } = await workspace();
    const made = await createObject(scope, projects());
    await archiveObject(scope, { objectId: made.id });
    expect(
      await refusalOf(
        createObject(scope, { ...projects(), singularName: 'Task', pluralName: 'PROJECTS', apiSlug: 'other' }),
      ),
    ).toEqual({
      code: 'NAME_TAKEN',
      message: 'An object called PROJECTS already exists.',
      field: 'pluralName',
    });
    expect(
      await refusalOf(createObject(scope, { ...projects(), singularName: 'person', pluralName: 'Humans' })),
    ).toEqual({
      code: 'NAME_TAKEN',
      message: 'An object called person already exists.',
      field: 'singularName',
    });
  });

  it('refuses a taken, malformed or reserved API name on apiSlug, and derives map_object from Map', async () => {
    const { scope } = await workspace();
    expect(
      await refusalOf(
        createObject(scope, { ...projects(), singularName: 'Human', pluralName: 'Humans', apiSlug: 'people' }),
      ),
    ).toMatchObject({ code: 'SLUG_TAKEN', field: 'apiSlug' });
    expect(await refusalOf(createObject(scope, { ...projects(), apiSlug: 'Bad Name' }))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'apiSlug',
    });
    for (const reserved of ['map', 'list', 'new', 'settings', 'attributes', 'configuration']) {
      expect(await refusalOf(createObject(scope, { ...projects(), apiSlug: reserved }))).toEqual({
        code: 'CONFIG_INVALID',
        message: 'That API name is reserved. Pick another.',
        field: 'apiSlug',
      });
    }
    const map = await createObject(scope, { ...projects(), singularName: 'Map', pluralName: 'Map' });
    expect(map.apiSlug).toBe('map_object');
  });

  it('refuses the 51st custom object, archived ones counting, and leaves exactly one of two racing at the limit', async () => {
    const { scope } = await workspace();
    const small = rescope(scope, { limits: { customObjects: 2 } });
    const first = await createObject(small, projects());
    await archiveObject(small, { objectId: first.id });
    const racing = await Promise.allSettled([
      createObject(small, { ...projects(), singularName: 'Partner', pluralName: 'Partners' }),
      createObject(small, { ...projects(), singularName: 'Vendor', pluralName: 'Vendors' }),
    ]);
    expect(racing.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(
      await refusalOf(createObject(small, { ...projects(), singularName: 'Event', pluralName: 'Events' })),
    ).toEqual({
      code: 'LIMIT_REACHED',
      message: 'This workspace holds at most 2 custom objects.',
    });
    // Restoring never fails on the limit: the archived one kept its slot.
    await expect(restoreObject(small, { objectId: first.id })).resolves.toMatchObject({ isArchived: false });
  });
});

describe('editing an object (AC-224)', () => {
  it('renames and restyles standard and custom objects alike; the API name stays', async () => {
    const { scope, objects } = await workspace();
    const edited = await editObject(scope, { objectId: objects.people ?? '', pluralName: 'Contacts', hue: 'red' });
    expect(edited).toMatchObject({ apiSlug: 'people', pluralName: 'Contacts', singularName: 'Person', hue: 'red' });
    expect(await refusalOf(editObject(scope, { objectId: objects.people ?? '', singularName: 'COMPANY' }))).toEqual({
      code: 'NAME_TAKEN',
      message: 'An object called COMPANY already exists.',
      field: 'singularName',
    });
    expect(await refusalOf(editObject(scope, { objectId: objects.people ?? '', icon: 'no-such-icon' }))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'icon',
    });
  });
});

describe('archiving and restoring (AC-226)', () => {
  it('treats references to an archived object as archived, everywhere, and restores them unchanged', async () => {
    const { scope, objects } = await workspace();
    const people = objects.people ?? '';
    const companies = objects.companies ?? '';
    const company = (await listObjectAttributes(scope, people)).find((attribute) => attribute.apiSlug === 'company');
    expect(company).toMatchObject({ isArchived: false });
    const name = (await listObjectAttributes(scope, people)).find((attribute) => attribute.isPrimary)?.id ?? '';
    const { recordId } = await createRecord(scope, {
      objectId: people,
      values: { [name]: { firstName: 'Ada', lastName: 'Lovelace' } },
    });

    await archiveObject(scope, { objectId: companies });
    expect((await listObjects(scope)).map((object) => object.standardKey)).toEqual(['people', 'deals']);
    expect((await listObjectAttributes(scope, people)).some((attribute) => attribute.apiSlug === 'company')).toBe(
      false,
    );
    const all = await listObjectAttributes(scope, people, { includeArchived: true });
    expect(all.find((attribute) => attribute.apiSlug === 'company')).toMatchObject({
      isArchived: true,
      archivedBy: { objectId: companies },
    });
    // Its row never changed.
    const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ archived: boolean }>(
        sql`select archived_at is not null as archived from attributes where id = ${company?.id ?? ''}`,
      ),
    );
    expect(rows.rows[0]?.archived).toBe(false);
    // Writes and filters are refused, as for an archived attribute.
    expect(
      await refusalOf(
        setValues(scope, {
          recordId,
          values: { [company?.id ?? '']: { value: { objectId: companies, recordId: newId() } } },
        }),
      ),
    ).toMatchObject({ code: 'ATTRIBUTE_READ_ONLY', attributeId: company?.id });
    expect(
      await refusalOf(
        queryPage(scope, {
          objectId: people,
          filter: { conjunction: 'and', conditions: [{ attributeId: company?.id ?? '', operator: 'is_not_empty' }] },
        }),
      ),
    ).toMatchObject({ code: 'FILTER_INVALID' });

    await restoreObject(scope, { objectId: companies });
    expect((await listObjects(scope)).map((object) => object.standardKey)).toEqual(['people', 'companies', 'deals']);
    expect(
      (await listObjectAttributes(scope, people)).find((attribute) => attribute.apiSlug === 'company'),
    ).toMatchObject({
      isArchived: false,
    });
  });

  it('lists an archived object only with includeArchived, and its attributes only then', async () => {
    const { scope } = await workspace();
    const made = await createObject(scope, projects());
    await archiveObject(scope, { objectId: made.id });
    expect((await listObjects(scope, { includeArchived: true })).find((object) => object.id === made.id)).toMatchObject(
      {
        isArchived: true,
      },
    );
    expect(await refusalOf(listObjectAttributes(scope, made.id))).toMatchObject({ code: 'NOT_FOUND' });
    expect((await listObjectAttributes(scope, made.id, { includeArchived: true })).length).toBe(6);
  });
});

describe('usage (AC-243)', () => {
  it('counts custom objects for schema.manage only, and each visible object’s non system attributes', async () => {
    const { scope, objects } = await workspace();
    const made = await createObject(scope, projects());
    const usage = await getUsage(scope);
    expect(usage.customObjects).toEqual({ used: 1, limit: 50 });
    expect(usage.attributes[made.id]).toEqual({ used: 1, limit: 250 });
    expect(usage.attributes[objects.people ?? '']?.used).toBeGreaterThan(5);
    expect(usage.optionsPerAttribute).toBe(500);
    const member = await memberIn(scope, 'member');
    const theirs = await getUsage(member);
    expect(theirs.customObjects).toBeUndefined();
    expect(theirs.attributes[made.id]).toEqual({ used: 1, limit: 250 });
  });

  it('leaves out an object the caller can’t see, with its count', async () => {
    const { scope, objects } = await workspace();
    const people = objects.people ?? '';
    const hidden = rescope(await memberIn(scope, 'member'), {
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: people }, level: 'none' },
        ],
        records: [],
      },
    });
    const usage = await getUsage(hidden);
    expect(Object.keys(usage.attributes)).not.toContain(people);
    expect((await listObjects(hidden)).map((object) => object.id)).not.toContain(people);
  });
});
