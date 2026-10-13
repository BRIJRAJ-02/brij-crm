// Spec 0017, milestone 2, step 7, against a real Postgres as the app role:
// the timeline's value and link sources. The fold (only the create's
// versions), the words of a change, one entry per write on a side (3 names
// and the count), the net of a whole value write, a move, paging with no
// repeat or gap (ties at one microsecond too), the reference built from
// `getHistory`, and hidden is absent with injected rules.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { ActivityItem } from '@crm/contracts';
import { createDatabase, type Database } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { getActivity } from './activity.ts';
import { deleteRecord, restoreRecord } from './deletion.ts';
import { getHistory } from './history.ts';
import { newId } from './ids.ts';
import { isRefusal } from './refusals.ts';
import { createRecord, setValues as setRecordValues } from './records.ts';
import { createWorkspace } from './workspaces.ts';
import type { EngineScope } from './scope.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl, adminUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-activity-sources-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Timeline',
    slug: `timeline-${String(count)}-${String(Date.now())}`,
    firstMember: { name: 'Ada', email: 'ada@example.com' },
  });
  const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; slug: string }>(
      sql`select a.id::text, o.api_slug || '.' || a.api_slug as slug from attributes a join objects o on o.id = a.object_id`,
    ),
  );
  const ids = Object.fromEntries(rows.rows.map((row) => [row.slug, row.id]));
  const id = (slug: string): string => {
    const value = ids[slug];
    if (value === undefined) throw new Error(`No ${slug}.`);
    return value;
  };
  const memberId = newId();
  await db.withWorkspace(created.workspaceId, (tx) =>
    tx.execute(
      sql`insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type) values (${created.workspaceId}, ${memberId}, 'Bea', 'bea@example.com', 'member', 'system', 'system')`,
    ),
  );
  const companies = created.objects.companies ?? '';
  const people = created.objects.people ?? '';
  const deals = created.objects.deals ?? '';
  const company = async (name: string) =>
    (await createRecord(scope, { objectId: companies, values: { [id('companies.name')]: name } })).recordId;
  const person = async (firstName: string, values: Record<string, unknown> = {}) =>
    (await createRecord(scope, { objectId: people, values: { [id('people.name')]: { firstName }, ...values } }))
      .recordId;
  const ref = (objectId: string, recordId: string) => ({ objectId, recordId });
  // A member with injected rules.
  const member = (rules: NonNullable<Parameters<typeof rescope>[1]['rules']>) =>
    rescope(scope, { actor: { type: 'member', id: memberId }, role: 'member', rules });
  return { scope, ownerId: created.memberId, memberId, companies, people, deals, id, company, person, ref, member };
}

/** Sets plain values on a record (each wrapped as the write takes it). */
function setValues(scope: EngineScope, input: { readonly recordId: string; readonly values: Record<string, unknown> }) {
  return setRecordValues(scope, {
    recordId: input.recordId,
    values: Object.fromEntries(Object.entries(input.values).map(([id, value]) => [id, { value }])),
  });
}

/** The whole timeline, newest first, one page. */
async function all(scope: EngineScope, recordId: string): Promise<readonly ActivityItem[]> {
  return (await getActivity(scope, { recordId })).entries;
}

/** The whole timeline, page by page of `limit`. */
async function paged(scope: EngineScope, recordId: string, limit: number): Promise<readonly ActivityItem[]> {
  const out: ActivityItem[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page += 1) {
    const answer = await getActivity(scope, { recordId, limit, ...(cursor === undefined ? {} : { cursor }) });
    out.push(...answer.entries);
    if (answer.nextCursor === undefined) return out;
    cursor = answer.nextCursor;
  }
  throw new Error('The pages never ended.');
}

const names = (refs: ActivityItem['added']) => (refs ?? []).map((each) => each.name);

