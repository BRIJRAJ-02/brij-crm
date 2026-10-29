// The api as a Vercel Function in the web project (spec 0045). Every /api request reaches it while
// API_ORIGIN_INTERNAL is unset (middleware.ts, vercel.json). It runs on the server only and never
// enters the browser bundle; the whole of it lives in apps/api.
//
// The build bundles apps/api/src/vercel/entry.ts and everything it imports into one file beside this
// one (`api-bundle.ts`), so a cold start loads one module rather than about 1,300.
export { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from './api.generated.mjs';
