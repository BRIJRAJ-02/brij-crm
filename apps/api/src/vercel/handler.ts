// The api as a Vercel Function (spec 0045): the same Hono app `server.ts`
// serves, built once per function instance from the validated environment,
// plus what a host without a worker needs. Writes start a bounded job drain
// after the response (`waitUntil`), a signed in request starts one once a
// queued row has come due (`createDueWake`), and `POST /api/internal/jobs/run`,
// which the scheduled workflow calls with `JOBS_RUN_SECRET`, runs one turn of
// it. `GET` on the same address is Vercel Cron's (it sends `Authorization:
// Bearer <CRON_SECRET>`): the same turn, the timer under Google's push that
// brings each calendar's 15 minute poll in on time when nobody uses the app;
// without `CRON_SECRET` it answers 404. Work a request starts after answering
// (the new device alert, the workspace deleted notice) is kept alive the same
// way. No relay and no Centrifugo: live updates stay off while the api runs here.
import { createHash, timingSafeEqual } from 'node:crypto';
import { type ErrorCode, errorStatus } from '@crm/contracts';
import { isInvitedEmail, twoFactorRequiredBy } from '@crm/core';
import { createDatabase, createIdentityStore } from '@crm/db';
import * as z from 'zod';
import { createApp } from '../app.ts';
import { createAuth } from '../auth/auth.ts';
import { createEdgeGuard } from '../edge.ts';
import { ApiEnv, FunctionEnv } from '../env.ts';
import { composeJobTasks } from '../jobs/compose.ts';
import { createDrainWake, createDueWake, createJobDrain, type DrainReport, type JobDrain } from '../jobs/drain.ts';
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

/** The token in an `Authorization: Bearer <token>` header (Vercel Cron sends `CRON_SECRET` so), or null for none. */
export function bearerOf(header: string | null): string | null {
  // The scheme's name is case insensitive (RFC 9110); the token is one run of printable characters.
  const match = header === null ? null : /^Bearer ([\x21-\x7e]+)$/i.exec(header);
  return match?.[1] ?? null;
}

/**
 * A turn's time budget: the after request wake's (its turn and the one more
 * it may run share it) and the scheduled one's. The slices in hand then
 * finish their batch (each returns within 30 seconds), and an after request
 * wake may first wait out its 5 second cooldown, which keeps it all inside
 * the function's 60 second limit.
 */
export const DRAIN_BUDGET_MS = 15_000;

/**
 * Every scheduled turn runs at least this long, with the runners started
 * even when nothing is due, so the cron lines' backfill gets its chance: the
 * hour's digest run (`DIGEST_CRONTAB`, one hour of fill) in every hour, quiet
 * or not, and the daily cleanup's (one day of fill) in the first turn after
 * 03:00 UTC. An hourly run of 3 seconds keeps Neon's compute awake for its
 * few idle minutes, once an hour.
 */
export const SCHEDULED_MINIMUM_MS = 3_000;

/** The scheduled turn's limits: the budget, and the minimum, so the cron lines always get their turn. */
export function scheduledTurn(): { readonly budgetMs: number; readonly minimumMs: number } {
  return { budgetMs: DRAIN_BUDGET_MS, minimumMs: SCHEDULED_MINIMUM_MS };
}

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
  const auth = createAuth({
    env,
    identity,
    mailer,
    analytics,
    invited: (email) => isInvitedEmail({ db }, email),
    requiredBy: (userId) => twoFactorRequiredBy({ db, identity }, userId),
    // The new device alert and the history sweep run after sign in answers: the instance stays up for them.
    keepAlive: platform.keepAlive,
  });

  // The job drain, on the worker's direct login (FunctionEnv requires it outside local). No relay runs here, so a
  // stored change event wakes nothing; it waits in the outbox (spec 0045, the trade offs).
  const drain: JobDrain | undefined =
    own.DATABASE_URL_DIRECT === undefined
      ? undefined
      : createJobDrain({
          directUrl: own.DATABASE_URL_DIRECT,
          compose: (queue) => composeJobTasks({ env, db, onStored: () => undefined, queue }),
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
  // In place of spec 0008's once a minute poke from use (WORKER_WAKE_ON_USE): nothing runs between turns, so a signed
  // in request starts one once a row the drain saw has come due (a reminder, a delayed email), or every 2 minutes.
  const wakeOnUse = drain === undefined ? NO_WAKE : createDueWake({ drain, wake: wakeRelay });
  log.info('API on Vercel', { environment: env.APP_ENV, jobs: drain === undefined ? 'off' : 'drain' });

  // The same mailer as sign in's: step up codes and invitations send through it, as on `server.ts`.
  const app = createApp({
    services: {
      db,
      identity,
      auth,
      wakeRelay,
      wakeOnUse,
      analytics,
      mailer,
      rules: APP_RULES,
      keepAlive: platform.keepAlive,
    },
    env,
  });
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

  /**
   * The jobs endpoint: `POST` with `x-crm-jobs-secret` (the scheduled workflow), or `GET` with `Authorization:
   * Bearer <CRON_SECRET>` (Vercel Cron), each secret compared in constant time and each through the app's edge. A
   * method, or a secret, this deployment doesn't have answers 404; either runs one scheduled turn and logs it.
   */
  async function runJobs(request: Request): Promise<Response> {
    const secret =
      request.method === 'POST' ? own.JOBS_RUN_SECRET : request.method === 'GET' ? own.CRON_SECRET : undefined;
    if (secret === undefined) return errorResponse('NOT_FOUND', 'There is nothing at this address.');
    if (!edge.admit(request)) return errorResponse('EDGE_REQUIRED', 'This API is reachable only through the app.');
    const presented =
      request.method === 'GET'
        ? bearerOf(request.headers.get('authorization'))
        : request.headers.get(JOBS_SECRET_HEADER);
    if (!secretMatches(secret, presented)) {
      return errorResponse('UNAUTHENTICATED', 'This request needs the jobs secret.');
    }
    if (drain === undefined) return errorResponse('API_UNAVAILABLE', 'The jobs are off on this deployment.');
    const refused = await rolesRefusal();
    if (refused !== undefined) return refused;
    const by = request.method === 'GET' ? 'cron' : 'schedule';
    let report: DrainReport;
    try {
      report = await drain.run(scheduledTurn());
    } catch (error) {
      log.error('jobs.drain.failed', { ...errorFields(error), by });
      captureFault(error, { task: 'jobs' });
      return errorResponse('API_UNAVAILABLE', 'The job run failed; the function log has the reason.');
    }
    log.info('jobs.drain', { ...report, by });
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