describe('the fold and the words of a change (spec 0017, AC-378)', () => {
  it('folds a create with values and links into one entry; later writes are entries of their own', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const jane = await world.person('Jane');
    const alan = await world.person('Alan');
    const { recordId: deal } = await createRecord(world.scope, {
      objectId: world.deals,
      values: {
        [world.id('deals.name')]: 'Big deal',
        [world.id('deals.next_step')]: 'Call',
        [world.id('deals.description')]: 'Rockets',
        [world.id('deals.associated_company')]: world.ref(world.companies, acme),
        [world.id('deals.associated_people')]: [world.ref(world.people, jane), world.ref(world.people, alan)],
      },
    });
    expect((await all(world.scope, deal)).map((entry) => entry.kind)).toEqual(['created']);

    await setValues(world.scope, { recordId: deal, values: { [world.id('deals.next_step')]: 'Send contract' } });
    const [change, created] = await all(world.scope, deal);
    expect(created?.kind).toBe('created');
    expect(change).toMatchObject({
      kind: 'change',
      attributeId: world.id('deals.next_step'),
      from: 'Call',
      to: 'Send contract',
      actor: { type: 'member', id: world.ownerId },
    });
    expect(change?.id).toMatch(/^value:/);
    expect(change?.key.split('|')[1]).toBe('2');

    // The far ends see the create's links as entries of their own.
    const [onAcme] = await all(world.scope, acme);
    expect(onAcme).toMatchObject({ kind: 'links', attributeId: world.id('companies.associated_deals'), addedCount: 1 });
    expect(names(onAcme?.added)).toEqual(['Big deal']);
    const [onJane] = await all(world.scope, jane);
    expect(onJane).toMatchObject({ kind: 'links', attributeId: world.id('people.associated_deals'), addedCount: 1 });
  });

  it('reads a first set, a change and a clear, with the values in their own shape', async () => {
    const world = await workspace();
    const jane = await world.person('Jane');
    const title = world.id('people.job_title');
    const emails = world.id('people.email_addresses');
    await setValues(world.scope, { recordId: jane, values: { [title]: 'CTO' } });
    await setValues(world.scope, { recordId: jane, values: { [title]: 'CEO', [emails]: ['a@x.com', 'b@x.com'] } });
    await setValues(world.scope, { recordId: jane, values: { [title]: null } });
    const entries = (await all(world.scope, jane)).filter((entry) => entry.kind === 'change');
    const titles = entries.filter((entry) => entry.attributeId === title).map((entry) => [entry.from, entry.to]);
    expect(titles).toEqual([
      ['CEO', null],
      ['CTO', 'CEO'],
      [null, 'CTO'],
    ]);
    const mails = entries.find((entry) => entry.attributeId === emails);
    expect(mails).toMatchObject({ from: null, to: ['a@x.com', 'b@x.com'] });
  });

  it('never shows system attributes', async () => {
    const world = await workspace();
    const jane = await world.person('Jane');
    await setValues(world.scope, { recordId: jane, values: { [world.id('people.job_title')]: 'CTO' } });
    const attributeIds = new Set((await all(world.scope, jane)).flatMap((entry) => entry.attributeId ?? []));
    for (const system of ['created_at', 'created_by', 'updated_at', 'updated_by', 'record_id']) {
      const systemId = (() => {
        try {
          return world.id(`people.${system}`);
        } catch {
          return undefined;
        }
      })();
      if (systemId !== undefined) expect(attributeIds.has(systemId)).toBe(false);
    }
  });
});

