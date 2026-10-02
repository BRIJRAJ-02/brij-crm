// `pnpm db:bench:scale`: the benchmark grid (spec 0004, AC-15) on the
// workspace `pnpm db:seed:scale` made. Each query's page statement runs warm,
// 20 times, as the app role (row level security on), and reports p50 and
// p95, its plan, and the whole queryPage call. Then the same grid runs
// against the split table variant: current values alone in their own table.
// Prints Markdown for the spec's verify.md.
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { createDatabase, type Database, type WorkspaceTx } from '@crm/db';
import type { FilterGroup } from '@crm/contracts/values';
import { countMatches, queryPage, type EngineScope, type PageQuery } from '../src/index.ts';
import { benchPage } from '../src/engine/query/page.ts';
import { refuseRemote } from './local-only.ts';

const env = z
  .object({
    DATABASE_URL_DIRECT: z.url(),
    DATABASE_URL_OWNER: z.url(),
    SCALE_WORKSPACE_ID: z.uuid(),
    BENCH_RUNS: z.coerce.number().int().min(3).max(200).default(20),
    SEED_SCALE_ALLOW_HOST: z.string().min(1).optional(),
    /** Grid numbers to run (`1,1b,7`), all when absent. */
    BENCH_ONLY: z
      .string()
      .optional()
      .transform((value) => (value === undefined ? undefined : new Set(value.split(',').map((item) => item.trim())))),
    /** `off` skips the split table variant (it copies every current value row first). */
    BENCH_SPLIT: z.enum(['on', 'off']).default('on'),
  })
  .parse(process.env);

refuseRemote(env.DATABASE_URL_DIRECT, env.SEED_SCALE_ALLOW_HOST, 'the benchmark');
refuseRemote(env.DATABASE_URL_OWNER, env.SEED_SCALE_ALLOW_HOST, 'the benchmark');

const app = createDatabase({ url: env.DATABASE_URL_DIRECT, applicationName: 'crm-bench-scale' });
const owner = createDatabase({ url: env.DATABASE_URL_OWNER, applicationName: 'crm-bench-scale-owner' });
const workspaceId = env.SCALE_WORKSPACE_ID;
// The timings only mean "row level security on" when the app connection really is the app role.
await app.assertAppRole();

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

async function lookups(db: Database) {
  return db.withWorkspace(workspaceId, async (tx) => {
    const one = async (query: ReturnType<typeof sql>) => {
      const result = await tx.execute<{ id: string }>(query);
      const id = result.rows[0]?.id;
      if (id === undefined) throw new Error('The scale workspace is missing something. Seed it again.');
      return id;
    };
    const deals = await one(sql`select id::text from objects where standard_key = 'deals'`);
    const companies = await one(sql`select id::text from objects where standard_key = 'companies'`);
    const attribute = (objectId: string, slug: string) =>
      one(sql`select id::text from attributes where object_id = ${objectId} and api_slug = ${slug}`);
    const option = (attributeId: string, label: string) =>
      one(sql`select id::text from attribute_options where attribute_id = ${attributeId} and label = ${label}`);
    const listId = await one(sql`select id::text from lists where api_slug = 'pipeline'`);
    const listStage = await one(sql`select id::text from attributes where list_id = ${listId} and api_slug = 'stage'`);
    const due = await one(sql`select id::text from attributes where list_id = ${listId} and api_slug = 'due'`);
    const source = await attribute(deals, 'source');
    const dealType = await attribute(deals, 'deal_type');
    const categories = await attribute(companies, 'categories');
    return {
      deals,
      listId,
      name: await attribute(deals, 'name'),
      createdAt: await attribute(deals, 'created_at'),
      closeDate: await attribute(deals, 'close_date'),
      probability: await attribute(deals, 'probability'),
      nextStep: await attribute(deals, 'next_step'),
      stage: await attribute(deals, 'stage'),
      company: await attribute(deals, 'associated_company'),
      categories,
      source,
      dealType,
      inbound: await option(source, 'Inbound'),
      newBusiness: await option(dealType, 'New business'),
      industry: await option(categories, 'Industry 3'),
      listStage,
      due,
      qualified: await option(listStage, 'Qualified'),
    };
  });
}

