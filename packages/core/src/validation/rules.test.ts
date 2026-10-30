// Validation rules in the engine (spec 0013, milestone 1) against a real
// Postgres as the app role: rule writes inside an attribute's create and
// edit (replace semantics, versions, rule counts, the 20 rule limit, the
// settings refusals, members refused), and the touched rule check on every
// record write (refusals with rule ids, nothing written, only the touched
// rules, never retroactive, a batch refusing one record, a parse refusal
// first, a rule saved while a write waits, two writes that break a rule
// together), the definitions event, and RE2's linear time.
import { sql } from 'drizzle-orm';
import type { ValidationRuleInput } from '@crm/contracts/values';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, schema, type Database } from '@crm/db';
import { newId } from '../engine/ids.ts';
import { outboxHook } from '../engine/outbox.ts';
import { createRecord, getRecords, setRecordValues, setValuesBatch } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createAttribute, editAttribute, listObjectAttributes } from '../attributes/attributes.ts';
import { createObject } from '../objects/objects.ts';
import { rescope, testScope } from '../testing.ts';
import { compilePattern } from './pattern.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-rules-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;

/** A workspace with a Deals object: Code (text), Email (several), Stage (status), Amount (number) and Phone. */
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Rules',
    slug: `rules-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const objectId = (
    await createObject(scope, {
      id: newId(),
      singularName: 'Contract',
      pluralName: 'Contracts',
      icon: 'box',
      hue: 'blue',
    })
  ).id;
  const attribute = (title: string, type: Parameters<typeof createAttribute>[1]['type'], extra = {}) =>
    createAttribute(scope, { objectId, id: newId(), title, type, ...extra });
  const won = newId();
  const open = newId();
  const code = await attribute('Code', 'text');
  const email = await attribute('Email', 'email', { isMulti: true });
  const stage = await attribute('Stage', 'status', {
    options: [
      { id: open, label: 'Open', hue: 'gray', outcome: 'open' },
      { id: won, label: 'Won', hue: 'green', outcome: 'won' },
    ],
  });
  const amount = await attribute('Amount', 'number');
  const phone = await attribute('Phone', 'phone');
  return { ...created, scope, objectId, code, email, stage, amount, phone, won, open };
}

type Fixture = Awaited<ReturnType<typeof workspace>>;

const rule = (
  kind: ValidationRuleInput['kind'],
  params: Record<string, unknown>,
  extra: Partial<ValidationRuleInput> = {},
): ValidationRuleInput => ({
  id: newId(),
  kind,
  params,
  ...extra,
});

async function refusalsOf(call: Promise<unknown>) {
  try {
    await call;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('It was let through.');
}

async function ruleCounts(scope: EngineScope, ids: readonly string[]): Promise<Record<string, [number, number]>> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; rule_count: number; rules_version: number }>(
      sql`select id::text, rule_count, rules_version from attributes where id = any(${`{${ids.join(',')}}`}::uuid[])`,
    ),
  );
  return Object.fromEntries(result.rows.map((row) => [row.id, [row.rule_count, row.rules_version]]));
}

async function outboxRows(scope: EngineScope) {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ kind: string; attribute_ids: string[] | null }>(
      sql`select kind, attribute_ids::text[] from outbox order by seq`,
    ),
  );
  return result.rows;
}

/** A record of the Deals object, made before any rule exists. */
async function deal(w: Fixture, values: Record<string, unknown> = {}) {
  return (await createRecord(w.scope, { objectId: w.objectId, id: newId(), values })).recordId;
}

describe('rule writes', () => {
  it('replaces an attribute’s rules, lists them on its definition, and keeps the rule counts exact', async () => {
    const w = await workspace();
    const length = rule('length', { max: 8 }, { message: 'Keep codes short.' });
    const pattern = rule(
      'pattern',
      { preset: 'digits', ignoreCase: false },
      { condition: { conjunction: 'and', conditions: [{ attributeId: w.stage.id, operator: 'is', value: w.won }] } },
    );
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [length, pattern] });
    const listed = await listObjectAttributes(w.scope, w.objectId);
    const code = listed.find((each) => each.id === w.code.id);
    expect(code?.validation).toEqual({
      required: 'never',
      rules: [
        { id: length.id, kind: 'length', params: { max: 8 }, message: 'Keep codes short.', position: 0 },
        {
          id: pattern.id,
          kind: 'pattern',
          params: { preset: 'digits', ignoreCase: false },
          condition: pattern.condition,
          position: 1,
        },
      ],
    });
    // Code holds two rules; Stage is named by one.
    expect(await ruleCounts(w.scope, [w.code.id, w.stage.id, w.amount.id])).toEqual({
      [w.code.id]: [2, 1],
      [w.stage.id]: [1, 1],
      [w.amount.id]: [0, 0],
    });
    // Replaced: the pattern is left out (deleted), the length kept with a new bound (its version moves).
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [{ ...length, params: { max: 4 } }] });
    expect(await ruleCounts(w.scope, [w.code.id, w.stage.id])).toEqual({
      [w.code.id]: [1, 2],
      [w.stage.id]: [0, 2],
    });
    const version = await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute<{ version: number; n: number }>(
        sql`select max(version)::int as version, count(*)::int as n from validation_rules where attribute_id = ${w.code.id}`,
      ),
    );
    expect(version.rows[0]).toEqual({ version: 2, n: 1 });
    // An empty list deletes them all.
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [] });
    expect((await ruleCounts(w.scope, [w.code.id]))[w.code.id]).toEqual([0, 3]);
  });

  it('keeps a Required When rule through a save of the other rules, which the list can’t carry', async () => {
    const w = await workspace();
    const required = newId();
    const condition = {
      conjunction: 'and' as const,
      conditions: [{ attributeId: w.stage.id, operator: 'is', value: w.won }],
    };
    // Stored as `required` will store it (milestone 2): the `rules` input refuses the kind.
    await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.insert(schema.validationRules).values({
        workspaceId: w.scope.workspaceId,
        id: required,
        objectId: w.objectId,
        attributeId: w.code.id,
        kind: 'required_when',
        params: {},
        condition,
        position: 0,
        createdByType: 'member',
        createdById: w.memberId,
        createdByMemberId: w.memberId,
        updatedByType: 'member',
        updatedById: w.memberId,
        updatedByMemberId: w.memberId,
      }),
    );
    // The settings dialog's Save: the rules it shows, never the Required When.
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [rule('length', { max: 8 })] });
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [] });
    const code = (await listObjectAttributes(w.scope, w.objectId)).find((each) => each.id === w.code.id);
    expect(code?.validation?.required).toBe('when');
    expect(code?.validation?.rules.map((each) => [each.id, each.kind])).toEqual([[required, 'required_when']]);
  });

  it('makes rules with a new attribute, in the same write and one definitions event', async () => {
    const w = await workspace();
    const before = (await outboxRows(w.scope)).length;
    const made = await createAttribute(
      w.scope,
      {
        objectId: w.objectId,
        id: newId(),
        title: 'Reference',
        type: 'text',
        rules: [rule('length', { min: 3, max: 10 })],
      },
      [outboxHook()],
    );
    expect(made.validation?.rules.map((each) => each.kind)).toEqual(['length']);
    const after = await outboxRows(w.scope);
    expect(after.slice(before)).toEqual([{ kind: 'definitions', attribute_ids: [made.id] }]);
  });

  it('refuses bad settings on the rule’s field, with nothing written', async () => {
    const w = await workspace();
    const refused = async (rules: ValidationRuleInput[], attributeId = w.code.id) =>
      (await refusalsOf(editAttribute(w.scope, { attributeId, rules }))).map((each) => ({
        code: each.code,
        field: each.field,
        message: each.message,
      }));
    expect(await refused([rule('length', { max: 3 }), rule('length', { min: 5, max: 2 })])).toEqual([
      { code: 'CONFIG_INVALID', field: 'rules.1.min', message: 'The smallest value must not be above the largest.' },
    ]);
    expect(await refused([rule('pattern', { preset: 'custom', regex: '(?<=a)b', ignoreCase: false })])).toEqual([
      {
        code: 'CONFIG_INVALID',
        field: 'rules.0.regex',
        message: 'That pattern can’t be used: invalid named capture: `(?<=a)b`.',
      },
    ]);
    expect(await refused([rule('range', { max: '5' })])).toEqual([
      {
        code: 'CONFIG_INVALID',
        field: 'rules.0.kind',
        message: 'This kind of rule doesn’t fit this attribute’s type.',
      },
    ]);
    // A condition naming another object's attribute.
    const other = await createObject(w.scope, {
      id: newId(),
      singularName: 'Thing',
      pluralName: 'Things',
      icon: 'box',
      hue: 'gray',
    });
    const name = (await listObjectAttributes(w.scope, other.id)).find((each) => each.isPrimary);
    expect(
      await refused([
        rule(
          'length',
          { max: 3 },
          { condition: { conjunction: 'and', conditions: [{ attributeId: name?.id ?? '', operator: 'is_empty' }] } },
        ),
      ]),
    ).toEqual([
      {
        code: 'CONFIG_INVALID',
        field: 'rules.0.condition',
        message: 'Conditions can only use this object’s own attributes.',
      },
    ]);
    expect(await ruleCounts(w.scope, [w.code.id])).toEqual({ [w.code.id]: [0, 0] });
  });

  it('holds at most 20 rules of an attribute’s own, and refuses a rule id another attribute holds', async () => {
    const w = await workspace();
    const twenty = Array.from({ length: 20 }, () => rule('length', { max: 10 }));
    await editAttribute(w.scope, { attributeId: w.code.id, rules: twenty });
    const refusals = await refusalsOf(
      editAttribute(w.scope, { attributeId: w.code.id, rules: [...twenty, rule('length', { max: 9 })] }),
    );
    expect(refusals).toEqual([
      { code: 'LIMIT_REACHED', message: 'An attribute holds at most 20 rules.', field: 'rules' },
    ]);
    // Rules elsewhere naming Code don't count toward its 20.
    const naming = rule(
      'range',
      { max: '5' },
      {
        condition: { conjunction: 'and', conditions: [{ attributeId: w.code.id, operator: 'is_not_empty' }] },
      },
    );
    await editAttribute(w.scope, { attributeId: w.amount.id, rules: [naming] });
    expect((await ruleCounts(w.scope, [w.code.id]))[w.code.id]?.[0]).toBe(21);
    const taken = await refusalsOf(
      editAttribute(w.scope, {
        attributeId: w.phone.id,
        rules: [{ ...naming, kind: 'phone_country', params: { countries: ['GB'] } }],
      }),
    );
    expect(taken.map((each) => each.code)).toEqual(['ID_TAKEN']);
  });

  it('refuses a member 403, with nothing written and no event', async () => {
    const w = await workspace();
    const memberId = newId();
    await db.withWorkspace(w.scope.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${w.scope.workspaceId}, ${memberId}, 'Bea', ${`bea-${memberId}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const member = rescope(w.scope, { actor: { type: 'member', id: memberId }, role: 'member' });
    const before = (await outboxRows(w.scope)).length;
    const refusals = await refusalsOf(
      editAttribute(member, { attributeId: w.code.id, rules: [rule('length', { max: 3 })] }, [outboxHook()]),
    );
    expect(refusals.map((each) => each.code)).toEqual(['FORBIDDEN']);
    const refusedCreate = await refusalsOf(
      createAttribute(member, {
        objectId: w.objectId,
        id: newId(),
        title: 'X',
        type: 'text',
        rules: [rule('length', { max: 3 })],
      }),
    );
    expect(refusedCreate.map((each) => each.code)).toEqual(['FORBIDDEN']);
    expect((await outboxRows(w.scope)).length).toBe(before);
    expect(await ruleCounts(w.scope, [w.code.id])).toEqual({ [w.code.id]: [0, 0] });
  });
});

