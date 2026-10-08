import { readFileSync } from 'node:fs';
import path from 'node:path';
import { layerOrder, uiVite } from '@crm/ui/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({
  // One `.env` at the repo root for local work.
  envDir: '../..',
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
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same origin locally too: the browser only ever talks to :5173.
    proxy: { '/api': { target: API_DEV_ORIGIN } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // dist/.vite/manifest.json: the first load budget reads the index route's static graph from it.
    manifest: true,
  },
});
