// Spec 0017, milestone 1, step 1, against a real Postgres as the app role:
// the create path stamps every value and link it writes with the new record's
// id as their version id (the creation fold), while every later write still
// mints its own uuid v7, so `getHistory` and spec 0006's versions read as
// before for later writes.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { getHistory } from './history.ts';
import { newId } from './ids.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { createWorkspace } from './workspaces.ts';
import { addRecord } from '../records/records.ts';
import { testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-creation-version-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Creation',
    slug: `creation-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const slugsOf = async (objectId: string) => {
    const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ id: string; api_slug: string }>(
        sql`select id, api_slug from attributes where object_id = ${objectId}`,
      ),
    );
    return Object.fromEntries(rows.rows.map((row) => [row.api_slug, row.id]));
  };
  const companies = created.objects.companies ?? '';
  const people = created.objects.people ?? '';
  return { scope, companies, people, company: await slugsOf(companies), person: await slugsOf(people) };
}

/** A record id minted a second ago, so a database clock a little behind this one (a busy VM) still stamps it. */
const pastId = () => newId(Date.now() - 1000);

const must = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Expected a value.');
  return value;
};

type World = Awaited<ReturnType<typeof workspace>>;

/** The distinct version ids of a record's value rows and of the links it holds as the near end, by attribute. */
async function storedVersions(world: World, recordId: string) {
  const values = await db.withWorkspace(world.scope.workspaceId, (tx) =>
    tx.execute<{ attribute_id: string; version_id: string }>(
      sql`select distinct attribute_id::text, version_id::text from "values" where owner_id = ${recordId}`,
    ),
  );
  const links = await db.withWorkspace(world.scope.workspaceId, (tx) =>
    tx.execute<{ version_id: string }>(
      sql`select distinct version_id::text from record_links where from_record_id = ${recordId} or to_record_id = ${recordId}`,
    ),
  );
  return { values: values.rows, links: links.rows.map((row) => row.version_id) };
}

describe('the creation fold (spec 0017, AC-378)', () => {
  it('stamps every value and link a create writes with the record id, the far end’s cell included', async () => {
    const world = await workspace();
    const { recordId: acme } = await createRecord(world.scope, {
      objectId: world.companies,
      values: { [must(world.company.name)]: 'Acme' },
    });
    const id = pastId();
    const { record, written } = await addRecord(world.scope, {
      objectId: world.people,
      id,
      values: {
        [must(world.person.name)]: { firstName: 'Jane', lastName: 'Doe' },
        [must(world.person.job_title)]: 'CTO',
        [must(world.person.company)]: { objectId: world.companies, recordId: acme },
      },
    });
    const stored = await storedVersions(world, id);
    expect(stored.values.length).toBeGreaterThanOrEqual(2);
    expect(stored.values.every((row) => row.version_id === id)).toBe(true);
    expect(stored.links).toEqual([id]);
    // What the create answers and reads back names the same version.
    expect(Object.values(written).every((version) => version === id)).toBe(true);
    expect(record.versions[must(world.person.job_title)]).toBe(id);
    expect(record.versions[must(world.person.company)]).toBe(id);
    const [company] = await getRecords(world.scope, { ids: [acme] });
    expect(company?.versions[must(world.company.team)]).toBe(id);
  });

  it('stamps a record whose id the server mints too', async () => {
    const world = await workspace();
    const { recordId } = await createRecord(world.scope, {
      objectId: world.companies,
      values: { [must(world.company.name)]: 'Server made' },
    });
    const stored = await storedVersions(world, recordId);
    expect(stored.values.map((row) => row.version_id)).toEqual([recordId]);
  });

  it('mints fresh versions for an id from a clock running ahead, so later writes still sort after them', async () => {
    const world = await workspace();
    const ahead = newId(Date.now() + 5 * 60 * 1000);
    await addRecord(world.scope, {
      objectId: world.companies,
      id: ahead,
      values: { [must(world.company.name)]: 'Early bird' },
    });
    const stored = await storedVersions(world, ahead);
    expect(stored.values.length).toBe(1);
    expect(stored.values[0]?.version_id).not.toBe(ahead);
  });

  it('leaves later writes on their own new versions, so getHistory and the read versions are as before', async () => {
    const world = await workspace();
    const jobTitle = must(world.person.job_title);
    const id = pastId();
    await addRecord(world.scope, {
      objectId: world.people,
      id,
      values: { [must(world.person.name)]: { firstName: 'Ada' }, [jobTitle]: 'Engineer' },
    });
    // The undo precondition still matches the created cell by its version (spec 0006, AC-49).
    const first = await setValues(world.scope, {
      recordId: id,
      values: { [jobTitle]: { value: 'CTO', ifVersionId: id } },
    });
    const second = await setValues(world.scope, { recordId: id, values: { [jobTitle]: { value: null } } });
    const firstVersion = must(first[jobTitle]?.versionId);
    const secondVersion = must(second[jobTitle]?.versionId);
    expect(new Set([id, firstVersion, secondVersion]).size).toBe(3);
    expect(firstVersion > id && secondVersion > firstVersion).toBe(true);
    const history = await getHistory(world.scope, { recordId: id, attributeId: jobTitle });
    expect(history.map((version) => version.value)).toEqual(['Engineer', 'CTO', null]);
    expect(
      history.every((version, index) => index === 0 || version.activeFrom > (history[index - 1]?.activeFrom ?? '')),
    ).toBe(true);
    const [read] = await getRecords(world.scope, { ids: [id] });
    expect(read?.versions[jobTitle]).toBe(secondVersion);
  });
});