describe('a side changed many at once (spec 0017, AC-379)', () => {
  it('reads one entry naming 3 and counting all, makes none for a reorder, and nets a replace', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const team = world.id('companies.team');
    const people: string[] = [];
    for (let index = 0; index < 100; index += 1) people.push(await world.person(`P${String(index).padStart(3, '0')}`));
    await setValues(world.scope, {
      recordId: acme,
      values: { [team]: people.map((recordId) => world.ref(world.people, recordId)) },
    });
    const [added] = await all(world.scope, acme);
    expect(added).toMatchObject({ kind: 'links', attributeId: team, addedCount: 100, removedCount: 0 });
    // The first 3 by the side's own order.
    expect(names(added?.added)).toEqual(['P000', 'P001', 'P002']);
    expect(added?.added?.[0]).toMatchObject({ objectId: world.people, recordId: people[0], kind: 'person' });
    expect(added?.id).toMatch(new RegExp(`^links:${team}:`));
    expect(added?.key.split('|')[1]).toBe('1');

    // Reordered only: no entry.
    const before = (await all(world.scope, acme)).length;
    await setValues(world.scope, {
      recordId: acme,
      values: { [team]: [...people].reverse().map((recordId) => world.ref(world.people, recordId)) },
    });
    expect(await all(world.scope, acme)).toHaveLength(before);

    // Two left and one came: one entry with both.
    const newcomer = await world.person('Zed');
    const kept = [...people].reverse().slice(2);
    await setValues(world.scope, {
      recordId: acme,
      values: { [team]: [...kept, newcomer].map((recordId) => world.ref(world.people, recordId)) },
    });
    const [net] = await all(world.scope, acme);
    expect(net).toMatchObject({ kind: 'links', addedCount: 1, removedCount: 2 });
    expect(names(net?.added)).toEqual(['Zed']);
    expect(names(net?.removed).sort()).toEqual(['P098', 'P099']);
    // Each removed person's own side reads the change too, a side that holds one: from Acme to nothing.
    const [onRemoved] = await all(world.scope, people[99] ?? '');
    expect(onRemoved).toMatchObject({ kind: 'change', attributeId: world.id('people.company'), to: null, toRefs: [] });
    expect(onRemoved?.fromRefs?.map((each) => each.name)).toEqual(['Acme']);
  });

  it('reads a move on a side that holds one as one change, and on both companies as a removal and an add', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const globex = await world.company('Globex');
    const company = world.id('people.company');
    const jane = await world.person('Jane', { [company]: world.ref(world.companies, acme) });
    // The create's link folds into Jane's creation.
    expect((await all(world.scope, jane)).map((entry) => entry.kind)).toEqual(['created']);
    await setValues(world.scope, { recordId: jane, values: { [company]: world.ref(world.companies, globex) } });
    const [move] = await all(world.scope, jane);
    expect(move).toMatchObject({
      kind: 'change',
      attributeId: company,
      from: { objectId: world.companies, recordId: acme },
      to: { objectId: world.companies, recordId: globex },
    });
    expect(move?.fromRefs?.map((each) => each.name)).toEqual(['Acme']);
    expect(move?.toRefs?.map((each) => each.name)).toEqual(['Globex']);
    const [left, joined] = [(await all(world.scope, acme))[0], (await all(world.scope, globex))[0]];
    expect(left).toMatchObject({ kind: 'links', removedCount: 1, addedCount: 0 });
    expect(names(left?.removed)).toEqual(['Jane']);
    expect(joined).toMatchObject({ kind: 'links', addedCount: 1, removedCount: 0 });
    // Acme also has Jane's creation link, an add.
    expect((await all(world.scope, acme)).map((entry) => [entry.kind, entry.addedCount, entry.removedCount])).toEqual([
      ['links', 0, 1],
      ['links', 1, 0],
      ['created', undefined, undefined],
    ]);
  });
});

