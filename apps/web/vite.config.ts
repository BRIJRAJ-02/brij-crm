import { readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { FIRST_SCREEN_FONTS, layerOrder, preloadFonts, uiVite } from '@crm/ui/vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { contentSecurityPolicy, directiveSources, policyForPath, sentryDsnProblem } from './csp.ts';
import { embedScript } from './embed-script.ts';
import { HANDLE_PATH } from './public-paths.ts';
import { realtimeCspProblem } from './realtime-csp.ts';

// The api the dev server and `vite preview` proxy /api to. API_DEV_ORIGIN moves it, so a second stack (another
// worktree's flows) runs beside the first; the web port moves with `--port`.
const API_DEV_ORIGIN = process.env.API_DEV_ORIGIN ?? 'http://localhost:3000';

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

/**
 * `vite preview` (the flows' server in CI) sends each page the `style-src` vercel.json sends it, so an inline
 * style the production policy refuses is refused in the flows too. Only `style-src`: the rest of the policy
 * names production's socket, and the flows connect to a local one.
 */
function deployedStylePolicy(): Plugin {
  return {
    name: 'crm:deployed-style-policy',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        // Before the page rewrites below, so the policy follows the address the browser asked for.
        const policy = policyForPath(new URL(request.url ?? '/', 'http://preview').pathname);
        const styles = policy === undefined ? [] : directiveSources(policy, 'style-src');
        if (styles.length > 0) response.setHeader('Content-Security-Policy', `style-src ${styles.join(' ')}`);
        next();
      });
    },
  };
}

/**
 * The hosted form page (spec 0023): `/f/<publicKey>` serves `form.html`, the
 * second entry, in the dev server and `vite preview`, as vercel.json's rewrite
 * does when deployed.
 */
function hostedForms(): Plugin {
  const rewrite = (url: string | undefined) => (url !== undefined && /^\/f\/[^/?#]+/.test(url) ? '/form.html' : url);
  return {
    name: 'crm:hosted-forms',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewrite(request.url);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewrite(request.url);
        next();
      });
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

/** The public booking pages' addresses (spec 0025): `/b/<publicKey>` and its `/manage`, served book.html as Vercel does. */
const BOOKING_PATH = /^\/b\/[^/?#]+(?:\/manage)?\/?(?:[?#].*)?$/;

/**
 * Serves book.html for `/b/<publicKey>`, and for a handle address `/<handle>` or `/<handle>/<slug>` (22 Oct 2026),
 * locally, as vercel.json's rewrites do when deployed.
 */
function publicBookingPage(): Plugin {
  const rewrite = (url: string | undefined): string | undefined =>
    url !== undefined && (BOOKING_PATH.test(url) || HANDLE_PATH.test(url.replace(/[?#].*$/, ''))) ? '/book.html' : url;
  return {
    name: 'crm:public-booking-page',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewrite(request.url);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        request.url = rewrite(request.url);
        next();
      });
    },
  };
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
    // Inter preloaded by its built name on every entry, so a cold first visit paints in it from the start
    // (never fallback, then Inter): the app, the hosted form and the public booking page all draw with it.
    preloadFonts(FIRST_SCREEN_FONTS, ['/index.html', '/form.html', '/book.html']),
    // Live updates' socket must be one vercel.json's CSP allows.
    realtimeCsp(),
    // A web DSN must be on Sentry's EU ingest and allowed by the same CSP; both checks run on every build.
    checkSentryDsn(),
    uploadSourceMaps(),
    deleteSourceMaps(),
    deployedStylePolicy(),
    hostedForms(),
    publicBookingPage(),
    // The one script a site adds for embeds and its own form, minified as /embed/v1.js.
    embedScript(),
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
    // An SVG over 2 kB ships as its own file. Inlined, ProviderMark's Apple Calendar and Google Calendar marks
    // rode in the shared Button chunk on every page, the booking page and the hosted form too (2.5 kB gzipped
    // each, 21 October 2026), though only calendar screens and the booking receipt draw them, as an image
    // fetched like Outlook's. The small marks that paint at once (Google's G, Timefix's) stay inline.
    assetsInlineLimit: (file, content) => (file.endsWith('.svg') && content.length > 2048 ? false : undefined),
    // The app, the hosted form page (spec 0023) and the public booking page (spec 0025), which share nothing with it.
    rollupOptions: {
      input: {
        index: path.join(import.meta.dirname, 'index.html'),
        form: path.join(import.meta.dirname, 'form.html'),
        book: path.join(import.meta.dirname, 'book.html'),
      },
    },
  },
});
