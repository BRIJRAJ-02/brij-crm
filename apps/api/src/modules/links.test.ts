// links.add, links.remove and records.search (spec 0014, milestone 2): a
// side that holds many changes by delta only, a taken record answers 409
// until it is moved, the answer names the far records to read again, and
// the picker's search answers linked and takenBy. Real session, real Postgres.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database, IdentityStore } from '@crm/db';
import { newId } from '@crm/core';
import { signInApp, testConnections } from '../../test/sign-in.ts';
import { failure, memberWithWorkspace, refusal, refusalsOf } from '../../test/workspace.ts';

let db: Database;
let identity: IdentityStore;
let app: ReturnType<typeof signInApp>['app'];

beforeAll(() => {
  ({ db, identity } = testConnections());
  ({ app } = signInApp({ db, identity }));
});
afterAll(async () => {
  await identity.close();
  await db.close();
});

type Member = Awaited<ReturnType<typeof memberWithWorkspace>>;

async function setUp() {
  const m = await memberWithWorkspace(app);
  const companyAttributes = await m.client.attributes.list({ workspace: m.slug, objectId: m.companies.id });
  const onCompanies = (slug: string) => companyAttributes.find((each) => each.apiSlug === slug)?.id ?? '';
  const person = async (firstName: string) => {
    const id = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.people.id,
      id,
      values: { [m.attribute('name')]: { firstName } },
      mutationId: newId(),
    });
    return id;
  };
  const company = async (name: string) => {
    const id = newId();
    await m.client.records.create({
      workspace: m.slug,
      objectId: m.companies.id,
      id,
      values: { [onCompanies('name')]: name },
      mutationId: newId(),
    });
    return id;
  };
  return { m, team: onCompanies('team'), company: m.attribute('company'), person, newCompany: company };
}

const addTo = (m: Member, recordId: string, attributeId: string, personId: string, move?: boolean) =>
  m.client.links.add({
    workspace: m.slug,
    recordId,
    attributeId,
    targets: [{ objectId: m.people.id, recordId: personId }],
    ...(move === undefined ? {} : { move }),
    mutationId: newId(),
  });

describe('links.add and links.remove (AC-290 to AC-294)', () => {
  it('adds one link, answers the near record and the far records to read again, and removes only it', async () => {
    const { m, team, company, person, newCompany } = await setUp();
    const acme = await newCompany('Acme');
    const [ada, ben] = [await person('Ada'), await person('Ben')];
    await addTo(m, acme, team, ada);
    const answer = await addTo(m, acme, team, ben);
    expect(answer.record.values[team]).toEqual([
      { objectId: m.people.id, recordId: ada },
      { objectId: m.people.id, recordId: ben },
    ]);
    expect(answer.changedRecordIds).toEqual([ben]);
    expect(answer.echoes).toBe(2);
    expect(Object.keys(answer.written)).toEqual([team]);
    // Repeating it changes nothing and still succeeds.
    const again = await addTo(m, acme, team, ben);
    expect([again.changedRecordIds, again.echoes, again.written]).toEqual([[], 0, {}]);
    const removed = await m.client.links.remove({
      workspace: m.slug,
      recordId: acme,
      attributeId: team,
      targetRecordIds: [ada],
      mutationId: newId(),
    });
    expect(removed.record.values[team]).toEqual([{ objectId: m.people.id, recordId: ben }]);
    expect(removed.changedRecordIds).toEqual([ada]);
    const [adaNow] = await m.client.records.get({ workspace: m.slug, ids: [ada] });
    expect(adaNow?.values[company]).toBeNull();
  });

  it('answers 409 RELATIONSHIP_TAKEN naming the picked record, then moves it with move', async () => {
    const { m, team, person, newCompany } = await setUp();
    const [acme, globex] = [await newCompany('Acme'), await newCompany('Globex')];
    const ada = await person('Ada');
    await addTo(m, acme, team, ada);
    expect(await refusal(() => addTo(m, globex, team, ada))).toEqual({
      code: 'RELATIONSHIP_TAKEN',
      status: 409,
      message: 'Ada is already linked to another record through Team.',
    });
    const moved = await addTo(m, globex, team, ada, true);
    expect([...moved.changedRecordIds].sort()).toEqual([acme, ada].sort());
  });

  it('refuses records.setValues on a side that holds many with 422, naming the side', async () => {
    const { m, team, person, newCompany } = await setUp();
    const acme = await newCompany('Acme');
    const ada = await person('Ada');
    const error = await failure(() =>
      m.client.records.setValues({
        workspace: m.slug,
        recordId: acme,
        values: { [team]: { value: [{ objectId: m.people.id, recordId: ada }] } },
        mutationId: newId(),
      }),
    );
    expect([error.code, error.status]).toEqual(['ATTRIBUTE_VALUE_INVALID', 422]);
    expect(refusalsOf(error)).toEqual([
      { code: 'ATTRIBUTE_VALUE_INVALID', message: 'Add or remove links one at a time.', attributeId: team },
    ]);
  });

  it('answers 404 for a far record that doesn’t exist, and 409 RECORD_DELETED for one in the trash', async () => {
    const { m, team, person, newCompany } = await setUp();
    const acme = await newCompany('Acme');
    expect((await refusal(() => addTo(m, acme, team, newId()))).status).toBe(404);
    const gone = await person('Gone');
    await m.client.records.deleteMany({
      workspace: m.slug,
      objectId: m.people.id,
      recordIds: [gone],
      batchId: newId(),
      mutationId: newId(),
    });
    expect(await refusal(() => addTo(m, acme, team, gone))).toMatchObject({ code: 'RECORD_DELETED', status: 409 });
  });
});

describe('records.search (AC-289, AC-292)', () => {
  it('answers recent, prefix and contains results with linked and takenBy', async () => {
    const { m, team, person, newCompany } = await setUp();
    const [acme, globex] = [await newCompany('Acme'), await newCompany('Globex')];
    const [ada] = [await person('Ada'), await person('Adam'), await person('Ben')];
    await addTo(m, acme, team, ada);
    const { results } = await m.client.records.search({
      workspace: m.slug,
      objectId: m.people.id,
      query: 'ad',
      forAttributeId: team,
      forRecordId: globex,
    });
    expect(results.map((result) => result.ref.name)).toEqual(['Ada', 'Adam']);
    expect(results[0]).toMatchObject({ linked: false, takenBy: { recordId: acme, name: 'Acme' } });
    expect(results[1]?.takenBy).toBeUndefined();
    const recent = await m.client.records.search({ workspace: m.slug, objectId: m.people.id, query: '', limit: 2 });
    expect(recent.results.map((result) => result.ref.name)).toEqual(['Ben', 'Adam']);
    expect(
      (await refusal(() => m.client.records.search({ workspace: m.slug, objectId: newId(), query: '' }))).status,
    ).toBe(404);
  });
});