describe('paging (spec 0017, AC-380)', () => {
  it('pages any size through every source with no repeat and no gap, ending with the creation', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const globex = await world.company('Globex');
    const description = world.id('companies.description');
    const domains = world.id('companies.domains');
    const team = world.id('companies.team');
    const people = [await world.person('A'), await world.person('B'), await world.person('C')];
    for (let index = 0; index < 6; index += 1) {
      await setValues(world.scope, { recordId: acme, values: { [description]: `Version ${String(index)}` } });
      await setValues(world.scope, {
        recordId: acme,
        values: { [team]: people.slice(0, (index % 3) + 1).map((id) => world.ref(world.people, id)) },
      });
      if (index % 2 === 0) {
        await setValues(world.scope, {
          recordId: acme,
          values: {
            [domains]: [`acme${String(index)}.com`],
            [world.id('companies.parent_company')]: world.ref(world.companies, globex),
          },
        });
      }
    }
    const whole = await all(world.scope, acme);
    expect(whole.at(-1)?.kind).toBe('created');
    const ids = whole.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const limit of [1, 2, 3, 7]) {
      expect((await paged(world.scope, acme, limit)).map((entry) => entry.id)).toEqual(ids);
    }
  });

  it('orders entries at one microsecond by rank, then by id, and pages through the tie', async () => {
    const world = await workspace();
    const jane = await world.person('Jane');
    const acme = await world.company('Acme');
    await setValues(world.scope, {
      recordId: jane,
      values: {
        [world.id('people.job_title')]: 'CTO',
        [world.id('people.timezone')]: 'Europe/London',
        [world.id('people.description')]: 'Hello',
        [world.id('people.company')]: world.ref(world.companies, acme),
      },
    });
    // Put the three versions at one moment (a superuser, past row level security).
    const moment = '2030-01-01T00:00:00.000001Z';
    await testQuery(adminUrl, `update "values" set active_from = $2 where owner_id = $1 and version_id <> $1`, [
      jane,
      moment,
    ]);
    await testQuery(adminUrl, `update record_links set active_from = $2 where from_record_id = $1`, [jane, moment]);
    const whole = await all(world.scope, jane);
    expect(whole.slice(0, 3).map((entry) => entry.key.split('|').slice(0, 2).join('|'))).toEqual([
      '2030-01-01T00:00:00.000001Z|2',
      '2030-01-01T00:00:00.000001Z|2',
      '2030-01-01T00:00:00.000001Z|2',
    ]);
    // The side that holds one is a change ("links:" sorts before "value:").
    expect(whole[0]?.id).toMatch(/^links:/);
    const valueIds = whole.slice(1, 3).map((entry) => entry.id);
    expect([...valueIds].sort()).toEqual(valueIds);
    expect((await paged(world.scope, jane, 1)).map((entry) => entry.id)).toEqual(whole.map((entry) => entry.id));
  });
});

