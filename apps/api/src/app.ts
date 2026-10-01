import type { Database } from '@crm/db';
import { RPCHandler } from '@orpc/server/fetch';
import { Hono } from 'hono';
import type { ApiEnv } from './env.ts';
import { errorFields, log } from './log.ts';
import { router } from './router.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApp({ db, env }: { db: Database; env: ApiEnv }) {
  const rpc = new RPCHandler(router);
  const allowedOrigins = new Set([new URL(env.APP_URL).origin, ...(env.TRUSTED_ORIGINS ?? [])]);

  const app = new Hono().basePath('/api');

  // Liveness: the process is up. Readiness: it can reach Postgres.
  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/health/ready', async (c) => {
    try {
      await db.checkHealth();
      return c.json({ status: 'ok' });
    } catch (error) {
      log.warn('Readiness check failed', errorFields(error));
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  // The app and API share one origin, so a write from anywhere else is refused.
  app.use('*', async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = c.req.header('origin');
    if (!origin || !allowedOrigins.has(origin)) {
      return c.json(
        { code: 'FORBIDDEN_ORIGIN', message: 'This request came from an origin the API does not accept.' },
        403,
      );
    }
    return next();
  });

  app.all('/rpc/*', async (c) => {
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/api/rpc',
      context: { db, environment: env.APP_ENV },
    });
    return matched ? c.newResponse(response.body, response) : c.notFound();
  });

  app.notFound((c) => c.json({ code: 'NOT_FOUND', message: 'There is nothing at this address.' }, 404));
  app.onError((error, c) => {
    log.error('Unhandled error', { path: c.req.path, ...errorFields(error) });
    return c.json({ code: 'INTERNAL', message: 'Something went wrong on our side.' }, 500);
  });

  return app;
}
