// Railway services for the CRM, applied per environment with `railway config plan`
// then `railway config apply` (linked to `production`, then to `preview-base`).
// Secrets stay in Railway variables: preserve() keeps what each environment has.
import { type BuildConfig, defineRailway, github, preserve, project, service } from 'railway/iac';

// The GitHub repository, as owner/name. Set it once the repo exists.
const REPO = 'OWNER/crm';

export default defineRailway(() => {
  const source = github(REPO, { branch: 'main' });
  const apiImage: BuildConfig = {
    builder: 'DOCKERFILE',
    dockerfilePath: 'apps/api/Dockerfile',
    watchPatterns: ['apps/api/**', 'packages/**', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  };

  const api = service('api', {
    source,
    build: apiImage,
    // Migrations run on the direct connection as the owner, before the new version starts.
    preDeploy: 'node packages/db/scripts/migrate.ts',
    start: 'node apps/api/src/server.ts',
    healthcheck: '/api/health/ready',
    env: {
      APP_ENV: preserve(),
      APP_URL: preserve(),
      DATABASE_URL: preserve(),
      DATABASE_URL_OWNER: preserve(),
    },
  });

  const worker = service('worker', {
    source,
    build: apiImage,
    start: 'node apps/api/src/worker.ts',
    healthcheck: '/health',
    env: {
      APP_ENV: api.env.APP_ENV,
      DATABASE_URL: api.env.DATABASE_URL,
      DATABASE_URL_DIRECT: preserve(),
    },
  });

  const centrifugo = service('centrifugo', {
    source,
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

  return project('crm', { resources: [api, worker, centrifugo] });
});
