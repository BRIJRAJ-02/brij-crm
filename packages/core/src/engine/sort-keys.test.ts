// Stored sort keys (spec 0004, stored sort keys): the keys follow the values
// through every write (AC-20), a jump lands on exactly the row cursor paging
// puts there, trashed records and removed entries left out (AC-21), and the
// comparisons the keys seek on are leakproof, so the index seeks under row
// level security.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import type { SortRule } from '@crm/contracts/values';
import { defineAttribute, defineObject } from './definitions.ts';
import { deleteRecord, eraseRecord, purgeDeleted, restoreRecord } from './deletion.ts';
import { addEntry, defineList, removeEntry, restoreEntry } from './lists.ts';
import { queryPage, type ViewSource } from './query/page.ts';
import { defineOption } from './options.ts';
import { createRecord, setValues } from './records.ts';
import { SYSTEM_ACTOR, type EngineScope } from './scope.ts';
import type { AttributeDef } from './values.ts';
import { createWorkspace } from './workspaces.ts';
import { rescope, testScope } from '../testing.ts';

const { appUrl, ownerUrl } = inject('testDatabase');
let db: Database;
/** The owner, for what the app role may not do: vacuum and analyze. */
let owner: Database;
let scope: EngineScope;
let craft: string;
let fleet: string;
const a: Record<string, string> = {};
const recordIds: string[] = [];
const options: { slug: string; id: string }[] = [];
let member = '';
const entryIds: string[] = [];

/** A small, repeatable sequence (high bits of an LCG), so a failure reproduces. */
function* sequence(seed: number) {
  let state = seed;
  for (;;) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    yield Math.floor(state / 65_536);
  }
}
const random = sequence(5);
const next = (n: number) => (random.next().value ?? 0) % n;
const WORDS = ['Vega', 'vega', 'Altair', 'Deneb', 'rigel', 'Ünal', 'zeta', 'Ångström', 'a_b%c', 'Polaris'];
const word = () => `${WORDS[next(WORDS.length)] ?? 'x'} ${String(next(5))}`;
const KINDS = ['mass', 'rank', 'cost', 'due', 'seen', 'kind', 'phase', 'active', 'port', 'ping'] as const;
/** A random value for one of the other kinds, or null (a clear) one time in five. */
function valueFor(slug: (typeof KINDS)[number]): unknown {
  if (next(5) === 0) return null;
  const optionsOf = (of: string) => options.filter((option) => option.slug === of).map((option) => option.id);
  const moment = new Date(Date.UTC(2026, next(12), 1 + next(28), next(24))).toISOString();
  switch (slug) {
    case 'mass':
      return `${next(2) === 0 ? '-' : ''}${String(next(100_000))}.${String(next(10_000))}`;
    case 'rank':
      return 1 + next(5);
    case 'cost':
      return { amount: String(next(5000)), currency: next(2) === 0 ? 'USD' : 'EUR' };
    case 'due':
      return moment.slice(0, 10);
    case 'seen':
      return moment;
    case 'kind':
      return [...new Set([pick(optionsOf('kind')), pick(optionsOf('kind'))])];
    case 'phase':
      return pick(optionsOf('phase'));
    case 'active':
      return next(2) === 0;
    case 'port':
      return { locality: next(3) === 0 ? undefined : word(), countryCode: next(2) === 0 ? 'US' : 'GB' };
    case 'ping':
      return { kind: 'email', at: moment, by: { type: 'member', id: member } };
  }
}

