// Relationships as the dialog makes them (spec 0014, milestone 1) against a
// real Postgres as the app role: every cardinality and a self relationship,
// the relationship block in `attributes.list`, refusals on the side they are
// about with nothing left behind, replays by the relationship's id, renames
// of both sides in one write, both sides archived and restored together with
// every link kept, one definitions outbox row per object, and members
// refused.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { archiveAttributes, listObjectAttributes, restoreAttributes } from '../attributes/attributes.ts';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { defineRelationship } from '../engine/relationships.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { archiveObject, createObject, restoreObject } from '../objects/objects.ts';
import { rescope, testScope } from '../testing.ts';
import { createRelationship, renameRelationship } from './relationships.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-relationships-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Relationships',
    slug: `relationships-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  // Custom objects, whose names aren't required, for the tests that make records.
  const custom = async (singularName: string, pluralName: string) =>
    (await createObject(scope, { id: newId(), singularName, pluralName, icon: 'folder', hue: 'blue' })).id;
  return { ...created, scope, people, companies, custom };
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

/** The definitions outbox rows stored since the workspace was made, with their mutation ids. */
async function definitionRows(scope: EngineScope) {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ object_id: string | null; attribute_ids: string[]; mutation_id: string | null }>(
      sql`select object_id::text, attribute_ids::text[], mutation_id::text from outbox where kind = 'definitions' order by seq`,
    ),
  );
  return result.rows.map((row) => ({
    objectId: row.object_id,
    attributeIds: [...row.attribute_ids].sort(),
    mutationId: row.mutation_id,
  }));
}

/** How many attributes and relationships the workspace holds: a refused create must leave both unchanged. */
async function counts(scope: EngineScope) {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ attributes: number; relationships: number }>(
      sql`select (select count(*)::int from attributes) as attributes, (select count(*)::int from relationships) as relationships`,
    ),
  );
  return result.rows[0];
}

describe('creating a relationship (AC-282, AC-283)', () => {
  it.each([
    ['many_to_one', false, true],
    ['one_to_many', true, false],
    ['many_to_many', true, true],
    ['one_to_one', false, false],
  ] as const)('makes %s with both sides, each holding one or many', async (cardinality, fromMany, toMany) => {
    const { scope, custom } = await workspace();
    const projects = await custom('Project', 'Projects');
    const clients = await custom('Client', 'Clients');
    const mutationId = newId();
    const before = (await definitionRows(scope)).length;
    const made = await createRelationship(
      scope,
      {
        id: newId(),
        cardinality,
        from: { objectId: projects, title: 'Main client' },
        to: { objectId: clients, title: 'Projects' },
      },
      [outboxHook({ mutationId })],
    );
    expect(made.cardinality).toBe(cardinality);
    expect(made.from).toMatchObject({
      objectId: projects,
      title: 'Main client',
      apiSlug: 'main_client',
      type: 'record_reference',
      isMulti: fromMany,
      relationship: {
        id: made.relationshipId,
        cardinality,
        side: 'from',
        targetObjectIds: [clients],
        pairedAttributeId: made.to.id,
        farHoldsOne: !toMany,
      },
    });
    expect(made.to).toMatchObject({
      objectId: clients,
      apiSlug: 'projects',
      isMulti: toMany,
      relationship: {
        side: 'to',
        targetObjectIds: [projects],
        pairedAttributeId: made.from.id,
        farHoldsOne: !fromMany,
      },
    });
    // Both columns are live on their objects at once, with the block in the list too.
    expect((await listObjectAttributes(scope, projects)).at(-1)).toEqual(made.from);
    expect((await listObjectAttributes(scope, clients)).at(-1)).toEqual(made.to);
    // One definitions row per object, sharing the write's mutation id (AC-282's live columns).
    const rows = (await definitionRows(scope)).slice(before);
    expect(rows).toEqual(
      expect.arrayContaining([
        { objectId: projects, attributeIds: [made.from.id], mutationId },
        { objectId: clients, attributeIds: [made.to.id], mutationId },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it('makes a relationship from an object to itself, whose two sides need different names (AC-283)', async () => {
    const { scope, people } = await workspace();
    const before = (await definitionRows(scope)).length;
    const made = await createRelationship(
      scope,
      {
        id: newId(),
        cardinality: 'many_to_one',
        from: { objectId: people, title: 'Manager' },
        to: { objectId: people, title: 'Reports' },
      },
      [outboxHook({ mutationId: newId() })],
    );
    expect([made.from.isMulti, made.to.isMulti]).toEqual([false, true]);
    expect(made.from.relationship?.targetObjectIds).toEqual([people]);
    // One definitions row for the one object, naming both sides.
    const rows = (await definitionRows(scope)).slice(before);
    expect(rows).toEqual([
      { objectId: people, attributeIds: [made.from.id, made.to.id].sort(), mutationId: expect.any(String) as string },
    ]);
    const counted = await counts(scope);
    expect(
      await refusalOf(
        createRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_many',
          from: { objectId: people, title: 'Mentors' },
          to: { objectId: people, title: ' mentors ' },
        }),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', message: 'Give each side its own name.', field: 'to.title' });
    expect(await counts(scope)).toEqual(counted);
  });

  it('carries the block on the standard relationships too', async () => {
    const { scope, people, companies } = await workspace();
    const company = (await listObjectAttributes(scope, people)).find((each) => each.apiSlug === 'company');
    const team = (await listObjectAttributes(scope, companies)).find((each) => each.apiSlug === 'team');
    expect(company?.relationship).toMatchObject({
      targetObjectIds: [companies],
      pairedAttributeId: team?.id,
      farHoldsOne: false,
    });
    expect(team?.relationship).toMatchObject({ targetObjectIds: [people], farHoldsOne: true });
    // Attributes of other types carry none.
    expect((await listObjectAttributes(scope, people)).find((each) => each.type === 'text')?.relationship).toBe(
      undefined,
    );
  });
});

describe('refusals (AC-284, AC-285, AC-286)', () => {
  it('refuses a name either object already uses on that side, leaving neither side behind', async () => {
    const { scope, people, companies } = await workspace();
    const counted = await counts(scope);
    // Companies already has Team (the standard relationship's side).
    expect(
      await refusalOf(
        createRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_many',
          from: { objectId: people, title: 'Advisers' },
          to: { objectId: companies, title: 'Team' },
        }),
      ),
    ).toEqual({
      code: 'SLUG_TAKEN',
      message: 'Companies already has an attribute with this name. Pick another.',
      field: 'to.title',
    });
    expect(
      await refusalOf(
        createRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_many',
          from: { objectId: people, title: 'Company' },
          to: { objectId: companies, title: 'Alumni' },
        }),
      ),
    ).toMatchObject({ code: 'SLUG_TAKEN', field: 'from.title' });
    expect(
      await refusalOf(
        createRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_many',
          from: { objectId: people, title: 'x'.repeat(101) },
          to: { objectId: companies, title: 'Alumni' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'from.title' });
    expect(await counts(scope)).toEqual(counted);
  });

  it('answers LIMIT_REACHED naming the full object, and NOT_FOUND for an archived or missing object', async () => {
    const { scope, people, custom } = await workspace();
    const projects = await custom('Project', 'Projects');
    const listed = await listObjectAttributes(scope, projects, { includeArchived: true });
    const full = rescope(scope, { limits: { attributesPerParent: listed.filter((each) => !each.isSystem).length } });
    const counted = await counts(scope);
    expect(
      await refusalOf(
        createRelationship(full, {
          id: newId(),
          cardinality: 'one_to_many',
          from: { objectId: projects, title: 'Members' },
          to: { objectId: people, title: 'Project' },
        }),
      ),
    ).toEqual({ code: 'LIMIT_REACHED', message: 'Projects already holds 1 attributes, the most an object can.' });
    expect(await counts(scope)).toEqual(counted);
    expect(
      await refusalOf(
        createRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_one',
          from: { objectId: people, title: 'Project' },
          to: { objectId: newId(), title: 'Members' },
        }),
      ),
    ).toEqual({ code: 'NOT_FOUND', message: 'That object does not exist.' });
    await archiveObject(scope, { objectId: projects });
    expect(
      await refusalOf(
        createRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_one',
          from: { objectId: people, title: 'Project' },
          to: { objectId: projects, title: 'Members' },
        }),
      ),
    ).toEqual({ code: 'NOT_FOUND', message: 'That object is archived. Restore it first.' });
    expect(await counts(scope)).toEqual(counted);
  });

  it('answers a repeated create with the relationship already made, whatever its mutation id', async () => {
    const { scope, people, companies } = await workspace();
    const input = {
      id: newId(),
      cardinality: 'many_to_many' as const,
      from: { objectId: people, title: 'Investments' },
      to: { objectId: companies, title: 'Investors' },
    };
    const first = await createRelationship(scope, input, [outboxHook({ mutationId: newId() })]);
    const rowsAfterFirst = (await definitionRows(scope)).length;
    const counted = await counts(scope);
    const again = await createRelationship(scope, input, [outboxHook({ mutationId: newId() })]);
    expect(again).toEqual(first);
    expect(await counts(scope)).toEqual(counted);
    expect((await definitionRows(scope)).length).toBe(rowsAfterFirst);
    // The same id with other ends, or from someone else, is another relationship's.
    expect(await refusalOf(createRelationship(scope, { ...input, cardinality: 'one_to_one' }))).toEqual({
      code: 'ID_TAKEN',
      message: 'A relationship with that id already exists.',
    });
    expect(
      await refusalOf(createRelationship(scope, { ...input, to: { objectId: people, title: 'Investors' } })),
    ).toMatchObject({ code: 'ID_TAKEN' });
    const admin = await memberIn(scope, 'admin');
    expect(await refusalOf(createRelationship(admin, input))).toMatchObject({ code: 'ID_TAKEN' });
  });

  it('refuses a member without schema.manage and writes nothing (AC-285)', async () => {
    const { scope, people, companies } = await workspace();
    const member = await memberIn(scope, 'member');
    const counted = await counts(scope);
    const rows = (await definitionRows(scope)).length;
    expect(
      await refusalOf(
        createRelationship(
          member,
          {
            id: newId(),
            cardinality: 'many_to_many',
            from: { objectId: people, title: 'Investments' },
            to: { objectId: companies, title: 'Investors' },
          },
          [outboxHook({ mutationId: newId() })],
        ),
      ),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await counts(scope)).toEqual(counted);
    expect((await definitionRows(scope)).length).toBe(rows);
  });

  it('makes only two way relationships with a client id (AC-286)', async () => {
    const { scope, people, companies } = await workspace();
    expect(
      await refusalOf(
        defineRelationship(scope, {
          id: newId(),
          cardinality: 'many_to_one',
          from: { objectId: people, apiSlug: 'employer', title: 'Employer' },
          targetObjectIds: [companies],
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(
      await refusalOf(
        defineRelationship(scope, {
          id: 'not-a-v7',
          cardinality: 'many_to_one',
          from: { objectId: people, apiSlug: 'employer', title: 'Employer' },
          to: { objectId: companies, apiSlug: 'staff', title: 'Staff' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });
});

describe('renaming a relationship (AC-307)', () => {
  it('renames both sides in one write, one definitions row per object, API names unchanged', async () => {
    const { scope, people, companies } = await workspace();
    const made = await createRelationship(scope, {
      id: newId(),
      cardinality: 'many_to_many',
      from: { objectId: people, title: 'Investments' },
      to: { objectId: companies, title: 'Investors' },
    });
    const mutationId = newId();
    const before = (await definitionRows(scope)).length;
    const renamed = await renameRelationship(
      scope,
      { relationshipId: made.relationshipId, fromTitle: 'Holdings', toTitle: ' Backers ' },
      [outboxHook({ mutationId })],
    );
    expect([renamed.from.title, renamed.from.apiSlug, renamed.to.title, renamed.to.apiSlug]).toEqual([
      'Holdings',
      'investments',
      'Backers',
      'investors',
    ]);
    expect(renamed.cardinality).toBe('many_to_many');
    const rows = (await definitionRows(scope)).slice(before);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.objectId).sort()).toEqual([people, companies].sort());
    // Names already as asked write nothing.
    await renameRelationship(scope, { relationshipId: made.relationshipId, fromTitle: 'Holdings' }, [
      outboxHook({ mutationId: newId() }),
    ]);
    expect((await definitionRows(scope)).length).toBe(before + 2);
  });

  it('keeps a self relationship’s names apart, and refuses archived, unknown and members', async () => {
    const { scope, people } = await workspace();
    const made = await createRelationship(scope, {
      id: newId(),
      cardinality: 'many_to_one',
      from: { objectId: people, title: 'Manager' },
      to: { objectId: people, title: 'Reports' },
    });
    expect(
      await refusalOf(renameRelationship(scope, { relationshipId: made.relationshipId, toTitle: 'manager' })),
    ).toEqual({ code: 'CONFIG_INVALID', message: 'Give each side its own name.', field: 'to.title' });
    expect(
      await refusalOf(renameRelationship(scope, { relationshipId: made.relationshipId, fromTitle: '' })),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'from.title' });
    const member = await memberIn(scope, 'member');
    expect(
      await refusalOf(renameRelationship(member, { relationshipId: made.relationshipId, fromTitle: 'Boss' })),
    ).toMatchObject({ code: 'FORBIDDEN' });
    expect(await refusalOf(renameRelationship(scope, { relationshipId: newId(), fromTitle: 'Boss' }))).toEqual({
      code: 'NOT_FOUND',
      message: 'That relationship does not exist.',
    });
    await archiveAttributes(scope, { attributeId: made.to.id });
    expect(
      await refusalOf(renameRelationship(scope, { relationshipId: made.relationshipId, fromTitle: 'Boss' })),
    ).toEqual({ code: 'NOT_FOUND', message: 'That relationship is archived. Restore it first.' });
  });
});

describe('archiving and restoring a relationship (AC-287)', () => {
  it('archives and restores both sides together, every link kept', async () => {
    const { scope, custom } = await workspace();
    const projects = await custom('Project', 'Projects');
    const clients = await custom('Client', 'Clients');
    const made = await createRelationship(scope, {
      id: newId(),
      cardinality: 'many_to_one',
      from: { objectId: projects, title: 'Client' },
      to: { objectId: clients, title: 'Projects' },
    });
    const { recordId: client } = await createRecord(scope, { objectId: clients });
    const { recordId: project } = await createRecord(scope, {
      objectId: projects,
      values: { [made.from.id]: { objectId: clients, recordId: client } },
    });
    const before = (await definitionRows(scope)).length;
    const archived = await archiveAttributes(scope, { attributeId: made.to.id }, [outboxHook({ mutationId: newId() })]);
    expect(archived.map((each) => [each.id, each.isArchived])).toEqual([
      [made.to.id, true],
      [made.from.id, true],
    ]);
    expect((await definitionRows(scope)).length - before).toBe(2);
    // Both columns leave the live lists.
    expect((await listObjectAttributes(scope, projects)).some((each) => each.id === made.from.id)).toBe(false);
    expect((await listObjectAttributes(scope, clients)).some((each) => each.id === made.to.id)).toBe(false);
    const restored = await restoreAttributes(scope, { attributeId: made.from.id });
    expect(restored.map((each) => each.isArchived)).toEqual([false, false]);
    const [readProject] = await getRecords(scope, { ids: [project], attributeIds: [made.from.id] });
    expect(readProject?.values[made.from.id]).toEqual({ objectId: clients, recordId: client });
    const [readClient] = await getRecords(scope, { ids: [client], attributeIds: [made.to.id] });
    expect(readClient?.values[made.to.id]).toEqual([{ objectId: projects, recordId: project }]);
  });

  it('refuses a restore while the other side’s object is archived', async () => {
    const { scope, custom } = await workspace();
    const projects = await custom('Project', 'Projects');
    const clients = await custom('Client', 'Clients');
    const made = await createRelationship(scope, {
      id: newId(),
      cardinality: 'many_to_many',
      from: { objectId: projects, title: 'Clients' },
      to: { objectId: clients, title: 'Projects' },
    });
    await archiveAttributes(scope, { attributeId: made.from.id });
    await archiveObject(scope, { objectId: clients });
    expect(await refusalOf(restoreAttributes(scope, { attributeId: made.from.id }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Restore Clients first.',
    });
    await restoreObject(scope, { objectId: clients });
    expect(await restoreAttributes(scope, { attributeId: made.from.id })).toHaveLength(2);
  });
});
