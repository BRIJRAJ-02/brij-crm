// The api's Vercel Function as one file (spec 0045). Loaded file by file, the function read about 1,300 modules
// on every cold start, each `.ts` import first failing and then resolving to its compiled `.js`, which held the
// first request after idle for 5 to 7 seconds in production (measured 29 Oct 2026). Bundled, the same graph loads
// in about 0.25 seconds on a laptop against 1.7 to 2.7 unbundled. Every dependency goes into the bundle, so pnpm's
// strict layout never matters at run time; Graphile Worker (a job run on a throwaway database), Better Auth (a
// session read) and Sentry's start were each run from a bundle before this landed.
import path from 'node:path';
import { rolldown, type Plugin as RolldownPlugin } from 'rolldown';
import type { Plugin } from 'vite';

/** The function's source entry, which the bundle starts from. */
export const API_ENTRY = path.join(import.meta.dirname, '..', 'api', 'src', 'vercel', 'entry.ts');

/** Where the build writes the bundle, beside the function that re-exports it (`api/index.mjs`). Never committed. */
export const API_BUNDLE = path.join(import.meta.dirname, 'api', 'api.generated.mjs');

/** The id the TypeScript stand in resolves to. */
const NO_TYPESCRIPT = '\0crm:no-typescript';

/**
 * TypeScript reaches the graph only through Graphile's config loader (cosmiconfig), for a `.ts` config file the
 * api never has. Left in, it is 7.7 MB of the bundle; left external, Vercel's file tracer would ship the package
 * beside the function. So it is a module that refuses, run only if that loader ever asks for it.
 */
function withoutTypescript(): RolldownPlugin {
  return {
    name: 'crm:no-typescript',
    resolveId: (id) => (id === 'typescript' ? NO_TYPESCRIPT : undefined),
    load: (id) =>
      id === NO_TYPESCRIPT ? 'throw new Error("TypeScript is not part of the api function bundle.");' : undefined,
  };
}

/** Bundles the api's function entry into `file`: ESM for Node, minified, Node's built ins and `pg-native` left out. */
export async function bundleApi(file: string = API_BUNDLE): Promise<void> {
  const bundle = await rolldown({
    input: API_ENTRY,
    platform: 'node',
    // `pg-native` is pg's optional native driver, required only when asked for, and never installed.
    external: [/^node:/, 'pg-native'],
    plugins: [withoutTypescript()],
    logLevel: 'warn',
  });
  try {
    await bundle.write({
      file,
      format: 'esm',
      codeSplitting: false,
      minify: true,
      banner: '// Written by the build (crm:api-bundle in vite.config.ts). Never edit it, and never commit it.',
    });
  } finally {
    await bundle.close();
  }
}

/** Writes the function's bundle once the web build is done, so `vercel build` finds it beside `api/index.mjs`. */
export function apiBundle(): Plugin {
  return {
    name: 'crm:api-bundle',
    apply: 'build',
    closeBundle: {
      sequential: true,
      order: 'post',
      handler: () => bundleApi(),
    },
  };
}