beforeAll(async () => {
  db = createDatabase({ url: appUrl, applicationName: 'crm-sort-keys-tests' });
  owner = createDatabase({ url: ownerUrl, applicationName: 'crm-sort-keys-tests-owner' });
  const created = await createWorkspace(db, {
    name: 'Keys',
    slug: `keys-${String(Date.now())}`,
    firstMember: { name: 'Kit', email: 'kit@example.com' },
  });
  scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
  ({ objectId: craft } = await defineObject(scope, {
    apiSlug: 'craft',
    singularName: 'Craft',
    pluralName: 'Craft',
    icon: 'rocket',
    hue: 'blue',
  }));
  const attribute = async (
    on: { objectId: string } | { listId: string },
    slug: string,
    type: AttributeDef['type'],
    extra: { isMulti?: boolean; config?: { defaultCurrency: string } } = {},
  ) => {
    a[slug] = (await defineAttribute(scope, { ...on, apiSlug: slug, title: slug, type, ...extra })).attributeId;
  };
  await attribute({ objectId: craft }, 'title', 'text');
  await attribute({ objectId: craft }, 'contacts', 'email', { isMulti: true });
  await attribute({ objectId: craft }, 'log', 'long_text');
  await attribute({ objectId: craft }, 'mass', 'number');
  await attribute({ objectId: craft }, 'rank', 'rating');
  await attribute({ objectId: craft }, 'cost', 'currency', { config: { defaultCurrency: 'USD' } });
  await attribute({ objectId: craft }, 'due', 'date');
  await attribute({ objectId: craft }, 'seen', 'timestamp');
  await attribute({ objectId: craft }, 'kind', 'select', { isMulti: true });
  await attribute({ objectId: craft }, 'phase', 'status');
  await attribute({ objectId: craft }, 'active', 'checkbox');
  await attribute({ objectId: craft }, 'port', 'location');
  await attribute({ objectId: craft }, 'ping', 'interaction');
  for (const [slug, labels] of [
    ['kind', ['probe', 'lander', 'rover']],
    ['phase', ['plan', 'fly']],
  ] as const) {
    for (const label of labels) {
      options.push({ slug, id: (await defineOption(scope, { attributeId: id(slug), label, hue: 'blue' })).optionId });
    }
  }
  member = created.memberId;
  ({ listId: fleet } = await defineList(scope, { objectId: craft, apiSlug: 'fleet', name: 'Fleet' }));
  await attribute({ listId: fleet }, 'callsign', 'text');
});

afterAll(async () => {
  await db.close();
  await owner.close();
});

const id = (slug: string): string => {
  const value = a[slug];
  if (value === undefined) throw new Error(`No ${slug}.`);
  return value;
};
const pick = <T>(items: readonly T[]): T => {
  const item = items[next(items.length)];
  if (item === undefined) throw new Error('Nothing to pick.');
  return item;
};

/** Rows of sort_keys that the current values don't explain, and the other way round. */
async function drift(): Promise<{ extra: number; missing: number }> {
  return db.withWorkspace(scope.workspaceId, async (tx) => {
    const columns = sql.raw(
      'workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key, time_key, option_id, bool_key',
    );
    const extra = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from (select ${columns} from sort_keys except select ${columns} from sort_key_sources) x`,
    );
    const missing = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from (select ${columns} from sort_key_sources except select ${columns} from sort_keys) x`,
    );
    return { extra: extra.rows[0]?.n ?? -1, missing: missing.rows[0]?.n ?? -1 };
  });
}

