// `pnpm load:jobs` (spec 0008, AC-108): the fairness measurement on the load
// stack, whose worker is capped like production's (1 vCPU, 512 MB) and whose
// Postgres is capped like a small Neon compute. It makes its own workspaces,
// starts the test kinds as their owners (through PgBouncer, as the API would),
// and lets the stack's worker run them: two huge heavy jobs (A, 200,000 items,
// and D, 100,000) take both heavy slots, a second heavy job in A waits behind
// A's own, then B's 1,000 item heavy job arrives, E fills all four light slots
// with long light jobs, and light jobs in C arrive. It reads
// when each was queued, started and finished, and how many heavy slices each
// workspace ran at once, then cancels what is left and prints the numbers for
// `docs/specs/0008-background-jobs/verify.md`. Localhost only (AC-210).
//
// Needs the load stack's data services and worker up (`docker compose -f
// docker-compose.load.yml -p crm-load up -d postgres pgbouncer centrifugo
// mailpit worker`), migrated, with its logins (`pnpm load:seed`).
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { cancelJob, createWorkspace, jobKinds, type JobRegistry } from '../src/index.ts';
import { startJobForTest, testScope } from '../src/testing.ts';
import { loadUrls, runLoadCommand } from './load-local.ts';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One workspace of the run, with its owner's scope. */
async function workspace(db: Database, name: string) {
  const created = await createWorkspace(db, {
    name: `Fairness ${name}`,
    slug: `fairness-${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    firstMember: { name: 'Ada', email: `fairness-${name.toLowerCase()}@example.com` },
  });
  return {
    name,
    workspaceId: created.workspaceId,
    scope: testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } }),
  };
}

type Space = Awaited<ReturnType<typeof workspace>>;

/** Starts a test job of `count` synthetic items in `space`. */
async function start(
  registry: JobRegistry,
  space: Space,
  kind: 'dev.simulate' | 'dev.simulate_light',
  count: number,
  batchMillis: number,
) {
  const items = Array.from({ length: count }, () => randomUUID());
  const { jobId } = await startJobForTest(space.scope, registry, {
    kind,
    params: { batchSize: 500, batchMillis },
    items,
  });
  return { space, jobId, kind, count };
}

type Started = Awaited<ReturnType<typeof start>>;

interface Times {
  readonly status: string;
  readonly done: number;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
}

/** A job's status and times, as the database holds them. */
async function times(db: Database, job: Started): Promise<Times> {
  return db.withWorkspace(job.space.workspaceId, async (tx) => {
    const result = await tx.execute<{
      status: string;
      done: number;
      created_at: string;
      started_at: string | null;
      finished_at: string | null;
    }>(
      sql`select status::text, done, created_at::text, started_at::text, finished_at::text from jobs where id = ${job.jobId}`,
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('A job of the run went away.');
    const date = (value: string | null) => (value === null ? null : new Date(value));
    return {
      status: row.status,
      done: row.done,
      queuedAt: new Date(row.created_at),
      startedAt: date(row.started_at),
      finishedAt: date(row.finished_at),
    };
  });
}

/** How many of the workspace's heavy jobs hold a live lease now: heavy slices running at once. */
async function heavySlices(db: Database, space: Space): Promise<number> {
  return db.withWorkspace(space.workspaceId, async (tx) => {
    const result = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from jobs where lane = 'heavy' and lease_until > now() and finished_at is null`,
    );
    return result.rows[0]?.n ?? 0;
  });
}

const seconds = (from: Date, to: Date | null) =>
  to === null ? 'never' : ((to.getTime() - from.getTime()) / 1000).toFixed(2);

async function main(): Promise<void> {
  const urls = loadUrls(process.env);
  const db = createDatabase({ url: urls.LOAD_PGBOUNCER_URL, applicationName: 'crm-jobs-fairness' });
  const registry = jobKinds({ environment: 'local' });
  try {
    const [a, b, c, d, e] = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((name) => workspace(db, name)));
    if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
      throw new Error('No workspaces.');
    }
    console.log('Starting the two big heavy jobs (A 200,000 items, D 100,000) and a second heavy job in A.');
    const bigA = await start(registry, a, 'dev.simulate', 200_000, 200);
    const bigD = await start(registry, d, 'dev.simulate', 100_000, 200);
    const secondA = await start(registry, a, 'dev.simulate', 1_000, 200);
    // Sample the heavy slices per workspace while everything runs.
    const most = new Map<string, number>();
    const sampling = { on: true };
    const sampler = (async () => {
      while (sampling.on) {
        for (const space of [a, b, d]) {
          most.set(space.name, Math.max(most.get(space.name) ?? 0, await heavySlices(db, space)));
        }
        await wait(100);
      }
    })();
    await wait(25_000);
    console.log('A and D hold both heavy slots: starting B (1,000 heavy items) and a light job in C every 3 seconds.');
    const smallB = await start(registry, b, 'dev.simulate', 1_000, 200);
    // E holds every light slot with long light jobs (20,000 items, batches of 500 at 200 ms: about 8 seconds each).
    const longLights: Started[] = [];
    for (let index = 0; index < 4; index += 1)
      longLights.push(await start(registry, e, 'dev.simulate_light', 20_000, 200));
    await wait(1_000);
    const lights: Started[] = [];
    for (let index = 0; index < 8; index += 1) {
      lights.push(await start(registry, c, 'dev.simulate_light', 100, 50));
      await wait(3_000);
    }
    const watched = [smallB, secondA, ...lights];
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const all = await Promise.all(watched.map((job) => times(db, job)));
      if (all.every((job) => job.finishedAt !== null)) break;
      await wait(500);
    }
    sampling.on = false;
    await sampler;
    const rows = await Promise.all(
      [bigA, bigD, secondA, smallB, ...longLights, ...lights].map(async (job) => ({ job, at: await times(db, job) })),
    );
    console.log('\n| Job | Workspace | Items | Queued to started (s) | Started to finished (s) | Status | Done |');
    console.log('|---|---|---|---|---|---|---|');
    for (const { job, at } of rows) {
      console.log(
        `| ${job.kind} | ${job.space.name} | ${job.count.toLocaleString('en')} | ${seconds(at.queuedAt, at.startedAt)} | ${
          at.startedAt === null ? 'never' : seconds(at.startedAt, at.finishedAt)
        } | ${at.status} | ${at.done.toLocaleString('en')} |`,
      );
    }
    const lightStarts = rows
      .filter(({ job }) => job.kind === 'dev.simulate_light' && job.space.name === 'C')
      .map(({ at }) => (at.startedAt === null ? Infinity : (at.startedAt.getTime() - at.queuedAt.getTime()) / 1000));
    console.log(
      `\nLight jobs in C (E holding the light slots): slowest start ${Math.max(...lightStarts).toFixed(2)} s after queued.`,
    );
    console.log(`Most heavy slices at once: ${[...most].map(([name, n]) => `${name} ${String(n)}`).join(', ')}.`);
    // The big jobs stop here: what they did stays done.
    for (const job of [bigA, bigD, ...longLights]) {
      if ((await times(db, job)).finishedAt === null) await cancelJob(job.space.scope, registry, job.jobId);
    }
  } finally {
    await db.close();
  }
}

await runLoadCommand(main);
