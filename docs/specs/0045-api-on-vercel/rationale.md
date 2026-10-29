# 0045. Rationale: why a Vercel Function, for now

## The ask

Railway's builds are paused and its tokens revoked (spec 0044), so production's api cannot change. Spec 0044 moves to Render, which needs a new account and a card. The owner wants production running now with no extra service and no card, on what we already pay nothing for: the Vercel project and Neon. Railway comes back when it is healthy, so the way back must be one variable and a redeploy.

## Options

| | Vercel Function in the web project | Render (spec 0044) | Wait for Railway |
|---|---|---|---|
| New account or card | none | yes | none |
| Live updates | off (no long running process for Centrifugo or the relay) | on | on |
| Background jobs | bounded turns after requests and hourly | the worker, always on | the worker |
| Effort | one function entry, a switch in the middleware, a job drain | a Blueprint | none, but production stays stale |
| Way back | unset to set: one variable, one redeploy | the same variable | |

## Why this one

It ships today on what exists, and nothing about the API's code changes: the function mounts the same Hono app `server.ts` serves, and the drain runs the same Graphile runners the worker runs, built from one shared module (`jobs/compose.ts`). The cost is live updates and job latency, both stated in the spec, and both come back the moment a long running host does.

## How the function is built

### Now: one bundled file (29 October 2026)

The build bundles the function with Rolldown into one file (spec, *How the function is built*). This reverses the first build, below. Shipped in `339ea0a9` and live on both productions from `2681fff0`.

**Why it changed.** Cold starts were the slow part of the app. Loaded file by file, a new instance read about 1,300 modules, and each `.ts` import first failed and then resolved to its compiled `.js` through the hook. That held the first request after idle for 5 to 7 seconds in production (7.2 seconds measured on brij-crm).

**Evidence.**

| | Before (file by file) | After (bundle) |
|---|---|---|
| Loading the api's module graph on a laptop | 1.7 to 2.7 seconds | about 0.25 seconds |
| brij-crm, first request after idle | 7.2 seconds | 2.3 to 2.6 seconds |
| Timefix, first request after idle | (not measured) | 0.6 to 0.8 seconds |

What is left on brij-crm is mostly Neon's free plan waking its compute and the pools opening, not loading code.

**Why the earlier objections no longer hold.**

- *pnpm's strict layout.* Rolldown resolves each import from the importing file, as Node does, so every workspace package finds its own dependencies at build time. At run time nothing is resolved from disk any more, so the layout no longer matters.
- *Dynamic loading in Graphile Worker, Better Auth and Sentry.* Each was run from a bundle before it landed: a Graphile job ran against a throwaway database, Better Auth read a session, and Sentry started. The one dynamic load that pulled in something large was TypeScript, through Graphile's config loader (cosmiconfig). The api has no `.ts` config file, so TypeScript is replaced by a stub that throws. Leaving it external was the other choice, but then Vercel's file tracer would ship the whole package beside the function.
- *Files read from disk at run time.* These were already static imports (as `calendar/free-domains.ts` imports its JSON), so the bundle carries them.

**What could break it, and the guard.** A dependency that loads a file by a computed path would fail only at run time. `apps/web/build.test.ts` checks that the bundle imports nothing but Node's built ins. It cannot catch a load that fails only at run time, so after a deploy that changes a dependency, [verify.md](verify.md) AC-1101 and AC-1109 (`/api/health` and the cold start) are the check. The Deploy web run reads `/api/health` only in proxy mode, not in function mode.

### Before: a resolve hook over Vercel's compiled files (22 to 29 October 2026, replaced)

Vercel's Node builder compiles each TypeScript file the function imports into JavaScript beside it, but keeps the `.ts` in every import, which Node follows as written on every other host. `apps/web/api/index.mjs` therefore registered a module resolve hook first: an import of a `.ts` file that isn't there resolved to the compiled `.js` one, for relative imports and for workspace packages whose `exports` name their `.ts` sources. The function entry imports `apps/api` across packages, which `turbo boundaries` allows only with the `@boundaries-ignore` note on that one import; it runs on the server and never enters the browser bundle (still true with the bundle).

At the time a bundle (esbuild or Rolldown) was turned down. The reasons were that it would need every dependency of every workspace package reachable from one place, which pnpm's strict layout doesn't give, and that Graphile Worker, Better Auth and Sentry each load parts of themselves dynamically. The section above says why neither held once it was tried.

## Why the schedule lives on GitHub

Vercel's Hobby plan runs cron jobs at most once a day. The repository is public, so scheduled Actions cost nothing; GitHub may start them late or skip one under load, which the delay trade off covers.
