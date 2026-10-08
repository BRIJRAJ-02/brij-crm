// Milestone 1 of spec 0004: one value through every layer, against a real
// Postgres as the app role (row level security on).
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import { isRefusal } from './refusals.ts';
import type { Actor, EngineScope } from './scope.ts';
import { defineAttribute, defineObject } from './definitions.ts';
import { createRecord, getRecords, setValues } from './records.ts';
import { createWorkspace } from './workspaces.ts';
import type { AfterWrite, Change } from './write.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl } = inject('testDatabase');
let db: Database;

beforeAll(() => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-engine-tests' });
});
afterAll(async () => {
  await db.close();
});

let slugs = 0;
async function workspace() {
  slugs += 1;
  const created = await createWorkspace(db, {
    name: 'Acme',
    slug: `acme-${String(slugs)}-${String(Date.now())}`,
    firstMember: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  const actor: Actor = { type: 'member', id: created.memberId };
  const scope = testScope({ db, workspaceId: created.workspaceId, actor });
  return { ...created, scope };
}

async function attributeIds(scope: EngineScope, objectId: string) {
  const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
    tx.execute<{ id: string; api_slug: string }>(
      sql`select id, api_slug from attributes where object_id = ${objectId}`,
    ),
  );
  return Object.fromEntries(rows.rows.map((row) => [row.api_slug, row.id]));
}

async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isRefusal(error)) return error.refusals;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

describe('a new workspace', () => {
  it('seeds People, Companies and Deals as ordinary objects with system and primary attributes (AC-1)', async () => {
    const { scope, objects } = await workspace();
    expect(Object.keys(objects).sort()).toEqual(['companies', 'deals', 'people']);
    const people = await attributeIds(scope, objects.people ?? '');
    for (const slug of [
      'record_id',
      'created_at',
      'created_by',
      'updated_at',
      'updated_by',
      'name',
      'email_addresses',
    ]) {
      expect(people[slug], slug).toBeDefined();
    }
    const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ standard_key: string; primary: string; is_standard: boolean }>(
        sql`select o.standard_key, a.api_slug as primary, o.is_standard from objects o join attributes a on a.id = o.primary_attribute_id order by o.standard_key`,
      ),
    );
    expect(rows.rows).toEqual([
      { standard_key: 'companies', primary: 'name', is_standard: true },
      { standard_key: 'deals', primary: 'name', is_standard: true },
      { standard_key: 'people', primary: 'name', is_standard: true },
    ]);
  });

  it('refuses a workspace address that is taken', async () => {
    const slug = `taken-${String(Date.now())}`;
    await createWorkspace(db, { name: 'One', slug, firstMember: { name: 'A', email: 'a@example.com' } });
    const refusals = await refusalOf(
      createWorkspace(db, { name: 'Two', slug, firstMember: { name: 'B', email: 'b@example.com' } }),
    );
    expect(refusals[0]?.code).toBe('SLUG_TAKEN');
  });
});

