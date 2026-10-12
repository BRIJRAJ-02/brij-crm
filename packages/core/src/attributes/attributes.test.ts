// Attributes in settings (spec 0012, milestone 2) against a real Postgres as
// the app role: creating with a client id and replays, the API name rule,
// defaults, Required and Unique, moving among the object's own attributes,
// archiving and restoring (both ends of a relationship together), one
// definitions outbox row per object touched, and members refused.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, getRecords } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { archiveObject, createObject, restoreObject } from '../objects/objects.ts';
import { rescope, testScope } from '../testing.ts';
import {
  archiveAttributes,
  createAttribute,
  editAttribute,
  listObjectAttributes,
  moveAttribute,
  restoreAttributes,
} from './attributes.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-attributes-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Attributes',
    slug: `attributes-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  // A custom object, whose Name isn't required, for the tests that make records.
  const projects = (
    await createObject(scope, {
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
    })
  ).id;
  return { ...created, scope, people, companies, projects };
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

/** The definitions outbox rows stored since the workspace was made, as `objectId: attributeIds`. */
async function definitionRows(scope: EngineScope): Promise<{ objectId: string | null; attributeIds: string[] }[]> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ object_id: string | null; attribute_ids: string[] }>(
      sql`select object_id::text, attribute_ids::text[] from outbox where kind = 'definitions' order by seq`,
    ),
  );
  return result.rows.map((row) => ({ objectId: row.object_id, attributeIds: row.attribute_ids }));
}

const hooks = () => [outboxHook({ mutationId: newId() })];

describe('creating an attribute (AC-229, AC-244, AC-245)', () => {
  it('lands last, with its API name from the title, and stores one definitions row for its object', async () => {
    const { scope, people } = await workspace();
    const before = (await definitionRows(scope)).length;
    const made = await createAttribute(
      scope,
      { objectId: people, id: newId(), title: 'Café orders', type: 'text', description: 'Where they eat.' },
      hooks(),
    );
    expect(made).toMatchObject({
      apiSlug: 'cafe_orders',
      title: 'Café orders',
      description: 'Where they eat.',
      type: 'text',
      isArchived: false,
    });
    const listed = await listObjectAttributes(scope, people);
    expect(listed.at(-1)?.id).toBe(made.id);
    const rows = (await definitionRows(scope)).slice(before);
    expect(rows).toEqual([{ objectId: people, attributeIds: [made.id] }]);
  });

  it('answers a replay with the attribute already made and writes nothing twice', async () => {
    const { scope, people, companies } = await workspace();
    const id = newId();
    const before = (await definitionRows(scope)).length;
    const first = await createAttribute(scope, { objectId: people, id, title: 'Nickname', type: 'text' }, hooks());
    const again = await createAttribute(scope, { objectId: people, id, title: 'Nickname', type: 'text' }, hooks());
    expect(again).toEqual(first);
    expect((await definitionRows(scope)).length - before).toBe(1);
    // The same id on another object, or from someone else, is another attribute's.
    expect(
      await refusalOf(createAttribute(scope, { objectId: companies, id, title: 'Nickname', type: 'text' })),
    ).toEqual({ code: 'ID_TAKEN', message: 'An attribute with that id already exists.' });
    const admin = await memberIn(scope, 'admin');
    expect(
      await refusalOf(createAttribute(admin, { objectId: people, id, title: 'Nickname', type: 'text' })),
    ).toMatchObject({ code: 'ID_TAKEN' });
  });

  it('refuses a taken or malformed API name on its field, and an id that is not a UUID v7', async () => {
    const { scope, people } = await workspace();
    expect(
      await refusalOf(
        createAttribute(scope, {
          objectId: people,
          id: newId(),
          title: 'Mail',
          type: 'email',
          apiSlug: 'email_addresses',
        }),
      ),
    ).toMatchObject({ code: 'SLUG_TAKEN', field: 'apiSlug' });
    expect(
      await refusalOf(
        createAttribute(scope, { objectId: people, id: newId(), title: 'Mail', type: 'email', apiSlug: 'Mail!' }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'apiSlug' });
    expect(
      await refusalOf(
        createAttribute(scope, {
          objectId: people,
          id: '0199d6a4-0000-4000-8000-000000000002',
          title: 'Mail',
          type: 'email',
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('takes each of the ten types without setup, with Allow multiple where offered', async () => {
    const { scope, people } = await workspace();
    const types = [
      ['text', false],
      ['long_text', false],
      ['date', false],
      ['checkbox', false],
      ['rating', false],
      ['email', true],
      ['phone', true],
      ['url', false],
      ['location', false],
      ['actor_reference', true],
    ] as const;
    for (const [type, isMulti] of types) {
      const made = await createAttribute(scope, { objectId: people, id: newId(), title: `A ${type}`, type, isMulti });
      expect(made).toMatchObject({ type, isMulti });
    }
  });

  it('applies a default to a create that leaves the attribute out: a member, a date offset, a static value (AC-234)', async () => {
    const { scope, projects: people, memberId } = await workspace();
    const owner = await createAttribute(scope, {
      objectId: people,
      id: newId(),
      title: 'Owner',
      type: 'actor_reference',
      defaultValue: { kind: 'current_user' },
    });
    const due = await createAttribute(scope, {
      objectId: people,
      id: newId(),
      title: 'Follow up',
      type: 'date',
      defaultValue: { kind: 'offset', duration: 'P7D' },
    });
    const tier = await createAttribute(scope, {
      objectId: people,
      id: newId(),
      title: 'Tier',
      type: 'text',
      defaultValue: { kind: 'static', value: 'Gold' },
    });
    expect(due.defaultValue).toEqual({ kind: 'offset', duration: 'P7D' });
    const { recordId } = await createRecord(scope, { objectId: people, timeZone: 'Europe/London' });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[owner.id]).toMatchObject({ type: 'member', id: memberId });
    expect(record?.values[tier.id]).toBe('Gold');
    expect(typeof record?.values[due.id]).toBe('string');
    // A cleared default gives nothing.
    await editAttribute(scope, { attributeId: tier.id, defaultValue: null });
    const { recordId: plain } = await createRecord(scope, { objectId: people });
    const [cleared] = await getRecords(scope, { ids: [plain] });
    expect(cleared?.values[tier.id] ?? null).toBeNull();
  });

  it('refuses a default the type cannot take on the default field', async () => {
    const { scope, people } = await workspace();
    expect(
      await refusalOf(
        createAttribute(scope, {
          objectId: people,
          id: newId(),
          title: 'Score',
          type: 'rating',
          defaultValue: { kind: 'static', value: 9 },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'defaultValue' });
  });
});

describe('editing an attribute (AC-231, AC-235)', () => {
  it('changes the title and clears the description; a system attribute is read only', async () => {
    const { scope, people } = await workspace();
    const made = await createAttribute(scope, {
      objectId: people,
      id: newId(),
      title: 'Nick',
      type: 'text',
      description: 'Short name',
    });
    const edited = await editAttribute(scope, { attributeId: made.id, title: 'Nickname', description: null });
    expect(edited).toMatchObject({ title: 'Nickname', apiSlug: 'nick' });
    expect(edited.description).toBeUndefined();
    const system = (await listObjectAttributes(scope, people)).find((each) => each.isSystem);
    expect(await refusalOf(editAttribute(scope, { attributeId: system?.id ?? '', title: 'When' }))).toMatchObject({
      code: 'ATTRIBUTE_READ_ONLY',
    });
  });

  it('refuses Unique while values repeat, and changes nothing', async () => {
    const { scope, projects: people } = await workspace();
    const code = await createAttribute(scope, { objectId: people, id: newId(), title: 'Code', type: 'text' });
    await createRecord(scope, { objectId: people, values: { [code.id]: 'A1' } });
    await createRecord(scope, { objectId: people, values: { [code.id]: 'A1' } });
    expect(await refusalOf(editAttribute(scope, { attributeId: code.id, isUnique: true }))).toMatchObject({
      code: 'UNIQUE_HAS_DUPLICATES',
    });
    const [after] = (await listObjectAttributes(scope, people)).filter((each) => each.id === code.id);
    expect(after?.isUnique).toBe(false);
  });

  it('refuses a create without a required value', async () => {
    const { scope, projects: people } = await workspace();
    const code = await createAttribute(scope, {
      objectId: people,
      id: newId(),
      title: 'Code',
      type: 'text',
      isRequired: true,
    });
    expect(await refusalOf(createRecord(scope, { objectId: people }))).toMatchObject({
      code: 'VALUE_REQUIRED',
      attributeId: code.id,
    });
  });
});

describe('moving an attribute (AC-232)', () => {
  it('moves among the object’s own attributes, after the system ones, archived ones keeping their place', async () => {
    const { scope, people } = await workspace();
    const a = await createAttribute(scope, { objectId: people, id: newId(), title: 'Alpha', type: 'text' });
    const b = await createAttribute(scope, { objectId: people, id: newId(), title: 'Beta', type: 'text' });
    await archiveAttributes(scope, { attributeId: a.id });
    const moved = await moveAttribute(scope, { attributeId: b.id, position: 0 }, hooks());
    const own = moved.filter((each) => !each.isSystem);
    expect(own[0]?.id).toBe(b.id);
    const system = moved.filter((each) => each.isSystem);
    expect(Math.max(...system.map((each) => each.position))).toBeLessThan(own[0]?.position ?? -1);
    expect(own.map((each) => each.position)).toEqual(own.map((_, index) => system.length + index));
    // The archived one kept its place among the rest.
    expect(own.some((each) => each.id === a.id && each.isArchived)).toBe(true);
    // A system attribute never moves.
    expect(await refusalOf(moveAttribute(scope, { attributeId: system[0]?.id ?? '', position: 3 }))).toMatchObject({
      code: 'ATTRIBUTE_READ_ONLY',
    });
  });
});

describe('archiving and restoring (AC-233)', () => {
  it('archives and restores an attribute at its place; the primary attribute never archives', async () => {
    const { scope, people } = await workspace();
    const made = await createAttribute(scope, { objectId: people, id: newId(), title: 'Nickname', type: 'text' });
    const archived = await archiveAttributes(scope, { attributeId: made.id }, hooks());
    expect(archived).toMatchObject([{ id: made.id, isArchived: true }]);
    expect((await listObjectAttributes(scope, people)).some((each) => each.id === made.id)).toBe(false);
    const restored = await restoreAttributes(scope, { attributeId: made.id }, hooks());
    expect(restored).toMatchObject([{ id: made.id, isArchived: false, position: made.position }]);
    const primary = (await listObjectAttributes(scope, people)).find((each) => each.isPrimary);
    expect(await refusalOf(archiveAttributes(scope, { attributeId: primary?.id ?? '' }))).toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('archives both ends of a relationship in one write, one definitions row per object', async () => {
    const { scope, people, companies } = await workspace();
    const company = (await listObjectAttributes(scope, people)).find((each) => each.apiSlug === 'company');
    const team = (await listObjectAttributes(scope, companies)).find((each) => each.apiSlug === 'team');
    const before = (await definitionRows(scope)).length;
    const archived = await archiveAttributes(scope, { attributeId: company?.id ?? '' }, hooks());
    expect(archived.map((each) => [each.id, each.isArchived])).toEqual([
      [company?.id, true],
      [team?.id, true],
    ]);
    const rows = (await definitionRows(scope)).slice(before);
    expect(rows.map((row) => row.objectId).sort()).toEqual([people, companies].sort());
    const restored = await restoreAttributes(scope, { attributeId: team?.id ?? '' }, hooks());
    expect(restored.map((each) => [each.id, each.isArchived])).toEqual([
      [team?.id, false],
      [company?.id, false],
    ]);
  });

  it('refuses to restore an end while the far end’s object is archived', async () => {
    const { scope, people, companies } = await workspace();
    const company = (await listObjectAttributes(scope, people)).find((each) => each.apiSlug === 'company');
    await archiveAttributes(scope, { attributeId: company?.id ?? '' });
    await archiveObject(scope, { objectId: companies });
    expect(await refusalOf(restoreAttributes(scope, { attributeId: company?.id ?? '' }))).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Restore Companies first.',
    });
    await restoreObject(scope, { objectId: companies });
    expect(await restoreAttributes(scope, { attributeId: company?.id ?? '' })).toHaveLength(2);
  });

  it('refuses to restore a unique attribute whose values now repeat', async () => {
    const { scope, projects: people } = await workspace();
    const code = await createAttribute(scope, { objectId: people, id: newId(), title: 'Code', type: 'text' });
    await createRecord(scope, { objectId: people, values: { [code.id]: 'A1' } });
    await createRecord(scope, { objectId: people, values: { [code.id]: 'A1' } });
    await archiveAttributes(scope, { attributeId: code.id });
    // Unique while archived (its keys fill as it is restored), with values that now repeat.
    await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute(sql`update attributes set is_unique = true where id = ${code.id}`),
    );
    expect(await refusalOf(restoreAttributes(scope, { attributeId: code.id }))).toMatchObject({
      code: 'UNIQUE_HAS_DUPLICATES',
    });
  });
});

describe('under rules that hide an object (spec 0009, AC-140)', () => {
  it('archives and restores an end whose far object is hidden, answering only the end the caller sees', async () => {
    const { scope, people, companies } = await workspace();
    const admin = await memberIn(scope, 'admin');
    const hiding = rescope(admin, {
      rules: {
        levels: [
          { subject: { type: 'role', role: 'admin' }, target: { type: 'object', objectId: companies }, level: 'none' },
        ],
        records: [],
      },
    });
    const company = (await listObjectAttributes(scope, people)).find((each) => each.apiSlug === 'company');
    const archived = await archiveAttributes(hiding, { attributeId: company?.id ?? '' });
    expect(archived.map((each) => [each.id, each.isArchived])).toEqual([[company?.id, true]]);
    const restored = await restoreAttributes(hiding, { attributeId: company?.id ?? '' });
    expect(restored.map((each) => [each.id, each.isArchived])).toEqual([[company?.id, false]]);
    // Both ends moved together all the same.
    const team = (await listObjectAttributes(scope, companies)).find((each) => each.apiSlug === 'team');
    expect(team?.isArchived).toBe(false);
  });
});

describe('defaults that would break record creation', () => {
  it('refuses an offset past 3,650 days and a member default naming no member here', async () => {
    const { scope, projects } = await workspace();
    expect(
      await refusalOf(
        createAttribute(scope, {
          objectId: projects,
          id: newId(),
          title: 'Far',
          type: 'date',
          defaultValue: { kind: 'offset', duration: 'P999999Y' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'defaultValue' });
    expect(
      await refusalOf(
        createAttribute(scope, {
          objectId: projects,
          id: newId(),
          title: 'Lead',
          type: 'actor_reference',
          defaultValue: { kind: 'static', value: { type: 'member', id: newId() } },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'defaultValue' });
    const lead = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Lead',
      type: 'actor_reference',
    });
    expect(
      await refusalOf(
        editAttribute(scope, {
          attributeId: lead.id,
          defaultValue: { kind: 'static', value: { type: 'member', id: newId() } },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', field: 'defaultValue' });
  });
});

describe('permission (AC-242)', () => {
  it('refuses every write to a member, writing no row and no outbox row', async () => {
    const { scope, people } = await workspace();
    const made = await createAttribute(scope, { objectId: people, id: newId(), title: 'Nickname', type: 'text' });
    const member = await memberIn(scope, 'member');
    const before = (await definitionRows(scope)).length;
    const calls = [
      createAttribute(member, { objectId: people, id: newId(), title: 'Other', type: 'text' }, hooks()),
      editAttribute(member, { attributeId: made.id, title: 'Nick' }, hooks()),
      moveAttribute(member, { attributeId: made.id, position: 0 }, hooks()),
      archiveAttributes(member, { attributeId: made.id }, hooks()),
      restoreAttributes(member, { attributeId: made.id }, hooks()),
    ];
    for (const call of calls) expect(await refusalOf(call)).toMatchObject({ code: 'FORBIDDEN' });
    expect((await definitionRows(scope)).length).toBe(before);
  });
});
