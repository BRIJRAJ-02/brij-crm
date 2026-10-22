// The api as a Vercel Function (spec 0045): the same Hono app `server.ts`
// serves, built once per function instance from the validated environment,
// plus what a host without a worker needs. Writes start a bounded job drain
// after the response (`waitUntil`), and `POST /api/internal/jobs/run`, which
// the scheduled workflow calls with `JOBS_RUN_SECRET`, runs one turn of it.
// No relay and no Centrifugo: live updates stay off while the api runs here.
import { createHash, timingSafeEqual } from 'node:crypto';
import { type ErrorCode, errorStatus } from '@crm/contracts';
import { createDatabase, createIdentityStore } from '@crm/db';
import * as z from 'zod';
import { createApp } from '../app.ts';
import { createAuth } from '../auth/auth.ts';
import { createEdgeGuard } from '../edge.ts';
import { ApiEnv, FunctionEnv } from '../env.ts';
import { composeJobTasks } from '../jobs/compose.ts';
import { createDrainWake, createJobDrain, type DrainReport, type JobDrain } from '../jobs/drain.ts';
import { errorFields, log } from '../log.ts';
import { createMailer } from '../mail/mailer.ts';
import { createAnalytics, POSTHOG_EU_HOST } from '../monitoring/posthog.ts';
import { captureFault, flush, MONITORING_FLUSH_MS } from '../monitoring/sentry.ts';
import { NO_WAKE } from '../realtime/wake.ts';
import { APP_RULES } from '../rules.ts';

/** Where the scheduled job run calls. */
export const JOBS_RUN_PATH = '/api/internal/jobs/run';

/** The liveness check, which answers without the database. */
const LIVENESS_PATH = '/api/health';

/** The header carrying `JOBS_RUN_SECRET`. */
export const JOBS_SECRET_HEADER = 'x-crm-jobs-secret';

/**
 * A turn's time budget: the after request turn's and the scheduled one's.
 * The slices in hand then finish their batch (each returns within 30
 * seconds), which keeps a turn inside the function's 60 second limit.
 */
export const DRAIN_BUDGET_MS = 20_000;

/** The scheduled turn runs at least this long, so the daily cron line's backfill gets its chance. */
export const SCHEDULED_MINIMUM_MS = 3_000;

/** The tenant pool's size per instance: Neon's pooler multiplexes them, and each instance serves many requests. */
export const FUNCTION_DB_CONNECTIONS = 3;

/** The identity pool's size per instance: the session check, one short query a request. */
export const FUNCTION_IDENTITY_CONNECTIONS = 2;

/** How long an idle client stays open in a function: short, so a suspended instance holds no connection. */
export const FUNCTION_IDLE_MS = 5_000;

/** What the function asks of its platform: `platform.ts` on Vercel, fakes in tests. */
export interface FunctionPlatform {
  /** Keeps the instance alive until the promise settles (Vercel's `waitUntil`). */
  readonly keepAlive: (work: Promise<unknown>) => void;
  /** Hands a pool to the platform, which closes its idle clients before the instance suspends. */
  readonly attachPool?: Parameters<typeof createDatabase>[0]['onPool'];
}

/** The function's one handler. */
export interface FunctionApi {
  fetch(request: Request): Promise<Response>;
}