describe('records and values', () => {
  it('runs a custom object through the same path as a standard one (AC-1, AC-2, AC-19)', async () => {
    const { scope } = await workspace();
    const { objectId } = await defineObject(scope, {
      apiSlug: 'projects',
      singularName: 'Project',
      pluralName: 'Projects',
      icon: 'folder',
      hue: 'green',
    });
    const { attributeId: website } = await defineAttribute(scope, {
      objectId,
      apiSlug: 'website',
      title: 'Website',
      type: 'url',
    });
    const ids = await attributeIds(scope, objectId);
    const { recordId } = await createRecord(scope, {
      objectId,
      values: { [ids.name ?? '']: 'Apollo', [website]: 'https://apollo.example.com' },
    });
    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[website]).toBe('https://apollo.example.com');
    expect(record?.display).toEqual({ objectId, recordId, name: 'Apollo', kind: 'other', hue: 'green' });
    expect(record?.values[ids.record_id ?? '']).toBe(recordId);
    expect(record?.createdBy).toEqual(scope.actor);

    const { recordId: unnamed } = await createRecord(scope, { objectId });
    const [blank] = await getRecords(scope, { ids: [unnamed] });
    expect(blank?.display.name).toBe('Unnamed project');
  });

  it('keeps every version with who and when, never backwards, and clears as a version (AC-3, AC-7)', async () => {
    const { scope, objects } = await workspace();
    const ids = await attributeIds(scope, objects.people ?? '');
    const email = ids.email_addresses ?? '';
    const { recordId } = await createRecord(scope, {
      objectId: objects.people ?? '',
      values: { [email]: ['ADA@example.com', 'ada@work.example.com'] },
    });
    await setValues(scope, { recordId, values: { [email]: { value: ['ada@work.example.com'] } } });
    const unchanged = await setValues(scope, { recordId, values: { [email]: { value: ['ada@work.example.com'] } } });
    expect(unchanged[email]).toEqual({});
    await setValues(scope, { recordId, values: { [email]: { value: null } } });

    const [record] = await getRecords(scope, { ids: [recordId] });
    expect(record?.values[email]).toBeNull();

    const versions = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{
        version_id: string;
        position: number;
        text_value: string | null;
        is_cleared: boolean;
        from: string;
        until: string | null;
        set_by_type: string;
      }>(sql`
        select version_id, position, text_value, is_cleared, active_from::text as from, active_until::text as until, set_by_type
        from "values" where owner_id = ${recordId} and attribute_id = ${email} order by active_from, position
      `),
    );
    const byVersion = new Map<string, typeof versions.rows>();
    for (const row of versions.rows) byVersion.set(row.version_id, [...(byVersion.get(row.version_id) ?? []), row]);
    expect([...byVersion.values()].map((rows) => rows.map((row) => row.text_value))).toEqual([
      ['ada@example.com', 'ada@work.example.com'],
      ['ada@work.example.com'],
      [null],
    ]);
    const cleared = versions.rows.at(-1);
    expect(cleared?.is_cleared).toBe(true);
    expect(cleared?.until).toBeNull();
    const starts = [...byVersion.values()].map((rows) => rows[0]?.from ?? '');
    const ends = [...byVersion.values()].map((rows) => rows[0]?.until);
    expect(ends.slice(0, -1)).toEqual(starts.slice(1));
    expect(versions.rows.every((row) => row.set_by_type === 'member')).toBe(true);

    const touched = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ moved: boolean }>(sql`select updated_at > created_at as moved from records where id = ${recordId}`),
    );
    expect(touched.rows[0]?.moved).toBe(true);
  });

  it('refuses every bad value at once and writes nothing (AC-2, AC-13)', async () => {
    const { scope, objects } = await workspace();
    const peopleId = objects.people ?? '';
    const ids = await attributeIds(scope, peopleId);
    const refusals = await refusalOf(
      createRecord(scope, {
        objectId: peopleId,
        values: {
          [ids.email_addresses ?? '']: ['not an email'],
          [ids.name ?? '']: { firstName: 42 },
          [ids.created_at ?? '']: 'x',
        },
      }),
    );
    expect(refusals.map((refusal) => refusal.attributeId).sort()).toEqual(
      [ids.email_addresses, ids.name, ids.created_at].sort(),
    );
    expect(refusals.find((refusal) => refusal.attributeId === ids.created_at)?.code).toBe('ATTRIBUTE_READ_ONLY');
    expect(refusals.find((refusal) => refusal.attributeId === ids.email_addresses)?.code).toBe(
      'ATTRIBUTE_VALUE_INVALID',
    );
    const counts = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ records: number }>(sql`select count(*)::int as records from records`),
    );
    expect(counts.rows[0]?.records).toBe(0);
  });

  it('runs hooks inside the write, and a failing hook undoes it (AC-17)', async () => {
    const { scope, objects } = await workspace();
    const peopleId = objects.people ?? '';
    const ids = await attributeIds(scope, peopleId);
    const seen: Change[] = [];
    const watch: AfterWrite = (change) => {
      seen.push(change);
      return Promise.resolve();
    };
    const { recordId } = await createRecord(
      scope,
      { objectId: peopleId, values: { [ids.name ?? '']: { fullName: 'Grace Hopper' } } },
      [watch],
    );
    expect(seen[0]?.createdRecords).toEqual([{ recordId, objectId: peopleId }]);
    expect(
      seen[0]?.values.map((value) => [value.attributeId, value.ownerKind, 'objectId' in value && value.objectId]),
    ).toEqual([[ids.name, 'record', peopleId]]);

    const failing: AfterWrite = () => Promise.reject(new Error('the outbox is down'));
    await expect(
      createRecord(scope, { objectId: peopleId, values: { [ids.name ?? '']: { fullName: 'Not kept' } } }, [failing]),
    ).rejects.toThrow('the outbox is down');
    const counts = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ records: number; values: number }>(
        sql`select (select count(*)::int from records) as records, (select count(*)::int from "values") as values`,
      ),
    );
    expect(counts.rows[0]).toEqual({ records: 1, values: 1 });
  });

  it('keeps one current version under concurrent saves, and names the save it replaced (AC-3, AC-12)', async () => {
    const { scope, objects } = await workspace();
    const peopleId = objects.people ?? '';
    const ids = await attributeIds(scope, peopleId);
    const name = ids.name ?? '';
    const { recordId, versions } = await createRecord(scope, {
      objectId: peopleId,
      values: { [name]: { fullName: 'First' } },
    });
    const base = versions[name]?.versionId ?? '';
    const other: EngineScope = rescope(scope, { actor: { type: 'system', id: null } });
    const [a, b] = await Promise.all([
      setValues(scope, { recordId, values: { [name]: { value: { fullName: 'From A' }, baseVersionId: base } } }),
      setValues(other, { recordId, values: { [name]: { value: { fullName: 'From B' }, baseVersionId: base } } }),
    ]);
    const replaced = [a[name]?.replaced, b[name]?.replaced].filter((each) => each !== undefined);
    expect(replaced).toHaveLength(1);
    const current = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from "values" where owner_id = ${recordId} and attribute_id = ${name} and active_until is null`,
      ),
    );
    expect(current.rows[0]?.n).toBe(1);
  });

  it('refuses a client id that is not a UUID v7, and one that is taken', async () => {
    const { scope, objects } = await workspace();
    const peopleId = objects.people ?? '';
    expect((await refusalOf(createRecord(scope, { objectId: peopleId, id: crypto.randomUUID() })))[0]?.code).toBe(
      'CONFIG_INVALID',
    );
    const { recordId } = await createRecord(scope, { objectId: peopleId });
    expect((await refusalOf(createRecord(scope, { objectId: peopleId, id: recordId })))[0]?.code).toBe('ID_TAKEN');
  });
});
