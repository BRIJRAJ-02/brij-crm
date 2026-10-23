// Spec 0014, milestone 3: `pageLinks`, one side's linked records a page at a
// time, against a real Postgres: the side's order, the keyset cursor, the
// exact total, and hidden, trashed and archived records absent.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { setObjectArchived } from './definitions.ts';
import { deleteRecord } from './deletion.ts';
import { changeLinks } from './link-delta.ts';
import { pageLinks } from './link-page.ts';
import { createRecord } from './records.ts';
import { isInputError, isRefusal } from './refusals.ts';
import { createWorkspace } from './workspaces.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-link-page-tests' });
});
afterAll(async () => {
  await db.close();
});

const must = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Missing id.');
  return value;
};

let count = 0;
async function world() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Pages',
    slug: `link-pages-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string; object_id: string }>(
      sql`select id::text, api_slug, object_id::text from attributes where object_id is not null`,
    ),
  );
  const people = must(created.objects.people);
  const companies = must(created.objects.companies);
  const deals = must(created.objects.deals);
  const on = (objectId: string) => (slug: string) =>
    must(rows.rows.find((row) => row.object_id === objectId && row.api_slug === slug)?.id);
  return { ...created, scope, people, companies, deals, person: on(people), company: on(companies) };
}
type World = Awaited<ReturnType<typeof world>>;

async function person(w: World, firstName: string) {
  return (await createRecord(w.scope, { objectId: w.people, values: { [w.person('name')]: { firstName } } })).recordId;
}

async function company(w: World, name: string) {
  return (await createRecord(w.scope, { objectId: w.companies, values: { [w.company('name')]: name } })).recordId;
}

/** A company whose Team holds `names`, linked in that order, one write each. */
async function team(w: World, names: readonly string[]) {
  const acme = await company(w, 'Acme');
  const members: string[] = [];
  for (const name of names) {
    const id = await person(w, name);
    members.push(id);
    await changeLinks(w.scope, {
      kind: 'add',
      recordId: acme,
      attributeId: w.company('team'),
      targets: [{ objectId: w.people, recordId: id }],
    });
  }
  return { acme, members };
}

async function failure(promise: Promise<unknown>): Promise<EngineRefusal | { code: string } | undefined> {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusal;
    if (isInputError(error)) return { code: 'INPUT_INVALID', ...error.inputProblem };
    throw error;
  }
  return undefined;
}

describe('pageLinks (spec 0014, AC-299, AC-304, AC-308)', () => {
  it('pages a side in its order with the exact total, and the cursor reads on to the end', async () => {
    const w = await world();
    const names = ['Ada', 'Ben', 'Cy', 'Dee', 'Eve'];
    const { acme } = await team(w, names);
    const first = await pageLinks(w.scope, { recordId: acme, attributeId: w.company('team'), limit: 2 });
    expect(first.items.map((item) => item.name)).toEqual(['Ada', 'Ben']);
    expect(first.total).toBe(5);
    expect(first.items[0]).toMatchObject({ objectId: w.people, kind: 'person' });
    const second = await pageLinks(w.scope, {
      recordId: acme,
      attributeId: w.company('team'),
      limit: 2,
      cursor: must(first.nextCursor),
    });
    expect(second.items.map((item) => item.name)).toEqual(['Cy', 'Dee']);
    const last = await pageLinks(w.scope, {
      recordId: acme,
      attributeId: w.company('team'),
      limit: 2,
      cursor: must(second.nextCursor),
    });
    expect(last.items.map((item) => item.name)).toEqual(['Eve']);
    expect(last.nextCursor).toBeUndefined();
    // The default page is 20.
    const whole = await pageLinks(w.scope, { recordId: acme, attributeId: w.company('team') });
    expect(whole.items).toHaveLength(5);
    expect(whole.nextCursor).toBeUndefined();
  });

  it('reads the other end of the same links: a person’s Company is one record, their side holds one', async () => {
    const w = await world();
    const { acme, members } = await team(w, ['Ada']);
    const page = await pageLinks(w.scope, { recordId: must(members[0]), attributeId: w.person('company') });
    expect(page.items.map((item) => item.recordId)).toEqual([acme]);
    expect(page.total).toBe(1);
  });

  it('leaves out far records in the trash, and answers an empty side', async () => {
    const w = await world();
    const { acme, members } = await team(w, ['Ada', 'Ben']);
    await deleteRecord(w.scope, { recordId: must(members[0]) });
    const page = await pageLinks(w.scope, { recordId: acme, attributeId: w.company('team') });
    expect(page.items.map((item) => item.name)).toEqual(['Ben']);
    expect(page.total).toBe(1);
    const empty = await company(w, 'Empty');
    expect(await pageLinks(w.scope, { recordId: empty, attributeId: w.company('team') })).toEqual({
      items: [],
      total: 0,
    });
  });

  it('refuses a record that is missing, in the trash or hidden, and a side that is not the record’s, alike', async () => {
    const w = await world();
    const { acme } = await team(w, ['Ada']);
    const unknown = '0192f000-0000-7000-8000-000000000000';
    expect((await failure(pageLinks(w.scope, { recordId: unknown, attributeId: w.company('team') })))?.code).toBe(
      'NOT_FOUND',
    );
    // A side of another object (People's Company) on a company.
    expect((await failure(pageLinks(w.scope, { recordId: acme, attributeId: w.person('company') })))?.code).toBe(
      'NOT_FOUND',
    );
    // Not a relationship at all.
    expect((await failure(pageLinks(w.scope, { recordId: acme, attributeId: w.company('name') })))?.code).toBe(
      'NOT_FOUND',
    );
    const role = { type: 'role' as const, role: 'member' };
    const blind = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [{ subject: role, target: { type: 'object', objectId: w.companies }, level: 'none' }],
        records: [],
      },
    });
    expect((await failure(pageLinks(blind, { recordId: acme, attributeId: w.company('team') })))?.code).toBe(
      'NOT_FOUND',
    );
    // A side hidden by a field rule is absent too.
    const sideHidden = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: role,
            target: { type: 'attribute', objectId: w.companies, attributeId: w.company('team') },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    expect((await failure(pageLinks(sideHidden, { recordId: acme, attributeId: w.company('team') })))?.code).toBe(
      'NOT_FOUND',
    );
    await deleteRecord(w.scope, { recordId: acme });
    expect((await failure(pageLinks(w.scope, { recordId: acme, attributeId: w.company('team') })))?.code).toBe(
      'NOT_FOUND',
    );
  });

  it('leaves out far records the reader can’t see, from the rows and the total', async () => {
    const w = await world();
    const { acme } = await team(w, ['Ada', 'Ben']);
    const role = { type: 'role' as const, role: 'member' };
    const noPeople = rescope(w.scope, {
      role: 'member',
      rules: {
        levels: [{ subject: role, target: { type: 'object', objectId: w.people }, level: 'none' }],
        records: [],
      },
    });
    expect(await pageLinks(noPeople, { recordId: acme, attributeId: w.company('team') })).toEqual({
      items: [],
      total: 0,
    });
  });

  it('refuses a side whose far object is archived (AC-308)', async () => {
    const w = await world();
    const { acme } = await team(w, ['Ada']);
    await setObjectArchived(w.scope, { objectId: w.people, archived: true });
    expect((await failure(pageLinks(w.scope, { recordId: acme, attributeId: w.company('team') })))?.code).toBe(
      'NOT_FOUND',
    );
  });

  it('refuses a cursor that is not this side’s, a tampered one, and a page too big', async () => {
    const w = await world();
    const { acme, members } = await team(w, ['Ada', 'Ben', 'Cy']);
    const first = await pageLinks(w.scope, { recordId: acme, attributeId: w.company('team'), limit: 1 });
    const cursor = must(first.nextCursor);
    const other = await team(w, ['Dee']);
    expect(
      await failure(pageLinks(w.scope, { recordId: other.acme, attributeId: w.company('team'), cursor })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'cursor' });
    expect(
      await failure(pageLinks(w.scope, { recordId: must(members[0]), attributeId: w.person('company'), cursor })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'cursor' });
    expect(
      await failure(pageLinks(w.scope, { recordId: acme, attributeId: w.company('team'), cursor: 'eyJub3QiOiJpdCJ9' })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'cursor' });
    expect(
      await failure(pageLinks(w.scope, { recordId: acme, attributeId: w.company('team'), limit: 51 })),
    ).toMatchObject({ code: 'INPUT_INVALID', field: 'limit' });
  });
});