describe('keys follow values (AC-20)', () => {
  it('stays equal to what the current values say through every kind of write', async () => {
    // Only the system writes the timestamp and the interaction, so it makes the records and their random values.
    const system: EngineScope = rescope(scope, { actor: SYSTEM_ACTOR });
    for (let index = 0; index < 30; index += 1) {
      const { recordId } = await createRecord(system, {
        objectId: craft,
        values: {
          ...(index % 5 === 4 ? {} : { [id('title')]: word() }),
          ...(index % 3 === 0
            ? {}
            : { [id('contacts')]: [`c${String(index)}@example.com`, `d${String(index)}@example.com`] }),
          [id('log')]: 'long text has no key',
          ...Object.fromEntries(
            KINDS.flatMap((slug) => {
              const value = valueFor(slug);
              return value === null ? [] : [[id(slug), value]];
            }),
          ),
        },
      });
      recordIds.push(recordId);
      if (index % 2 === 0) {
        const { entryId } = await addEntry(scope, {
          listId: fleet,
          recordId,
          values: index % 4 === 0 ? { [id('callsign')]: word() } : {},
        });
        entryIds.push(entryId);
      }
    }
    expect(await drift()).toEqual({ extra: 0, missing: 0 });

    for (let step = 0; step < 80; step += 1) {
      const recordId = pick(recordIds);
      const entryId = pick(entryIds);
      const action = next(10);
      try {
        if (action === 0) await setValues(scope, { recordId, values: { [id('title')]: { value: word() } } });
        if (action === 1) await setValues(scope, { recordId, values: { [id('title')]: { value: null } } });
        // A reorder moves a different item to position 0, so the key changes.
        if (action === 2) {
          await setValues(scope, {
            recordId,
            values: { [id('contacts')]: { value: [`z${String(step)}@example.com`, 'a@example.com'] } },
          });
        }
        if (action === 3) await deleteRecord(scope, { recordId });
        if (action === 4) await restoreRecord(scope, { recordId });
        if (action === 5) await removeEntry(scope, { entryId });
        if (action === 6) await restoreEntry(scope, { entryId });
        if (action === 7) await setValues(scope, { entryId, values: { [id('callsign')]: { value: word() } } });
        if (action >= 8) {
          const slug = pick(KINDS);
          await setValues(system, { recordId, values: { [id(slug)]: { value: valueFor(slug) } } });
        }
      } catch {
        // A write on a trashed record or a removed entry is refused; the keys must still match.
      }
    }
    expect(await drift()).toEqual({ extra: 0, missing: 0 });

    // Hard deletes: erasure, and the purge of records and entries past the window.
    await eraseRecord(scope, { recordId: recordIds[1] ?? '' });
    const old = recordIds.slice(2, 5);
    for (const recordId of old) await deleteRecord(scope, { recordId });
    await removeEntry(scope, { entryId: entryIds[6] ?? '' }).catch(() => undefined);
    await db.withWorkspace(scope.workspaceId, async (tx) => {
      await tx.execute(
        sql`update records set deleted_at = now() - interval '40 days' where id = any(${`{${old.join(',')}}`}::uuid[])`,
      );
      await tx.execute(
        sql`update list_entries set deleted_at = now() - interval '40 days' where deleted_at is not null`,
      );
    });
    await purgeDeleted(scope);
    expect(await drift()).toEqual({ extra: 0, missing: 0 });
  });
});

/** Every row of a view in cursor order. */
async function ordered(source: ViewSource, sorts: SortRule[]): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await queryPage(scope, { ...source, sorts, limit: 7, ...(cursor === undefined ? {} : { cursor }) });
    ids.push(...(result.entries ?? result.records).map((row) => row.id));
    if (result.nextCursor === undefined) return ids;
    cursor = result.nextCursor;
  }
  throw new Error('Paging never ended.');
}

describe('races and other workspaces', () => {
  it('an entry removal waits for a restore holding its record, so the entry stays hidden', async () => {
    const { recordId } = await createRecord(scope, { objectId: craft, values: { [id('title')]: word() } });
    const { entryId } = await addEntry(scope, { listId: fleet, recordId, values: { [id('callsign')]: word() } });
    await deleteRecord(scope, { recordId });
    // Hold the record's row lock as restoreRecord does, then start the removal.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked: () => void = () => undefined;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const restoring = db.withWorkspace(scope.workspaceId, async (tx) => {
      await tx.execute(sql`select 1 from records where id = ${recordId} for no key update`);
      locked();
      await held;
    });
    await isLocked;
    let removed = false;
    const removing = removeEntry(scope, { entryId }).then(() => {
      removed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(removed).toBe(false);
    release();
    await restoring;
    await removing;
    await restoreRecord(scope, { recordId });
    expect(await drift()).toEqual({ extra: 0, missing: 0 });
  });

  it('shows another workspace none of these keys', async () => {
    const other = await createWorkspace(db, {
      name: 'Other keys',
      slug: `other-keys-${String(Date.now())}`,
      firstMember: { name: 'Oz', email: 'oz@example.com' },
    });
    const seen = await db.withWorkspace(other.workspaceId, (tx) =>
      tx.execute<{ keys: number; sources: number }>(sql`
        select (select count(*)::int from sort_keys where workspace_id = ${scope.workspaceId}) as keys,
          (select count(*)::int from sort_key_sources where workspace_id = ${scope.workspaceId}) as sources
      `),
    );
    expect(seen.rows[0]).toEqual({ keys: 0, sources: 0 });
  });
});

