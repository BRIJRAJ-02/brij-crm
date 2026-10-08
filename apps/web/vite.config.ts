import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { layerOrder, uiVite } from '@crm/ui/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { contentSecurityPolicy, directiveSources, sentryDsnProblem } from './csp.ts';
import { realtimeCspProblem } from './realtime-csp.ts';

const API_DEV_ORIGIN = 'http://localhost:3000';

/** The Content-Security-Policy vercel.json sends with every page. */
function deployedCsp(): string {
  const vercel = JSON.parse(readFileSync(path.join(import.meta.dirname, 'vercel.json'), 'utf8')) as {
    readonly headers: readonly { readonly headers: readonly { readonly key: string; readonly value: string }[] }[];
  };
  return (
    vercel.headers.flatMap((rule) => rule.headers).find((header) => header.key === 'Content-Security-Policy')?.value ??
    ''
  );
}

/** Refuses to build with a realtime address (VITE_REALTIME_URL) the deployed CSP would block (spec 0005). */
function realtimeCsp(): Plugin {
  return {
    name: 'crm:realtime-csp',
    apply: 'build',
    configResolved(config) {
      const url: unknown = config.env.VITE_REALTIME_URL;
      const problem = realtimeCspProblem(typeof url === 'string' ? url : undefined, deployedCsp());
      if (problem !== undefined) throw new Error(problem);
    },
  };
}
// Monitoring (spec 0010): the release is the commit the deploy and preview Actions build (`GITHUB_SHA`), and the
// environment Vercel's build names (`VERCEL_ENV`); a laptop's build is `local` for both.
const RELEASE = process.env.GITHUB_SHA ?? 'local';
const ENVIRONMENT = process.env.VERCEL_ENV ?? 'local';

/**
 * Source maps never ship (AC-164): the build makes hidden ones (no `sourceMappingURL` in the bundle), the
 * Sentry plugin uploads them when the Actions hold `SENTRY_AUTH_TOKEN`, and this deletes every `.map` left in
 * the output afterwards, uploaded or not. `closeBundle` runs once every `writeBundle`, the upload's, is done.
 */
function deleteSourceMaps(): Plugin {
  let outDir = '';
  return {
    name: 'crm:delete-source-maps',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        for (const file of readdirSync(outDir, { recursive: true, encoding: 'utf8' })) {
          if (file.endsWith('.map')) rmSync(path.join(outDir, file));
        }
      },
    },
  };
}

/** A build carrying a web DSN must be one the CSP lets through, on Sentry's EU ingest (AC-167). */
function checkSentryDsn(): Plugin {
  return {
    name: 'crm:check-sentry-dsn',
    apply: 'build',
    configResolved(config) {
      const dsn = config.env.VITE_SENTRY_DSN_WEB as string | undefined;
      if (dsn === undefined || dsn === '') return;
      const problem = sentryDsnProblem(dsn, directiveSources(contentSecurityPolicy(), 'connect-src'));
      if (problem !== undefined) throw new Error(problem);
    },
  };
}

/**
 * The source map upload, only where `SENTRY_AUTH_TOKEN` is set (the deploy and preview Actions); without it
 * the build is the same, and the maps are deleted all the same.
 */
function uploadSourceMaps(): Plugin[] {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  if (authToken === undefined || authToken === '') return [];
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT_WEB;
  if (org === undefined || org === '' || project === undefined || project === '') {
    throw new Error('SENTRY_AUTH_TOKEN is set, so SENTRY_ORG and SENTRY_PROJECT_WEB must be too.');
  }
  return sentryVitePlugin({
    authToken,
    org,
    project,
    // The EU region's API, where the organization lives.
    url: 'https://de.sentry.io/',
    release: { name: RELEASE },
    sourcemaps: { filesToDeleteAfterUpload: [path.join(import.meta.dirname, 'dist', '**', '*.map')] },
    // Nothing about our builds goes to Sentry beyond the maps themselves.
    telemetry: false,
  });
}

export default defineConfig({
  // One `.env` at the repo root for local work.
  envDir: '../..',
  define: {
    'import.meta.env.APP_RELEASE': JSON.stringify(RELEASE),
    'import.meta.env.APP_ENVIRONMENT': JSON.stringify(ENVIRONMENT),
  },
  plugins: [
    // Must come before the React plugin.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      addExtensions: true,
      // Pending components split too (the default keeps them in the first
      // load), so the frames they draw load with the route, not up front.
      codeSplittingOptions: {
        defaultBehavior: [['component'], ['pendingComponent'], ['errorComponent'], ['notFoundComponent']],
      },
    }),
    react(),
    // CSS module classes as ws-<component>-<local>, as in Storybook and the artifact.
    uiVite(),
    // The cascade layer order as /layers.css, linked ahead of every bundled stylesheet.
    layerOrder(),
    // Live updates' socket must be one vercel.json's CSP allows.
    realtimeCsp(),
    // A web DSN must be on Sentry's EU ingest and allowed by the same CSP; both checks run on every build.
    checkSentryDsn(),
    uploadSourceMaps(),
    deleteSourceMaps(),
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same origin locally too: the browser only ever talks to :5173.
    proxy: { '/api': { target: API_DEV_ORIGIN } },
  },
  build: {
    outDir: 'dist',
    // Made for Sentry, never linked from the bundle, and deleted before anything ships (deleteSourceMaps).
    sourcemap: 'hidden',
    // dist/.vite/manifest.json: the first load budget reads the index route's static graph from it.
    manifest: true,
  },
});
