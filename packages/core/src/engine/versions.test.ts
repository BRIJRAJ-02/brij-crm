// Spec 0006, milestone 1, against a real Postgres as the app role: the record
// revision on every kind of record write (AC-44), the exact version
// precondition undo uses (`ifVersionId`, AC-49), a `null` base reporting the
// version it replaced, and the outbox row naming what a write replaced with
// the writing actor, capped at 1,000 entries (AC-46).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { EngineRefusal } from '@crm/contracts/values';
import { deleteRecord, restoreRecord } from './deletion.ts';
import { newId } from './ids.ts';
import { outboxEvents, outboxHook, REPLACED_CAP } from './outbox.ts';
import { createRecord, getRecords, MAX_BATCH_CELLS, setValues, setValuesBatch } from './records.ts';
import { isRefusal } from './refusals.ts';
import { SYSTEM_ACTOR, type EngineScope } from './scope.ts';
import { createWorkspace } from './workspaces.ts';
import { capChange } from './write.ts';
import { editRecords } from '../records/records.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-versions-tests' });
});
afterAll(async () => {
  await db.close();
});

let count = 0;
async function workspace() {
  count += 1;
  const created = await createWorkspace(db, {
    name: 'Versions',
    slug: `versions-${String(count)}-${String(Date.now())}`,
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
  return { ...created, scope, companies, people, company: await slugsOf(companies), person: await slugsOf(people) };
}

const must = (value: string | undefined): string => {
  if (value === undefined) throw new Error('Expected a value.');
  return value;
};

async function refusals(promise: Promise<unknown>): Promise<readonly EngineRefusal[]> {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

async function revisionOf(scope: EngineScope, recordId: string): Promise<number | undefined> {
  return (await getRecords(scope, { ids: [recordId] }))[0]?.revision;
}

interface ReplacedRow extends Record<string, unknown> {
  readonly replaced: unknown;
  readonly mutation_id: string | null;
}

async function replacedRows(scope: EngineScope): Promise<ReplacedRow[]> {
  const result = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<ReplacedRow>(sql`select replaced, mutation_id from outbox where kind = 'records' order by seq`),
  );
  return result.rows;
}

describe('the record revision (spec 0006, AC-44)', () => {
  it('starts at 0 and grows by one with each value write, near side link write, delete and restore', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const parent = must(company.parent_company);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    const { recordId: holding } = await createRecord(scope, { objectId: companies, values: { [name]: 'Holding' } });
    expect(await revisionOf(scope, recordId)).toBe(0);

    await setValues(scope, { recordId, values: { [name]: { value: 'Acme Ltd' } } });
    expect(await revisionOf(scope, recordId)).toBe(1);
    // An unchanged value writes nothing, and moves nothing.
    await setValues(scope, { recordId, values: { [name]: { value: 'Acme Ltd' } } });
    expect(await revisionOf(scope, recordId)).toBe(1);
    // The near side of a link write.
    await setValues(scope, { recordId, values: { [parent]: { value: { objectId: companies, recordId: holding } } } });
    expect(await revisionOf(scope, recordId)).toBe(2);
    // The far side's revision doesn't move (spec 0004, AC-7).
    expect(await revisionOf(scope, holding)).toBe(0);

    await deleteRecord(scope, { recordId });
    await restoreRecord(scope, { recordId });
    expect(await revisionOf(scope, recordId)).toBe(4);
  });

  it('reads the revision on every record a batch answers', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    await setValuesBatch(scope, { items: [{ recordId, values: { [name]: { value: 'Acme Two' } } }] });
    expect(await revisionOf(scope, recordId)).toBe(1);
  });
});

