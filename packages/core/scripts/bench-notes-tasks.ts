// `pnpm --filter @crm/core bench:notes-tasks` (spec 0019, AC-450): the first
// pages of My tasks (each filter and status), of a record's Tasks tab and of
// its Notes tab, on a workspace holding 100,000 tasks and 100,000 notes. It
// makes its own workspace (reused after with BENCH_WORKSPACE_ID)
// beside whatever else the database holds: 2,000 companies, 50 members, the
// tasks spread over them (a third done, a fifth with no due date, most linked
// to one to three companies, the hub company linked to 10,000) and the notes
// spread over the companies (the hub holding 10,000). Then, as the app role
// with row level security on, it reads each first page warm `BENCH_RUNS`
// times through the services themselves, and prints p50 and p95 of the whole
// call and an `explain (analyze, buffers)` of each list's page statement, as
// Markdown for the spec's verify.md. Local only.
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import * as z from 'zod';
import { createDatabase } from '@crm/db';
import { testQuery } from '@crm/db/testing';
import { createWorkspace, listNotes, listTasks } from '../src/index.ts';
import { testScope } from '../src/testing.ts';
import { refuseRemote } from './local-only.ts';

const env = z
  .object({
    DATABASE_URL_DIRECT: z.url(),
    /** The owner login, to analyze the seeded tables (the app role may not). */
    DATABASE_URL_OWNER: z.url(),
    /** A workspace an earlier run seeded (it prints its id); absent, a new one is made and seeded. */
    BENCH_WORKSPACE_ID: z.uuid().optional(),
    BENCH_RUNS: z.coerce.number().int().min(3).max(200).default(30),
    BENCH_TASKS: z.coerce.number().int().min(1_000).max(1_000_000).default(100_000),
    BENCH_NOTES: z.coerce.number().int().min(1_000).max(1_000_000).default(100_000),
    SEED_SCALE_ALLOW_HOST: z.string().min(1).optional(),
  })
  .parse(process.env);

refuseRemote(env.DATABASE_URL_DIRECT, env.SEED_SCALE_ALLOW_HOST, 'the notes and tasks benchmark');
refuseRemote(env.DATABASE_URL_OWNER, env.SEED_SCALE_ALLOW_HOST, 'the notes and tasks benchmark');

const db = createDatabase({ url: env.DATABASE_URL_DIRECT, applicationName: 'crm-bench-notes-tasks' });
await db.assertAppRole();

const SLUG = `notes-tasks-bench-${String(Date.now())}`;
const MEMBERS = 50;
const COMPANIES = 2_000;
const HUB_SHARE = 10_000;

