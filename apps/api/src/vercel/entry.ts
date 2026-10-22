// The Vercel Function's entry (spec 0045), re-exported by apps/web/api/index.ts,
// which Vercel builds as a Node function in the web project. Each instance
// builds the api once, here, and serves every /api request with it (the
// middleware sends them, vercel.json routes them to this one function).
// Sentry starts first when SENTRY_DSN_SERVER is set, as `instrument.ts` does on
// the other hosts, though database spans need the preload only `node --import`
// gives, so a function reports errors and request traces without them.
import { releaseOf } from '../env.ts';
import { log } from '../log.ts';
import { MonitoringEnv } from '../monitoring/config.ts';
import { startSentry } from '../monitoring/sentry.ts';
import { createFunctionApi } from './handler.ts';
import { attachPool, keepAlive } from './platform.ts';

const monitoring = MonitoringEnv.safeParse(process.env);
if (monitoring.success && monitoring.data.SENTRY_DSN_SERVER !== undefined) {
  const release = releaseOf(monitoring.data);
  startSentry({
    dsn: monitoring.data.SENTRY_DSN_SERVER,
    environment: monitoring.data.APP_ENV,
    release,
    service: 'api',
  });
  log.info('Monitoring on', { monitoring: 'on', service: 'api', environment: monitoring.data.APP_ENV, release });
} else {
  log.info('Monitoring off', { monitoring: 'off', service: 'api' });
}

const api = createFunctionApi(process.env, { keepAlive, attachPool });

/** Every method goes to the one handler; the Hono app routes them. */
const handle = (request: Request): Promise<Response> => api.fetch(request);

export {
  handle as DELETE,
  handle as GET,
  handle as HEAD,
  handle as OPTIONS,
  handle as PATCH,
  handle as POST,
  handle as PUT,
};