describe('record writes', () => {
  it('refuses a write that breaks a touched rule, naming every failing rule, and writes nothing', async () => {
    const w = await workspace();
    const length = rule('length', { max: 4 });
    const digits = rule('pattern', { preset: 'digits', ignoreCase: false });
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [length, digits] });
    const recordId = await deal(w);
    const refusals = await refusalsOf(
      setRecordValues(w.scope, { recordId, values: { [w.code.id]: { value: 'ABCDEF' } } }, [outboxHook()]),
    );
    expect(refusals).toEqual([
      {
        code: 'VALIDATION_FAILED',
        message: 'Code can have at most 4 characters.',
        attributeId: w.code.id,
        ruleId: length.id,
      },
      {
        code: 'VALIDATION_FAILED',
        message: 'Code can only contain digits.',
        attributeId: w.code.id,
        ruleId: digits.id,
      },
    ]);
    const [record] = await getRecords(w.scope, { ids: [recordId] });
    expect(record?.values[w.code.id]).toBeNull();
    await setRecordValues(w.scope, { recordId, values: { [w.code.id]: { value: '1234' } } });
    // A create runs every rule of the object.
    const created = await refusalsOf(
      createRecord(w.scope, { objectId: w.objectId, id: newId(), values: { [w.code.id]: '12345' } }),
    );
    expect(created.map((each) => each.ruleId)).toEqual([length.id]);
  });

  it('refuses a value that doesn’t parse with its own code, before any rule runs', async () => {
    const w = await workspace();
    await editAttribute(w.scope, { attributeId: w.amount.id, rules: [rule('integer', {})] });
    const recordId = await deal(w);
    const refusals = await refusalsOf(
      setRecordValues(w.scope, { recordId, values: { [w.amount.id]: { value: 'many' } } }),
    );
    expect(refusals.map((each) => each.code)).toEqual(['ATTRIBUTE_VALUE_INVALID']);
  });

  it('runs only touched rules, and never on values nobody touched', async () => {
    const w = await workspace();
    // A record already at a gmail address before the rule.
    const recordId = await deal(w, { [w.email.id]: ['ada@gmail.com'] });
    await editAttribute(w.scope, {
      attributeId: w.email.id,
      rules: [rule('email_domain', { mode: 'allow', domains: ['acme.com'] })],
    });
    // Its phone changes fine: the email rule isn't touched.
    await setRecordValues(w.scope, {
      recordId,
      values: { [w.phone.id]: { value: { number: '+447700900123', country: 'GB' } } },
    });
    const refusals = await refusalsOf(
      setRecordValues(w.scope, { recordId, values: { [w.email.id]: { value: ['ada@gmail.com', 'b@acme.com'] } } }),
    );
    expect(refusals.map((each) => each.message)).toEqual(['Email must be an address at acme.com.']);
    // Emptying it passes: rules other than Required never look at an empty value.
    await setRecordValues(w.scope, { recordId, values: { [w.email.id]: { value: null } } });
  });

  it('checks a condition against the record after the write, through the attribute it names', async () => {
    const w = await workspace();
    const capped = rule(
      'range',
      { max: '100' },
      {
        condition: { conjunction: 'and', conditions: [{ attributeId: w.stage.id, operator: 'is', value: w.won }] },
      },
    );
    await editAttribute(w.scope, { attributeId: w.amount.id, rules: [capped] });
    const recordId = await deal(w, { [w.stage.id]: w.open });
    await setRecordValues(w.scope, { recordId, values: { [w.amount.id]: { value: '500' } } });
    // Moving the stage to Won touches Amount's rule through its condition, and reads Amount as it is.
    const refusals = await refusalsOf(
      setRecordValues(w.scope, { recordId, values: { [w.stage.id]: { value: w.won } } }),
    );
    expect(refusals).toEqual([
      {
        code: 'VALIDATION_FAILED',
        message: 'Amount must be at most 100 when Stage is Won.',
        attributeId: w.amount.id,
        ruleId: capped.id,
      },
    ]);
  });

  it('refuses only the breaking record in a batch', async () => {
    const w = await workspace();
    await editAttribute(w.scope, { attributeId: w.code.id, rules: [rule('length', { max: 3 })] });
    const [a, b] = [await deal(w), await deal(w)];
    const outcomes = await setValuesBatch(w.scope, {
      items: [
        { recordId: a, values: { [w.code.id]: { value: 'abc' } } },
        { recordId: b, values: { [w.code.id]: { value: 'abcd' } } },
      ],
    });
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, false]);
    const refused = outcomes[1];
    expect(refused !== undefined && !refused.ok ? refused.refusals.map((each) => each.code) : []).toEqual([
      'VALIDATION_FAILED',
    ]);
  });

  it('sees a rule saved while the write waits for the attribute, or restarts and meets it', async () => {
    const w = await workspace();
    const recordId = await deal(w);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // A rule write's lock on Code, held while a value write starts: Code had no rules when the write loaded it.
    const ruleWrite = db.withWorkspace(w.scope.workspaceId, async (tx) => {
      await tx.execute(sql`select id from attributes where id = ${w.code.id} for update`);
      locked();
      await gate;
      await tx.execute(
        sql`insert into validation_rules (workspace_id, id, object_id, attribute_id, kind, params, position, created_by_type, updated_by_type) values (${w.scope.workspaceId}, ${newId()}, ${w.objectId}, ${w.code.id}, 'length', '{"max": 2}', 0, 'system', 'system')`,
      );
      await tx.execute(
        sql`update attributes set rule_count = 1, rules_version = rules_version + 1 where id = ${w.code.id}`,
      );
    });
    await isLocked;
    const write = refusalsOf(setRecordValues(w.scope, { recordId, values: { [w.code.id]: { value: 'abcd' } } }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await ruleWrite;
    expect((await write).map((each) => each.code)).toEqual(['VALIDATION_FAILED']);
  });

  it('refuses the second of two writes that pass a conditional rule alone but break it together', async () => {
    const w = await workspace();
    await editAttribute(w.scope, {
      attributeId: w.amount.id,
      rules: [
        rule(
          'range',
          { max: '100' },
          {
            condition: { conjunction: 'and', conditions: [{ attributeId: w.stage.id, operator: 'is', value: w.won }] },
          },
        ),
      ],
    });
    for (let round = 0; round < 3; round += 1) {
      const recordId = await deal(w, { [w.stage.id]: w.open, [w.amount.id]: '50' });
      const outcomes = await Promise.allSettled([
        setRecordValues(w.scope, { recordId, values: { [w.amount.id]: { value: '500' } } }),
        setRecordValues(w.scope, { recordId, values: { [w.stage.id]: { value: w.won } } }),
      ]);
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
      const [record] = await getRecords(w.scope, { ids: [recordId] });
      const broken = record?.values[w.stage.id] === w.won && record.values[w.amount.id] === '500';
      expect(broken).toBe(false);
    }
  });

  it('never names a field hidden from the writer', async () => {
    const w = await workspace();
    await editAttribute(w.scope, {
      attributeId: w.code.id,
      rules: [
        rule(
          'length',
          { max: 2 },
          {
            condition: { conjunction: 'and', conditions: [{ attributeId: w.stage.id, operator: 'is', value: w.won }] },
          },
        ),
      ],
    });
    const recordId = await deal(w, { [w.stage.id]: w.won });
    const hiding = rescope(w.scope, {
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'owner' },
            target: { type: 'attribute', objectId: w.objectId, attributeId: w.stage.id },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    const refusals = await refusalsOf(setRecordValues(hiding, { recordId, values: { [w.code.id]: { value: 'abc' } } }));
    expect(refusals.map((each) => each.message)).toEqual([
      'Code can have at most 2 characters when another field matches.',
    ]);
    // And the rule, naming a field they can't see, isn't theirs to read.
    const listed = await listObjectAttributes(hiding, w.objectId);
    expect(listed.find((each) => each.id === w.code.id)?.validation?.rules).toEqual([]);
    // Nor to delete or change: saving the rules they see keeps it, and naming its id answers as unknown.
    const theirs = rule('pattern', { preset: 'letters', ignoreCase: false });
    await editAttribute(hiding, { attributeId: w.code.id, rules: [theirs] });
    const all = await listObjectAttributes(w.scope, w.objectId);
    expect(all.find((each) => each.id === w.code.id)?.validation?.rules.map((each) => each.kind)).toEqual([
      'length',
      'pattern',
    ]);
    const hiddenId = all.find((each) => each.id === w.code.id)?.validation?.rules[0]?.id ?? '';
    const refused = await refusalsOf(
      editAttribute(hiding, { attributeId: w.code.id, rules: [{ id: hiddenId, kind: 'length', params: { max: 9 } }] }),
    );
    expect(refused.map((each) => each.code)).toEqual(['NOT_FOUND']);
  });
});

describe('every kind, through a real write', () => {
  it('refuses a value breaking each kind on its type, and lets a good one land', async () => {
    const w = await workspace();
    const make = (title: string, type: Parameters<typeof createAttribute>[1]['type'], extra = {}) =>
      createAttribute(w.scope, { objectId: w.objectId, id: newId(), title, type, ...extra });
    const tags = await make('Tags', 'select', {
      isMulti: true,
      options: [
        { id: newId(), label: 'A', hue: 'gray' },
        { id: newId(), label: 'B', hue: 'blue' },
      ],
    });
    const [tagA, tagB] = (tags.options ?? []).map((option) => option.id);
    const cases: { attributeId: string; rule: ValidationRuleInput; bad: unknown; good: unknown }[] = [
      { attributeId: w.code.id, rule: rule('length', { min: 2 }), bad: 'a', good: 'ab' },
      {
        attributeId: (await make('Notes', 'long_text')).id,
        rule: rule('pattern', { preset: 'no_spaces', ignoreCase: false }),
        bad: 'a b',
        good: 'ab',
      },
      {
        attributeId: (await make('Site', 'url')).id,
        rule: rule('pattern', { preset: 'starts_with', text: 'https://acme', ignoreCase: true }),
        bad: 'https://other.com',
        good: 'https://ACME.com/x',
      },
      {
        attributeId: (await make('Handle', 'text')).id,
        rule: rule('pattern', { preset: 'ends_with', text: '.org', ignoreCase: false }),
        bad: 'acme.com',
        good: 'acme.org',
      },
      {
        attributeId: w.email.id,
        rule: rule('email_domain', { mode: 'block', domains: ['gmail.com'] }),
        bad: ['a@gmail.com'],
        good: ['a@acme.com'],
      },
      {
        attributeId: w.phone.id,
        rule: rule('phone_country', { countries: ['GB'] }),
        bad: { number: '+12025550123', country: 'US' },
        good: { number: '+447700900123', country: 'GB' },
      },
      { attributeId: w.amount.id, rule: rule('integer', {}), bad: '1.5', good: '2' },
      { attributeId: (await make('Score', 'rating')).id, rule: rule('range', { min: '3' }), bad: 2, good: 4 },
      {
        attributeId: (await make('Price', 'currency', { config: { defaultCurrency: 'EUR' } })).id,
        rule: rule('currency_in', { codes: ['EUR'] }),
        bad: { amount: '1', currency: 'USD' },
        good: { amount: '1', currency: 'EUR' },
      },
      {
        attributeId: (await make('Due', 'date')).id,
        rule: rule('date_range', { max: { date: '2026-12-31' } }),
        bad: '2027-01-01',
        good: '2026-12-31',
      },
      { attributeId: tags.id, rule: rule('count', { max: 1 }), bad: [tagA, tagB], good: [tagA] },
    ];
    for (const each of cases) await editAttribute(w.scope, { attributeId: each.attributeId, rules: [each.rule] });
    const recordId = await deal(w);
    for (const each of cases) {
      const refusals = await refusalsOf(
        setRecordValues(w.scope, { recordId, values: { [each.attributeId]: { value: each.bad } } }),
      );
      expect(
        refusals.map((refusal) => [refusal.code, refusal.ruleId]),
        each.rule.kind,
      ).toEqual([['VALIDATION_FAILED', each.rule.id]]);
      await setRecordValues(w.scope, { recordId, values: { [each.attributeId]: { value: each.good } } });
    }
  });
});

describe('patterns', () => {
  it('refuse a pattern too large to check quickly, before it is saved', async () => {
    const w = await workspace();
    const refusals = await refusalsOf(
      editAttribute(w.scope, {
        attributeId: w.code.id,
        rules: [rule('pattern', { preset: 'custom', regex: '(?:.*a){1000}', ignoreCase: true })],
      }),
    );
    expect(refusals).toEqual([
      {
        code: 'CONFIG_INVALID',
        message: 'That pattern is too large to check quickly. Use fewer repeats.',
        field: 'rules.0.regex',
      },
    ]);
  });

  it('check the largest pattern the settings allow against a 10,000 character value quickly', () => {
    // About 300 instructions: the most the settings let through.
    const test = compilePattern('^(?:(?:.*a){95})$', true);
    const value = 'a'.repeat(10_000);
    const started = performance.now();
    test.test(value);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('match a 10,000 character value against (a+)+$ in linear time, under 50 ms', () => {
    const test = compilePattern('^(?:(a+)+$)$', false);
    const value = `${'a'.repeat(10_000)}b`;
    test.test(value);
    const started = performance.now();
    expect(test.test(value)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('run Unicode letter classes and ignore case as RE2 does', () => {
    expect(compilePattern('^(?:[\\p{L} ]+)$', false).test('Zoë Ann')).toBe(true);
    expect(compilePattern('^(?:abc)$', true).test('ABC')).toBe(true);
    expect(() => compilePattern('^(?:a()$', false)).toThrow(/missing closing/);
  });
});