describe('the exact version precondition (spec 0006, AC-49)', () => {
  it('writes when the cell is still at the version named, and refuses VERSION_CHANGED when it moved on', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const description = must(company.description);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    const first = await setValues(scope, { recordId, values: { [name]: { value: 'Acme Ltd' } } });
    const written = must(first[name]?.versionId);

    // Equal (in any spelling): it writes.
    const undone = await setValues(scope, {
      recordId,
      values: { [name]: { value: 'Acme', ifVersionId: written.toUpperCase() } },
    });
    expect(undone[name]?.versionId).toBeTruthy();

    // Unequal now: refused, naming the attribute, and nothing on the record is written, not even another cell.
    const before = await getRecords(scope, { ids: [recordId] });
    const refused = await refusals(
      setValues(scope, {
        recordId,
        values: {
          [name]: { value: 'Acme Again', ifVersionId: written },
          [description]: { value: 'Written with it' },
        },
      }),
    );
    expect(refused).toEqual([
      { code: 'VERSION_CHANGED', message: 'Name was changed since, so it was kept.', attributeId: name },
    ]);
    expect(await getRecords(scope, { ids: [recordId] })).toEqual(before);
  });

  it('checks a cleared cell by its marker, and refuses a cell that was never set', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const description = must(company.description);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    const set = await setValues(scope, { recordId, values: { [description]: { value: 'Makes things' } } });
    const cleared = await setValues(scope, { recordId, values: { [description]: { value: null } } });
    // Undo the clear: the marker's version is the cell's version.
    const restored = await setValues(scope, {
      recordId,
      values: { [description]: { value: 'Makes things', ifVersionId: must(cleared[description]?.versionId) } },
    });
    expect(restored[description]?.versionId).toBeTruthy();
    // An older version never matches.
    expect(
      await refusals(
        setValues(scope, {
          recordId,
          values: { [description]: { value: null, ifVersionId: must(set[description]?.versionId) } },
        }),
      ),
    ).toMatchObject([{ code: 'VERSION_CHANGED', attributeId: description }]);
    // A cell never set has no version to match.
    const domains = must(company.domains);
    expect(
      await refusals(
        setValues(scope, { recordId, values: { [domains]: { value: ['acme.com'], ifVersionId: newId() } } }),
      ),
    ).toMatchObject([{ code: 'VERSION_CHANGED', attributeId: domains }]);
  });

  it('checks a record reference by its latest link, as reads give it', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const parent = must(company.parent_company);
    const make = async (title: string) =>
      (await createRecord(scope, { objectId: companies, values: { [name]: title } })).recordId;
    const acme = await make('Acme');
    const holding = await make('Holding');
    const linked = await setValues(scope, {
      recordId: acme,
      values: { [parent]: { value: { objectId: companies, recordId: holding } } },
    });
    const read = (await getRecords(scope, { ids: [acme] }))[0];
    expect(read?.versions[parent]).toBe(linked[parent]?.versionId);
    const unlinked = await setValues(scope, {
      recordId: acme,
      values: { [parent]: { value: null, ifVersionId: must(linked[parent]?.versionId) } },
    });
    expect(unlinked[parent]?.versionId).toBeTruthy();
    // The same unlink again (its answer was lost): the cell already holds what it asks, so it lands, writing nothing.
    const again = await setValues(scope, {
      recordId: acme,
      values: { [parent]: { value: null, ifVersionId: must(linked[parent]?.versionId) } },
    });
    expect(again).toEqual({ [parent]: {} });
  });

  it('refuses one record of a batch and lands the others (spec 0006, AC-50)', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const make = async (title: string) =>
      (await createRecord(scope, { objectId: companies, values: { [name]: title } })).recordId;
    const acme = await make('Acme');
    const beta = await make('Beta');
    const outcomes = await setValuesBatch(scope, {
      items: [
        { recordId: acme, values: { [name]: { value: 'Acme Ltd', ifVersionId: newId() } } },
        { recordId: beta, values: { [name]: { value: 'Beta Ltd' } } },
      ],
    });
    expect(outcomes).toMatchObject([
      { recordId: acme, ok: false, refusals: [{ code: 'VERSION_CHANGED', attributeId: name }] },
      { recordId: beta, ok: true },
    ]);
  });
});

describe('the precondition and the access door (spec 0006, AC-49; spec 0009)', () => {
  it('lets a cell that already holds the value asked for pass, whatever its version (a retried undo)', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    const first = await setValues(scope, { recordId, values: { [name]: { value: 'Acme Ltd' } } });
    const undo = { recordId, values: { [name]: { value: 'Acme', ifVersionId: must(first[name]?.versionId) } } };
    await setValues(scope, undo);
    // The same undo again (its answer was lost): it lands, writing nothing.
    expect(await setValues(scope, undo)).toEqual({ [name]: {} });
  });

  it('answers a hidden attribute as unknown, never VERSION_CHANGED with its title, and reads back without it', async () => {
    const { scope, people, person } = await workspace();
    const name = must(person.name);
    const jobTitle = must(person.job_title);
    const { recordId } = await createRecord(scope, { objectId: people, values: { [jobTitle]: 'Spy' } });
    const hidden = rescope(scope, {
      role: 'member',
      rules: {
        levels: [
          {
            subject: { type: 'role', role: 'member' },
            target: { type: 'attribute', objectId: people, attributeId: jobTitle },
            level: 'hidden',
          },
        ],
        records: [],
      },
    });
    expect(
      await refusals(setValues(hidden, { recordId, values: { [jobTitle]: { value: 'Agent', ifVersionId: newId() } } })),
    ).toEqual([{ code: 'NOT_FOUND', message: expect.any(String) as string, attributeId: jobTitle }]);
    const [answer] = await editRecords(hidden, {
      items: [{ recordId, values: { [name]: { value: { firstName: 'Ada', lastName: 'L' } } } }],
    });
    expect(answer?.record?.values).not.toHaveProperty(jobTitle);
    expect(answer?.record?.versions).not.toHaveProperty(jobTitle);
    expect(Object.keys(answer?.written ?? {})).toEqual([name]);
  });

  it(`refuses a batch of more than ${String(MAX_BATCH_CELLS)} cells whole, before writing anything`, async () => {
    const { scope, person } = await workspace();
    const values = Object.fromEntries(
      [
        'job_title',
        'description',
        'timezone',
        'avatar',
        'email_opt_out',
        'phone_numbers',
        'primary_location',
        'owner',
        'email_addresses',
        'name',
        'company',
      ].map((slug) => [must(person[slug]), { value: null }]),
    );
    const items = Array.from({ length: 500 }, () => ({ recordId: newId(), values }));
    expect(await refusals(setValuesBatch(scope, { items }))).toMatchObject([{ code: 'CONFIG_INVALID' }]);
  });
});