const ids = await lookups(app);
const memberId = await app.withWorkspace(workspaceId, async (tx) => {
  const result = await tx.execute<{ id: string }>(sql`select id::text from members order by created_at limit 1`);
  return result.rows[0]?.id ?? null;
});
const scope: EngineScope = { db: app, workspaceId, actor: { type: 'member', id: memberId } };
const and = (...conditions: FilterGroup['conditions']): FilterGroup => ({ conjunction: 'and', conditions });
const byName = [{ attributeId: ids.name, direction: 'ascending' as const }];
/** The cursor after the row before `position`, so the page that follows starts at `position`. */
async function cursorAt(position: number): Promise<string> {
  const page = await queryPage(scope, { objectId: ids.deals, sorts: byName, position: position - 1, limit: 1 });
  if (page.nextCursor === undefined) throw new Error(`No row at ${String(position)}.`);
  return page.nextCursor;
}
const [at100k, at500k] = [await cursorAt(100_000), await cursorAt(500_000)];

const fullGrid: { name: string; query: PageQuery }[] = [
  {
    name: '1. No filter, sort by name',
    query: { objectId: ids.deals, sorts: [{ attributeId: ids.name, direction: 'ascending' }] },
  },
  {
    name: '1b. The same at position 600,000',
    query: { objectId: ids.deals, sorts: [{ attributeId: ids.name, direction: 'ascending' }], position: 600_000 },
  },
  {
    name: '2. Source is any of (about 20%), sort by created at',
    query: {
      objectId: ids.deals,
      filter: and({ attributeId: ids.source, operator: 'is_any_of', values: [ids.inbound] }),
      sorts: [{ attributeId: ids.createdAt, direction: 'descending' }],
    },
  },
  {
    name: '3. Name contains, probability between, deal type is; sort by close date, then name',
    query: {
      objectId: ids.deals,
      filter: and(
        { attributeId: ids.name, operator: 'contains', value: 'expansion' },
        { attributeId: ids.probability, operator: 'between', from: 20, to: 60 },
        { attributeId: ids.dealType, operator: 'is', value: ids.newBusiness },
      ),
      sorts: [
        { attributeId: ids.closeDate, direction: 'ascending' },
        { attributeId: ids.name, direction: 'ascending' },
      ],
    },
  },
  {
    name: '4. Through the company: its category is Industry 3 (5%), sort by name',
    query: {
      objectId: ids.deals,
      filter: and({
        operator: 'through',
        path: [ids.company],
        condition: { attributeId: ids.categories, operator: 'contains_any_of', values: [ids.industry] },
      }),
      sorts: [{ attributeId: ids.name, direction: 'ascending' }],
    },
  },
  {
    name: '5. Next step is empty, sort by stage',
    query: {
      objectId: ids.deals,
      filter: and({ attributeId: ids.nextStep, operator: 'is_empty' }),
      sorts: [{ attributeId: ids.stage, direction: 'ascending' }],
    },
  },
  {
    name: '6. List of 200,000 entries: entry stage is Qualified, sort by entry due date',
    query: {
      listId: ids.listId,
      filter: and({ attributeId: ids.listStage, operator: 'is', value: ids.qualified }),
      sorts: [{ attributeId: ids.due, direction: 'ascending' }],
    },
  },
  {
    name: '7. Sort by name, the page after a cursor at row 100,000',
    query: { objectId: ids.deals, sorts: byName, cursor: at100k },
  },
  {
    name: '8. Sort by name, the page after a cursor at row 500,000',
    query: { objectId: ids.deals, sorts: byName, cursor: at500k },
  },
];
const grid = fullGrid.filter((item) => env.BENCH_ONLY?.has(item.name.split('.')[0] ?? '') ?? true);

async function timeStatement(tx: WorkspaceTx, query: PageQuery): Promise<number> {
  const start = performance.now();
  await benchPage(tx, scope, query);
  return performance.now() - start;
}

async function measure(query: PageQuery, searchPath?: string) {
  return app.withWorkspace(workspaceId, async (tx) => {
    if (searchPath !== undefined) await tx.execute(sql.raw(`set local search_path = ${searchPath}`));
    // The first run is the cold one (nothing cached yet on a fresh connection's plan); the rest warm up.
    const cold = await timeStatement(tx, query);
    for (let warm = 0; warm < 2; warm += 1) await timeStatement(tx, query);
    const samples: number[] = [];
    for (let run = 0; run < env.BENCH_RUNS; run += 1) samples.push(await timeStatement(tx, query));
    const { plans } = await benchPage(tx, scope, query, true);
    return {
      cold,
      p50: percentile(samples, 50),
      p95: percentile(samples, 95),
      plan: plans.join('\n\n-- then --\n\n'),
    };
  });
}

