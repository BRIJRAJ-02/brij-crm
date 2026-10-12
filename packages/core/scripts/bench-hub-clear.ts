// `pnpm load:bench-hub-clear` (spec 0011, AC-214): clearing a 150,000 link
// side is not something a person does, so it is measured here at the engine
// level on the load seed rather than in the harness. As the system actor it
// clears the hub's Team in one whole value write while 100 engine level
// writers link other people to the hub and to other companies at the
// harness's rate (0.2 a second each), all through one pool of 10 connections
// like the API's. It prints the clear's time, the other writes' times (all of
// them, and those that ran beside the clear), how many ran out of retries in
// `runWrite`, and the WAL written, then writes the Team back the way `pnpm
// load:reset` does. Reported, not judged. It refuses (exit 3) any database
// that isn't this machine's, a database without the manifest's workspace, and
// a hub whose Team isn't as seeded (naming `pnpm load:reset`).
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from '@crm/db';
import { isRefusal, outboxHook, setValues } from '../src/index.ts';
import { systemScope } from '../src/system.ts';
import { readManifest, type LoadManifest } from './load-files.ts';
import { LOAD_DIR, loadRefusal, loadUrls, runLoadCommand } from './load-local.ts';
import { assertSeededWorkspace, movedPeople, restoreHubTeam } from './load-reset.ts';
import { SCALE_BUDGET } from './scale-budget.ts';

/** The bench's shape: writers, their rate, the pool, how long they write alone before and after the clear. */
export interface BenchOptions {
  readonly writers: number;
  readonly perSecond: number;
  readonly pool: number;
  /** People each writer moves (its own, so no two writers move the same person). */
  readonly peoplePerWriter: number;
  readonly beforeMs: number;
  readonly afterMs: number;
}

/** AC-214's shape: 100 writers at the harness's rate through a pool of 10, alone for 10 seconds either side. */
export const BENCH: BenchOptions = {
  writers: SCALE_BUDGET.online.gate,
  perSecond: SCALE_BUDGET.load.actionsPerUserPerSecond,
  pool: 10,
  peoplePerWriter: 20,
  beforeMs: 10_000,
  afterMs: 10_000,
};

/** A set of times summed up by the nearest rank. */
export interface Times {
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** `values` summed up by the nearest rank (every percentile is a time some write took), or undefined when empty. */
export function timesOf(values: readonly number[]): Times | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
  return { count: sorted.length, p50: rank(50), p95: rank(95), p99: rank(99), max: rank(100) };
}

/** One writer's write: when it was due and answered, and how it ended. */
export interface Write {
  readonly scheduledAt: number;
  readonly answeredAt: number;
  /** `ok`, `QUERY_CANCELLED` (out of retries), another refusal's code, or `error`. */
  readonly outcome: string;
}

/** What the bench measured. */
export interface BenchResult {
  /** Links the clear ended (the hub's live Team before it). */
  readonly team: number;
  readonly clearMs: number;
  readonly writes: Times | undefined;
  /** Writes whose span, from the scheduled moment to the answer, overlapped the clear. */
  readonly beside: Times | undefined;
  readonly outOfRetries: number;
  readonly failed: Readonly<Record<string, number>>;
  /** WAL from the clear's start to its end, the writers' share included. */
  readonly walBytes: number;
  readonly restoreMs: number;
  readonly restored: number;
}

/** Splits the bench's writes: the ok times, those beside the clear, and how the rest ended. */
export function summarizeWrites(writes: readonly Write[], clear: { readonly start: number; readonly end: number }) {
  const ok = writes.filter((write) => write.outcome === 'ok');
  const duration = (write: Write) => write.answeredAt - write.scheduledAt;
  const failed: Record<string, number> = {};
  for (const write of writes) if (write.outcome !== 'ok') failed[write.outcome] = (failed[write.outcome] ?? 0) + 1;
  return {
    writes: timesOf(ok.map(duration)),
    beside: timesOf(
      ok.filter((write) => write.scheduledAt < clear.end && write.answeredAt > clear.start).map(duration),
    ),
    outOfRetries: failed.QUERY_CANCELLED ?? 0,
    failed,
  };
}

