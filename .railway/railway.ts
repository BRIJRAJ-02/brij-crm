// Railway services for the CRM, applied per environment with `railway config plan`
// then `railway config apply` (linked to `production`, then to `preview-base`).
// Secrets stay in Railway variables: preserve() keeps what each environment has.
import { type BuildConfig, defineRailway, github, preserve, project, service } from 'railway/iac';

// The GitHub repository, as owner/name.
const REPO = 'BRIJRAJ-02/brij-crm';
// Singapore, beside the Neon database (aws ap-southeast-1).
const REGIONS = { 'asia-southeast1-eqsg3a': 1 };

export default defineRailway(() => {
  const source = github(REPO, { branch: 'main' });
  const apiImage: BuildConfig = {
    builder: 'DOCKERFILE',
    dockerfilePath: 'apps/api/Dockerfile',
    watchPatterns: ['apps/api/**', 'packages/**', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  };

  const api = service('api', {
    source,
    regions: REGIONS,
    build: apiImage,
    // Migrations run on the direct connection as the owner, before the new version starts.
    preDeploy: 'node packages/db/scripts/migrate.ts',
    // Sentry's instrument loads first (spec 0010); it starts nothing without SENTRY_DSN_SERVER.
    start: 'node --import ./apps/api/src/monitoring/instrument.ts apps/api/src/server.ts',
    healthcheck: '/api/health/ready',
    env: {
      APP_ENV: preserve(),
      APP_URL: preserve(),
      // Extra origins allowed to write (comma separated), if any.
      TRUSTED_ORIGINS: preserve(),
      // The edge guard's shared secret (spec 0005): declared before it is set, so a config apply keeps it.
      EDGE_SECRET: preserve(),
      DATABASE_URL: preserve(),
      DATABASE_URL_OWNER: preserve(),
      // Sign in (spec 0005): the identity login, Better Auth, the allowlist and mail.
      IDENTITY_DATABASE_URL: preserve(),
      BETTER_AUTH_SECRET: preserve(),
      BETTER_AUTH_URL: preserve(),
      SIGNUP_ALLOWLIST: preserve(),
      RESEND_API_KEY: preserve(),
      MAIL_FROM: preserve(),
      // The key a booking's guest links and an email's preferences links are signed with; unset, both derive from
      // WORKER_WAKE_SECRET. The worker takes the api's value.
      BOOKING_LINK_SECRET: preserve(),
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      // The relay's wake up call (spec 0005): the worker's private address and port, and the shared secret.
      WORKER_INTERNAL_URL: preserve(),
      WORKER_WAKE_SECRET: preserve(),
      // Spec 0008: signed in requests wake the worker once a minute; off in production until the owner sets `on`.
      WORKER_WAKE_ON_USE: preserve(),
      // Live updates (spec 0005): signs Centrifugo's tokens. In production, a reference to the Centrifugo
      // service's CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY; unset in preview-base, which has no live updates.
      CENTRIFUGO_TOKEN_SECRET: preserve(),
      // Monitoring (spec 0010): the brij-crm-server project's DSN. Unset means off. The release is Railway's own
      // RAILWAY_GIT_COMMIT_SHA, and the service comes from the start command's entry file.
      SENTRY_DSN_SERVER: preserve(),
      // `on` opens system.testFault to prove an error report in production; leave it unset otherwise.
      MONITORING_TEST_FAULT: preserve(),
      // Product events (spec 0010, milestone 3): the PostHog EU project's key, production only. Unset means off;
      // POSTHOG_HOST defaults to https://eu.i.posthog.com.
      POSTHOG_KEY: preserve(),
      POSTHOG_HOST: preserve(),
      // Calendar sync (spec 0024): off until the owner sets CALENDAR_SYNC=on with the Google client, the token key
      // and the public origin Google posts push notices to.
      CALENDAR_SYNC: preserve(),
      GOOGLE_CALENDAR_CLIENT_ID: preserve(),
      GOOGLE_CALENDAR_CLIENT_SECRET: preserve(),
      CALENDAR_TOKEN_KEY: preserve(),
      CALENDAR_WEBHOOK_ORIGIN: preserve(),
    },
  });

  const worker = service('worker', {
    source,
    regions: REGIONS,
    build: apiImage,
    start: 'node --import ./apps/api/src/monitoring/instrument.ts apps/api/src/worker.ts',
    healthcheck: '/health',
    env: {
      APP_ENV: api.env.APP_ENV,
      DATABASE_URL: api.env.DATABASE_URL,
      DATABASE_URL_DIRECT: preserve(),
      // The relay (spec 0005): Centrifugo's server API on its private port, its key, and the api's wake secret.
      CENTRIFUGO_API_URL: preserve(),
      CENTRIFUGO_API_KEY: preserve(),
      WORKER_WAKE_SECRET: api.env.WORKER_WAKE_SECRET,
      // The same Sentry project as the api, tagged service=worker.
      SENTRY_DSN_SERVER: api.env.SENTRY_DSN_SERVER,
      // Background jobs (spec 0008): the runners stay off in production until the owner sets `on` (its verify.md),
      // and the worker sleeps after this many idle seconds (180 when unset, 0 never).
      JOBS_RUNNER: preserve(),
      WORKER_IDLE_SLEEP_SECONDS: preserve(),
      // Email from the jobs (spec 0025's booking emails, the emails lane's queued ones): the app's address for their
      // links, the mail service and the sender, and the links' key, all the api's own.
      APP_URL: api.env.APP_URL,
      RESEND_API_KEY: api.env.RESEND_API_KEY,
      MAIL_FROM: api.env.MAIL_FROM,
      BOOKING_LINK_SECRET: api.env.BOOKING_LINK_SECRET,
      // Calendar sync (spec 0024): the worker refreshes tokens and syncs, with the api's values.
      CALENDAR_SYNC: api.env.CALENDAR_SYNC,
      GOOGLE_CALENDAR_CLIENT_ID: api.env.GOOGLE_CALENDAR_CLIENT_ID,
      GOOGLE_CALENDAR_CLIENT_SECRET: api.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      CALENDAR_TOKEN_KEY: api.env.CALENDAR_TOKEN_KEY,
      CALENDAR_WEBHOOK_ORIGIN: api.env.CALENDAR_WEBHOOK_ORIGIN,
      // Graphile's cron is UTC whatever the zone; the logs' times and anything else local read UTC too.
      TZ: 'UTC',
      // SIGTERM to SIGKILL: time for the slices in hand to finish their batch and hand their jobs back.
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: '30',
    },
  });

  const centrifugo = service('centrifugo', {
    source,
    regions: REGIONS,
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'infra/centrifugo/Dockerfile',
      watchPatterns: ['infra/centrifugo/**'],
    },
    healthcheck: '/health',
    env: {
      // /health lives on the internal port. The public domain targets 8000.
      PORT: '9000',
      CENTRIFUGO_HTTP_API_KEY: preserve(),
      CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: preserve(),
      CENTRIFUGO_ADMIN_PASSWORD: preserve(),
      CENTRIFUGO_ADMIN_SECRET: preserve(),
      CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: preserve(),
    },
  });

  return project('brij-crm', { resources: [api, worker, centrifugo] });
});
