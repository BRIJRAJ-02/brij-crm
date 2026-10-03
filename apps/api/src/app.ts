import { randomUUID } from 'node:crypto';
import { type ErrorCode, errorStatus } from '@crm/contracts';
import type { Database } from '@crm/db';
import type { AnyRouter } from '@orpc/server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createEdgeGuard } from './edge.ts';
import type { ApiEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { router as appRouter } from './router.ts';
import { createRpcHandler } from './rpc.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The largest RPC request body the API reads. Better Auth keeps its own default on /api/auth. */
export const RPC_BODY_LIMIT_BYTES = 1024 * 1024;

interface AppVariables {
  requestId: string;
  clientIp: string | undefined;
}

/** A `{ code, message }` answer at the status the error map gives the code. */
function errorResponse(code: ErrorCode, message: string): Response {
  return Response.json({ code, message }, { status: errorStatus(code) });
}

/** The API. `router` is the app's own unless a test passes one. */
export function createApp({ db, env, router = appRouter }: { db: Database; env: ApiEnv; router?: AnyRouter }) {
  const rpc = createRpcHandler(router);
  const edge = createEdgeGuard({ secret: env.EDGE_SECRET, environment: env.APP_ENV });
  const allowedOrigins = new Set([new URL(env.APP_URL).origin, ...(env.TRUSTED_ORIGINS ?? [])]);

  const app = new Hono<{ Variables: AppVariables }>().basePath('/api');

  // Every request gets its own id, never one the caller chose; logs carry it.
  app.use('*', async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    await next();
    c.header('x-request-id', requestId);
  });

  // Only requests through Vercel's middleware reach the API (see edge.ts). The
  // client IP is read here, from the request the guard saw, and nowhere else.
  app.use('*', async (c, next) => {
    if (!edge.admit(c.req.raw)) {
      return errorResponse('EDGE_REQUIRED', 'This API is reachable only through the app.');
    }
    c.set('clientIp', edge.clientIp(c.req.raw));
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
    const origin = c.req.header('origin');
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
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/api/rpc',
      context: { db, environment: env.APP_ENV, requestId: c.get('requestId'), clientIp: c.get('clientIp') },
    });
    return matched ? c.newResponse(response.body, response) : c.notFound();
  });

  app.notFound(() => errorResponse('NOT_FOUND', 'There is nothing at this address.'));
  app.onError((error, c) => {
    log.error('Unhandled error', { requestId: c.get('requestId'), path: c.req.path, ...errorFields(error) });
    return errorResponse('INTERNAL', 'Something went wrong on our side.');
  });

  return app;
}