/** The refusal code an engine write threw (`QUERY_CANCELLED` when `runWrite` ran out of retries), or `error`. */
const outcomeOf = (error: unknown): string => (isRefusal(error) ? error.refusal.code : 'error');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** The WAL position now, in bytes from the start. */
async function walAt(db: Database, workspaceId: string): Promise<number> {
  return db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ at: string }>(
      sql`select pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0')::text as at`,
    );
    return Number(result.rows[0]?.at ?? 0);
  });
}

/**
 * Plays the bench on `db` (a pool of `options.pool` connections, as the
 * owner login) against the manifest's workspace, and answers what it
 * measured. The Team is written back before it answers, whatever happened.
 */
export async function benchHubClear(
  db: Database,
  manifest: LoadManifest,
  log: (message: string) => void = () => undefined,
  options: BenchOptions = BENCH,
): Promise<BenchResult> {
  await assertSeededWorkspace(db, manifest);
  if ((await movedPeople(db, manifest)).length > 0) {
    throw loadRefusal("The hub's Team isn't as seeded. Put it back first: `pnpm load:reset`.");
  }
  const companyAttributeId = manifest.attributes['people.company'];
  const companiesObjectId = manifest.objects.companies;
  if (companyAttributeId === undefined || companiesObjectId === undefined) {
    throw loadRefusal('The manifest has no People Company or Companies. Seed again: `pnpm load:seed`.');
  }
  const scope = systemScope(db, manifest.workspaceId);
  // Seeded live people outside the hub whose company is live, so `load:reset` can link each back; and the hub's Team.
  const { people, team } = await db.withWorkspace(manifest.workspaceId, async (tx) => {
    const outside = await tx.execute<{ id: string }>(sql`
      select l.from_record_id::text as id
      from attributes a
      join record_links l on l.workspace_id = a.workspace_id and l.relationship_id = a.relationship_id
      join records p on p.workspace_id = l.workspace_id and p.id = l.from_record_id and p.deleted_at is null
      join records c on c.workspace_id = l.workspace_id and c.id = l.to_record_id and c.deleted_at is null
      where a.workspace_id = ${manifest.workspaceId} and a.id = ${companyAttributeId} and l.active_until is null
        and l.to_record_id <> ${manifest.hubCompanyId} and p.created_at <= ${manifest.seededAt}::timestamptz
      order by hashtext(l.from_record_id::text), l.from_record_id
      limit ${options.writers * options.peoplePerWriter}
    `);
    const members = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
      from attributes a
      join record_links l on l.workspace_id = a.workspace_id and l.relationship_id = a.relationship_id
      join records p on p.workspace_id = l.workspace_id and p.id = l.from_record_id and p.deleted_at is null
      where a.workspace_id = ${manifest.workspaceId} and a.id = ${manifest.hubTeamAttributeId}
        and l.to_record_id = ${manifest.hubCompanyId} and l.active_until is null
    `);
    return { people: outside.rows.map((row) => row.id), team: members.rows[0]?.n ?? 0 };
  });
  const elsewhere = (manifest.samples.companies ?? []).filter((id) => id !== manifest.hubCompanyId);
  if (people.length < options.writers || elsewhere.length === 0) {
    throw loadRefusal('The seed has too few people or companies outside the hub for the bench.');
  }

  const writes: Write[] = [];
  const inFlight = new Set<Promise<void>>();
  let stopped = false;
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(Math.random() * items.length)];
    if (item === undefined) throw new RangeError('Nothing to pick from.');
    return item;
  };
  /** One write: a person of this writer's to the hub or to another company, timed from its scheduled moment. */
  const write = async (mine: readonly string[], scheduledAt: number) => {
    const target = Math.random() < 0.5 ? manifest.hubCompanyId : pick(elsewhere);
    const values = { [companyAttributeId]: { value: { objectId: companiesObjectId, recordId: target } } };
    let outcome = 'ok';
    try {
      await setValues(scope, { recordId: pick(mine), values }, [outboxHook()]);
    } catch (error) {
      outcome = outcomeOf(error);
    }
    writes.push({ scheduledAt, answeredAt: performance.now(), outcome });
  };
  /** One writer: arrivals at exponential gaps (an open model: none waits for the last to answer) until stopped. */
  const writer = async (index: number) => {
    const mine = people.filter((_, at) => at % options.writers === index);
    let due = performance.now();
    for (;;) {
      due += -Math.log(1 - Math.random()) * (1_000 / options.perSecond);
      await sleep(due - performance.now());
      if (stopped) return;
      const work = write(mine, due);
      inFlight.add(work);
      void work.finally(() => inFlight.delete(work));
    }
  };

  log(
    `${String(options.writers)} writers at ${String(options.perSecond)} a second each through a pool of ` +
      `${String(options.pool)}; the hub's Team holds ${team.toLocaleString('en')} people`,
  );
  const writers = Array.from({ length: options.writers }, (_, index) => writer(index));
  let clear = { start: 0, end: 0 };
  let walBytes = 0;
  let failure: Error | undefined;
  try {
    await sleep(options.beforeMs);
    log("clearing the hub's Team in one write");
    const walBefore = await walAt(db, manifest.workspaceId);
    const start = performance.now();
    await setValues(
      scope,
      { recordId: manifest.hubCompanyId, values: { [manifest.hubTeamAttributeId]: { value: null } } },
      [outboxHook()],
    );
    clear = { start, end: performance.now() };
    walBytes = (await walAt(db, manifest.workspaceId)) - walBefore;
    log(`cleared in ${(clear.end - clear.start).toFixed(0)} ms; the writers go on for ${String(options.afterMs)} ms`);
    await sleep(options.afterMs);
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  } finally {
    stopped = true;
    await Promise.all(writers);
    await Promise.allSettled([...inFlight]);
  }
  // Written back whatever happened, so a failed clear never leaves the seed changed.
  log("writing the hub's Team back");
  const restoreStart = performance.now();
  const restored = await restoreHubTeam(db, manifest, log);
  const restoreMs = performance.now() - restoreStart;
  if (failure !== undefined) throw failure;
  return {
    team,
    clearMs: clear.end - clear.start,
    ...summarizeWrites(writes, clear),
    walBytes,
    restoreMs,
    restored,
  };
}

/** The bench's printed lines. */
export function formatBench(result: BenchResult): string {
  const ms = (value: number) => value.toFixed(1).padStart(8);
  const line = (name: string, times: Times | undefined) =>
    times === undefined
      ? `${name.padEnd(34)}      no samples`
      : `${name.padEnd(34)}${ms(times.p50)}${ms(times.p95)}${ms(times.p99)}${ms(times.max)}${String(times.count).padStart(7)}`;
  const failed = Object.entries(result.failed)
    .map(([code, count]) => `${code} ×${String(count)}`)
    .join(', ');
  return [
    '',
    `clear of the hub's Team (${result.team.toLocaleString('en')} links, one write): ${result.clearMs.toFixed(0)} ms`,
    '',
    `${'other writes (ms)'.padEnd(34)}${'p50'.padStart(8)}${'p95'.padStart(8)}${'p99'.padStart(8)}${'max'.padStart(8)}${'count'.padStart(7)}`,
    line('all, from their scheduled moment', result.writes),
    line('beside the clear', result.beside),
    '',
    `out of retries (runWrite): ${String(result.outOfRetries)}`,
    `writes that failed: ${failed === '' ? 'none' : failed}`,
    `WAL written during the clear (the writers' share included): ${(result.walBytes / 1024 ** 2).toFixed(1)} MB`,
    `Team written back: ${result.restored.toLocaleString('en')} people in ${(result.restoreMs / 1_000).toFixed(1)} s`,
    'Reported, not judged (#41 judges it).',
  ].join('\n');
}

async function main(): Promise<void> {
  const urls = loadUrls(process.env);
  const manifest = await readManifest(LOAD_DIR);
  const target = new URL(urls.LOAD_DATABASE_URL_OWNER);
  console.log(
    `Hub clear bench on "${manifest.slug}" at ${target.hostname}:${target.port || '5432'}${target.pathname}.`,
  );
  const db = createDatabase({
    url: urls.LOAD_DATABASE_URL_OWNER,
    applicationName: 'crm-load-bench-hub-clear',
    maxConnections: BENCH.pool,
  });
  try {
    console.log(formatBench(await benchHubClear(db, manifest, console.log)));
  } finally {
    await db.close();
  }
}

if (import.meta.main) await runLoadCommand(main);