/** The bench's workspace: made once with its seed, then reused. */
async function workspace(): Promise<{ readonly workspaceId: string; readonly ownerId: string }> {
  const existing = env.BENCH_WORKSPACE_ID;
  if (existing !== undefined) {
    const owner = await db.withWorkspace(existing, (tx) =>
      tx.execute<{ id: string }>(sql`select id::text from members where role = 'owner' limit 1`),
    );
    return { workspaceId: existing, ownerId: owner.rows[0]?.id ?? '' };
  }
  const made = await createWorkspace(db, {
    name: 'Notes and tasks bench',
    slug: SLUG,
    firstMember: { name: 'Bench owner', email: 'bench-owner@example.com' },
  });
  const started = performance.now();
  await db.withWorkspace(made.workspaceId, async (tx) => {
    const ws = made.workspaceId;
    const companies = made.objects.companies ?? '';
    await tx.execute(sql`
      insert into members (workspace_id, id, name, email, role, created_by_type, updated_by_type)
      select ${ws}::uuid, gen_random_uuid(), 'Member ' || n, 'member' || n || '@example.com', 'member', 'system', 'system'
      from generate_series(1, ${MEMBERS - 1}) n
    `);
    await tx.execute(sql`
      insert into records (workspace_id, id, object_id, created_by_type, updated_by_type)
      select ${ws}::uuid, gen_random_uuid(), ${companies}::uuid, 'system', 'system' from generate_series(1, ${COMPANIES})
    `);
    // Tasks: made by and assigned to the members in turn, a third done, a fifth with no due date.
    await tx.execute(sql`
      with m as (select id, row_number() over (order by created_at, id) - 1 as k, count(*) over () as c from members),
      t as (
        select n, gen_random_uuid() as id,
          now() - (n || ' seconds')::interval as made_at
        from generate_series(1, ${env.BENCH_TASKS}) n
      )
      insert into tasks (workspace_id, id, title, is_done, done_at, done_by_type, due_on, assignee_member_id,
        created_at, created_by_type, created_by_id, created_by_member_id, updated_by_type)
      select ${ws}::uuid, t.id, 'Task ' || t.n, t.n % 3 = 0, case when t.n % 3 = 0 then t.made_at end,
        case when t.n % 3 = 0 then 'system'::actor_type end,
        case when t.n % 5 = 0 then null else current_date + ((t.n % 120) - 60) end,
        assignee.id, t.made_at, 'member', creator.id, creator.id, 'system'
      from t
      join m assignee on assignee.k = t.n % assignee.c
      join m creator on creator.k = (t.n / 7) % creator.c
    `);
    // Links: the hub company (the first) gets HUB_SHARE tasks; the rest one to three companies each, a tenth none.
    await tx.execute(sql`
      with r as (select id, row_number() over (order by id) - 1 as k from records where object_id = ${companies}::uuid),
      t as (select id, row_number() over (order by created_at desc, id) as n from tasks)
      insert into task_records (workspace_id, task_id, record_id, position, created_by_type)
      select ${ws}::uuid, t.id, r.id, s.p, 'system'
      from t
      cross join lateral generate_series(0, case when t.n <= ${HUB_SHARE} then 0 else (t.n % 3) end) s(p)
      join r on r.k = case when t.n <= ${HUB_SHARE} then 0 else 1 + ((t.n * 7 + s.p * 13) % (${COMPANIES} - 1)) end
      where t.n <= ${HUB_SHARE} or t.n % 10 <> 0
      on conflict do nothing
    `);
    // Notes: the hub holds HUB_SHARE; the rest spread over the other companies.
    await tx.execute(sql`
      with r as (select id, row_number() over (order by id) - 1 as k from records where object_id = ${companies}::uuid)
      insert into notes (workspace_id, id, record_id, title, content, content_text, created_at, updated_at,
        created_by_type, updated_by_type)
      select ${ws}::uuid, gen_random_uuid(), r.id, 'Note ' || n,
        jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
          'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'Call notes number ' || n))))),
        'Call notes number ' || n, now() - (n || ' seconds')::interval, now() - (n || ' seconds')::interval,
        'system', 'system'
      from generate_series(1, ${env.BENCH_NOTES}) n
      join r on r.k = case when n <= ${HUB_SHARE} then 0 else 1 + (n % (${COMPANIES} - 1)) end
    `);
  });
  await testQuery(env.DATABASE_URL_OWNER, 'analyze tasks, task_records, notes, records');
  console.log(
    `Seeded workspace ${made.workspaceId} in ${String(Math.round((performance.now() - started) / 1000))} s (BENCH_WORKSPACE_ID reuses it).`,
  );
  return { workspaceId: made.workspaceId, ownerId: made.memberId };
}

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const { workspaceId, ownerId } = await workspace();
const owner = testScope({ db, workspaceId, actor: { type: 'member', id: ownerId } });
const facts = await db.withWorkspace(workspaceId, async (tx) => {
  const hub = await tx.execute<{ id: string }>(
    sql`select record_id::text as id from task_records group by record_id order by count(*) desc limit 1`,
  );
  const counts = await tx.execute<{ tasks: number; notes: number; links: number }>(
    sql`select (select count(*)::int from tasks) as tasks, (select count(*)::int from notes) as notes,
      (select count(*)::int from task_records) as links`,
  );
  return { hub: hub.rows[0]?.id ?? '', counts: counts.rows[0] };
});

