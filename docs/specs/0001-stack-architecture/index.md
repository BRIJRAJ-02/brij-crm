# 0001. Stack and architecture for the CRM

**Date**: 2026-10-01
**Status**: Accepted
**Amended**: 2026-10-01, the web app moved from Cloudflare to Vercel, Neon is provisioned through Vercel, and the product is named brij-crm (see [rationale.md](rationale.md#amendment-2026-10-01-web-hosting-on-vercel)).

## Summary

The CRM (product name brij-crm) is written in TypeScript throughout. It's a single page React app backed by a modular API service on Node, with Postgres as the only database. One client data layer (TanStack DB, behind our own wrapper) holds every record the screen shows. Centrifugo pushes live changes and presence, and Hocuspocus with Yjs handles shared notes later. Everything runs on managed but portable hosts: Neon for Postgres (provisioned through Vercel), Railway for the services, Vercel for the web app, and Cloudflare R2 for files. The web app and API share one address, so sign in stays simple and safe.

## Rationale

The reasoning, the context, and the four full stacks compared are in [rationale.md](rationale.md).

## Decision

**Chosen option**: Option 1, a TypeScript single page app with a modular API, server run queries, a TanStack DB client layer, and dedicated realtime and collaboration services on Postgres.

Build one modular API (a monolith split into clear internal modules, not microservices), plus Centrifugo for realtime. Jobs run as a second entrypoint of the API image. A collaboration service joins in Slice 7. Everything shares typed packages in one monorepo.

**Implementation skills**:
- House rules, which always apply:
  - `crm-design-system` (`.claude/skills/crm-design-system/`)
  - `crm-frontend-state` (`.claude/skills/crm-frontend-state/`)
  - `crm-data-model-access` (`.claude/skills/crm-data-model-access/`)
  - `crm-api-backend` (`.claude/skills/crm-api-backend/`)
- Design and review skills:
  - `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`)
  - `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`)
  - `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`)
  - `building-components` (`vercel/components.build`, `.claude/skills/building-components/`)
  - `modern-css-html` (`kemiljk/skills`, `.claude/skills/modern-css-html/`)
