// Options in settings and from a cell (spec 0012, milestone 3) against a real
// Postgres as the app role: an attribute made with its first options, options
// made with a client id and replays, the next hue, labels unique among live
// options, the 500 live options limit on create and restore, moves, archived
// options refused for new values, an archived default, one definitions row
// per write, members refused, and `newOption` in a record write.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, getRecords, setRecordValues, setValuesBatch } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createObject } from '../objects/objects.ts';
import { rescope, testScope } from '../testing.ts';
import { createAttribute, editAttribute, listObjectAttributes } from './attributes.ts';
import { archiveOption, createOption, editOption, moveOption, restoreOption } from './options.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-options-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Options',
    slug: `options-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  // A custom object whose Name isn't required, so records need no values.
  const projects = (
    await createObject(scope, {
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
    })
  ).id;
  return { ...created, scope, projects };
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

/** The outbox rows stored since the workspace was made, as `kind objectId: attributeIds`. */
async function outboxRows(
  scope: EngineScope,
): Promise<{ kind: string; objectId: string | null; attributeIds: string[] }[]> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ kind: string; object_id: string | null; attribute_ids: string[] }>(
      sql`select kind, object_id::text, attribute_ids::text[] from outbox order by seq`,
    ),
  );
  return result.rows.map((row) => ({ kind: row.kind, objectId: row.object_id, attributeIds: row.attribute_ids }));
}

/** How many options an attribute holds, archived ones included. */
async function optionCount(scope: EngineScope, attributeId: string): Promise<number> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ n: number }>(
      sql`select count(*)::int as n from attribute_options where attribute_id = ${attributeId}`,
    ),
  );
  return result.rows[0]?.n ?? 0;
}

const hooks = () => [outboxHook({ mutationId: newId() })];

/** A select attribute on `objectId` with options labelled `labels`, in order. */
async function selectWith(scope: EngineScope, objectId: string, labels: readonly string[], extra = {}) {
  return createAttribute(scope, {
    objectId,
    id: newId(),
    title: 'Tier',
    type: 'select',
    options: labels.map((label, index) => ({ id: newId(), label, hue: index % 2 === 0 ? 'gray' : 'blue' })),
    ...extra,
  });
}

describe('an attribute made with its first options (AC-230)', () => {
  it('makes a status with its stages in order, outcomes kept, in one write and one definitions row', async () => {
    const { scope, projects } = await workspace();
    const before = (await outboxRows(scope)).length;
    const stages = [
      { id: newId(), label: 'Not started', hue: 'gray' as const, outcome: 'open' as const },
      { id: newId(), label: 'In progress', hue: 'blue' as const, outcome: 'open' as const, targetTimeInStage: 'P7D' },
      { id: newId(), label: 'Done', hue: 'green' as const, outcome: 'won' as const },
    ];
    const status = await createAttribute(
      scope,
      { objectId: projects, id: newId(), title: 'Stage', type: 'status', options: stages },
      hooks(),
    );
    expect(status.options).toEqual([
      { id: stages[0]?.id, label: 'Not started', hue: 'gray', position: 0, isArchived: false, outcome: 'open' },
      {
        id: stages[1]?.id,
        label: 'In progress',
        hue: 'blue',
        position: 1,
        isArchived: false,
        outcome: 'open',
        targetTimeInStage: 'P7D',
      },
      { id: stages[2]?.id, label: 'Done', hue: 'green', position: 2, isArchived: false, outcome: 'won' },
    ]);
    expect((await outboxRows(scope)).slice(before)).toEqual([
      { kind: 'definitions', objectId: projects, attributeIds: [status.id] },
    ]);
  });

  it('refuses options on a type that takes none, two labels alike, and more than the limit', async () => {
    const { scope, projects } = await workspace();
    expect(
      await refusalOf(
        createAttribute(scope, {
          objectId: projects,
          id: newId(),
          title: 'Code',
          type: 'text',
          options: [{ id: newId(), label: 'A', hue: 'gray' }],
        }),
      ),
    ).toEqual({ code: 'CONFIG_INVALID', message: 'Only select and status attributes have options.', field: 'options' });
    expect(await refusalOf(selectWith(scope, projects, ['Gold', 'gold']))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'Two options are called gold. Give each its own label.',
      field: 'options',
    });
    const small = rescope(scope, { limits: { optionsPerAttribute: 2 } });
    expect(await refusalOf(selectWith(small, projects, ['A', 'B', 'C']))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'An attribute holds at most 2 options.',
    });
    // Nothing was made by any of them.
    expect((await listObjectAttributes(scope, projects, { includeArchived: true })).map((each) => each.title)).toEqual([
      'Record ID',
      'Created at',
      'Created by',
      'Updated at',
      'Updated by',
      'Name',
    ]);
  });
});

describe('creating an option (AC-236, AC-244)', () => {
  it('lands last with the next hue, and a replay answers the option already made', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver', 'Platinum']);
    const id = newId();
    const before = (await outboxRows(scope)).length;
    const gold = await createOption(scope, { attributeId: tier.id, id, label: ' Gold ' }, hooks());
    // The last option is blue; the next hue in HUES order follows it.
    expect(gold).toEqual({ id, label: 'Gold', hue: 'purple', position: 2, isArchived: false });
    const again = await createOption(scope, { attributeId: tier.id, id, label: 'Gold' }, hooks());
    expect(again).toEqual(gold);
    expect((await outboxRows(scope)).slice(before)).toEqual([
      { kind: 'definitions', objectId: projects, attributeIds: [tier.id] },
    ]);
    // The same id on another attribute, or from someone else, is another option's.
    const level = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Level', type: 'select' });
    expect(await refusalOf(createOption(scope, { attributeId: level.id, id, label: 'Gold' }))).toEqual({
      code: 'ID_TAKEN',
      message: 'An option with that id already exists.',
    });
    const admin = await memberIn(scope, 'admin');
    expect(await refusalOf(createOption(admin, { attributeId: tier.id, id, label: 'Gold' }))).toMatchObject({
      code: 'ID_TAKEN',
    });
  });

  it('starts a status stage open, and the first option of all gray', async () => {
    const { scope, projects } = await workspace();
    const stage = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Stage', type: 'status' });
    const first = await createOption(scope, { attributeId: stage.id, id: newId(), label: 'Lead' });
    expect(first).toMatchObject({ label: 'Lead', hue: 'gray', outcome: 'open' });
  });

  it('refuses a label a live option holds (ignoring case) on the label, but not an archived one’s', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver', 'Platinum']);
    expect(await refusalOf(createOption(scope, { attributeId: tier.id, id: newId(), label: 'SILVER' }))).toEqual({
      code: 'CONFIG_INVALID',
      message: 'An option with that label already exists. Pick another label.',
      field: 'label',
    });
    await archiveOption(scope, { optionId: tier.options?.[0]?.id ?? '' });
    await expect(createOption(scope, { attributeId: tier.id, id: newId(), label: 'Silver' })).resolves.toMatchObject({
      label: 'Silver',
    });
  });

  it('refuses the 501st live option, and a restore while the attribute is full (AC-237)', async () => {
    const { scope, projects } = await workspace();
    const small = rescope(scope, { limits: { optionsPerAttribute: 2 } });
    const tier = await selectWith(small, projects, ['Silver', 'Platinum']);
    expect(await refusalOf(createOption(small, { attributeId: tier.id, id: newId(), label: 'Gold' }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'An attribute holds at most 2 options.',
    });
    // Archived options don't count: one archived makes room, and its restore then has none.
    const silver = tier.options?.[0]?.id ?? '';
    await archiveOption(small, { optionId: silver });
    await createOption(small, { attributeId: tier.id, id: newId(), label: 'Gold' });
    expect(await refusalOf(restoreOption(small, { optionId: silver }))).toEqual({
      code: 'LIMIT_REACHED',
      message: 'An attribute holds at most 2 options.',
    });
    expect(await optionCount(scope, tier.id)).toBe(3);
  });

  it('refuses a member, writing nothing', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const member = await memberIn(scope, 'member');
    const before = (await outboxRows(scope)).length;
    const optionId = tier.options?.[0]?.id ?? '';
    for (const call of [
      () => createOption(member, { attributeId: tier.id, id: newId(), label: 'Gold' }, hooks()),
      () => editOption(member, { optionId, label: 'Gold' }, hooks()),
      () => moveOption(member, { optionId, position: 0 }, hooks()),
      () => archiveOption(member, { optionId }, hooks()),
      () => restoreOption(member, { optionId }, hooks()),
    ]) {
      expect(await refusalOf(call())).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await outboxRows(scope)).length).toBe(before);
    expect(await optionCount(scope, tier.id)).toBe(1);
  });
});

describe('changing, moving, archiving and restoring options (AC-236)', () => {
  it('renames, recolours and sets a stage’s outcome and target, and clears the target', async () => {
    const { scope, projects } = await workspace();
    const stage = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Stage',
      type: 'status',
      options: [{ id: newId(), label: 'Lead', hue: 'gray' }],
    });
    const optionId = stage.options?.[0]?.id ?? '';
    expect(
      await editOption(scope, {
        optionId,
        label: 'Qualified',
        hue: 'green',
        outcome: 'won',
        targetTimeInStage: 'P14D',
      }),
    ).toMatchObject({ label: 'Qualified', hue: 'green', outcome: 'won', targetTimeInStage: 'P14D' });
    const cleared = await editOption(scope, { optionId, targetTimeInStage: null });
    expect(cleared.targetTimeInStage).toBeUndefined();
    // A select's option takes no outcome.
    const tier = await selectWith(scope, projects, ['Silver']);
    expect(await refusalOf(editOption(scope, { optionId: tier.options?.[0]?.id ?? '', outcome: 'won' }))).toMatchObject(
      { code: 'CONFIG_INVALID' },
    );
  });

  it('moves an option and answers the order, archived ones counted', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['A', 'B', 'C']);
    const [a, b, c] = (tier.options ?? []).map((option) => option.id);
    await archiveOption(scope, { optionId: b ?? '' });
    const order = await moveOption(scope, { optionId: c ?? '', position: 0 });
    expect(order.map((option) => [option.id, option.position, option.isArchived])).toEqual([
      [c, 0, false],
      [a, 1, false],
      [b, 2, true],
    ]);
  });

  it('keeps an archived option on the values that hold it and refuses it for new ones', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver', 'Gold']);
    const silver = tier.options?.[0]?.id ?? '';
    const { recordId } = await createRecord(scope, { objectId: projects, values: { [tier.id]: silver } });
    const archived = await archiveOption(scope, { optionId: silver });
    expect(archived.isArchived).toBe(true);
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[tier.id]).toBe(silver);
    expect(await refusalOf(createRecord(scope, { objectId: projects, values: { [tier.id]: silver } }))).toMatchObject({
      code: 'OPTION_ARCHIVED',
    });
    // Restored, it is chosen again.
    await restoreOption(scope, { optionId: silver });
    await expect(createRecord(scope, { objectId: projects, values: { [tier.id]: silver } })).resolves.toBeDefined();
  });

  it('refuses restoring an option whose label a live one took meanwhile, on the label', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const silver = tier.options?.[0]?.id ?? '';
    await archiveOption(scope, { optionId: silver });
    await createOption(scope, { attributeId: tier.id, id: newId(), label: 'silver' });
    expect(await refusalOf(restoreOption(scope, { optionId: silver }))).toMatchObject({
      code: 'CONFIG_INVALID',
      field: 'label',
    });
  });

  it('keeps an archived default stored: a required select gets the first live option, and a restore brings it back', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver', 'Gold']);
    const [silver, gold] = (tier.options ?? []).map((option) => option.id);
    await editAttribute(scope, {
      attributeId: tier.id,
      isRequired: true,
      defaultValue: { kind: 'static', value: gold ?? '' },
    });
    await archiveOption(scope, { optionId: gold ?? '' });
    const [definition] = (await listObjectAttributes(scope, projects)).filter((each) => each.id === tier.id);
    expect(definition?.defaultValue).toEqual({ kind: 'static', value: gold });
    const first = await createRecord(scope, { objectId: projects });
    expect((await getRecords(scope, { ids: [first.recordId] }))[0]?.values[tier.id]).toBe(silver);
    await restoreOption(scope, { optionId: gold ?? '' });
    const second = await createRecord(scope, { objectId: projects });
    expect((await getRecords(scope, { ids: [second.recordId] }))[0]?.values[tier.id]).toBe(gold);
  });
});

describe('creating an option from a cell (AC-238)', () => {
  it('makes the option and sets it in one write: one records row and one definitions row', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const { recordId } = await createRecord(scope, { objectId: projects });
    const id = newId();
    const before = (await outboxRows(scope)).length;
    const { results } = await setRecordValues(
      scope,
      { recordId, values: { [tier.id]: { value: { newOption: { id, label: ' Gold ' } } } } },
      hooks(),
    );
    expect(results[tier.id]?.versionId).toBeDefined();
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[tier.id]).toBe(id);
    const [definition] = (await listObjectAttributes(scope, projects)).filter((each) => each.id === tier.id);
    expect(definition?.options?.at(-1)).toEqual({ id, label: 'Gold', hue: 'red', position: 1, isArchived: false });
    const rows = (await outboxRows(scope)).slice(before);
    expect(rows.map((row) => row.kind).sort()).toEqual(['definitions', 'records']);
    expect(rows.find((row) => row.kind === 'definitions')).toEqual({
      kind: 'definitions',
      objectId: projects,
      attributeIds: [tier.id],
    });
  });

  it('sets a live option with that label (ignoring case) instead of making one, and a replay makes none', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const silver = tier.options?.[0]?.id ?? '';
    const { recordId } = await createRecord(scope, { objectId: projects });
    const before = (await outboxRows(scope)).length;
    await setRecordValues(
      scope,
      { recordId, values: { [tier.id]: { value: { newOption: { id: newId(), label: 'SILVER' } } } } },
      hooks(),
    );
    expect((await getRecords(scope, { ids: [recordId] }))[0]?.values[tier.id]).toBe(silver);
    expect(await optionCount(scope, tier.id)).toBe(1);
    expect((await outboxRows(scope)).slice(before).map((row) => row.kind)).toEqual(['records']);
    // The same new option twice (a lost answer): the second finds the first's option.
    const id = newId();
    const value = { [tier.id]: { value: { newOption: { id, label: 'Gold' } } } };
    await setRecordValues(scope, { recordId, values: value });
    await setRecordValues(scope, { recordId, values: value });
    expect(await optionCount(scope, tier.id)).toBe(2);
  });

  it('adds a new option to a multi select’s list, and starts a status stage open', async () => {
    const { scope, projects } = await workspace();
    const tags = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Tags',
      type: 'select',
      isMulti: true,
      options: [{ id: newId(), label: 'Fintech', hue: 'gray' }],
    });
    const fintech = tags.options?.[0]?.id ?? '';
    const stage = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Stage', type: 'status' });
    const { recordId } = await createRecord(scope, { objectId: projects });
    const ai = newId();
    const lead = newId();
    await setRecordValues(scope, {
      recordId,
      values: {
        [tags.id]: { value: [fintech, { newOption: { id: ai, label: 'AI' } }] },
        [stage.id]: { value: { newOption: { id: lead, label: 'Lead' } } },
      },
    });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[tags.id]).toEqual([fintech, ai]);
    expect(record?.values[stage.id]).toBe(lead);
    const [listedStage] = (await listObjectAttributes(scope, projects)).filter((each) => each.id === stage.id);
    expect(listedStage?.options).toEqual([
      { id: lead, label: 'Lead', hue: 'gray', position: 0, isArchived: false, outcome: 'open' },
    ]);
  });

  it('refuses a full attribute and leaves no option behind, and the value with it', async () => {
    const { scope, projects } = await workspace();
    const small = rescope(scope, { limits: { optionsPerAttribute: 1 } });
    const tier = await selectWith(small, projects, ['Silver']);
    const { recordId } = await createRecord(small, { objectId: projects });
    expect(
      await refusalOf(
        setRecordValues(small, {
          recordId,
          values: { [tier.id]: { value: { newOption: { id: newId(), label: 'Gold' } } } },
        }),
      ),
    ).toEqual({ code: 'LIMIT_REACHED', message: 'An attribute holds at most 1 options.' });
    expect(await optionCount(scope, tier.id)).toBe(1);
    expect((await getRecords(scope, { ids: [recordId] }))[0]?.values[tier.id]).toBeNull();
  });

  it('refuses a member FORBIDDEN, writing nothing, and a batch the new option', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const { recordId } = await createRecord(scope, { objectId: projects });
    const member = await memberIn(scope, 'member');
    const before = (await outboxRows(scope)).length;
    const values = { [tier.id]: { value: { newOption: { id: newId(), label: 'Gold' } } } };
    expect(await refusalOf(setRecordValues(member, { recordId, values }, hooks()))).toEqual({
      code: 'FORBIDDEN',
      message: 'Only workspace owners and admins can change objects and attributes.',
    });
    expect((await outboxRows(scope)).length).toBe(before);
    expect(await optionCount(scope, tier.id)).toBe(1);
    // A batch never makes options: the value is refused as one it can't take.
    const [outcome] = await setValuesBatch(scope, { items: [{ recordId, values }] });
    expect(outcome).toMatchObject({ ok: false, refusals: [{ code: 'ATTRIBUTE_VALUE_INVALID' }] });
    expect(await optionCount(scope, tier.id)).toBe(1);
  });

  it('refuses a malformed new option on its attribute', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const { recordId } = await createRecord(scope, { objectId: projects });
    expect(
      await refusalOf(
        setRecordValues(scope, {
          recordId,
          values: { [tier.id]: { value: { newOption: { id: newId(), label: ' ' } } } },
        }),
      ),
    ).toEqual({
      code: 'ATTRIBUTE_VALUE_INVALID',
      message: 'Give the new Tier option a label of 1 to 100 characters.',
      attributeId: tier.id,
    });
  });

  it('refuses more than one new option in a multi select’s list', async () => {
    const { scope, projects } = await workspace();
    const tags = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Tags',
      type: 'select',
      isMulti: true,
    });
    const { recordId } = await createRecord(scope, { objectId: projects });
    const two = [{ newOption: { id: newId(), label: 'A' } }, { newOption: { id: newId(), label: 'B' } }];
    expect(await refusalOf(setRecordValues(scope, { recordId, values: { [tags.id]: { value: two } } }))).toEqual({
      code: 'ATTRIBUTE_VALUE_INVALID',
      message: 'Create one new Tags option at a time.',
      attributeId: tags.id,
    });
    expect(await optionCount(scope, tags.id)).toBe(0);
  });
});

describe('options under field rules: hidden means absent (spec 0009, AC-141)', () => {
  /** An admin (schema.manage) whose rules hide one select and leave another read only, on Projects. */
  async function ruled() {
    const { scope, projects } = await workspace();
    const secret = await selectWith(scope, projects, ['Silver']);
    const level = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Level',
      type: 'select',
      options: [{ id: newId(), label: 'One', hue: 'gray' }],
    });
    const admin = await memberIn(scope, 'admin');
    const rule = (attributeId: string, field: 'hidden' | 'read') => ({
      subject: { type: 'role' as const, role: 'admin' },
      target: { type: 'attribute' as const, objectId: projects, attributeId },
      level: field,
    });
    const limited = rescope(admin, {
      rules: { levels: [rule(secret.id, 'hidden'), rule(level.id, 'read')], records: [] },
    });
    return { scope, projects, secret, level, limited };
  }

  it('answers every option write on a hidden attribute NOT_FOUND, writing nothing', async () => {
    const { scope, secret, limited } = await ruled();
    const optionId = secret.options?.[0]?.id ?? '';
    const before = (await outboxRows(scope)).length;
    for (const call of [
      () => createOption(limited, { attributeId: secret.id, id: newId(), label: 'Gold' }, hooks()),
      () => editOption(limited, { optionId, label: 'Gold' }, hooks()),
      () => moveOption(limited, { optionId, position: 0 }, hooks()),
      () => archiveOption(limited, { optionId }, hooks()),
      () => restoreOption(limited, { optionId }, hooks()),
    ]) {
      expect(await refusalOf(call())).toMatchObject({ code: 'NOT_FOUND' });
    }
    expect((await outboxRows(scope)).length).toBe(before);
    expect(await optionCount(scope, secret.id)).toBe(1);
  });

  it('leaves no option behind for a new option on a hidden or read only field', async () => {
    const { scope, projects, secret, level, limited } = await ruled();
    const { recordId } = await createRecord(scope, { objectId: projects });
    const make = (attributeId: string, label: string) =>
      setRecordValues(limited, {
        recordId,
        values: { [attributeId]: { value: { newOption: { id: newId(), label } } } },
      });
    expect(await refusalOf(make(secret.id, 'Gold'))).toMatchObject({ code: 'NOT_FOUND' });
    expect(await refusalOf(make(level.id, 'Two'))).toMatchObject({ code: 'ATTRIBUTE_READ_ONLY' });
    expect(await optionCount(scope, secret.id)).toBe(1);
    expect(await optionCount(scope, level.id)).toBe(1);
  });

  it('stores no definitions row for archiving an archived option', async () => {
    const { scope, projects } = await workspace();
    const tier = await selectWith(scope, projects, ['Silver']);
    const optionId = tier.options?.[0]?.id ?? '';
    await archiveOption(scope, { optionId }, hooks());
    const before = (await outboxRows(scope)).length;
    await archiveOption(scope, { optionId }, hooks());
    expect((await outboxRows(scope)).length).toBe(before);
  });
});