const cases: { readonly name: string; readonly run: () => Promise<unknown> }[] = [];
for (const mine of ['assigned', 'created', 'all'] as const) {
  for (const status of ['open', 'done'] as const) {
    cases.push({ name: `My tasks, ${mine}, ${status}`, run: () => listTasks(owner, { scope: { mine }, status }) });
  }
}
for (const status of ['open', 'done'] as const) {
  cases.push({
    name: `Tasks tab (hub, 10,000 tasks), ${status}`,
    run: () => listTasks(owner, { scope: { recordId: facts.hub }, status }),
  });
}
cases.push({ name: 'Notes tab (hub, 10,000 notes)', run: () => listNotes(owner, { recordId: facts.hub }) });

console.log(
  `\n${String(facts.counts?.tasks)} tasks, ${String(facts.counts?.links)} links, ${String(facts.counts?.notes)} notes; ${String(env.BENCH_RUNS)} warm runs each.\n`,
);
console.log('| First page | p50 | p95 |');
console.log('|---|---|---|');
for (const each of cases) {
  await each.run();
  const samples: number[] = [];
  for (let i = 0; i < env.BENCH_RUNS; i += 1) {
    const started = performance.now();
    await each.run();
    samples.push(performance.now() - started);
  }
  console.log(`| ${each.name} | ${percentile(samples, 50).toFixed(1)} ms | ${percentile(samples, 95).toFixed(1)} ms |`);
}

// The page statements themselves, explained.
const me = ownerId;
const plans: { readonly name: string; readonly query: ReturnType<typeof sql> }[] = [
  {
    name: 'My tasks, assigned, open',
    query: sql`select t.id from tasks t where t.assignee_member_id = ${me}::uuid and t.deleted_at is null and not t.is_done order by t.due_on asc nulls last, t.created_at, t.id limit 51`,
  },
  {
    name: 'My tasks, all, open (the task rule)',
    query: sql`select t.id from tasks t where t.deleted_at is null and not t.is_done and (not exists (select 1 from task_records l where l.workspace_id = t.workspace_id and l.task_id = t.id) or t.assignee_member_id = ${me}::uuid or (t.created_by_type = 'member' and t.created_by_id = ${me}::uuid) or exists (select 1 from task_records l join records r on r.workspace_id = l.workspace_id and r.id = l.record_id join objects o on o.workspace_id = r.workspace_id and o.id = r.object_id where l.workspace_id = t.workspace_id and l.task_id = t.id and r.deleted_at is null and o.archived_at is null)) order by t.due_on asc nulls last, t.created_at, t.id limit 51`,
  },
  {
    name: 'My tasks, created, done',
    query: sql`select t.id from tasks t where t.created_by_member_id = ${me}::uuid and t.deleted_at is null and t.is_done order by t.done_at desc nulls last, t.id limit 51`,
  },
  {
    name: 'Tasks tab, open',
    query: sql`select t.id from task_records l join tasks t on t.workspace_id = l.workspace_id and t.id = l.task_id where l.record_id = ${facts.hub}::uuid and t.deleted_at is null and not t.is_done order by t.due_on asc nulls last, t.created_at, t.id limit 51`,
  },
  {
    name: 'Notes tab',
    query: sql`select n.id from notes n where n.record_id = ${facts.hub}::uuid and n.deleted_at is null order by n.updated_at desc, n.id limit 21`,
  },
];
for (const plan of plans) {
  const explained = await db.withWorkspace(workspaceId, (tx) =>
    tx.execute<{ 'QUERY PLAN': string }>(sql`explain (analyze, buffers) ${plan.query}`),
  );
  console.log(`\n**${plan.name}**\n\n\`\`\`\n${explained.rows.map((row) => row['QUERY PLAN']).join('\n')}\n\`\`\``);
}
await db.close();
