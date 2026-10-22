# 0045. Rationale: why a Vercel Function, for now

## The ask

Railway's builds are paused and its tokens revoked (spec 0044), so production's api cannot change. Spec 0044 moves to Render, which needs a new account and a card. The owner wants production running now with no extra service and no card, on what we already pay nothing for: the Vercel project and Neon. Railway comes back when it is healthy, so the way back must be one variable and a redeploy.

## Options

| | Vercel Function in the web project | Render (spec 0044) | Wait for Railway |
|---|---|---|---|
| New account or card | none | yes | none |
| Live updates | off (no long running process for Centrifugo or the relay) | on | on |
| Background jobs | bounded turns after requests and every 10 minutes | the worker, always on | the worker |
| Effort | one function entry, a switch in the middleware, a job drain | a Blueprint | none, but production stays stale |
| Way back | unset to set: one variable, one redeploy | the same variable | |

## Why this one

It ships today on what exists, and nothing about the API's code changes: the function mounts the same Hono app `server.ts` serves, and the drain runs the same Graphile runners the worker runs, built from one shared module (`jobs/compose.ts`). The cost is live updates and job latency, both stated in the spec, and both come back the moment a long running host does.

## How the function is built

Vercel's Node builder compiles each TypeScript file the function imports into JavaScript beside it, but keeps the `.ts` in every import, which Node follows as written on every other host. `apps/web/api/index.mjs` therefore registers a module resolve hook first: an import of a `.ts` file that isn't there resolves to the compiled `.js` one, for relative imports and for workspace packages whose `exports` name their `.ts` sources. Proved locally by building with `vercel build` and loading the emulated output (its symlinks restored) under Node 24: the whole module graph loads and answers. The function entry imports `apps/api` across packages, which `turbo boundaries` allows only with the `@boundaries-ignore` note on that one import; it runs on the server and never enters the browser bundle.

A bundle (esbuild or Rolldown) was the other way. It would need every dependency of every workspace package reachable from one place, which pnpm's strict layout doesn't give, and Graphile Worker, Better Auth and Sentry each load parts of themselves dynamically.

## Why the schedule lives on GitHub

Vercel's Hobby plan runs cron jobs at most once a day. The repository is public, so scheduled Actions cost nothing; GitHub may start them late or skip one under load, which the delay trade off covers.
