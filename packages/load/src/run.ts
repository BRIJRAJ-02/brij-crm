// `pnpm load:run <scenario>` (spec 0011, AC-196 to AC-205, AC-209, AC-210):
// checks everything before the warm up (every address is this machine, the
// sessions file's API is the one it will call, one session per 100 users
// still signs in, the free record slots hold the run's creates), learns the
// seeded objects the way a browser does (`objects.list`, `attributes.list` as
// user 1; option ids from the owner login, as setup may), plans every
// arrival, drives the users (each with its live connection) in worker threads
// while it samples the server, reads the window's relay lags and heads from
// the outbox afterwards, and prints and writes the report.
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { sql } from 'drizzle-orm';
import type { AttributeDefinition } from '@crm/contracts';
import { readManifest, readSessions, type LoadManifest } from '@crm/core/load-files';
import {
  assertLocalUrls,
  isLoadStackDatabase,
  LOAD_DIR,
  loadRefusal,
  loadUrls,
  type LoadUrls,
} from '@crm/core/load-local';
import { freeRecordSlots } from '@crm/core/load-slots';
import { prepareStatements } from '@crm/core/load-stack';
import { SCALE_BUDGET } from '@crm/core/scale-budget';
import { createDatabase, type Database } from '@crm/db';
import { openServerStats, type ServerStats } from '@crm/db/stats';
import { createLoadClient } from './client.ts';
import { cpuShare, hostFacts, poolerWait, sampleEvery, stackContainers } from './collectors.ts';
import type { DriveInput, DriveOutput, ThreadUser } from './drive.ts';
import { wallClock } from './drive.ts';
import { mergeHistograms } from './histogram.ts';
import { headAt, relayLags } from './outbox.ts';
import { achievedMix, mixDeviation, planArrivals, planStorm, type ArrivalPlan } from './plan.ts';
import { errorCounts, errorLines, exitCodeOf, formatReport, judgeValidity, reportLines } from './report.ts';
import { LoadResult, type StatementLine } from './result.ts';
import { SCENARIOS, WARMUP_SECONDS, type Scenario, type ScenarioName } from './scenarios.ts';
import { columnsOnScreen, OBJECT_SHARES, viewShapes, type ObjectKey, type ShapeAttribute } from './shapes.ts';
import { ACTION_METRICS, type ObjectModel } from './user.ts';
import { MISS_AFTER_MS } from './live/stream.ts';

/** What a run is asked for. */
export interface RunOptions {
  readonly scenario: ScenarioName;
  readonly users?: number;
  readonly minutes?: number;
  readonly seed?: number;
  readonly threads?: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: (message: string) => void;
  /** The test flag that stalls every harness thread (`LOAD_TEST_BLOCK_LOOP_MS`), proving a stalled run is invalid. */
  readonly blockLoopMs?: number;
}

/** One session per this many users is checked before the warm up (AC-196). */
export const SESSION_CHECK_EVERY = 100;
/** A run refuses unless the free record slots hold this many times its planned creates (AC-209). */
export const FREE_SLOT_MARGIN = 1.5;
/** How long before the run's clock starts the threads get to spin up. */
const START_DELAY_MS = 3_000;

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/** The scenario as asked, or a refusal for one a later milestone builds. */
export function scenarioOf(name: ScenarioName): Scenario {
  const scenario = SCENARIOS[name];
  if (!scenario.built) {
    throw loadRefusal(`The ${name} scenario arrives with milestone ${String(scenario.milestone)} of spec 0011.`);
  }
  return scenario;
}

/** The creates a run plans: users × (minutes and warm up) × the rate × the create share (AC-209). */
export function plannedCreates(users: number, minutes: number): number {
  const seconds = minutes * 60 + WARMUP_SECONDS;
  return users * seconds * SCALE_BUDGET.load.actionsPerUserPerSecond * SCALE_BUDGET.load.mix.create;
}

/** Which object user `index` holds: People 50%, Deals 30%, Companies 20%, spread evenly over the users. */
export function objectOf(index: number): ObjectKey {
  const u = (index * GOLDEN) % 1;
  let total = 0;
  for (const { key, share } of OBJECT_SHARES) {
    total += share;
    if (u < total) return key;
  }
  return 'people';
}

