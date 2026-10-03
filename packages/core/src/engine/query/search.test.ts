// The search function behind contains (spec 0004, stored sort keys, AC-24,
// AC-25): it reads past row level security, so these tests prove it stays
// inside the session's workspace, returns nothing without one, matches its
// pattern literally, and that a page answers the same with it or without it.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database, type WorkspaceTx } from '@crm/db';
import type { FilterGroup } from '@crm/contracts/values';
import { deleteRecord } from '../deletion.ts';
import { createRecord, setValues } from '../records.ts';
import type { EngineScope } from '../scope.ts';
import { createWorkspace } from '../workspaces.ts';
import { countMatches, queryPage } from './page.ts';

const { appUrl } = inject('testDatabase');
let db: Database;
let scope: EngineScope;
let deals: string;
let name: string;
let theirName: string;
const recordOf: Record<string, string> = {};

const NAMES = ['Rocket_fuel 100%', 'Rocketxfuel 1000', 'ROCKET pad', 'Tiny', 'Retired rocket', 'Renamed rocket'];

async function nameAttribute(scopeOf: EngineScope, objectId: string): Promise<string> {
  const found = await db.withWorkspace(scopeOf.workspaceId, (tx) =>
    tx.execute<{ id: string }>(
      sql`select id::text from attributes where object_id = ${objectId} and api_slug = 'name'`,
    ),
  );
  const id = found.rows[0]?.id;
  if (id === undefined) throw new Error('No name attribute.');
  return id;
}

/** The function's answer, called the way the engine calls it, as a sorted list. */
const search = async (tx: WorkspaceTx, attributeId: string, pattern: string, limit = 5000) =>
  (
    await tx.execute<{ id: string }>(
      sql`select public.crm_search_text(${attributeId}::uuid, ${pattern}, ${limit}::int)::text as id`,
    )
  ).rows
    .map((row) => row.id)
    .sort();

const ids = (...names: string[]) => names.map((item) => recordOf[item] ?? '').sort();

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-search-tests' });
  const created = await createWorkspace(db, {
    name: 'Search',
    slug: `search-${String(Date.now())}`,
    firstMember: { name: 'Sam', email: 'sam@example.com' },
  });
  scope = { db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } };
  deals = created.objects.deals ?? '';
  name = await nameAttribute(scope, deals);
  for (const item of NAMES) {
    const { recordId } = await createRecord(scope, { objectId: deals, values: { [name]: item } });
    recordOf[item] = recordId;
  }
  await deleteRecord(scope, { recordId: recordOf['Retired rocket'] ?? '' });
  await setValues(scope, { recordId: recordOf['Renamed rocket'] ?? '', values: { [name]: { value: 'Plain' } } });

  // Another workspace, whose deal names hold the same words.
  const other = await createWorkspace(db, {
    name: 'Elsewhere',
    slug: `elsewhere-${String(Date.now())}`,
    firstMember: { name: 'Eli', email: 'eli@example.com' },
  });
  const otherScope: EngineScope = {
    db,
    workspaceId: other.workspaceId,
    actor: { type: 'member', id: other.memberId },
  };
  theirName = await nameAttribute(otherScope, other.objects.deals ?? '');
  await createRecord(otherScope, { objectId: other.objects.deals ?? '', values: { [theirName]: 'Rocket theirs' } });
});

afterAll(async () => {
  await db.close();
});

describe('the search function', () => {
  it('matches current text in any case, with wildcards in the pattern taken literally', async () => {
    await db.withWorkspace(scope.workspaceId, async (tx) => {
      expect(await search(tx, name, 'rocket_fuel')).toEqual(ids('Rocket_fuel 100%'));
      expect(await search(tx, name, '100%')).toEqual(ids('Rocket_fuel 100%'));
      // A trashed record's id comes back (the page's own checks hide it); an old value doesn't.
      expect(await search(tx, name, 'ROCKET')).toEqual(
        ids('Rocket_fuel 100%', 'Rocketxfuel 1000', 'ROCKET pad', 'Retired rocket'),
      );
      expect(await search(tx, name, 'plain')).toEqual(ids('Renamed rocket'));
      expect(await search(tx, name, '\\')).toEqual([]);
    });
  });

  it('parses its body once, so session settings change neither what it reads nor its escapes', async () => {
    await db.withWorkspace(scope.workspaceId, async (tx) => {
      await tx.execute(sql`set local standard_conforming_strings = off`);
      await tx.execute(sql`set local search_path = pg_temp`);
      expect(await search(tx, name, 'rocket_fuel')).toEqual(ids('Rocket_fuel 100%'));
    });
  });

  it('returns at most its limit, clamped to at least 1', async () => {
    await db.withWorkspace(scope.workspaceId, async (tx) => {
      expect(await search(tx, name, 'rocket', 2)).toHaveLength(2);
      expect(await search(tx, name, 'rocket', 0)).toHaveLength(1);
      expect(await search(tx, name, 'rocket', -5)).toHaveLength(1);
    });
  });

  it("returns nothing from another workspace's attribute, and nothing without a workspace", async () => {
    await db.withWorkspace(scope.workspaceId, async (tx) => {
      expect(await search(tx, theirName, 'rocket')).toEqual([]);
      await tx.execute(sql`select set_config('app.workspace_id', '', true)`);
      expect(await search(tx, name, 'rocket')).toEqual([]);
      await tx.execute(sql`reset app.workspace_id`);
      expect(await search(tx, name, 'rocket')).toEqual([]);
    });
  });
});

describe('contains through the search function', () => {
  const contains = (value: string, operator = 'contains'): FilterGroup => ({
    conjunction: 'and',
    conditions: [{ attributeId: name, operator, value } as FilterGroup['conditions'][number]],
  });
  const page = async (filter: FilterGroup, search?: false) =>
    (
      await queryPage(
        scope,
        { objectId: deals, filter, sorts: [{ attributeId: name, direction: 'ascending' }] },
        search === undefined ? {} : { search },
      )
    ).records
      .map((record) => record.id)
      .sort();

  it('answers the same with the search and without it, and never shows a trashed record', async () => {
    const live = Object.entries(recordOf)
      .filter(([item]) => item !== 'Retired rocket')
      .map(([, recordId]) => recordId)
      .sort();
    const cases: [FilterGroup, string[]][] = [
      [contains('rocket_fuel'), ids('Rocket_fuel 100%')],
      [contains('rocket'), ids('Rocket_fuel 100%', 'Rocketxfuel 1000', 'ROCKET pad')],
      [contains('rocket', 'does_not_contain'), ids('Tiny', 'Renamed rocket')],
      // No run of 3 letters or digits: the narrowed path answers.
      [contains('t p'), ids('ROCKET pad')],
      [contains('%'), ids('Rocket_fuel 100%')],
      [contains('nothing like it'), []],
      [contains('nothing like it', 'does_not_contain'), live],
    ];
    for (const [filter, expected] of cases) {
      expect(await page(filter)).toEqual(expected);
      expect(await page(filter, false)).toEqual(expected);
      expect(await countMatches(scope, { objectId: deals, filter })).toEqual({
        count: expected.length,
        atLeast: false,
      });
      expect(await countMatches(scope, { objectId: deals, filter }, undefined, { search: false })).toEqual({
        count: expected.length,
        atLeast: false,
      });
    }
  });
});