describe('the reference from history (spec 0017, 0017-activity.md tests)', () => {
  it.each([7, 11, 23, 101])(
    'agrees with getHistory for every attribute and both sides, over writes seeded %i',
    async (start) => {
      const world = await workspace();
      const companies = [await world.company('C0'), await world.company('C1'), await world.company('C2')];
      const people: string[] = [];
      for (let index = 0; index < 6; index += 1) people.push(await world.person(`P${String(index)}`));
      const deals: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        deals.push(
          (
            await createRecord(world.scope, {
              objectId: world.deals,
              values: { [world.id('deals.name')]: `D${String(index)}` },
            })
          ).recordId,
        );
      }
      const subject = people[0] ?? '';
      const title = world.id('people.job_title');
      const emails = world.id('people.email_addresses');
      const company = world.id('people.company');
      const associated = world.id('people.associated_deals');
      // A small seeded random walk of writes on the subject, from both ends, with far records deleted and restored.
      let seed = start;
      const random = () => {
        seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
        return seed / 2_147_483_648;
      };
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
      // An empty list is written as a clear.
      const listOf = <T>(items: readonly T[]): readonly T[] | null => (items.length === 0 ? null : items);
      for (let step = 0; step < 40; step += 1) {
        const roll = random();
        // A refused write (a person on another team, a deal in the trash) writes nothing, which the reference holds too.
        try {
          if (roll < 0.2) {
            await setValues(world.scope, {
              recordId: subject,
              values: { [title]: random() < 0.2 ? null : `T${String(step)}` },
            });
          } else if (roll < 0.3) {
            await setValues(world.scope, {
              recordId: subject,
              values: { [emails]: random() < 0.3 ? null : [`m${String(step)}@x.com`, `n${String(step)}@x.com`] },
            });
          } else if (roll < 0.45) {
            await setValues(world.scope, {
              recordId: subject,
              values: { [company]: random() < 0.2 ? null : world.ref(world.companies, pick(companies)) },
            });
          } else if (roll < 0.6) {
            const chosen = deals.filter(() => random() < 0.5);
            await setValues(world.scope, {
              recordId: subject,
              values: { [associated]: listOf(chosen.map((id) => world.ref(world.deals, id))) },
            });
          } else if (roll < 0.8) {
            // From the far end: a deal's people, which may add or drop the subject.
            const deal = pick(deals);
            const chosen = people.filter((id) => (id === subject ? random() < 0.5 : random() < 0.3));
            await setValues(world.scope, {
              recordId: deal,
              values: {
                [world.id('deals.associated_people')]: listOf(chosen.map((id) => world.ref(world.people, id))),
              },
            });
          } else if (roll < 0.9) {
            // A company's team: may move the subject in or out.
            const target = pick(companies);
            const chosen = people.filter((id) => (id === subject ? random() < 0.5 : random() < 0.3));
            await setValues(world.scope, {
              recordId: target,
              values: { [world.id('companies.team')]: listOf(chosen.map((id) => world.ref(world.people, id))) },
            });
          } else {
            const deal = pick(deals);
            await deleteRecord(world.scope, { recordId: deal });
            if (random() < 0.5) await restoreRecord(world.scope, { recordId: deal });
          }
        } catch (error) {
          if (!isRefusal(error)) throw error;
        }
      }
      for (const deal of deals) {
        try {
          await restoreRecord(world.scope, { recordId: deal });
        } catch {
          // Already live.
        }
      }
      const timeline = await paged(world.scope, subject, 7);
      // Values: each version after the first is a change from the one before (the subject was created with a name only).
      for (const attributeId of [title, emails]) {
        const history = await getHistory(world.scope, { recordId: subject, attributeId });
        const expected = history.map((version, index) => [
          index === 0 ? null : history[index - 1]?.value,
          version.value,
        ]);
        const got = timeline
          .filter((entry) => entry.attributeId === attributeId)
          .map((entry) => [entry.from, entry.to])
          .reverse();
        expect(got).toEqual(expected);
        expect(expected.length).toBeGreaterThan(1);
      }
      // References: each version is the net of the moment before it.
      const idsOf = (value: unknown): string[] =>
        value === null
          ? []
          : (Array.isArray(value) ? value : [value]).map((item: { recordId: string }) => item.recordId);
      for (const attributeId of [company, associated]) {
        const history = await getHistory(world.scope, { recordId: subject, attributeId });
        const expected = history
          .map((version, index) => {
            const before = new Set(index === 0 ? [] : idsOf(history[index - 1]?.value));
            const after = new Set(idsOf(version.value));
            return {
              added: [...after].filter((id) => !before.has(id)).sort(),
              removed: [...before].filter((id) => !after.has(id)).sort(),
            };
          })
          .filter((net) => net.added.length + net.removed.length > 0);
        const got = timeline
          .filter((entry) => entry.attributeId === attributeId)
          .reverse()
          .map((entry) =>
            entry.kind === 'change'
              ? { added: idsOf(entry.to), removed: idsOf(entry.from) }
              : {
                  added: [...(entry.added ?? [])].map((each) => each.recordId).sort(),
                  removed: [...(entry.removed ?? [])].map((each) => each.recordId).sort(),
                },
          );
        expect(got).toEqual(expected);
        expect(expected.length).toBeGreaterThan(1);
      }
    },
    120_000,
  );
});

