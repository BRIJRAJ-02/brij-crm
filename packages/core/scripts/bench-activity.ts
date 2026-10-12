// `pnpm --filter @crm/core bench:activity`: the record timeline's database
// numbers (spec 0017, AC-380) on a seeded load workspace (`pnpm load:seed`,
// the `crm` profile or the smoke one). It gives one deal 10,000 value versions
// through the engine's own write path (once: a deal named "Activity bench
// deal" is reused), then, as the app role with row level security on, reads
// the first page of the hub company's and of that deal's timeline warm
// `BENCH_RUNS` times, and pages each through 2,000 entries. It prints p50 and
// p95 of the whole `getActivity` call (every statement it sends) and an
// `explain (analyze, buffers)` of each raw statement one first page sends,
// as Markdown for the spec's verify.md. Local only.
import { sql, type SQL } from 'drizzle-orm';
import * as z from 'zod';
import { createDatabase, type Database, type WorkspaceTx } from '@crm/db';
import { createRecord, getActivity, setValues } from '../src/index.ts';
import { refuseRemote } from './local-only.ts';
import { testScope } from '../src/testing.ts';

const env = z
  .object({
    DATABASE_URL_DIRECT: z.url(),
    ACTIVITY_WORKSPACE_ID: z.uuid(),
    BENCH_RUNS: z.coerce.number().int().min(3).max(200).default(30),
    BENCH_VERSIONS: z.coerce.number().int().min(10).max(50_000).default(10_000),
    BENCH_SCROLL: z.coerce.number().int().min(50).max(10_000).default(2_000),
    SEED_SCALE_ALLOW_HOST: z.string().min(1).optional(),
  })
  .parse(process.env);

refuseRemote(env.DATABASE_URL_DIRECT, env.SEED_SCALE_ALLOW_HOST, 'the activity benchmark');

const app = createDatabase({ url: env.DATABASE_URL_DIRECT, applicationName: 'crm-bench-activity' });
await app.assertAppRole();
const workspaceId = env.ACTIVITY_WORKSPACE_ID;

/** The raw statements a read sends, kept while `capturing` is on, so each can be explained after. */
const captured: SQL[] = [];
let capturing = false;
/** The app database, with each `tx.execute` noted while capturing (the timeline's own statements are raw SQL). */
const watched: Database = {
  ...app,
  withWorkspace: (id, work) =>
    app.withWorkspace(id, (tx) =>
      work(
        new Proxy(tx, {
          get(target, property, receiver) {
            const value: unknown = Reflect.get(target, property, receiver);
            if (property !== 'execute' || typeof value !== 'function') return value;
            return (query: SQL) => {
              if (capturing) captured.push(query);
              return (value as (query: SQL) => unknown).call(target, query);
            };
          },
        }),
      ),
    ),
};

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const one = async (tx: WorkspaceTx, query: SQL): Promise<string> => {
  const result = await tx.execute<{ id: string }>(query);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('The workspace is missing something. Seed it with `pnpm load:seed`.');
  return id;
};

const facts = await app.withWorkspace(workspaceId, async (tx) => {
  const deals = await one(tx, sql`select id::text from objects where standard_key = 'deals'`);
  const companies = await one(tx, sql`select id::text from objects where standard_key = 'companies'`);
  const attribute = (objectId: string, slug: string) =>
    one(tx, sql`select id::text from attributes where object_id = ${objectId}::uuid and api_slug = ${slug}`);
  const companyName = await attribute(companies, 'name');
  return {
    deals,
    memberId: await one(tx, sql`select id::text from members where role = 'owner' order by created_at limit 1`),
    hub: await one(
      tx,
      sql`select v.owner_id::text as id from "values" v where v.attribute_id = ${companyName}::uuid
        and v.text_value = 'Hub Company' and v.active_until is null limit 1`,
    ),
    dealName: await attribute(deals, 'name'),
    nextStep: await attribute(deals, 'next_step'),
    description: await attribute(deals, 'description'),
  };
});
const scope = testScope({ db: watched, workspaceId, actor: { type: 'member', id: facts.memberId } });

/** The bench deal, made once, and how many value versions it holds. */
async function benchDeal(): Promise<{ readonly id: string; readonly versions: number }> {
  return app.withWorkspace(workspaceId, async (tx) => {
    const found = await tx.execute<{ id: string; versions: number }>(sql`
      select r.id::text as id,
        (select count(distinct x.version_id)::int from "values" x where x.owner_id = r.id and x.version_id <> r.id) as versions
      from records r join "values" v on v.owner_id = r.id and v.attribute_id = ${facts.dealName}::uuid
        and v.active_until is null and v.text_value = 'Activity bench deal'
      where r.object_id = ${facts.deals}::uuid and r.deleted_at is null
      limit 1
    `);
    const [row] = found.rows;
    if (row !== undefined) return row;
    return { id: '', versions: 0 };
  });
}

