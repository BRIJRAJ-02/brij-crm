// Bulk edit (spec 0022, milestone 2), against a real Postgres as the app role:
// every operation computed under the record locks, value history and one
// outbox row per object, an unchanged record writing nothing (the retry rule),
// the dialog's refusals (excluded, unique, required), and access (a read only
// object or field refuses the call, a hidden record is refused unnamed).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { updateMany, BULK_EDIT_WORDS } from './bulk-edit.ts';
import { defineAttribute } from './definitions.ts';
import { defineOption } from './options.ts';
import { getHistory } from './history.ts';
import { newId } from './ids.ts';
import { outboxHook } from './outbox.ts';
import { createRecord, getRecords } from './records.ts';
import { isRefusal } from './refusals.ts';
import type { Actor } from './scope.ts';
import { deleteRecords } from './trash.ts';
import { createWorkspace } from './workspaces.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-bulk-edit-tests' });
});
afterAll(async () => {
  await db.close();
});

let made = 0;
async function world() {
  made += 1;
  const created = await createWorkspace(db, {
    name: 'Bulk',
    slug: `bulk-${String(made)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const actor: Actor = { type: 'member', id: created.memberId };
  const scope = testScope({ db, workspaceId: created.workspaceId, actor });
  const rows = await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute<{ id: string; object_id: string; api_slug: string }>(
      sql`select id::text, object_id::text, api_slug from attributes where object_id is not null`,
    ),
  );
  const people = created.objects.people ?? '';
  const companies = created.objects.companies ?? '';
  const deals = created.objects.deals ?? '';
  const attribute = (objectId: string, slug: string) =>
    rows.rows.find((row) => row.object_id === objectId && row.api_slug === slug)?.id ?? '';
  return {
    ...created,
    scope,
    people,
    companies,
    deals,
    person: (slug: string) => attribute(people, slug),
    company: (slug: string) => attribute(companies, slug),
    deal: (slug: string) => attribute(deals, slug),
  };
}
type World = Awaited<ReturnType<typeof world>>;

async function person(w: World, firstName: string, values: Record<string, unknown> = {}) {
  return (await createRecord(w.scope, { objectId: w.people, values: { [w.person('name')]: { firstName }, ...values } }))
    .recordId;
}

async function company(w: World, name: string, values: Record<string, unknown> = {}) {
  return (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: name, ...values } }))
    .recordId;
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

async function valuesOf(w: World, ids: readonly string[], attributeId: string) {
  const views = await getRecords(w.scope, { ids });
  return ids.map((id) => views.find((view) => view.id === id)?.values[attributeId]);
}

describe('updateMany', () => {
  it('sets and clears a single value, returning before only for records it changed (AC-530, AC-540)', async () => {
    const w = await world();
    const jobTitle = w.person('job_title');
    const ada = await person(w, 'Ada', { [jobTitle]: 'Engineer' });
    const bob = await person(w, 'Bob');
    const cy = await person(w, 'Cy', { [jobTitle]: 'Founder' });
    const set = await updateMany(w.scope, {
      objectId: w.people,
      recordIds: [ada, bob, cy],
      edit: { attributeId: jobTitle, op: 'set', value: 'Founder' },
    });
    expect(set.outcomes.map((outcome) => outcome.state)).toEqual(['changed', 'changed', 'unchanged']);
    expect(set.outcomes[0]).toMatchObject({ state: 'changed', before: 'Engineer' });
    expect(set.outcomes[1]).toMatchObject({ state: 'changed', before: null });
    expect(await valuesOf(w, [ada, bob, cy], jobTitle)).toEqual(['Founder', 'Founder', 'Founder']);
    // The same edit again (a retry after a lost answer) changes nothing and carries no before.
    const again = await updateMany(w.scope, {
      objectId: w.people,
      recordIds: [ada, bob, cy],
      edit: { attributeId: jobTitle, op: 'set', value: 'Founder' },
    });
    expect(again.outcomes.map((outcome) => outcome.state)).toEqual(['unchanged', 'unchanged', 'unchanged']);
    // History keeps every version: Ada's value was Engineer, then Founder.
    const history = await getHistory(w.scope, { recordId: ada, attributeId: jobTitle });
    expect(history.map((entry) => entry.value)).toEqual(expect.arrayContaining(['Engineer', 'Founder']));
    const cleared = await updateMany(w.scope, {
      objectId: w.people,
      recordIds: [ada, bob],
      edit: { attributeId: jobTitle, op: 'clear' },
    });
    expect(cleared.outcomes.map((outcome) => outcome.state)).toEqual(['changed', 'changed']);
    expect(await valuesOf(w, [ada, bob], jobTitle)).toEqual([null, null]);
  });

  it('adds, removes, replaces and clears a multi select, keeping the existing order (AC-529)', async () => {
    const w = await world();
    const categories = w.company('categories');
    const made: string[] = [];
    for (const label of ['SaaS', 'Fintech', 'Retail']) {
      made.push((await defineOption(w.scope, { attributeId: categories, label })).optionId);
    }
    const [first, second, third] = made;
    if (first === undefined || second === undefined || third === undefined) throw new Error('Categories has options.');
    const acme = await company(w, 'Acme', { [categories]: [second] });
    const globex = await company(w, 'Globex');
    const add = await updateMany(w.scope, {
      objectId: w.companies,
      recordIds: [acme, globex],
      edit: { attributeId: categories, op: 'add', value: [first, second] },
    });
    expect(add.outcomes.map((outcome) => outcome.state)).toEqual(['changed', 'changed']);
    expect(await valuesOf(w, [acme, globex], categories)).toEqual([
      [second, first],
      [first, second],
    ]);
    await updateMany(w.scope, {
      objectId: w.companies,
      recordIds: [acme, globex],
      edit: { attributeId: categories, op: 'remove', value: [second] },
    });
    expect(await valuesOf(w, [acme, globex], categories)).toEqual([[first], [first]]);
    await updateMany(w.scope, {
      objectId: w.companies,
      recordIds: [acme],
      edit: { attributeId: categories, op: 'replace', value: [third] },
    });
    expect(await valuesOf(w, [acme], categories)).toEqual([[third]]);
    // Removing the last item leaves the cell empty.
    await updateMany(w.scope, {
      objectId: w.companies,
      recordIds: [acme, globex],
      edit: { attributeId: categories, op: 'clear' },
    });
    expect(await valuesOf(w, [acme, globex], categories)).toEqual([null, null]);
  });

  it('checks and unchecks a checkbox, and stores one outbox row for the object (AC-529)', async () => {
    const w = await world();
    const optOut = w.person('email_opt_out');
    const ids = [await person(w, 'Ada'), await person(w, 'Bob')];
    const stored: number[] = [];
    await updateMany(
      w.scope,
      { objectId: w.people, recordIds: ids, edit: { attributeId: optOut, op: 'set', value: true } },
      [outboxHook({ mutationId: newId(), onStored: (count) => stored.push(count) })],
    );
    expect(stored).toEqual([1]);
    expect(await valuesOf(w, ids, optOut)).toEqual([true, true]);
    await updateMany(w.scope, {
      objectId: w.people,
      recordIds: ids,
      edit: { attributeId: optOut, op: 'set', value: false },
    });
    expect(await valuesOf(w, ids, optOut)).toEqual([false, false]);
  });

  it('refuses Set on a unique attribute for several records, and Clear on a required one (AC-529)', async () => {
    const w = await world();
    const emails = w.person('email_addresses');
    const ids = [await person(w, 'Ada'), await person(w, 'Bob')];
    // Replace is the list's Set: a unique list on two records clashes per record.
    const replaced = await updateMany(w.scope, {
      objectId: w.people,
      recordIds: ids,
      edit: { attributeId: emails, op: 'replace', value: ['team@acme.com'] },
    });
    expect(replaced.outcomes.map((outcome) => outcome.state)).toEqual(['changed', 'refused']);
    // A unique single value: one record may take it, two may not.
    const code = (
      await defineAttribute(w.scope, {
        objectId: w.people,
        apiSlug: 'badge',
        title: 'Badge',
        type: 'text',
        isUnique: true,
      })
    ).attributeId;
    expect(
      await refusalOf(
        updateMany(w.scope, {
          objectId: w.people,
          recordIds: ids,
          edit: { attributeId: code, op: 'set', value: 'B1' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: BULK_EDIT_WORDS.unique('Badge') });
    const one = await updateMany(w.scope, {
      objectId: w.people,
      recordIds: ids.slice(0, 1),
      edit: { attributeId: code, op: 'set', value: 'B1' },
    });
    expect(one.outcomes[0]?.state).toBe('changed');
    const stage = w.deal('stage');
    const deal = (await createRecord(w.scope, { objectId: w.deals, values: { [w.deal('name')]: 'Pilot' } })).recordId;
    expect(
      await refusalOf(
        updateMany(w.scope, { objectId: w.deals, recordIds: [deal], edit: { attributeId: stage, op: 'clear' } }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: BULK_EDIT_WORDS.required('Stage') });
  });

  it('refuses the primary attribute, system attributes, and more than 500 records (AC-529, AC-539)', async () => {
    const w = await world();
    const ada = await person(w, 'Ada');
    expect(
      await refusalOf(
        updateMany(w.scope, {
          objectId: w.people,
          recordIds: [ada],
          edit: { attributeId: w.person('name'), op: 'set', value: { firstName: 'Bo' } },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: BULK_EDIT_WORDS.excluded('Name') });
    expect(
      await refusalOf(
        updateMany(w.scope, {
          objectId: w.people,
          recordIds: [ada],
          edit: { attributeId: w.person('created_at'), op: 'clear' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(
      await refusalOf(
        updateMany(w.scope, {
          objectId: w.people,
          recordIds: [ada],
          edit: { attributeId: w.person('company'), op: 'clear' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(
      await refusalOf(
        updateMany(w.scope, {
          objectId: w.people,
          recordIds: Array.from({ length: 501 }, () => newId()),
          edit: { attributeId: w.person('job_title'), op: 'clear' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(
      await refusalOf(
        updateMany(w.scope, {
          objectId: w.people,
          recordIds: [ada],
          edit: { attributeId: w.person('job_title'), op: 'add', value: 'x' },
        }),
      ),
    ).toMatchObject({ code: 'CONFIG_INVALID', message: BULK_EDIT_WORDS.wrongOp('Job title') });
  });

  it('refuses a record in the trash or of another object per record, and changes the rest (AC-530)', async () => {
    const w = await world();
    const jobTitle = w.person('job_title');
    const ada = await person(w, 'Ada');
    const bob = await person(w, 'Bob');
    const acme = await company(w, 'Acme');
    await deleteRecords(w.scope, { objectId: w.people, recordIds: [bob], batchId: newId() });
    const { outcomes } = await updateMany(w.scope, {
      objectId: w.people,
      recordIds: [ada, bob, acme],
      edit: { attributeId: jobTitle, op: 'set', value: 'CTO' },
    });
    expect(outcomes.map((outcome) => outcome.state)).toEqual(['changed', 'refused', 'refused']);
    expect(outcomes[1]).toMatchObject({ refusals: [{ code: 'RECORD_DELETED' }] });
    expect(outcomes[2]).toMatchObject({ refusals: [{ code: 'NOT_FOUND' }] });
  });

  it('refuses an object or a field the member may only read, and a hidden record unnamed (AC-538)', async () => {
    const w = await world();
    const jobTitle = w.person('job_title');
    const ada = await person(w, 'Ada');
    const readOnly = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          { subject: { type: 'role', role: 'member' }, target: { type: 'object', objectId: w.people }, level: 'read' },
        ],
        records: [],
      },
    });
    expect(
      await refusalOf(
        updateMany(readOnly, {
          objectId: w.people,
          recordIds: [ada],
          edit: { attributeId: jobTitle, op: 'set', value: 'CTO' },
        }),
      ),
    ).toEqual({ code: 'FORBIDDEN', message: 'You can view People but not change them.' });
    const fieldReadOnly = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: w.people, attributeId: jobTitle },
            level: 'read',
          },
        ],
        records: [],
      },
    });
    expect(
      await refusalOf(
        updateMany(fieldReadOnly, {
          objectId: w.people,
          recordIds: [ada],
          edit: { attributeId: jobTitle, op: 'set', value: 'CTO' },
        }),
      ),
    ).toMatchObject({ code: 'ATTRIBUTE_READ_ONLY' });
    const ruled = rescope(w.scope, {
      actor: { type: 'member', id: newId() },
      role: 'member',
      rules: {
        levels: [],
        records: [
          {
            subject: { type: 'role', role: 'member' },
            objectId: w.people,
            attributeId: w.person('created_by'),
            kind: 'own',
          },
        ],
      },
    });
    const { outcomes } = await updateMany(ruled, {
      objectId: w.people,
      recordIds: [ada],
      edit: { attributeId: jobTitle, op: 'set', value: 'CTO' },
    });
    expect(outcomes).toEqual([
      { recordId: ada, state: 'refused', refusals: [{ code: 'NOT_FOUND', message: 'That record does not exist.' }] },
    ]);
    expect(await valuesOf(w, [ada], jobTitle)).toEqual([null]);
  });
});
