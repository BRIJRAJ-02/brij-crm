// Loaded before anything else in the api and the worker (`node --import
// ./apps/api/src/monitoring/instrument.ts …`, spec 0010), so Sentry is ready
// before the first module it watches. It imports no vendor itself: it reads
// its own small environment and, only when `SENTRY_DSN_SERVER` is set, calls
// `startSentry`. Without a DSN nothing starts and nothing is sent.
import { loadEnv } from '../env.ts';
import { log } from '../log.ts';
import { MonitoringEnv, serviceFor } from './config.ts';
import { startSentry } from './sentry.ts';

const env = loadEnv(MonitoringEnv);
const service = serviceFor(env, process.argv[1]);
if (env.SENTRY_DSN_SERVER === undefined) {
  log.info('Monitoring off', { monitoring: 'off', service, reason: 'no SENTRY_DSN_SERVER' });
} else {
  const release = env.RAILWAY_GIT_COMMIT_SHA ?? 'local';
  startSentry({ dsn: env.SENTRY_DSN_SERVER, environment: env.APP_ENV, release, service });
  // Whether it is on and for what, never the DSN.
  log.info('Monitoring on', { monitoring: 'on', service, environment: env.APP_ENV, release });
}