let deal = await benchDeal();
if (deal.id === '') {
  const made = await createRecord(scope, {
    objectId: facts.deals,
    values: { [facts.dealName]: 'Activity bench deal' },
  });
  deal = { id: made.recordId, versions: 0 };
}
const started = Date.now();
for (let index = deal.versions; index < env.BENCH_VERSIONS; index += 1) {
  // Alternating attributes, so the merge reads more than one lateral.
  const attributeId = index % 2 === 0 ? facts.nextStep : facts.description;
  await setValues(scope, { recordId: deal.id, values: { [attributeId]: { value: `Step ${String(index)}` } } });
  if (index % 1000 === 999) console.error(`  ${String(index + 1)} versions (${String(Date.now() - started)} ms)`);
}
deal = await benchDeal();

async function timed(recordId: string, cursor?: string) {
  const at = performance.now();
  const page = await getActivity(scope, { recordId, ...(cursor === undefined ? {} : { cursor }) });
  return { ms: performance.now() - at, page };
}

async function firstPage(label: string, recordId: string) {
  for (let index = 0; index < 3; index += 1) await timed(recordId);
  const samples: number[] = [];
  for (let index = 0; index < env.BENCH_RUNS; index += 1) samples.push((await timed(recordId)).ms);
  return { label, p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples) };
}

async function scroll(label: string, recordId: string) {
  const samples: number[] = [];
  let cursor: string | undefined;
  let entries = 0;
  while (entries < env.BENCH_SCROLL) {
    const { ms, page } = await timed(recordId, cursor);
    samples.push(ms);
    entries += page.entries.length;
    if (page.nextCursor === undefined) break;
    cursor = page.nextCursor;
  }
  return { label, pages: samples.length, entries, p50: percentile(samples, 50), p95: percentile(samples, 95) };
}

async function explain(recordId: string): Promise<string[]> {
  captured.length = 0;
  capturing = true;
  await getActivity(scope, { recordId });
  capturing = false;
  const plans: string[] = [];
  for (const query of [...captured]) {
    const plan = await app.withWorkspace(workspaceId, (tx) =>
      tx.execute<{ 'QUERY PLAN': string }>(sql`explain (analyze, buffers) ${query}`),
    );
    plans.push(plan.rows.map((row) => row['QUERY PLAN']).join('\n'));
  }
  return plans;
}

const hubCount = await app.withWorkspace(workspaceId, (tx) =>
  tx.execute<{ n: number }>(
    sql`select count(*)::int as n from record_links where to_record_id = ${facts.hub}::uuid and active_until is null`,
  ),
);
const ms = (value: number) => `${value.toFixed(1)} ms`;
const firsts = [
  await firstPage(`Hub company (${String(hubCount.rows[0]?.n ?? 0)} people in Team)`, facts.hub),
  await firstPage(`Deal with ${String(deal.versions)} value versions`, deal.id),
];
const scrolls = [await scroll('Hub company', facts.hub), await scroll('Bench deal', deal.id)];

console.log(`## Activity bench (${new Date().toISOString()})\n`);
console.log(
  `Workspace ${workspaceId}, ${String(env.BENCH_RUNS)} warm runs each, the whole getActivity call as the app role.\n`,
);
console.log('| First page | p50 | p95 | max |\n|---|---|---|---|');
for (const row of firsts) console.log(`| ${row.label} | ${ms(row.p50)} | ${ms(row.p95)} | ${ms(row.max)} |`);
console.log(
  `\n| Paging through ${String(env.BENCH_SCROLL)} entries | pages | entries | p50 per page | p95 per page |\n|---|---|---|---|---|`,
);
for (const row of scrolls) {
  console.log(`| ${row.label} | ${String(row.pages)} | ${String(row.entries)} | ${ms(row.p50)} | ${ms(row.p95)} |`);
}
for (const [label, recordId] of [
  ['Hub company', facts.hub],
  ['Bench deal', deal.id],
] as const) {
  console.log(`\n### Plans, the first page of the ${label}\n`);
  for (const plan of await explain(recordId)) console.log(`\`\`\`\n${plan}\n\`\`\`\n`);
}
await app.close();