describe('hidden is absent (spec 0017, AC-382)', () => {
  it('leaves out a hidden attribute, a hidden far object, a far record outside the rule, and a far record in the trash', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const team = world.id('companies.team');
    const jane = await world.person('Jane');
    const owned = await world.person('Owned', { [world.id('people.owner')]: { type: 'member', id: world.memberId } });
    await setValues(world.scope, {
      recordId: acme,
      values: { [world.id('companies.description')]: 'Rockets' },
    });
    await setValues(world.scope, {
      recordId: acme,
      values: { [team]: [world.ref(world.people, jane), world.ref(world.people, owned)] },
    });
    const kinds = (entries: readonly ActivityItem[]) => entries.map((entry) => entry.kind);
    expect(kinds(await all(world.scope, acme))).toEqual(['links', 'change', 'created']);

    const hidesDescription = world.member({
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: world.companies, attributeId: world.id('companies.description') },
          level: 'hidden',
        },
      ],
      records: [],
    });
    expect(kinds(await all(hidesDescription, acme))).toEqual(['links', 'created']);

    const hidesPeople = world.member({
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'object', objectId: world.people },
          level: 'none',
        },
      ],
      records: [],
    });
    expect(kinds(await all(hidesPeople, acme))).toEqual(['change', 'created']);

    const ownPeopleOnly = world.member({
      levels: [],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: world.people,
          kind: 'own',
          attributeId: world.id('people.owner'),
        },
      ],
    });
    const [ruled] = await all(ownPeopleOnly, acme);
    expect(ruled).toMatchObject({ kind: 'links', addedCount: 1 });
    expect(names(ruled?.added)).toEqual(['Owned']);

    // A far record in the trash: left out, and back with a restore.
    await deleteRecord(world.scope, { recordId: jane });
    const [withoutJane] = await all(world.scope, acme);
    expect(withoutJane).toMatchObject({ kind: 'links', addedCount: 1 });
    expect(names(withoutJane?.added)).toEqual(['Owned']);
    await restoreRecord(world.scope, { recordId: jane });
    expect((await all(world.scope, acme))[0]).toMatchObject({ addedCount: 2 });
  });

  it('names who did it: a member, or the system', async () => {
    const world = await workspace();
    const jane = await world.person('Jane');
    const title = world.id('people.job_title');
    await setValues(rescope(world.scope, { actor: { type: 'system', id: null } }), {
      recordId: jane,
      values: { [title]: 'By the system' },
    });
    await setValues(world.scope, { recordId: jane, values: { [title]: 'By Ada' } });
    const [byAda, bySystem] = await all(world.scope, jane);
    expect(byAda?.actor).toEqual({ type: 'member', id: world.ownerId });
    expect(bySystem?.actor).toEqual({ type: 'system', id: null });
    // The system's link moments are keyed with "none" for its id.
    const acme = await world.company('Acme');
    await setValues(rescope(world.scope, { actor: { type: 'system', id: null } }), {
      recordId: jane,
      values: { [world.id('people.company')]: world.ref(world.companies, acme) },
    });
    const [moved] = await all(world.scope, jane);
    expect(moved?.id).toMatch(/:system:none$/);
    expect(moved?.actor).toEqual({ type: 'system', id: null });
  });
});