describe('a save that replaced a value its author never saw (spec 0006, AC-46)', () => {
  it('reports the current version replaced when the base is null (never set in the caller copy)', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const description = must(company.description);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    // Someone set it after the caller read it unset.
    const theirs = await setValues(scope, { recordId, values: { [description]: { value: 'Theirs' } } });
    const mine = await setValues(scope, {
      recordId,
      values: { [description]: { value: 'Mine', baseVersionId: null } },
    });
    expect(mine[description]?.replaced?.versionId).toBe(theirs[description]?.versionId);
    // A null base on a cell nobody set reports nothing.
    const domains = must(company.domains);
    const first = await setValues(scope, {
      recordId,
      values: { [domains]: { value: ['acme.com'], baseVersionId: null } },
    });
    expect(first[domains]?.replaced).toBeUndefined();
  });

  it('stores each replaced version on the outbox row with the writing actor, and none for a current base', async () => {
    const { scope, companies, company } = await workspace();
    const name = must(company.name);
    const { recordId } = await createRecord(scope, { objectId: companies, values: { [name]: 'Acme' } });
    const base = await setValues(scope, { recordId, values: { [name]: { value: 'Acme Ltd' } } });
    const baseVersion = must(base[name]?.versionId);
    const theirs = await setValues(scope, { recordId, values: { [name]: { value: 'Acme Group' } } });

    // The system saves from the older base: last save wins, and the row names what it replaced and who.
    const asSystem = rescope(scope, { actor: SYSTEM_ACTOR });
    const mutationId = newId();
    await setValues(
      asSystem,
      { recordId, values: { [name]: { value: 'Acme Holdings', baseVersionId: baseVersion } } },
      [outboxHook({ mutationId })],
    );
    // A save from the current version replaces nothing.
    const current = must((await getRecords(scope, { ids: [recordId] }))[0]?.versions[name]);
    await setValues(scope, { recordId, values: { [name]: { value: 'Acme Inc', baseVersionId: current } } }, [
      outboxHook({ mutationId: newId() }),
    ]);

    const rows = await replacedRows(scope);
    expect(rows).toEqual([
      {
        mutation_id: mutationId,
        replaced: [
          { recordId, attributeId: name, versionId: theirs[name]?.versionId, by: { type: 'system', id: null } },
        ],
      },
      { mutation_id: expect.any(String) as string, replaced: null },
    ]);
  });

  it(`keeps up to ${String(REPLACED_CAP)} entries on one row, and leaves the list empty past that`, () => {
    const objectId = newId();
    const attributes = [newId(), newId()];
    const by = { type: 'member' as const, id: newId() };
    const changeOf = (records: number) =>
      capChange({
        kind: 'write',
        workspaceId: newId(),
        actor: by,
        createdRecords: [],
        deletedRecords: [],
        restoredRecords: [],
        purgedRecords: [],
        createdEntries: [],
        removedEntries: [],
        restoredEntries: [],
        hiddenEntries: [],
        shownEntries: [],
        purgedEntries: [],
        references: [],
        definitions: [],
        values: Array.from({ length: records }, () => newId()).flatMap((ownerId) =>
          attributes.map((attributeId) => ({
            ownerId,
            ownerKind: 'record' as const,
            objectId,
            attributeId,
            versionId: newId(),
            replaced: { versionId: newId(), setBy: { type: 'system' as const, id: null } },
          })),
        ),
      });
    const [atCap] = outboxEvents(changeOf(REPLACED_CAP / 2));
    expect(atCap?.replaced).toHaveLength(REPLACED_CAP);
    expect(atCap?.replaced?.[0]?.by).toEqual(by);
    const [past] = outboxEvents(changeOf(REPLACED_CAP / 2 + 1));
    expect(past?.recordIds).toHaveLength(REPLACED_CAP / 2 + 1);
    expect(past?.replaced).toBeUndefined();
  });
});