async function wholeCall(query: PageQuery): Promise<number> {
  const samples: number[] = [];
  for (let run = 0; run < Math.min(10, env.BENCH_RUNS); run += 1) {
    const start = performance.now();
    await queryPage(scope, query);
    samples.push(performance.now() - start);
  }
  return percentile(samples, 95);
}

async function countTime(query: PageQuery): Promise<string> {
  if (query.filter === undefined) return 'none';
  const source = 'listId' in query ? { listId: query.listId } : { objectId: query.objectId };
  const start = performance.now();
  const n = await countMatches(scope, { ...source, filter: query.filter });
  return `${n.toLocaleString('en')} in ${(performance.now() - start).toFixed(0)} ms`;
}

const sizes = await owner.withWorkspace(workspaceId, async (tx) => {
  const result = await tx.execute<{ name: string; table: string; indexes: string; rows: string }>(sql`
    select c.relname as name, pg_size_pretty(pg_table_size(c.oid)) as table,
      pg_size_pretty(pg_indexes_size(c.oid)) as indexes, c.reltuples::bigint::text as rows
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('records', 'values', 'record_links', 'list_entries')
    order by c.relname
  `);
  return result.rows;
});

try {
  // The split table variant: this workspace's current value rows alone, with the same indexes and policy.
  if (env.BENCH_SPLIT === 'on')
    await owner.withWorkspace(workspaceId, async (tx) => {
      await tx.execute(sql`create schema if not exists bench_split`);
      await tx.execute(sql`drop table if exists bench_split."values"`);
      await tx.execute(sql`create table bench_split."values" (like public."values" including all)`);
      await tx.execute(
        sql`insert into bench_split."values" select * from public."values" where workspace_id = ${workspaceId} and active_until is null`,
      );
      await tx.execute(sql`alter table bench_split."values" enable row level security`);
      await tx.execute(sql`alter table bench_split."values" force row level security`);
      await tx.execute(sql`
      create policy values_tenant on bench_split."values"
        using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)
    `);
      await tx.execute(sql`grant usage on schema bench_split to crm_app`);
      await tx.execute(sql`grant select on bench_split."values" to crm_app`);
      await tx.execute(sql`analyze bench_split."values"`);
    });

  const lines: string[] = [];
  const plans: string[] = [];
  const version = await app.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ v: string }>(sql`select version() as v`);
    return result.rows[0]?.v ?? '';
  });
  lines.push(
    `Run ${new Date().toISOString()} on ${new URL(env.DATABASE_URL_DIRECT).hostname}, ${version.split(',')[0] ?? ''}, ${String(env.BENCH_RUNS)} warm runs each, as the app role.`,
  );
  lines.push('');
  lines.push(
    '| Query | first run (ms) | p50 (ms) | p95 (ms) | whole call p95 (ms) | split table p95 (ms) | exact count |',
  );
  lines.push('|---|---|---|---|---|---|---|');
  for (const { name, query } of grid) {
    const main = await measure(query);
    const split = env.BENCH_SPLIT === 'on' ? await measure(query, 'bench_split, public') : undefined;
    const whole = await wholeCall(query);
    const counted = await countTime(query);
    lines.push(
      `| ${name} | ${main.cold.toFixed(1)} | ${main.p50.toFixed(1)} | ${main.p95.toFixed(1)} | ${whole.toFixed(1)} | ${split?.p95.toFixed(1) ?? 'skipped'} | ${counted} |`,
    );
    plans.push(`#### ${name}\n\n\`\`\`\n${main.plan}\n\`\`\``);
    console.error(`done: ${name}`);
  }
  lines.push('');
  lines.push('| Table | Rows (estimate) | Table size | Index size |');
  lines.push('|---|---|---|---|');
  for (const row of sizes)
    lines.push(`| ${row.name} | ${Number(row.rows).toLocaleString('en')} | ${row.table} | ${row.indexes} |`);
  console.log([...lines, '', ...plans].join('\n'));
} finally {
  await owner.withWorkspace(workspaceId, (tx) => tx.execute(sql`drop schema if exists bench_split cascade`));
  await app.close();
  await owner.close();
}
