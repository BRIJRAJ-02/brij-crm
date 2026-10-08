import { randomUUID } from 'node:crypto';
import { type ErrorCode, errorStatus } from '@crm/contracts';
import type { RuleSource } from '@crm/core';
import type { Database, IdentityStore } from '@crm/db';
import type { AnyRouter } from '@orpc/server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AUTH_BASE_PATH, AUTH_ROUTES, type Auth } from './auth/auth.ts';
import { createEdgeGuard } from './edge.ts';
import type { ApiEnv } from './env.ts';
import { createReadGate } from './gate.ts';
import { errorFields, log } from './log.ts';
import { captureFault, withRequestScope } from './monitoring/sentry.ts';
import { createRealtimeTokens } from './realtime/tokens.ts';
import type { WakeRelay } from './realtime/wake.ts';
import { router as appRouter } from './router.ts';
import { createRpcHandler } from './rpc.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Where `system.testFault` answers, when it is switched on. */
const TEST_FAULT_PATH = '/api/rpc/system/testFault';

/**
 * A path as the RPC router may read it: decoded, repeated slashes as one, no trailing slash. So every
 * spelling of the test fault's address (`/testFault/`, `//testFault`, `test%46ault`) is caught as one.
 */
export function routedPath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Not valid percent encoding: the router can't read it as the test fault either.
  }
  return decoded.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1');
}

/** The largest RPC request body the API reads. */
export const RPC_BODY_LIMIT_BYTES = 1024 * 1024;

/** The largest body a sign in route reads: an email, a code, a provider name. */
export const AUTH_BODY_LIMIT_BYTES = 64 * 1024;

interface AppVariables {
  requestId: string;
  clientIp: string | undefined;
  /** The browser's Origin, as the edge guard reads it (see `EdgeGuard.origin`). */
  origin: string | undefined;
}

/** A `{ code, message }` answer at the status the error map gives the code. */
function errorResponse(code: ErrorCode, message: string): Response {
  return Response.json({ code, message }, { status: errorStatus(code) });
}

/** The route an error report names: a sign in route by its Better Auth path (`auth /sign-in/email-otp`), else the path. */
export function routeOf(path: string): string {
  return path.startsWith(`${AUTH_BASE_PATH}/`) ? `auth ${path.slice(AUTH_BASE_PATH.length)}` : path;
}

/** What the API serves with: the tenant database, global identity, sign in, and the relay's wake up call. */
export interface AppServices {
  readonly db: Database;
  readonly identity: IdentityStore;
  readonly auth: Auth;
  readonly wakeRelay: WakeRelay;
  /**
   * Where the door reads object, field and record rules (spec 0009). The
   * server passes none (no rules until #24); only tests and the local test
   * server (`test/rules-server.ts`) inject some.
   */
  readonly rules?: RuleSource;
}

/** The API. `router` is the app's own unless a test passes one. */
export function createApp({
  services,
  env,
  router = appRouter,
}: {
  services: AppServices;
  env: ApiEnv;
  router?: AnyRouter;
}) {
  const { db, identity, auth, wakeRelay, rules } = services;
  const rpc = createRpcHandler(router);
  const edge = createEdgeGuard({ secret: env.EDGE_SECRET, environment: env.APP_ENV });
  const allowedOrigins = new Set([new URL(env.APP_URL).origin, ...(env.TRUSTED_ORIGINS ?? [])]);
  // One per app, so its counts are this process's: at most 6 heavy reads per workspace at once.
  const readGate = createReadGate();
  // Centrifugo's tokens, where live updates are on (spec 0005).
  const realtime =
    env.CENTRIFUGO_TOKEN_SECRET === undefined
      ? undefined
      : createRealtimeTokens({ secret: env.CENTRIFUGO_TOKEN_SECRET });
  // The monitoring test fault (spec 0010, AC-168): off, its address answers exactly as one that doesn't exist.
  const testFault = env.MONITORING_TEST_FAULT === 'on';

  const app = new Hono<{ Variables: AppVariables }>().basePath('/api');

  // Every request gets its own id, never one the caller chose; logs carry it.
  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    // Its own monitoring scope too, so an error report names this request (and its user and workspace) only.
    await withRequestScope(requestId, next);
    c.header('x-request-id', requestId);
  });

  // Only requests through Vercel's middleware reach the API (see edge.ts). The
  // client IP is read here, from the request the guard saw, and nowhere else.
  app.use('*', async (c, next) => {
    if (!edge.admit(c.req.raw)) {
      return errorResponse('EDGE_REQUIRED', 'This API is reachable only through the app.');
    }
    c.set('clientIp', edge.clientIp(c.req.raw));
    c.set('origin', edge.origin(c.req.raw));
    return next();
  });

  // Liveness: the process is up. Readiness: it can reach Postgres.
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/health/ready', async (c) => {
    try {
      await db.checkHealth();
      return c.json({ status: 'ok' });
    } catch (error) {
      log.warn('Readiness check failed', { requestId: c.get('requestId'), ...errorFields(error) });
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  // The app and API share one origin, so a write from anywhere else is refused.
  app.use('*', async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.get('origin');
    if (!origin || !allowedOrigins.has(origin)) {
      return errorResponse('FORBIDDEN_ORIGIN', 'This request came from an origin the API does not accept.');
    }
    return next();
  });

  app.use(
    '/rpc/*',
    bodyLimit({
      maxSize: RPC_BODY_LIMIT_BYTES,
      onError: () => errorResponse('PAYLOAD_TOO_LARGE', 'This request is larger than the 1 MB the API accepts.'),
    }),
  );

  app.all('/rpc/*', async (c) => {
    if (!testFault && routedPath(c.req.path) === TEST_FAULT_PATH) return c.notFound();
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/api/rpc',
      context: {
        db,
        identity,
        auth,
        wakeRelay,
        environment: env.APP_ENV,
        requestId: c.get('requestId'),
        clientIp: c.get('clientIp'),
        headers: c.req.raw.headers,
        readGate,
        realtime,
        testFault,
        ...(rules === undefined ? {} : { rules }),
      },
    });
    return matched ? c.newResponse(response.body, response) : c.notFound();
  });

  // Better Auth's own routes: only the ones sign in uses (`AUTH_ROUTES`), matched on the path as sent, so
  // an encoded or padded path never reaches a route we didn't list.
  app.use('/auth/*', async (c, next) => {
    const route = new URL(c.req.url).pathname.slice(AUTH_BASE_PATH.length);
    if (!AUTH_ROUTES.has(route)) return errorResponse('NOT_FOUND', 'There is nothing at this address.');
    return next();
  });

  app.use(
    '/auth/*',
    bodyLimit({
      maxSize: AUTH_BODY_LIMIT_BYTES,
      onError: () => errorResponse('PAYLOAD_TOO_LARGE', 'This request is larger than the 64 KB sign in accepts.'),
    }),
  );

  // It sees only the client IP the edge guard trusted.
  app.on(['GET', 'POST'], '/auth/*', (c) => auth.handle(c.req.raw, c.get('clientIp'), c.get('origin')));

  app.notFound(() => errorResponse('NOT_FOUND', 'There is nothing at this address.'));
  app.onError((error, c) => {
    log.error('Unhandled error', { requestId: c.get('requestId'), path: c.req.path, ...errorFields(error) });
    captureFault(error, { requestId: c.get('requestId'), route: routeOf(c.req.path) });
    return errorResponse('INTERNAL', 'Something went wrong. Try again.');
  });

  return app;
}