describe('the review of milestone 2: hidden actors, hidden sides and names, and long runs of reorders', () => {
  it('names nobody on changes and link entries when a field rule hides Updated by or Created by', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const jane = await world.person('Jane');
    await setValues(world.scope, { recordId: acme, values: { [world.id('companies.description')]: 'Rockets' } });
    await setValues(world.scope, {
      recordId: acme,
      values: { [world.id('companies.team')]: [world.ref(world.people, jane)] },
    });
    for (const column of ['updated_by', 'created_by']) {
      const hides = world.member({
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: world.companies, attributeId: world.id(`companies.${column}`) },
            level: 'hidden',
          },
        ],
        records: [],
      });
      const entries = await all(hides, acme);
      expect(entries.map((entry) => entry.kind)).toEqual(['links', 'change', 'created']);
      for (const entry of entries.slice(0, 2)) expect(entry).not.toHaveProperty('actor');
    }
    // Under the open policy, every entry names who did it.
    for (const entry of await all(world.scope, acme)) {
      expect(entry.actor).toEqual({ type: 'member', id: world.ownerId });
    }
  });

  it('leaves out a hidden relationship side from either end', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const jane = await world.person('Jane');
    await setValues(world.scope, {
      recordId: jane,
      values: { [world.id('people.company')]: world.ref(world.companies, acme) },
    });
    const hideField = (objectId: string, slug: string) =>
      world.member({
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId, attributeId: world.id(slug) },
            level: 'hidden',
          },
        ],
        records: [],
      });
    expect((await all(hideField(world.companies, 'companies.team'), acme)).map((entry) => entry.kind)).toEqual([
      'created',
    ]);
    expect((await all(hideField(world.people, 'people.company'), jane)).map((entry) => entry.kind)).toEqual([
      'created',
    ]);
  });

  it('counts and names only far records the viewer may see, for removals and for a side that holds one', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    await setValues(world.scope, {
      recordId: acme,
      values: { [world.id('companies.owner')]: { type: 'member', id: world.memberId } },
    });
    const globex = await world.company('Globex');
    const team = world.id('companies.team');
    const company = world.id('people.company');
    const owned = { [world.id('people.owner')]: { type: 'member', id: world.memberId } };
    const mine = await world.person('Mine', owned);
    const theirs = await world.person('Theirs');
    const gone = await world.person('Gone', owned);
    await setValues(world.scope, {
      recordId: acme,
      values: { [team]: [mine, theirs, gone].map((id) => world.ref(world.people, id)) },
    });
    // Gone goes to the trash (its link stays, hidden), then the team is cleared: Mine and Theirs leave.
    await deleteRecord(world.scope, { recordId: gone });
    await setValues(world.scope, { recordId: acme, values: { [team]: null } });
    const ownPeople = world.member({
      levels: [],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: world.people,
          kind: 'own',
          attributeId: world.id('people.owner'),
        },
      ],
    });
    const [removal, addition] = await all(ownPeople, acme);
    expect(removal).toMatchObject({ kind: 'links', removedCount: 1, addedCount: 0 });
    expect(names(removal?.removed)).toEqual(['Mine']);
    expect(addition).toMatchObject({ kind: 'links', addedCount: 1 });
    expect(names(addition?.added)).toEqual(['Mine']);

    // A side that holds one: Mine moves from Acme (the member's) to Globex (not): under a rule on Companies, the
    // move reads as leaving Acme for nothing the member can see.
    await setValues(world.scope, { recordId: mine, values: { [company]: world.ref(world.companies, acme) } });
    await setValues(world.scope, { recordId: mine, values: { [company]: world.ref(world.companies, globex) } });
    const ownCompanies = world.member({
      levels: [],
      records: [
        {
          subject: { type: 'role', role: 'member' },
          objectId: world.companies,
          kind: 'own',
          attributeId: world.id('companies.owner'),
        },
        {
          subject: { type: 'role', role: 'member' },
          objectId: world.people,
          kind: 'own',
          attributeId: world.id('people.owner'),
        },
      ],
    });
    const seen = await all(ownCompanies, mine);
    expect(seen[0]).toMatchObject({ kind: 'change', attributeId: company, to: null, toRefs: [] });
    expect(seen[0]?.fromRefs?.map((each) => each.name)).toEqual(['Acme']);
    expect(JSON.stringify(seen)).not.toContain('Globex');
    expect(JSON.stringify(seen)).not.toContain(globex);
  });

  it('names a far record whose name the viewer may not see as unnamed', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const jane = await world.person('Jane');
    await setValues(world.scope, {
      recordId: acme,
      values: { [world.id('companies.team')]: [world.ref(world.people, jane)] },
    });
    const hidesNames = world.member({
      levels: [
        {
          subject: { type: 'role', role: 'member' },
          target: { type: 'attribute', objectId: world.people, attributeId: world.id('people.name') },
          level: 'hidden',
        },
      ],
      records: [],
    });
    const [entry] = await all(hidesNames, acme);
    expect(names(entry?.added)).toEqual(['Unnamed person']);
  });

  it('pages through a long run of reorders in bounded reads, skipping nothing', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const team = world.id('companies.team');
    const people = [await world.person('A'), await world.person('B'), await world.person('C')];
    const order = (ids: readonly string[]) => ids.map((id) => world.ref(world.people, id));
    await setValues(world.scope, { recordId: acme, values: { [team]: order(people) } });
    await setValues(world.scope, { recordId: acme, values: { [world.id('companies.description')]: 'Before' } });
    for (let index = 0; index < 30; index += 1) {
      await setValues(world.scope, {
        recordId: acme,
        values: { [team]: order(index % 2 === 0 ? [...people].reverse() : people) },
      });
    }
    await setValues(world.scope, { recordId: acme, values: { [world.id('companies.description')]: 'After' } });
    const whole = (await all(world.scope, acme)).map((entry) => entry.id);
    expect(whole).toHaveLength(4);
    // With pages of 2, a side reads 3 moments at a time: the 30 reorders take more reads than a page allows, so a
    // page stops short and the next one goes on from where it stopped.
    expect((await paged(world.scope, acme, 2)).map((entry) => entry.id)).toEqual(whole);
    const first = await getActivity(world.scope, { recordId: acme, limit: 2 });
    expect(first.entries.length).toBeLessThanOrEqual(2);
    expect(first.nextCursor).toBeDefined();
  }, 60_000);
});