- Stack skills, all in `.claude/skills/`:
  - `vercel-react-best-practices` (`vercel-labs/agent-skills`)
  - `better-auth-best-practices` (`better-auth/skills`)
  - `neon-postgres` (`neondatabase/agent-skills`)
  - `drizzle` (`lobehub/lobehub`, community)
  - `zod` (`pproenca/dot-skills`, community)
  - `cloudflare` (`cloudflare/skills`), for R2 files from #32
  - `use-railway` (`railwayapp/railway-skills`)
  - `turborepo` (`vercel/turborepo`)
  - `resend` (`resend/resend-skills`)
  - `react-email` (`resend/react-email`)
  - `playwright-cli` (`microsoft/playwright-cli`)
  - `vitest` (`antfu/skills`)
  - `sentry-react-sdk`, `sentry-node-sdk` and `sentry-fix-issues` (`getsentry/sentry-for-ai`)

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) everywhere | One set of types from database to screen, shared Zod schemas, and one ecosystem for a solo builder. |
| Runtime | Node.js 24 LTS | The most compatible runtime for Postgres drivers, Graphile Worker and Hocuspocus. |
| Repo | pnpm workspaces + Turborepo monorepo | Apps and packages share types, and one change lands in one commit with cached builds. |
| App shape | Single page app behind login | No SEO need. It loads once, then every view is instant and live, which is the natural home for a client data layer. |
| Build + router | Vite + TanStack Router | Typed routes and typed search params, so view state (filters, sort, open record) lives safely in the URL. |
| UI components | The design system (CRM Workspace) ported into `packages/ui`, built on React Aria Components | The artifact is the visual source of truth. React Aria gives the widgets correct keyboard, focus and screen reader behaviour under our own look. |
| Icons | Lucide (`lucide-react`) through the Icon atom | The design system's only icon library; size and stroke come from tokens. |
| Styling | CSS Modules + CSS variables + cascade layers, with Stylelint enforcing tokens | Native CSS, scoped per component, zero runtime. The artifact's `ws-` styles port almost directly, and the build refuses raw values. |
| Tables | TanStack Table + TanStack Virtual | Headless column, selection and resize logic, plus virtualisation. Every cell renders through the one field design. Amended by [spec 0003](../0003-component-library/0003-data-grid.md): TanStack Virtual only, with column state of our own. |
| Forms | React Hook Form + the Zod resolver | Mature and fast, with the same Zod schemas the server validates with. |
| Dates | `@internationalized/date` + `Intl` | Already used by React Aria for calendar dates and time zones, so we don't need a second date library. |
| Client data layer | TanStack DB behind our own `packages/data` interface | One normalised copy per record, live queries, and optimistic transactions, fed by server queries and patched by change events. It's young and built for in memory collections, so it must pass a windowed query prototype first (see Follow-up). |
| API | Hono (on `@hono/node-server`) + oRPC + Zod 4 | One set of typed procedures for the app, which also generates the OpenAPI spec and REST routes for the public API (#34). |
| Database | Postgres 18 (on Neon, the version Vercel's Neon provisions; local Docker matches it) | Relations, typed JSON, row level security, full text and trigram search, and LISTEN/NOTIFY in one proven engine. |
| Database access | Drizzle ORM with the `pg` driver, and SQL migrations from drizzle-kit | SQL first and typed, with SQL templates for dynamic attribute queries. Row level security and roles live in hand written SQL migrations. |
| Tenancy | `workspace_id` on every row, forced Postgres row level security, and the access door in the app | The database refuses other workspaces' rows even if a query forgets to filter. The app does the fine grained checks. |
| Auth | Better Auth (self hosted, on our Postgres), with its organization plugin as the workspace | Email with verification, Google, sessions, two factor, passkeys, organisations and API keys as plugins, with no per user fees. |
| Realtime + presence | Centrifugo, one node on its memory engine, fed by our outbox relay | Channels, presence, and history with recovery on reconnect, proven at very large scale. One node easily serves 1,000 connections. History is lost on restart, and the client then refetches. |
| Shared notes (Slice 7) | Yjs + Hocuspocus + Tiptap | The standard way to merge edits without conflicts (a CRDT), on a self hosted server with an auth hook and Postgres storage. It isn't built in the scaffold. |
| Background jobs | Graphile Worker on Postgres, as a second entrypoint of the API image | Jobs are queued in the same transaction as the write, picked up in under 100ms, with cron built in. No separate service to build at first. |
| Search (launch) | Postgres full text + `pg_trgm` | No extra service, and access filters apply in the same query. Revisit in #33 if the load harness says so. |
| Cache + rate limits | Postgres only to start | One fewer service. Add Redis only when the load harness shows a need. |
| File storage | Cloudflare R2 (S3 API), browser uploads through signed URLs | No download fees, and the S3 API keeps it portable. |
| Email sending | Resend + React Email (Mailpit locally) | A simple API behind a mailer interface. Templates are React components that use our tokens. |
| Errors + performance | Sentry (web, API, worker) | Errors come with the request and user, tracing crosses services, and custom metrics chart realtime delay and job backlog. |
| Product analytics + flags | PostHog | Events for signups and activation, plus feature flags for staged rollouts, in one tool. |
| Tests | Vitest + Playwright | Fast unit and integration tests, plus end to end tests with two browsers open to prove live updates. |
| Code + CI | GitHub (`BRIJRAJ-02/brij-crm`, private) + GitHub Actions (CI that fails blocks the merge) | Runs typecheck, lint, tests and the house rule checks, creates preview databases, and triggers deploys. |
| Database host | Neon, provisioned through the Vercel Marketplace on your Vercel account (production compute never scales to zero) | Plain Postgres with instant branches, so each preview gets its own database. Scale to zero would drop LISTEN and the relay. |
| Service host | Railway (Docker images) | Multi service deploys from the monorepo, private networking and preview environments, with the least upkeep. |
| Web host | Vercel: the static build on Vercel's CDN, with Routing Middleware (`apps/web/middleware.ts`) proxying `/api/*` to Railway | Your own Vercel account, global and fast, with a deployment per pull request. The middleware keeps the app and API on one origin, reads the API address per environment, and can add headers before a request leaves (which Edge only API access, #57, needs). |

## Architecture

**Deployables** (Docker images built per app with `turbo prune`, on a Node 24 base, each with a health endpoint and graceful shutdown on SIGTERM):

| App | What it is | Runs on | When |
|---|---|---|---|
| `apps/web` | The Vite single page app, plus the Routing Middleware that proxies `/api/*` | Vercel | Scaffold |
| `apps/api` | The Hono + oRPC API: every read and write, auth, the public API, and realtime (later collab) token issuing. The same image has a `worker` entrypoint that runs Graphile Worker and the outbox relay. | Railway (two services from one image: `api`, `worker`) | Scaffold |
| `infra/centrifugo` | The Centrifugo config and image (memory engine, one node) | Railway | Scaffold |
| `apps/collab` | The Hocuspocus server for shared notes | Railway | Slice 7 |

**Packages:**

| Package | Holds |
|---|---|
| `packages/tokens` | CSS variables generated from the design system's `tokens.json` (light, dark, density) |
| `packages/ui` | The design system's React components (atoms, molecules, modules), CSS Modules, and React Aria wiring |
| `packages/data` | The one client data layer: a thin interface shaped by what screens need, implemented on TanStack DB, with change event patching and undo |
| `packages/contracts` | The oRPC contract and Zod schemas, shared by web, api and worker |
| `packages/core` | Domain services and the access door, shared by api and worker (no HTTP in here) |
| `packages/db` | The Drizzle schema, SQL migrations, row level security policies and roles, the `withWorkspace()` helper, and seeds |
| `packages/emails` | React Email templates |
| `packages/config` | Shared tsconfig, lint, Stylelint and test config |

**How a write flows:**
1. The screen calls `packages/data`.
2. The layer applies the edit optimistically, tags it with a client mutation id, and calls an oRPC procedure.
3. `apps/api` validates the input with the contract schema and authorises it through the access door in `packages/core`.
4. Inside `withWorkspace()` it writes, in one Postgres transaction:
   - the change;
   - the value history;
   - the audit entry;
   - an outbox row carrying ids only, a per workspace sequence number, and the client mutation id.
5. The relay in the `worker` process sends new outbox rows to Centrifugo's HTTP API, in commit order. It wakes on LISTEN over the direct connection, and falls back to a one second poll.
6. Centrifugo publishes to the subscribed channels. Other screens' data layers fetch the changed records through the API (access applied) and patch them in place. The writer's own screen recognises its own mutation id and skips the echo.

The outbox event shape, channel names, access filtering of events, and handling of sequence gaps are settled in the realtime spec (#7). Echo matching and rollback are settled in the client data spec (#6).

**Rules for Postgres connections and row level security:**
- **One helper.** Every request's queries run through one helper, `withWorkspace(workspaceId, fn)`. It opens a transaction, runs `select set_config('app.workspace_id', $1, true)` first, then the work. No other query path exists, and lint bans using the raw pool.
- **The app role can't bypass it.** The app connects as a role that isn't the table owner and can't bypass row level security. Every table uses `FORCE ROW LEVEL SECURITY`. Migrations and the worker's maintenance tasks use a separate owner role.
- **Policies fail closed.** Each policy is a plain comparison, `workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid`, so an unset workspace matches nothing. Every index on a tenant table leads with `workspace_id`.
- **Pooled connection.** API request queries use Neon's pooled connection (PgBouncer in transaction mode), with no named prepared statements.
- **Direct connection.** LISTEN, the relay, Graphile Worker, migrations and (later) Hocuspocus use the direct connection, each with a small pool (2 to 5). The pooled connection accepts LISTEN and never delivers, so the startup check refuses a LISTEN on a pooled URL.
- **Tests guard it.** One test asserts every tenant table has row level security forced and a policy. An integration test tries a cross workspace read and must get nothing.
- **Better Auth's tables sit outside row level security,** because they're global identity. Membership is always checked explicitly. Each request resolves its workspace from the URL (`/w/:slug`), checked against membership, and never from the session alone.

**Sign in, cookies and origins:**
- **One origin.** The web app and the API share one origin in every environment. Vercel serves the static app, and its Routing Middleware proxies `/api/*` to the Railway API over HTTPS.
- **Cookies.** Session cookies are host only, `SameSite=Lax`, `Secure` and `HttpOnly`. There's no CORS for the app, and the API checks the `Origin` header on writes.
- **Realtime and collab tokens.** Centrifugo and (later) Hocuspocus are the only other origins, and they use short lived tokens the API issues after an access check, with no cookies. The Centrifugo connection token lasts 5 to 10 minutes and refreshes through the client's `getToken`. Subscription tokens are issued per channel.
- **Per environment.** Better Auth's `BETTER_AUTH_URL` and `trustedOrigins` are set per environment.
- **Google sign in in previews.** Google needs a fixed callback address, so previews offer email sign in only (or one stable preview auth domain, if that's added later).

**Web hosting details:**
- **Deep links.** Vercel checks real files first, then `vercel.json` rewrites everything else except `/api` (`/((?!api(?:/|$)).*)`) to `index.html`, so deep links load the app.
- **Caching.** Hashed assets under `/assets/` are cached as immutable, and `index.html` keeps Vercel's default `max-age=0, must-revalidate` (headers in `vercel.json`).
- **Security headers.** A Content Security Policy, set in `vercel.json` on every path except `/api`, allows only our origin today. Realtime (#7) adds the Centrifugo origin, and Monitoring (#11) adds Sentry and PostHog.
- **The proxy.** `apps/web/middleware.ts` (Edge runtime, `rewrite()` and `ipAddress()` from `@vercel/functions`) matches `/api` and `/api/:path*` and runs before files and rewrites. It rewrites to `API_ORIGIN_INTERNAL` and replaces, never appends, `x-forwarded-for` (with the client IP Vercel saw), `x-forwarded-host` and `x-forwarded-proto`. It does nothing else: no auth, no database. The API trusts none of those headers until Edge only API access (#57) adds a credential only the middleware sends. Rewrites pass bodies, redirects and `Set-Cookie` through unchanged; a proxied request has about 120 seconds to answer, so long work stays in jobs.

**Vercel setup:**
- **The project.** `brij-crm` on your personal Vercel account. Root directory `apps/web`, framework Vite, output `dist`, Node 24, files outside the root directory included (the pnpm workspace installs from the repo root).
- **Git integration off.** The repo is never connected in the dashboard, and `vercel.json` sets `git.deploymentEnabled` to `false`. Every deploy comes from an Action: `vercel pull`, then `vercel build` with the environment's variables in the step env, then `vercel deploy --prebuilt`.
- **Variables.** `API_ORIGIN_INTERNAL` is set at build (step env) and at deploy (`--env`), so the middleware sees it either way. Production's values (`API_ORIGIN_INTERNAL` and the `VITE_*` URLs) live in the Vercel project's Production variables. A preview's come from the workflow, which reads them from that pull request's Railway environment.
- **Preview address.** Each preview gets a fixed alias, `brij-crm-pr-<n>.vercel.app`, known before it deploys, so the workflow can set the Railway `APP_URL` first. The workflow posts the address as one comment on the pull request, and removes the alias when the pull request closes.
- **Protection.** Previews stay behind Vercel's login (the default). When end to end tests run against previews, CI uses Vercel's protection bypass secret. Production is public.
- **Neon integration.** The Neon resource isn't connected to the web project's variables, and its own preview branching stays off. The web app needs no database variables, and preview branches come only from the workflow.
- **Rollback.** `vercel rollback` (or promoting an earlier deployment) undoes a bad production web deploy.
- **Build time URLs.** Public URLs are baked in at build time through `VITE_*` variables, so each preview is built with its own Centrifugo URL.

**Migrations:**
- **Committed SQL.** drizzle-kit generates SQL files that are committed to the repo. Row level security, roles and policies are hand written SQL migrations.
- **Run before deploy.** Railway runs migrations as a pre deploy step of the `api` service on the direct connection, before the new version starts.
- **Expand, then contract.** Schema changes are additive first, and a destructive step ships only after no running code needs the old shape.
- **Seeds are separate.** Seeds are kept apart from migrations and never run in production.

**Environments:**
- **Local:**
  - Docker Compose runs Postgres 18 (with the same roles, `pg_trgm` and row level security), PgBouncer in transaction mode, Centrifugo, Mailpit for email, and MinIO for S3 compatible files.
  - Locally, `DATABASE_URL` points at PgBouncer and `DATABASE_URL_DIRECT` at Postgres, so the pooled versus direct mistake shows up locally.
  - One `pnpm dev` starts everything on a fixed port map, and `.env.example` lists every variable.
- **Preview per pull request:**
  - A GitHub Action creates a Neon branch from a seeded parent (never from production data), and deletes it when the pull request closes.
  - Railway creates the preview environment for `api`, `worker` and `centrifugo`, and the Action overwrites the database variables.
  - The Action deploys a Vercel preview with that environment's API address (at runtime) and public URLs (at build time). Vercel's own Git deploys stay off, so a preview never points at the wrong API.
  - Secrets are generated per environment, never shared with production.
- **Production:** a push to `main` deploys the Vercel production build through an Action, and Railway deploys the services from `main`. Neon production compute is pinned to never scale to zero, which needs a paid Neon plan (see Follow-up).
- **Regions:** Neon and Railway sit in the same region, so every query stays close: Singapore (AWS `ap-southeast-1` on Neon, `asia-southeast1` on Railway), the closest to you.

**Design system to code:** the artifact (https://claude.ai/artifact/XYoLqU7b2SFfga9FWwqaPh?sk=NUiJdAv_8B9f6a2uJRrpBg, always this link) stays the source of truth, and it keeps updating as needed.
- `packages/tokens` is generated from its `tokens.json` by a script, so no token is ever hand copied.
- `packages/ui` ports each component by hand into typed React with CSS Modules. It keeps the `ws-` class prefix through the CSS Modules naming pattern (`ws-[name]-[local]`), so styles stay scoped and readable in dev tools.
- A new component or variant goes into the artifact and `packages/ui` in the same change, per the house rules.
- Amended by [spec 0003](../0003-component-library/0003-artifact-publishing.md): components are now written once in `packages/ui` and published to the artifact from code. Tokens still flow from the artifact into code.
- Because the artifact changes over time, every UI task starts by reading the live artifact (its `project/tokens.json` and component list) with the Artifact tool, and syncs any drift into `packages/tokens` and `packages/ui` first. The token script regenerates `packages/tokens` from a downloaded `tokens.json`. CI can't reach a private artifact, so this sync is part of the agent's UI workflow, not a CI step.

**Deploys and reconnects:** every Railway deploy drops open WebSockets. Centrifugo clients reconnect with jittered backoff (the default, kept on), and the data layer refetches open views if recovery fails. That makes a deploy a short blip, not a storm.

## Configuration required

Secrets live in Railway variables per environment (and in Vercel environment variables for the middleware). GitHub Actions secrets hold only CI credentials. Every app validates its variables with a Zod schema at startup and refuses to boot if one is missing.

- `APP_ENV` (`local` | `preview` | `production`), `NODE_ENV` and `PORT`: runtime basics.
- `APP_URL`: the one public origin for the app and API. `REALTIME_URL` is the public Centrifugo URL, and `COLLAB_URL` comes later.
- `API_ORIGIN_INTERNAL`: the Railway API address the Vercel middleware proxies to.
- `DATABASE_URL`: Neon pooled connection (PgBouncer locally), for API request queries.
- `DATABASE_URL_DIRECT`: Neon direct connection, for LISTEN, the relay, jobs and migrations.
- `DATABASE_URL_OWNER`: the owner role, for migrations only.
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `TRUSTED_ORIGINS`: auth signing, base URL and allowed origins.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google sign in (production and local).
- `CENTRIFUGO_API_URL`: the internal address the relay publishes to, over Railway private networking.
- `CENTRIFUGO_API_KEY`, `CENTRIFUGO_TOKEN_SECRET`, `CENTRIFUGO_ADMIN_PASSWORD` and `CENTRIFUGO_ALLOWED_ORIGINS`: the Centrifugo server settings.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET`: file storage (MinIO locally).
- `RESEND_API_KEY` and `MAIL_FROM`: email sending. The sending domain needs SPF and DKIM set up (Mailpit locally).
- `SENTRY_DSN_WEB`, `SENTRY_DSN_SERVER`, `SENTRY_AUTH_TOKEN` and `SENTRY_RELEASE`: error tracking, source maps and release names.
- `POSTHOG_KEY` and `POSTHOG_HOST`: product analytics and flags.
- CI only: `NEON_API_KEY`, `NEON_PROJECT_ID`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` and `RAILWAY_TOKEN` (plus `VERCEL_AUTOMATION_BYPASS_SECRET` once end to end tests run on previews).

## Consequences

**Positive:**
- One language and one set of types across screens, API, jobs and realtime tokens, so a renamed field breaks the build rather than production.
- The client data layer, realtime and collaboration each use a tool built for exactly that job, so the house rule "state management is the backbone" has real support.
- Postgres is the only stateful service to back up and restore. Jobs, the outbox, notes and search all live in it.
- One origin for the app and API removes most cookie, CORS and preview domain problems.
- Every piece is open source or has a standard API (Postgres, S3, Docker), so moving to your own cloud later is a redeploy, not a rewrite.

**Negative / tradeoffs:**
- Centrifugo runs as a single node on the memory engine. There's no high availability, and history is lost when it restarts, so a reconnect then falls back to a refetch. Moving to Redis (or a compatible broker) for more than one node is a config change when the load harness asks for it.
- TanStack DB is young and built for collections held fully in memory. Windowed queries over a million rows are the case it's least proven on, so it must pass a prototype, and the `packages/data` wrapper is real code we own.
- oRPC is younger than tRPC or plain REST. Its OpenAPI output must be proven in the core loop (#10), not later.
- Row level security under a transaction pooler works only through `withWorkspace()`. A query outside it returns nothing (the policies fail closed), which is safe but can look like a bug.
- CSS Modules give less type safety than a typed styling system. Stylelint rules and typed variant props on components make up for it, but they must be kept strict.
- Postgres carries everything (data, jobs, events, search, and later notes), so it's the scaling point, and the direct connection count is small on small Neon computes. The load harness (#12) must watch CPU, connections and lag from the first slice.
- Preview environments multiply services per pull request, which costs money. Keep previews to web, api, worker and one small Centrifugo.
- Vercel's Hobby plan is for personal, non commercial use, and caps deployments at 100 a day. Move the project to Pro before the first paying workspace.
- Every `/api` request passes through the Routing Middleware, which counts toward Vercel's edge request and middleware usage. At 100 people online that's well inside what's included; the load harness (#12) should watch it.
- Neon's billing and plan now live in Vercel. On the Free plan, scale to zero can't be turned off, so until production moves to a paid plan the worker's direct connection drops when the compute sleeps. The worker then exits, Railway restarts it, and the relay catches up from the outbox, so events arrive late but none are lost.

**Neutral:**
- The design system lives in two places (the artifact, and `packages/ui`). The token generation script and the house rules keep them in step.
- Lint and format tooling, commit hooks and CI details are chosen in Coding standards & tooling (#2) through `/audit`, not here.
- The main risk isn't the stack itself. It's the dynamic attribute query engine at a million records, which the data model spec (#5) and the load harness (#12) must settle before more than one slice is built on it.

## Follow-up

- [x] Choose the product name: brij-crm (2026-10-01).
- [ ] Choose the domain. Until then production runs on `brij-crm-phi.vercel.app` (`brij-crm.vercel.app` was already taken), which works for host only cookies; email sending and Google sign in need the real domain.
- [ ] Move Neon production to a paid plan with scale to zero off, before the realtime relay (#7) ships.
- [ ] Confirm the Vercel managed Neon organization lets you create an API key for the preview workflow (`NEON_API_KEY`). If it doesn't, previews take their database branch from the Vercel integration instead, and `preview.yml` changes to match.
- [ ] Prototype TanStack DB on a windowed, server filtered query over a million rows (live patches plus loading on scroll), as the first step of Client data and state (#6). If it struggles, the `packages/data` interface switches to a plain normalised store on TanStack Query, and the screens don't change.
- [ ] Confirm current releases at scaffold time, and pin them: TanStack DB, oRPC, Centrifugo, Better Auth.
- [ ] Prove oRPC's OpenAPI output with one procedure during the core loop (#10).
- [ ] Settle these in the specs where they belong, before Slice 1:
  - [ ] Data model (#5): custom attribute value storage and indexing at a million records, cursor pagination and window size, and value history. Use `docs/research/crm-attributes.md`.
  - [ ] Client data and state (#6): the `packages/data` interface, optimistic writes, echo matching by mutation id, and ordering between responses and events.
  - [ ] Change events and realtime (#7): the outbox event shape, channel names (for example one per workspace and object), subscription token checks, sequence gap handling, and relay ordering.
  - [ ] Shared notes (#27): Yjs document names, update storage and compaction.
  - [ ] Design tokens (#3), Component library (#4), Background jobs (#8) and Access model (#9).
- [ ] `/audit` should capture this stack, the house rule skills and the reviewer agents into root `AGENTS.md`, with nested `AGENTS.md` files for `apps/api`, `apps/web`, `packages/ui`, `packages/data` and `packages/db`.
- [ ] Record the stack skills above in the `## Agent skills` section of `AGENTS.md` (via `/audit`). The Hono skill (`yusukebe/hono-skill`) currently has no valid `SKILL.md`, so retry it later. The Sentry CLI skill's repo (`sentry/dev`) wasn't reachable, so the official `getsentry/sentry-for-ai` skills were used instead. There's no skill for oRPC, TanStack DB, Graphile Worker or Hocuspocus. The third party Centrifugo skill was skipped as low trust.
- [x] Neon, Sentry and Playwright MCP servers added at project scope (`crm/.mcp.json`, 2026-10-01). Approve them on the next `claude` start in `crm`, and sign in to Neon and Sentry through `/mcp`.
- [ ] Add the GitHub MCP server once the repo exists: `claude mcp add -s project --transport http github https://api.githubcopilot.com/mcp/`, with your GitHub token as an `Authorization` header. Check GitHub's MCP docs for the current auth step.
- [ ] Record the MCP servers on the `MCP servers:` line of `AGENTS.md` (via `/audit`).