/**
 * Refuses (exit 3) a sessions file whose API isn't this machine or isn't the
 * API the run calls: the cookies were minted for that API, and the file can
 * be edited by hand (AC-210).
 */
export function assertSessionsApi(sessionsApiUrl: string, apiUrl: string): void {
  assertLocalUrls({ 'apiUrl in .load/sessions.json': sessionsApiUrl });
  if (new URL(sessionsApiUrl).origin !== new URL(apiUrl).origin) {
    throw loadRefusal(
      `The sessions were minted for ${sessionsApiUrl}, but this run calls ${apiUrl}. Mint them again: \`pnpm load:sessions\`.`,
    );
  }
}

/** Checks one session per 100 users with `me.get`, refusing (exit 3, naming `pnpm load:sessions`) a refused one. */
async function checkSessions(apiUrl: string, cookies: readonly { n: number; cookie: string }[]): Promise<void> {
  const checked = cookies.filter((_, index) => index % SESSION_CHECK_EVERY === 0);
  for (const { n, cookie } of checked) {
    try {
      await createLoadClient(apiUrl, cookie).me.get(undefined, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      if (status === 401) {
        throw loadRefusal(`User ${String(n)}'s session was refused. Mint the sessions again: \`pnpm load:sessions\`.`);
      }
      throw loadRefusal(
        `The API at ${apiUrl} didn't answer user ${String(n)}'s session check (${error instanceof Error ? error.message : String(error)}). Is the load stack up (\`pnpm load:stack\`)?`,
      );
    }
  }
}

/** Option ids by attribute id, in order, read as setup through the owner login. */
async function optionIds(db: Database, workspaceId: string): Promise<ReadonlyMap<string, readonly string[]>> {
  const rows = await db.withWorkspace(workspaceId, async (tx) => {
    const result = await tx.execute<{ attribute_id: string; id: string }>(sql`
      select attribute_id::text, id::text from attribute_options
      where workspace_id = ${workspaceId} and archived_at is null order by attribute_id, position
    `);
    return result.rows;
  });
  const byAttribute = new Map<string, string[]>();
  for (const row of rows) byAttribute.set(row.attribute_id, [...(byAttribute.get(row.attribute_id) ?? []), row.id]);
  return byAttribute;
}

/** The seeded objects as user 1 sees them, with their shapes, samples and seeded counts. */
async function objectModels(
  apiUrl: string,
  cookie: string,
  manifest: LoadManifest,
  options: ReadonlyMap<string, readonly string[]>,
): Promise<Record<ObjectKey, ObjectModel>> {
  const client = createLoadClient(apiUrl, cookie);
  const memberIds = manifest.users.slice(0, 5).map((user) => user.memberId);
  const keys: readonly ObjectKey[] = ['people', 'companies', 'deals'];
  const models = await Promise.all(
    keys.map(async (key) => {
      const objectId = manifest.objects[key];
      if (objectId === undefined)
        throw loadRefusal(`The manifest has no ${key} object. Seed again: \`pnpm load:seed\`.`);
      const definitions: readonly AttributeDefinition[] = await client.attributes.list({
        workspace: manifest.slug,
        objectId,
      });
      const attributes = new Map<string, ShapeAttribute>(
        definitions.map((definition) => {
          const currency = definition.config.defaultCurrency;
          return [
            definition.apiSlug,
            {
              id: definition.id,
              apiSlug: definition.apiSlug,
              type: definition.type,
              isSystem: definition.isSystem,
              isMulti: definition.isMulti,
              options: options.get(definition.id) ?? [],
              ...(typeof currency === 'string' ? { currency } : {}),
            },
          ];
        }),
      );
      const shapes = viewShapes(key, { attributes, memberIds });
      const positioned = definitions.flatMap((definition) => {
        const attribute = attributes.get(definition.apiSlug);
        return attribute === undefined ? [] : [{ ...attribute, position: definition.position }];
      });
      const model: ObjectModel = {
        key,
        objectId,
        attributes,
        shapes,
        columns: columnsOnScreen(key, positioned, shapes),
        samples: manifest.samples[key] ?? [],
        liveCount: manifest.counts[key]?.live ?? 0,
      };
      return [key, model] as const;
    }),
  );
  return Object.fromEntries(models) as Record<ObjectKey, ObjectModel>;
}

/** Runs one thread's share in a worker thread. */
function inThread(input: DriveInput): Promise<DriveOutput> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./thread.ts', import.meta.url), { workerData: input });
    worker.once('message', (output: DriveOutput) => resolve(output));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`A harness thread exited with ${String(code)}.`));
    });
  });
}