function errorResponse(code: ErrorCode, message: string): Response {
  return Response.json({ code, message }, { status: errorStatus(code) });
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** Whether `presented` is the secret, compared in constant time over both digests. */
export function secretMatches(expected: string, presented: string | null): boolean {
  if (presented === null) return false;
  return timingSafeEqual(digest(presented), digest(expected));
}

/** A handler that refuses every request plainly: the environment is invalid, so nothing was built. */
function unconfigured(): FunctionApi {
  return {
    fetch: () => Promise.resolve(errorResponse('API_UNAVAILABLE', 'The API is not configured on this deployment.')),
  };
}

/**
 * Builds the api for one function instance from `source` (`process.env`).
 * An invalid environment builds nothing: every request answers 503 and the
 * log names each variable at fault, never a value.
 */
export function createFunctionApi(source: Record<string, string | undefined>, platform: FunctionPlatform): FunctionApi {
  const parsedApi = ApiEnv.safeParse(source);
  const parsedFunction = FunctionEnv.safeParse(source);
  if (!parsedApi.success || !parsedFunction.success) {
    const problems = [parsedApi.error, parsedFunction.error].flatMap((error) =>
      error === undefined ? [] : [z.prettifyError(error)],
    );
    log.error('Refusing to start, the environment is invalid', { problems: problems.join('\n') });
    return unconfigured();
  }
  const env = parsedApi.data;
  const own = parsedFunction.data;

  const onPoolError = (error: Error) => {
    log.error('Idle database client failed', errorFields(error));
    captureFault(error, { task: 'database pool' });
  };
  const pools = {
    onPoolError,
    idleTimeoutMs: FUNCTION_IDLE_MS,
    ...(platform.attachPool === undefined ? {} : { onPool: platform.attachPool }),
  };
  // DATABASE_URL is Neon's pooler, as on every host; the pools stay small because each instance has its own.
  const db = createDatabase({
    url: env.DATABASE_URL,
    applicationName: 'crm-api',
    maxConnections: FUNCTION_DB_CONNECTIONS,
    ...pools,
  });
  const identity = createIdentityStore({
    url: env.IDENTITY_DATABASE_URL,
    applicationName: 'crm-api-identity',
    maxConnections: FUNCTION_IDENTITY_CONNECTIONS,
    ...pools,
  });
  const mailer = createMailer(env);
  // Each event goes at once: an instance may be suspended before a batch of 20 fills.
  const analytics = createAnalytics({
    key: env.POSTHOG_KEY,
    host: env.POSTHOG_HOST ?? POSTHOG_EU_HOST,
    environment: env.APP_ENV,
    log,
    flushAt: 1,
  });
  const auth = createAuth({ env, identity, mailer, analytics });

  // The job drain, on the worker's direct login (FunctionEnv requires it outside local). No relay runs here, so a
  // stored change event wakes nothing; it waits in the outbox (spec 0045, the trade offs).
  const drain: JobDrain | undefined =
    own.DATABASE_URL_DIRECT === undefined
      ? undefined
      : createJobDrain({
          directUrl: own.DATABASE_URL_DIRECT,
          tasks: composeJobTasks({ env, db, onStored: () => undefined }),
          log,
          onFault: (error) => captureFault(error, { task: 'jobs' }),
        });
  const wakeRelay =
    drain === undefined
      ? NO_WAKE
      : createDrainWake({
          drain,
          keepAlive: platform.keepAlive,
          budgetMs: DRAIN_BUDGET_MS,
          log,
          onFault: (error) => captureFault(error, { task: 'jobs' }),
        });
  log.info('API on Vercel', { environment: env.APP_ENV, jobs: drain === undefined ? 'off' : 'drain' });

  const app = createApp({ services: { db, identity, auth, wakeRelay, analytics, rules: APP_RULES }, env });
  // The jobs endpoint answers only through the app's edge, like every other route.
  const edge = createEdgeGuard({ secret: env.EDGE_SECRET, environment: env.APP_ENV });

  // As `server.ts` refuses to start: never serve on a role that can bypass row level security. Asked on the first
  // request and kept once it passes; a failure answers 503 and is asked again next time.
  let ready: Promise<void> | undefined;
  const assertRoles = () => {
    ready ??= Promise.all([db.assertAppRole(), identity.assertIdentityRole()])
      .then(() => undefined)
      .catch((error: unknown) => {
        ready = undefined;
        throw error;
      });
    return ready;
  };

  async function runJobs(request: Request): Promise<Response> {
    if (request.method !== 'POST' || own.JOBS_RUN_SECRET === undefined) {
      return errorResponse('NOT_FOUND', 'There is nothing at this address.');
    }
    if (!edge.admit(request)) return errorResponse('EDGE_REQUIRED', 'This API is reachable only through the app.');
    if (!secretMatches(own.JOBS_RUN_SECRET, request.headers.get(JOBS_SECRET_HEADER))) {
      return errorResponse('UNAUTHENTICATED', 'This request needs the jobs secret.');
    }
    if (drain === undefined) return errorResponse('API_UNAVAILABLE', 'The jobs are off on this deployment.');
    const refused = await rolesRefusal();
    if (refused !== undefined) return refused;
    let report: DrainReport;
    try {
      report = await drain.run({ budgetMs: DRAIN_BUDGET_MS, minimumMs: SCHEDULED_MINIMUM_MS });
    } catch (error) {
      log.error('jobs.drain.failed', errorFields(error));
      captureFault(error, { task: 'jobs' });
      return errorResponse('API_UNAVAILABLE', 'The job run failed; the function log has the reason.');
    }
    log.info('jobs.drain', { ...report, by: 'schedule' });
    return Response.json({ status: 'ok', ...report });
  }

  /** Refuses with 503 unless the roles check passes; undefined when it did. */
  async function rolesRefusal(): Promise<Response | undefined> {
    try {
      await assertRoles();
      return undefined;
    } catch (error) {
      log.error('Refusing to serve', errorFields(error));
      captureFault(error, { task: 'start' });
      return errorResponse('API_UNAVAILABLE', 'The API cannot reach its database right now.');
    }
  }

  return {
    async fetch(request) {
      try {
        const path = new URL(request.url).pathname;
        // Liveness and the release need no database: the web deploy and uptime checks read them even while it is down.
        if (path === LIVENESS_PATH) return await app.fetch(request);
        // The jobs endpoint checks its caller before it touches the database.
        if (path === JOBS_RUN_PATH) return await runJobs(request);
        return (await rolesRefusal()) ?? (await app.fetch(request));
      } finally {
        // What monitoring holds goes out before the instance may be suspended.
        platform.keepAlive(flush(MONITORING_FLUSH_MS));
      }
    },
  };
}