describe('exact jumps (AC-21)', () => {
  it('lands on the row cursor paging puts at every position, for records and entries, both ways', async () => {
    const views: [ViewSource, string][] = [
      [{ objectId: craft }, 'title'],
      [{ objectId: craft }, 'contacts'],
      [{ listId: fleet }, 'callsign'],
    ];
    for (const [source, slug] of views) {
      for (const direction of ['ascending', 'descending'] as const) {
        const sorts = [{ attributeId: id(slug), direction }];
        const order = await ordered(source, sorts);
        expect(order.length).toBeGreaterThanOrEqual(3);
        for (let position = 0; position <= order.length + 2; position += 3) {
          const page = await queryPage(scope, { ...source, sorts, position, limit: 4 });
          expect((page.entries ?? page.records).map((row) => row.id)).toEqual(order.slice(position, position + 4));
        }
      }
    }
  });
});

describe('seeks under row level security', () => {
  it('uses only leakproof comparisons for the stored keys', async () => {
    const rows = await db.withWorkspace(scope.workspaceId, (tx) =>
      tx.execute<{ name: string; leakproof: boolean }>(sql`
        select p.proname as name, bool_and(p.proleakproof) as leakproof from pg_proc p
        where p.proname in ('text_lt', 'text_le', 'text_gt', 'text_ge', 'texteq', 'bttextcmp', 'int8lt', 'int8gt',
          'int8eq', 'date_lt', 'date_gt', 'timestamptz_lt', 'timestamptz_gt', 'uuid_lt', 'uuid_gt', 'uuid_eq', 'booleq')
        group by p.proname
      `),
    );
    expect(rows.rows.filter((row) => !row.leakproof)).toEqual([]);
    expect(rows.rows.length).toBe(17);
  });

  it("finds one owner's key by index, never a scan of every record, as the app role", async () => {
    const plan = await db.withWorkspace(scope.workspaceId, async (tx) => {
      // With scans off, a join condition row level security can't use as an index condition still shows as a scan.
      await tx.execute(sql`set local enable_seqscan = off`);
      const result = await tx.execute<{ 'QUERY PLAN': unknown }>(sql`
        explain (format json) select * from sort_key_sources
        where owner_id = ${recordIds[0] ?? ''} and attribute_id = ${id('title')}
      `);
      return JSON.stringify(result.rows[0]?.['QUERY PLAN']);
    });
    expect(plan).not.toContain('Seq Scan');
  });

  it('seeks a text cursor in the index, as the app role', async () => {
    // Current statistics and visibility map first: other test files write sort_keys at the same time, and with
    // stale ones the planner weighed a bitmap scan cheaper about one run in four. The claim is that row level
    // security leaves the seek to the index (spec 0004 verify: an Index Cond of an index only scan), so the
    // probe turns off the scans that read the table instead, as the one above does.
    await owner.vacuumAnalyze(['sort_keys']);
    const plan = await db.withWorkspace(scope.workspaceId, async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
      const result = await tx.execute<{ 'QUERY PLAN': readonly { Plan: PlanNode }[] }>(sql`
        explain (format json) select d.owner_id from sort_keys d
        where d.attribute_id = ${id('title')} and d.live and d.text_key is not null and d.text_key >= ${'m'}
        order by d.text_key, d.owner_id limit 5
      `);
      const root = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
      if (root === undefined) throw new Error('No plan.');
      return root;
    });
    const nodes: PlanNode[] = [];
    const walk = (node: PlanNode) => {
      nodes.push(node);
      for (const child of node.Plans ?? []) walk(child);
    };
    walk(plan);
    const seek = nodes.find((node) => node['Index Name'] === 'sort_keys_text');
    expect(seek?.['Node Type']).toBe('Index Only Scan');
    expect(seek?.['Index Cond']).toMatch(/text_key >=/);
  });
});

/** The parts of an `explain (format json)` node the plan tests read. */
interface PlanNode {
  readonly 'Node Type': string;
  readonly 'Index Name'?: string;
  readonly 'Index Cond'?: string;
  readonly Plans?: readonly PlanNode[];
}
