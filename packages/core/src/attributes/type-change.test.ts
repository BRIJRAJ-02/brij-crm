// Changing an attribute's type in place (the field types pass) against a real Postgres as the app role: a value
// that doesn't convert blocks the change and names its record, a fixed one lets it through with the old value kept
// in history, a select becomes a multi select holding the same option, a number takes a currency, Unique turns
// off with the change to long text, and a member who can't change the schema is refused.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { getHistory } from '../engine/history.ts';
import { newId } from '../engine/ids.ts';
import { createRecord, getRecords, setValues } from '../engine/records.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createWorkspace } from '../engine/workspaces.ts';
import { createObject } from '../objects/objects.ts';
import { rescope, testScope } from '../testing.ts';
import { createAttribute } from './attributes.ts';
import { changeAttributeType, checkTypeChange } from './type-change.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-type-change-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function workspace() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Types',
    slug: `types-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const projects = (
    await createObject(scope, {
      id: newId(),
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'blue',
    })
  ).id;
  return { scope, projects };
}

/** The code a refused call carried, or the error itself. */
async function refusalOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return 'let through';
  } catch (error) {
    return isRefusal(error) ? error.refusal.code : error;
  }
}

describe('changing a type in place', () => {
  it('blocks text to email while a value isn’t one, then converts every value once it is', async () => {
    const { scope, projects } = await workspace();
    const contact = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Contact', type: 'text' });
    const good = await createRecord(scope, { objectId: projects, values: { [contact.id]: 'Ada@Example.com' } });
    const bad = await createRecord(scope, { objectId: projects, values: { [contact.id]: 'Ada Lovelace' } });

    const check = await checkTypeChange(scope, { attributeId: contact.id, to: 'email' });
    expect(check).toMatchObject({ total: 2, converts: 1, fails: 1, failedRecordIds: [bad.recordId] });
    expect(check.blockers[0]).toContain('can’t become Email');
    expect(await refusalOf(changeAttributeType(scope, { attributeId: contact.id, to: 'email' }))).toBe(
      'TYPE_CHANGE_REFUSED',
    );

    await setValues(scope, { recordId: bad.recordId, values: { [contact.id]: { value: 'grace@example.com' } } });
    expect((await checkTypeChange(scope, { attributeId: contact.id, to: 'email' })).blockers).toEqual([]);
    const changed = await changeAttributeType(scope, { attributeId: contact.id, to: 'email' });
    expect(changed).toMatchObject({ type: 'email', isMulti: false });

    const [read] = await getRecords(scope, { ids: [good.recordId] });
    expect(read?.values[contact.id]).toBe('ada@example.com');
    // The old spelling stays in the record's history, under the new one.
    const history = await getHistory(scope, { recordId: good.recordId, attributeId: contact.id });
    expect(history).toHaveLength(2);
  });

  it('makes a select a multi select holding the same option, with no new version', async () => {
    const { scope, projects } = await workspace();
    const high = newId();
    const priority = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Priority',
      type: 'select',
      options: [{ id: high, label: 'High', hue: 'red' }],
    });
    const record = await createRecord(scope, { objectId: projects, values: { [priority.id]: high } });
    const changed = await changeAttributeType(scope, { attributeId: priority.id, to: 'multi_select' });
    expect(changed).toMatchObject({ type: 'select', isMulti: true });
    const [read] = await getRecords(scope, { ids: [record.recordId] });
    expect(read?.values[priority.id]).toEqual([high]);
    expect(await getHistory(scope, { recordId: record.recordId, attributeId: priority.id })).toHaveLength(1);
  });

  it('gives a number the chosen currency, and needs one', async () => {
    const { scope, projects } = await workspace();
    const budget = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Budget', type: 'number' });
    const record = await createRecord(scope, { objectId: projects, values: { [budget.id]: '1200.5' } });
    expect(await refusalOf(changeAttributeType(scope, { attributeId: budget.id, to: 'currency' }))).toBe(
      'CONFIG_INVALID',
    );
    await changeAttributeType(scope, { attributeId: budget.id, to: 'currency', config: { defaultCurrency: 'EUR' } });
    const [read] = await getRecords(scope, { ids: [record.recordId] });
    expect(read?.values[budget.id]).toEqual({ amount: '1200.5', currency: 'EUR' });
  });

  it('turns Unique off going to long text, and says so first', async () => {
    const { scope, projects } = await workspace();
    const code = await createAttribute(scope, {
      objectId: projects,
      id: newId(),
      title: 'Code',
      type: 'text',
      isUnique: true,
    });
    await createRecord(scope, { objectId: projects, values: { [code.id]: 'A1' } });
    const check = await checkTypeChange(scope, { attributeId: code.id, to: 'long_text' });
    expect(check.consequences).toContain('Unique turns off.');
    const changed = await changeAttributeType(scope, { attributeId: code.id, to: 'long_text' });
    expect(changed).toMatchObject({ type: 'long_text', isUnique: false });
  });

  it('refuses a pair that isn’t safe, and a member who can’t change the schema', async () => {
    const { scope, projects } = await workspace();
    const due = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Due', type: 'date' });
    expect(await refusalOf(checkTypeChange(scope, { attributeId: due.id, to: 'text' }))).toBe('TYPE_CHANGE_REFUSED');

    const notes = await createAttribute(scope, { objectId: projects, id: newId(), title: 'Notes', type: 'text' });
    const memberId = newId();
    await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute(
        sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${scope.workspaceId}, ${memberId}, 'Bea', ${`bea-${memberId}@example.com`}, 'member', 'system', 'system')`,
      ),
    );
    const member = rescope(scope, { actor: { type: 'member', id: memberId }, role: 'member' });
    expect(await refusalOf(changeAttributeType(member, { attributeId: notes.id, to: 'long_text' }))).toBe('FORBIDDEN');
    expect(await refusalOf(checkTypeChange(member, { attributeId: notes.id, to: 'long_text' }))).toBe('FORBIDDEN');
  });
});