/** Round trips per clock offset reading: the fastest one gives the tightest midpoint. */
const CLOCK_SAMPLES = 5;

/** The database's clock minus ours, from the midpoint of the fastest of a few round trips. */
async function clockOffset(stats: ServerStats): Promise<number> {
  let best: { rtt: number; offset: number } | undefined;
  for (let sample = 0; sample < CLOCK_SAMPLES; sample += 1) {
    const sent = wallClock();
    const database = await stats.clock();
    const back = wallClock();
    if (best === undefined || back - sent < best.rtt) best = { rtt: back - sent, offset: database - (sent + back) / 2 };
  }
  return best?.offset ?? 0;
}

/** Writes the result to `.load/results/<scenario>-<time>.json`, readable by this user only. */
async function writeResult(result: LoadResult): Promise<string> {
  const dir = join(LOAD_DIR, 'results');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = join(dir, `${result.scenario}-${result.startedAt.replaceAll(':', '-')}.json`);
  await writeFile(path, `${JSON.stringify(LoadResult.parse(result), null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}

/** Plays a scenario and reports it; answers the result, where it was written, and the exit code. */
export async function runLoad(options: RunOptions): Promise<{ result: LoadResult; path: string }> {
  const { log } = options;
  const scenario = scenarioOf(options.scenario);
  const users = options.users ?? scenario.users;
  const minutes = options.minutes ?? scenario.minutes;
  const seed = options.seed ?? Math.floor(Date.now() / 1000);
  const threads = Math.max(1, Math.min(options.threads ?? 1, users));
  if (!Number.isInteger(users) || users < 1) throw loadRefusal('Give --users as a whole number from 1.');
  if (!(minutes > 0)) throw loadRefusal('Give --minutes as a number above 0.');

  const urls: LoadUrls = loadUrls(options.env);
  const manifest = await readManifest(LOAD_DIR);
  const sessions = await readSessions(LOAD_DIR);
  assertSessionsApi(sessions.apiUrl, urls.LOAD_API_URL);
  if (users > manifest.users.length) {
    throw loadRefusal(
      `The ${manifest.profile} seed has ${String(manifest.users.length)} users; this run asks for ${String(users)}.`,
    );
  }
  const cookies = manifest.users.slice(0, users).map((user) => {
    const cookie = sessions.sessions[String(user.n)];
    if (cookie === undefined) throw loadRefusal(`User ${String(user.n)} has no session. Run \`pnpm load:sessions\`.`);
    return { ...user, cookie };
  });

  const onStack = isLoadStackDatabase(urls.LOAD_DATABASE_URL_OWNER);
  const owner = createDatabase({
    url: urls.LOAD_DATABASE_URL_OWNER,
    applicationName: 'crm-load-run',
    maxConnections: 2,
  });
  let stats: ServerStats | undefined;
  try {
    const slots = await freeRecordSlots(owner, manifest.workspaceId);
    const creates = plannedCreates(users, minutes);
    if (slots.free < FREE_SLOT_MARGIN * creates) {
      throw loadRefusal(
        `${slots.free.toLocaleString('en')} free record slots can't hold this run's ${Math.ceil(creates).toLocaleString('en')} planned creates with room to spare (${String(FREE_SLOT_MARGIN)} times). Run \`pnpm load:reset\`.`,
      );
    }
    log(`checking ${String(Math.ceil(users / SESSION_CHECK_EVERY))} session(s) with me.get`);
    await checkSessions(urls.LOAD_API_URL, cookies);
    const first = cookies[0];
    if (first === undefined) throw loadRefusal('No users to run.');
    const models = await objectModels(
      urls.LOAD_API_URL,
      first.cookie,
      manifest,
      await optionIds(owner, manifest.workspaceId),
    );
    if (onStack) prepareStatements();
    stats = await openServerStats({ url: urls.LOAD_DATABASE_URL_OWNER, applicationName: 'crm-load-run-stats' });
    const containers: Awaited<ReturnType<typeof stackContainers>> = onStack ? await stackContainers() : new Map();
    const facts = await hostFacts();

    const warmupMs = WARMUP_SECONDS * 1_000;
    const measuredMs = minutes * 60_000;
    const plan: ArrivalPlan = planArrivals({
      users,
      actionsPerUserPerSecond: SCALE_BUDGET.load.actionsPerUserPerSecond,
      warmupMs,
      measuredMs,
      mix: SCALE_BUDGET.load.mix,
      seed,
    });
    const storm =
      scenario.storm === undefined
        ? undefined
        : planStorm({ users, warmupMs, measuredMs, everyMs: scenario.storm.burstEveryMs, seed });
    const threadUsers: ThreadUser[][] = Array.from({ length: threads }, () => []);
    cookies.forEach((user, index) => {
      threadUsers[index % threads]?.push({
        index,
        n: user.n,
        cookie: user.cookie,
        memberId: user.memberId,
        object: objectOf(index),
      });
    });
    const startedAt = new Date();
    const runStartMs = wallClock() + START_DELAY_MS;
    const offsets = [await clockOffset(stats)];
    log(
      `${options.scenario}: ${String(users)} users in ${String(threads)} thread(s), ${String(WARMUP_SECONDS)} s warm up then ${String(minutes)} measured minutes, seed ${String(seed)}`,
    );
    const driving = Promise.all(
      threadUsers.map((mine) => {
        const indexes = new Set(mine.map((user) => user.index));
        return inThread({
          apiUrl: urls.LOAD_API_URL,
          workspace: manifest.slug,
          runStartMs,
          warmupMs,
          measuredMs,
          seed,
          behaviour: scenario.behaviour,
          memberIds: manifest.users.slice(0, 5).map((user) => user.memberId),
          models,
          users: mine,
          joins: plan.joins.filter((join) => indexes.has(join.user)),
          arrivals: plan.arrivals.filter((arrival) => indexes.has(arrival.user)),
          live: { url: urls.LOAD_CENTRIFUGO_URL, origin: new URL(urls.LOAD_API_URL).origin },
          clockOffsetMs: offsets[0] ?? 0,
          ...(storm === undefined
            ? {}
            : {
                bursts: storm.bursts.filter((burst) => indexes.has(burst.user)),
                reconnectAt: storm.reconnectAt,
              }),
          ...(options.blockLoopMs === undefined ? {} : { blockLoopMs: options.blockLoopMs }),
        });
      }),
    );

    // The measured window: statements and WAL from its start, the server sampled through it.
    const mainLoop = monitorEventLoopDelay({ resolution: 10 });
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, runStartMs + warmupMs - wallClock())));
    log('warm up done: measuring');
    mainLoop.enable();
    const statementsOn = await stats.resetStatements();
    const walBefore = await stats.walBytes();
    const postgres = containers.get('postgres');
    const cpu = postgres === undefined ? undefined : sampleEvery(() => cpuShare(postgres.id, postgres.cap.cpus));
    const api = containers.get('api');
    const apiCpu = api === undefined ? undefined : sampleEvery(() => cpuShare(api.id, api.cap.cpus));
    const database = new URL(urls.LOAD_PGBOUNCER_URL).pathname.slice(1);
    const pooler = sampleEvery(() => poolerWait(urls.LOAD_PGBOUNCER_URL, database));
    const progress = setInterval(() => {
      const left = Math.max(0, runStartMs + warmupMs + measuredMs - wallClock());
      log(`${(left / 60_000).toFixed(1)} measured minutes left`);
    }, 60_000);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, runStartMs + warmupMs + measuredMs - wallClock())));
    clearInterval(progress);
    mainLoop.disable();
    const walAfter = await stats.walBytes();
    const cpuShares = await cpu?.stop();
    const apiCpuShares = await apiCpu?.stop();
    const poolerWaits = await pooler.stop();
    const top = statementsOn ? await stats.topStatements(10) : undefined;
    log('window closed: waiting for the last answers');
    const outputs = await driving;
    offsets.push(await clockOffset(stats));
    const endedAt = new Date();
    const clockOffsetMs = offsets.reduce((sum, offset) => sum + offset, 0) / offsets.length;

    // The outbox through the owner login: the window's relay lags, and the heads the miss rule needs.
    const windowStartDb = runStartMs + warmupMs + clockOffsetMs;
    const windowEndDb = windowStartDb + measuredMs;
    const relay = await relayLags(owner, manifest.workspaceId, windowStartDb, windowEndDb).catch(() => undefined);
    const heads = await Promise.all([
      headAt(owner, manifest.workspaceId, windowStartDb),
      headAt(owner, manifest.workspaceId, windowEndDb - MISS_AFTER_MS),
    ]).then(
      ([start, end]) => ({ start, end }),
      () => undefined,
    );

    const samples = outputs.flatMap((output) => output.samples);
    const lines = [
      ...reportLines({
        budget: SCALE_BUDGET,
        samples,
        poolerWaitMs: poolerWaits,
        postgresCpuShares: cpuShares,
        apiCpuShares,
        live: {
          clockOffsetMs,
          arrivals: mergeHistograms(outputs.map((output) => output.arrivals)),
          arrivalsOffsetMs: clockOffsetMs - (offsets[0] ?? 0),
          users: outputs.flatMap((output) => output.live),
          relay,
          heads,
        },
        storm: storm !== undefined,
      }),
      ...errorLines(samples, SCALE_BUDGET),
    ];
    const validity = judgeValidity({
      budget: SCALE_BUDGET,
      samples,
      plannedActions: outputs.reduce((sum, output) => sum + output.planned, 0),
      sentActions: outputs.reduce((sum, output) => sum + output.sent, 0),
      eventLoopDelayP99Ms: [
        mainLoop.count === 0 ? 0 : mainLoop.percentile(99) / 1e6,
        ...outputs.map((output) => output.loopDelayP99Ms),
      ],
    });
    // The mix the measured window really sent: one sample per action (its count apart), never the plan's.
    const sentActions = samples.flatMap((sample) =>
      ACTION_METRICS.has(sample.metric) && sample.action !== 'join' && sample.action !== 'live' && sample.burst !== true
        ? [sample.action]
        : [],
    );
    const achieved = achievedMix(sentActions);
    const statements: StatementLine[] | undefined = top?.map((statement) => ({ ...statement }));
    const result: LoadResult = {
      scenario: options.scenario,
      gate: scenario.gate,
      users,
      minutes,
      warmupSeconds: WARMUP_SECONDS,
      seed,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      facts: {
        ...facts,
        stackCaps: Object.fromEntries([...containers].map(([service, container]) => [service, container.cap])),
        databaseClockOffsetMs: clockOffsetMs,
        databaseClockDriftMs: (offsets[1] ?? 0) - (offsets[0] ?? 0),
        manifestCounts: manifest.counts,
        manifestProfile: manifest.profile,
        apiUrl: urls.LOAD_API_URL,
        threads,
      },
      lines,
      mix: {
        budget: { ...SCALE_BUDGET.load.mix },
        achieved,
        deviationPoints: mixDeviation(achieved, SCALE_BUDGET.load.mix),
      },
      errors: errorCounts(samples).byReason,
      ...(statements === undefined ? {} : { topStatements: statements }),
      walBytes: walAfter - walBefore,
      validity,
      exitCode: exitCodeOf(validity, lines, scenario.gate),
    };
    const path = await writeResult(result);
    log(formatReport(result));
    log(`result: ${path}`);
    return { result, path };
  } finally {
    await stats?.close();
    await owner.close();
  }
}
