// The api as a Vercel Function in the web project (spec 0045). Every /api request reaches it while
// API_ORIGIN_INTERNAL is unset (middleware.ts, vercel.json). It runs on the server only and never
// enters the browser bundle; the whole of it lives in apps/api.
//
// Vercel's Node builder compiles each TypeScript file the function imports into a .js file beside it
// but keeps the `.ts` in every import, as Node runs them on the other hosts. This hook sends an import
// of a `.ts` file that isn't there to the compiled `.js` one: a relative import, and a workspace
// package whose exports name its `.ts` sources. Anything else resolves as Node would.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const missing = error?.code === 'ERR_MODULE_NOT_FOUND' && typeof error.url === 'string' ? error.url : '';
      if (missing.startsWith('file:') && missing.endsWith('.ts')) {
        return nextResolve(missing.replace(/\.ts$/, '.js'), context);
      }
      throw error;
    }
  },
});

// @boundaries-ignore the Vercel Function entry runs on the server, not in the client bundle
const api = await import('../../api/src/vercel/entry.ts');

export const { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } = api;