describe('history names nobody to a reader who may not see who changed things (spec 0017, owner decision 3)', () => {
  it('leaves setBy out of every value and reference version when Updated by or Created by is hidden', async () => {
    const world = await workspace();
    const acme = await world.company('Acme');
    const jane = await world.person('Jane');
    const description = world.id('companies.description');
    const team = world.id('companies.team');
    await setValues(world.scope, { recordId: acme, values: { [description]: 'Rockets' } });
    await setValues(world.scope, { recordId: acme, values: { [description]: 'Satellites' } });
    await setValues(world.scope, { recordId: acme, values: { [team]: [world.ref(world.people, jane)] } });
    await setValues(world.scope, { recordId: acme, values: { [team]: null } });
    const hiding = (slug: string) =>
      world.member({
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: world.companies, attributeId: world.id(slug) },
            level: 'hidden',
          },
        ],
        records: [],
      });
    for (const denied of [hiding('companies.updated_by'), hiding('companies.created_by')]) {
      for (const attributeId of [description, team]) {
        const versions = await getHistory(denied, { recordId: acme, attributeId });
        expect(versions.length).toBeGreaterThan(1);
        for (const version of versions) expect(version).not.toHaveProperty('setBy');
      }
      // The far end too: Jane's Company was set by Acme's Team write, whose actor is Acme's hidden Updated by.
      const far = await getHistory(denied, { recordId: jane, attributeId: world.id('people.company') });
      expect(far.length).toBeGreaterThan(1);
      for (const version of far) expect(version).not.toHaveProperty('setBy');
      // And Jane's timeline names nobody for that link, though People's own fields are visible.
      const [linked] = await all(denied, jane);
      expect(linked).toMatchObject({ kind: 'change', attributeId: world.id('people.company') });
      expect(linked).not.toHaveProperty('actor');
    }
    // A reader who may see both, and the open policy, are told who set each version.
    const seesAll = world.member({ levels: [], records: [] });
    for (const reader of [seesAll, world.scope]) {
      for (const attributeId of [description, team]) {
        const versions = await getHistory(reader, { recordId: acme, attributeId });
        expect(versions.every((version) => version.setBy?.id === world.ownerId)).toBe(true);
      }
    }
  });
});
