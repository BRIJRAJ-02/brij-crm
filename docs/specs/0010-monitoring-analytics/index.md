# 0010. Monitoring and product analytics

**Date**: 2026-10-03
**Status**: Proposed

## Summary

This spec makes problems visible before a user reports them. Sentry (an error and performance service) catches every unexpected error in the browser, the API and the worker, with the request it belongs to, and charts request time, live update delay and the backlog of unsent changes. PostHog (a product analytics service) counts sign ups, workspaces created and first records created, sent only from the server. Nothing personal leaves the app: no emails, names, values or bodies. It is built in four visible steps: errors, request time, product counts, then live delay and backlog.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As the owner, I want every unexpected error in production in one place, with the request, release and screen it came from, so I can fix it before anyone writes to me.
- As the owner, I want request time, live update delay and the backlog charted, so I can see the app slowing down before it breaks.
- As the owner, I want to be emailed when the app is down, the worker stops, or live updates stall, so I don't have to watch charts.
- As the owner, I want sign ups, workspaces created and first records created counted, so I can see whether people get going.
- As a user, I want my emails, names and records kept out of third party tools, so using the CRM never leaks them.

**Acceptance criteria** (numbered after spec 0005's and the specs written beside this one, so every ID in the plan stays unique):

*Errors (milestone 1)*
- **AC-162**: An unexpected error on the server (any failure the API answers as `INTERNAL`, an `onError` in `app.ts`, or a fault in the worker) appears in the Sentry project `brij-crm-server` within 60 seconds. The event carries the request id (the same value as the answer's `x-request-id`), the procedure or route, the service (`api` or `worker`), the environment, the release (the commit), and the user id and workspace id when the request had them. Expected refusals (every code except `INTERNAL`) are never sent.
- **AC-163**: An unexpected error in the browser (an uncaught error, an unhandled promise rejection, a render that crashed, or a data layer fault the server never saw: an answer without one of our codes, or an error thrown inside the layer) appears in the Sentry project `brij-crm-web` within 60 seconds, with a readable stack (original file and line), the release, the environment, the route pattern (such as `/w/$slug/objects/$object`, never the filled path or the query), and the request id of the failed call when there was one. Being offline and API refusals are not sent.
- **AC-164**: Source maps are never served to browsers. Builds make hidden maps, upload them to Sentry when `SENTRY_AUTH_TOKEN` is set, and delete them before deploy. A build test fails if `dist` holds a `.map` file or a `sourceMappingURL` comment.
- **AC-165**: No personal data reaches Sentry or PostHog: no emails, names, sign in codes, attribute values, request or response bodies, cookies, auth headers, query strings or IP addresses. One `scrub` runs in every send hook of both Sentry SDKs; request bodies and local variables are never captured; `sendDefaultPii` is off. A test feeds an error carrying an email, a cookie, a body, a query string and a Postgres `detail` through each send hook and finds none of them in what would be sent.
- **AC-166**: Monitoring never breaks or slows the app. With no DSN or key set (local, tests) nothing is sent and nothing fails. When Sentry or PostHog is slow or down, answers are unchanged and take no longer (sending is queued in memory). On shutdown, both flush for at most 2 seconds inside the existing shutdown window.
- **AC-167**: The Content Security Policy's `connect-src` adds the one Sentry EU ingest host and nothing else for monitoring. The browser never contacts PostHog.
- **AC-168**: `system.testFault` exists to prove AC-162 in production. With `MONITORING_TEST_FAULT` unset it answers `NOT_FOUND`, like a procedure that doesn't exist. Set to `on`, it needs a session and fails with an unexpected error, answered as `INTERNAL` and reported per AC-162.
- **AC-169**: The first load stays under the 250 kB budget. The browser SDK loads in its own chunk, started at boot and never awaited. Errors that happen before it is ready (up to 20) are kept and sent once it starts.

*Request time (milestone 2)*
- **AC-170**: Every `/api/rpc` request is a trace named after its procedure (`rpc records.query`), and every sign in route after its route (`auth /sign-in/email-otp`), with database queries as child spans. Traces are sampled at 0 for health checks, 0.2 in production and 1.0 in previews. Request time p50 and p95 per procedure is charted in Sentry, and a screenshot goes in `verify.md`.
- **AC-171**: A Sentry uptime monitor calls `https://brij-crm-phi.vercel.app/api/health` every 5 minutes, through Vercel and the edge guard. Two failures in a row email the owner.
- **AC-172**: A new or regressed issue in production, in either project, emails the owner.

*Product counts (milestone 3)*
- **AC-173**: Product events are a closed catalog: one Zod schema per event in `packages/contracts`. The PostHog wrapper accepts only catalog events; their properties are parsed before sending, so a property outside the catalog fails the type check and the parse. Every event carries `environment`.
- **AC-174**: `user_signed_up` (`method`: `email_code` or `google`) is sent once per new user, after the account is written, with the user id as the distinct id. Signing in again sends nothing.
- **AC-175**: `workspace_created` (`workspace_id`) is sent once per workspace, after its transaction commits. A replayed create and a refused create send nothing.
- **AC-176**: `first_record_created` (`workspace_id`, `object_kind`: `people`, `companies`, `deals` or `custom`) is sent once per workspace, when the first record created by a member commits. Later records, refused creates and records the system makes (workspace setup) send nothing.
- **AC-177**: Each milestone is stored once in `workspace_milestones` (the source of truth, forced row level security, the standard policy, guard tests pass) in the same transaction as the write that reached it. Its PostHog event uses a fixed id derived from the workspace and milestone, so a resend is deduplicated.
- **AC-178**: PostHog (EU) has an "Activation" dashboard with daily counts of the three events, filtered to `environment = production`. Production sends events; previews send none unless a key is set on them; local sends none unless a key is set.

*Live delay and backlog (milestone 4)*
- **AC-179**: For every outbox row the relay publishes, the delay from the row's `created_at` to its `published_at` (both from the database clock) is recorded as the distribution `relay.lag` in milliseconds, and charted at p50 and p95 per minute.
- **AC-180**: Once a minute the worker records two gauges, `outbox.pending` (unpublished rows) and `outbox.oldest_age_s` (seconds since the oldest unpublished row was written), read through one definer function that returns those two numbers only. Both are charted.
- **AC-181**: In production, after each successful backlog read, the worker checks in to the Sentry cron monitor `worker-heartbeat`. No check in for 3 minutes (the worker is down or the database can't be read) emails the owner.
- **AC-182**: When `outbox.oldest_age_s` is over 30 at two samples in a row, the worker raises a warning issue `RELAY_LAGGING` (one fixed fingerprint, with the pending count and the age), which emails the owner per AC-172. No metric carries a workspace, record or user id.

*Done*
- **AC-183**: `verify.md` records, in production: an error from `system.testFault` found in Sentry by its request id in under 60 seconds; the request time chart; the live delay and backlog charts; the three counts on the Activation dashboard; the uptime and heartbeat monitors green.
- **AC-184**: A reviewer reading the code finds each vendor imported in exactly one wrapper module (`@sentry/node`, `@sentry/react`, `@sentry/vite-plugin`, `posthog-node`), and `security-access-reviewer` has passed milestones 1 and 4.

## Decision

**Chosen option**: Option 1: Sentry for errors, request time and custom metrics in all three services; PostHog for a closed catalog of product events, sent from the server only.

Sentry runs on the free plan in its EU region with two projects (`brij-crm-web`, `brij-crm-server`, the server one tagged by service); PostHog Cloud runs on the free plan in its EU region; both accounts are the owner's own, never the work org. Every vendor sits behind one wrapper, one `scrub` keeps personal data out, and milestone events come from a `workspace_milestones` table written in the same transaction as the change.

Calls made here and recorded for the owner to confirm (the brief left them open or this spec departs from it):
- **The uptime monitor calls `/api/health`, not `/api/health/ready`.** The brief named the ready check. A probe that touches the database every few minutes keeps Neon's free compute awake. The worker heartbeat (AC-181) already proves the database is readable, since it checks in only after a successful read.
- **No browser performance tracing in this feature.** It keeps the browser SDK small and off the first load (AC-169). Request time is measured on the server, where it is spent. Web Vitals are a follow up.
- **Analytics are sent wherever `POSTHOG_KEY` is set, and every event carries `environment`.** Production has the key; previews and local don't by default. A key set locally lets the build prove the events, and the dashboard filters to production.
- **A switchable test fault** (`MONITORING_TEST_FAULT`) proves the production error path on demand, then is switched off.
- **The worker raises its own `RELAY_LAGGING` issue** instead of a Sentry metric alert, because issue alerts work on the free plan and metric alerts may not.

**Implementation skills**: `sentry-node-sdk` (`getsentry/sentry-for-ai`, `.claude/skills/sentry-node-sdk/`) · `sentry-react-sdk` (`getsentry/sentry-for-ai`, `.claude/skills/sentry-react-sdk/`) · `sentry-fix-issues` (`getsentry/sentry-for-ai`, `.claude/skills/sentry-fix-issues/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `vite` (`.claude/skills/vite/`) · `use-railway` (`railwayapp/railway-skills`, `.claude/skills/use-railway/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Depends on**:
- **#10 (spec 0005)**: milestone 1 here needs only what is live today (the API, the web app, sign in). `first_record_created` needs `records.create` (0005 milestone 2) and the write composer (0005 milestone 3). Milestone 4 needs the outbox and relay (0005 milestone 3) and waits for them.
- **#6 (client data)**: the data layer gains one injected `report` option. Nothing else in the layer changes.
- **#7 (realtime)**: uses 0005's thin relay as it is; the relay gains one metric call per published row.
- **#8 (background jobs)**: not built yet. This spec builds the thin slice monitoring needs: a backlog sampler in the worker that runs a list of probes once a minute, with one probe (the outbox). #8 adds a `jobs` probe (Graphile Worker's queued and oldest job) to the same list; its spec owns that.
- **#9 (access model)**: none beyond 0005's door. `system.testFault` is a session procedure on the bootstrap list.
- **#12 (scale budget)**: owns the targets. This spec charts; it judges nothing against a budget.
- **#39 (operator console)**: will read recent errors per workspace through the `workspace_id` tag set here.

**Data model sketch** (one migration, in milestone 3; the function in milestone 4):

| Object | Schema | Key | Columns and rules |
|---|---|---|---|
| `workspace_milestones` | `public` | (`workspace_id`, `milestone`) | `workspace_id` uuid not null → `workspaces` (on delete cascade); `milestone` text not null, check in (`workspace_created`, `first_record_created`); `reached_at` timestamptz not null default `now()`. Forced row level security, the standard workspace policy. `crm_app` gets `select` and `insert` only. Written with `insert … on conflict do nothing returning milestone`, so a row comes back only the first time. |
| `crm_outbox_backlog()` | `public` | function | Security definer, owned by 0005's `crm_relay`, execute granted to `crm_app`. Returns one row: `pending` bigint (unpublished outbox rows), `oldest_created_at` timestamptz null. Aggregates only, never ids or contents. Same hardening as `crm_outbox_workspaces`: `begin atomic`, `stable`, `search_path = pg_catalog, pg_temp`, qualified names. Reads the relay's partial index (`published_at is null`). The guard tests list it beside the other definer functions. |

No change to `outbox`: `created_at` and `published_at` already exist (spec 0005).

**State transitions**: a milestone is unreached (no row), then reached (one row, never changed or removed except with its workspace).

**API surface** (one new procedure; everything else is internal):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `system.testFault` | none | never answers successfully | session, and `MONITORING_TEST_FAULT=on` | 404 `NOT_FOUND` when the flag is off; 500 `INTERNAL` when on (on purpose); 401 without a session |
| `/api/health` (exists) | none | `{ status: 'ok' }` | public (edge open path) | none; the uptime monitor's target |

**Module surface** (the wrappers; each the only importer of its vendor, each with a lint exception for itself only):

| Module | Exports | Rules |
|---|---|---|
| `apps/api/src/monitoring/instrument.ts` | none (side effect) | Loaded with `node --import` before anything else in the api and worker. Parses its own small env schema (`SENTRY_DSN_SERVER`, `APP_ENV`, `RAILWAY_GIT_COMMIT_SHA`, `SERVICE`) and starts Sentry only when the DSN is set. |
| `apps/api/src/monitoring/sentry.ts` (`@sentry/node`) | `startSentry(config)`, `captureFault(error, context)`, `nameRequest(name)`, `setRequestScope({ requestId, userId?, workspaceId? })`, `metrics.distribution/gauge`, `heartbeat()`, `raiseIssue(code, data)`, `flush(ms)` | `sendDefaultPii: false`, `includeLocalVariables: false`, `httpIntegration({ maxIncomingRequestBodySize: 'none' })`, `enableLogs: false`, `beforeSend`, `beforeSendTransaction`, `beforeBreadcrumb` all run `scrub`. Every function is a no op when Sentry isn't started. |
| `apps/api/src/monitoring/posthog.ts` (`posthog-node`) | `createAnalytics({ key?, host, environment, log })` → `{ capture(event), shutdown(ms) }` | `capture` takes a catalog event only, parses it, adds `environment` and `$process_person_profile: false`, sets `disableGeoip: true`, and never throws or awaits the network. Without a key it returns a no op. |
| `apps/web/src/monitoring/sentry.ts` (`@sentry/react`) | `startSentry(config, buffered)`, `reportFault(fault)` | Errors only (no tracing, no replay). `sendDefaultPii: false`; `beforeSend` and `beforeBreadcrumb` run `scrub`; `ui.input` breadcrumbs dropped; `fetch` breadcrumbs keep the path only. Passed to React 19's `createRoot` error options. |
| `apps/web/src/monitoring/buffer.ts` | `createFaultBuffer({ max: 20 })` | No vendor import. Collects `error` and `unhandledrejection` until `startSentry` drains it. |
| `apps/web/vite.config.ts` (`@sentry/vite-plugin`) | build plugin | `sourcemap: 'hidden'`; the plugin uploads and runs only with `SENTRY_AUTH_TOKEN`; maps are deleted after upload, and a build step deletes any `.map` left either way. |
| `packages/contracts/src/monitoring/scrub.ts` | `scrub(event)` | Pure, no vendor import, structural types. Drops `request.cookies`, `request.data`, `request.query_string`, every header except `content-type` and `x-request-id`, `user` fields except `id`, `extra.detail`; cuts query strings from every URL; replaces anything shaped like an email with `[email]`. |
| `packages/contracts/src/monitoring/events.ts` | `ProductEvent` (a Zod discriminated union), one schema per event, `milestoneEventId(workspaceId, milestone)` | The catalog. A new event is a new schema here, reviewed like a contract change. |
| `packages/data` | `DataLayerOptions.report?: (fault: DataFault) => void` | Called only for faults the server can't have seen (AC-163). `DataFault` is `{ error, requestId?, procedure? }`. |

**Status codes**: no new codes. `system.testFault` answers 404 `NOT_FOUND` (off), 401 `UNAUTHENTICATED`, 500 `INTERNAL` (on).

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| any server event | request id | the `requestId` `app.ts` already mints per request, set on the Sentry scope by `setRequestScope` |
| any server event | procedure or route | oRPC's `path` in the RPC interceptor (`rpc.ts`); the Better Auth route after `AUTH_BASE_PATH` |
| any server event | user id, workspace id | the session user's id and the door's workspace id from the request context; absent before sign in or outside a workspace |
| any server event | service | `SERVICE` set by the start command (`api`, `worker`) |
| any server event | environment | `APP_ENV` |
| any server event | release | `RAILWAY_GIT_COMMIT_SHA` (Railway provides it), else `local` |
| any web event | release | `GITHUB_SHA` at build (the deploy and preview Actions), injected with Vite `define` and handed to the upload plugin; else `local` |
| any web event | environment | `VERCEL_ENV` at build (`production` or `preview`), else `local` |
| any web event | route pattern | the router's matched route id at the time of the error |
| any web event | request id of a failed call | the `x-request-id` answer header, read in the data layer's fetch wrapper and passed in `DataFault` |
| which errors are sent | expected or not | `toApiError(…).expected` on the server; on the web, a `DataError` with a known code is expected, and only `report` calls and uncaught errors are sent |
| trace | span name | `rpc <procedure>` or `auth <route>`, set by `nameRequest` |
| trace | sample rate | `APP_ENV`: production 0.2, preview 1.0, local 0; any `/api/health*` path 0 |
| CSP | Sentry ingest host | the host part of the owner's web DSN (`o<id>.ingest.de.sentry.io`), written into `vercel.json` once the project exists |
| `user_signed_up` | distinct id | `auth.user.id`, from Better Auth's `databaseHooks.user.create.after` |
| `user_signed_up` | `method` | the hook context's path: the email code route → `email_code`, the Google callback → `google` |
| `workspace_created` | whether it is new | a row returned by the milestone insert inside `createUserWorkspace`'s transaction |
| `workspace_created`, `first_record_created` | distinct id | the acting user's id from the request context |
| `first_record_created` | whether it is the first | a row returned by the milestone insert in the write composer, for a create by a member actor |
| `first_record_created` | `object_kind` | the object's `standard_key` (`people`, `companies`, `deals`), else `custom` |
| milestone events | event id and timestamp | `milestoneEventId` (a UUID v5 of workspace id and milestone, fixed namespace in `events.ts`) and `reached_at` |
| every event | `environment` | `APP_ENV` |
| `relay.lag` | milliseconds | `published_at − created_at` of each row the relay marks, returned by the relay's mark statement (database clock on both ends) |
| `outbox.pending`, `outbox.oldest_age_s` | the numbers | `crm_outbox_backlog()`; age is `now() − oldest_created_at` in the same query, 0 when nothing is pending |
| backlog sample | how often | once a minute, on a timer in the worker, after the relay's own cycle so it adds no extra database wake ups |
| `worker-heartbeat` | schedule | interval 1 minute, check in margin 2 minutes, set by the wrapper's `heartbeat()` upsert; production only (`APP_ENV`) |
| `RELAY_LAGGING` | when | `outbox.oldest_age_s > 30` at two samples in a row; the two numbers go in the issue |
| uptime monitor | URL and interval | `APP_URL` + `/api/health`, 5 minutes, set by the owner in Sentry |

**Key invariants**:
- Each vendor is imported in exactly one module; lint enforces it (the vendor list already names `@sentry/*` and `posthog-node`).
- Every Sentry send hook and every PostHog event passes `scrub` or the catalog parse; nothing bypasses them.
- Expected refusals are never sent to Sentry.
- A milestone row and the write that reached it commit together or not at all; its event is sent only after commit and only when the insert returned a row.
- `packages/core` never imports a monitoring module. It returns the milestones a write reached, and `apps/api` sends them.
- Metric attributes are `service` and `environment` only.
- Sending never awaits the network on a request path.
- No source map is ever in a deployed bundle.

**Security model**:
- Both vendors are processors of pseudonymous data only: user ids, workspace ids, request ids, procedure names, stacks and counts. No email, name, value, body, cookie, header beyond the two allowed, query string or IP. GDPR applies (user ids are still personal data): both accounts in the EU region, both vendors' data processing terms accepted, the privacy notice names them (follow up).
- Sentry project settings, set by the owner and recorded in `verify.md`: server side data scrubbing on, default scrubbers on, IP storage off, allowed domains `brij-crm-phi.vercel.app` and `*.vercel.app` (previews) for the web project, and a per key rate limit on the web DSN, since a browser DSN is public by design.
- `SENTRY_DSN_SERVER` and `POSTHOG_KEY` live in Railway variables only. `SENTRY_AUTH_TOKEN` is an organization token with release upload scope only, a GitHub Actions secret, never a Vercel or Railway variable.
- `crm_outbox_backlog()` is a third deliberate gap in row level security, returning two numbers; it carries the same hardening and guard test as 0005's functions.
- `system.testFault` is off by default, answers `NOT_FOUND` when off, and needs a session when on.
- `security-access-reviewer` reviews milestone 1 (scrub, CSP, source maps, the test fault) and milestone 4 (the definer function) before they land.

**Configuration required**:
- `SENTRY_DSN_SERVER` (api and worker; the worker references the api's): server errors, traces and metrics. Unset means off. Spec 0001's name.
- `VITE_SENTRY_DSN_WEB` (web build; Vercel Production and Preview): spec 0001's `SENTRY_DSN_WEB`, with the prefix Vite needs to put it in the bundle. Unset means off.
- `SENTRY_AUTH_TOKEN` (GitHub Actions secret), `SENTRY_ORG` and `SENTRY_PROJECT_WEB` (repository variables): source map upload in `deploy-web.yml` and `preview.yml`.
- `POSTHOG_KEY` (api; production only): the project's write key. Unset means off.
- `POSTHOG_HOST` (api): defaults to `https://eu.i.posthog.com`; must be an `https` URL.
- `MONITORING_TEST_FAULT` (api, optional): `on` enables `system.testFault`.
- `SERVICE` (api and worker): set in each start command, not as a variable.
- Spec 0001's `SENTRY_RELEASE` is dropped: the release is the commit, which each host already provides.
- `.railway/railway.ts` declares the api's new variables with `preserve()` and changes both start commands to `node --import ./apps/api/src/monitoring/instrument.ts …`; the Dockerfile's `CMD` matches. `.env.example` gains the variables, empty.
- New pinned dependencies in the catalog: `@sentry/node` (10.25 or later, for the stable metrics API), `@sentry/react`, `@sentry/vite-plugin`, `posthog-node`.
- Owner prerequisites, before milestone 1: a Sentry organization in the EU region with the two projects, and a PostHog Cloud EU project (before milestone 3), both on the owner's own account.

**Critical test scenarios**:
- Happy path: with a fake Sentry transport, a procedure that throws an unexpected error sends one event with the request id from the answer header, the procedure, service, environment, release, user id and workspace id; a refusal sends nothing. In production, `system.testFault` is found by request id within 60 seconds. Verifies **AC-162**, **AC-168**, **AC-183**.
- Browser: a Playwright test with a fake transport throws in a render and in a promise before and after the SDK starts, and gets a scrubbed event with the route pattern; an offline call and a refusal send nothing; a proxy page answer sends a fault with its request id. Verifies **AC-163**, **AC-169**.
- Privacy: `scrub` unit tests (emails, cookies, bodies, queries, headers, Postgres `detail`, `user` fields), and the same inputs through each SDK send hook. Verifies **AC-165**.
- Failure: Sentry and PostHog transports that hang or fail leave answer times and bodies unchanged; shutdown ends within the window. Verifies **AC-166**.
- Build: no `.map` file or `sourceMappingURL` in `dist`; the CSP lists one Sentry ingest host and no PostHog host; the first load budget passes. Verifies **AC-164**, **AC-167**, **AC-169**.
- Events: against a real Postgres with a fake PostHog client, a new user, a workspace and a first record each send one parsed event; a replayed workspace create, a second record, a refused create and system created records send none; the milestone rows exist once; the guard tests pass. Verifies **AC-173** to **AC-178**.
- Live: a test relay run records one `relay.lag` per published row from database times; the sampler records both gauges from `crm_outbox_backlog()`; two slow samples raise one `RELAY_LAGGING`; the heartbeat runs only in production. Verifies **AC-179** to **AC-182**.
- Permission: `crm_app` cannot read `outbox` across workspaces except through the two numbers; `system.testFault` answers `NOT_FOUND` with the flag off and 401 without a session. Verifies **AC-168**, **AC-180**.
- Structure: lint fails on a vendor import outside its wrapper. Verifies **AC-184**.

## Build plan

Tracer Bullet: each milestone ends with something you can see in production, in Sentry or PostHog.

**Milestone 1: a production error, with its request, in under a minute**
1. Owner step: create the Sentry organization (EU) with `brij-crm-web` and `brij-crm-server`, the organization token, the project settings in the security model, and the issue alert emails; set the variables on Railway, Vercel and GitHub, satisfies **AC-165**, **AC-172**
2. `scrub` and its tests in `packages/contracts`, satisfies **AC-165**
3. The server wrapper and `instrument.ts`; `--import` in the start commands, the Dockerfile and `railway.ts`; `captureFault` and `setRequestScope` wired into `rpc.ts`, `app.ts`'s `onError` and the worker's fault paths; flush in `onShutdown`; lint exceptions, satisfies **AC-162**, **AC-165**, **AC-166**, **AC-184**
4. `system.testFault` behind `MONITORING_TEST_FAULT`, on the bootstrap list, satisfies **AC-168**
5. The web wrapper and fault buffer, started from `main.tsx` in its own chunk; React's error options; the root route's `errorComponent` reports; `report` in `packages/data` with the request id from the answer header, satisfies **AC-163**, **AC-169**
6. Hidden source maps, the upload plugin in `vite.config.ts`, `SENTRY_AUTH_TOKEN` and `GITHUB_SHA` in `deploy-web.yml` and `preview.yml`, the map deletion and the build test; the Sentry ingest host in `vercel.json`'s CSP and its test, satisfies **AC-164**, **AC-167**
7. Deploy; prove AC-162 in production with the test fault, then switch it off; `security-access-reviewer` before it lands, satisfies **AC-162**, **AC-168**, **AC-183**

**Milestone 2: request time, charted, and the app watched**
8. Tracing on the server: `nameRequest` per procedure and sign in route, the sampler by environment and path, database child spans, satisfies **AC-170**
9. The request time view in Sentry (p50 and p95 per procedure), the uptime monitor on `/api/health`, the alert check; screenshots in `verify.md`, satisfies **AC-170**, **AC-171**, **AC-172**

**Milestone 3: product counts**
10. Owner step: create the PostHog EU project; set `POSTHOG_KEY` on Railway production, satisfies **AC-178**
11. The event catalog in `packages/contracts` and the PostHog wrapper with its no op and shutdown, satisfies **AC-173**, **AC-166**, **AC-184**
12. Migration: `workspace_milestones`, its policy and grants; guard tests updated, satisfies **AC-177**
13. `user_signed_up` from Better Auth's after hook; `workspace_created` from the milestone insert in `createUserWorkspace`; `first_record_created` from the write composer (core returns the milestones reached, the api sends them after commit), satisfies **AC-174**, **AC-175**, **AC-176**, **AC-177**
14. The Activation dashboard in PostHog; prove the events locally with a key set, then with a real production sign up, satisfies **AC-178**

**Milestone 4: live delay and backlog** (after 0005 milestone 3)
15. Migration: `crm_outbox_backlog()` with its hardening; guard tests list it, satisfies **AC-180**
16. `relay.lag` per published row from the relay's mark statement, satisfies **AC-179**
17. The backlog sampler with its probe list (the outbox probe), the heartbeat after each good read, and `RELAY_LAGGING` after two slow samples, satisfies **AC-180**, **AC-181**, **AC-182**
18. Charts in Sentry; deploy; `security-access-reviewer` before it lands; `verify.md` with every Done item, satisfies **AC-179** to **AC-184**

## Consequences

**Positive**:
- Every unexpected error, on every layer, is in one place with the request id the user's answer carried.
- The source maps that are public today stop being served.
- The counts rest on a table in our own database, so they can be rebuilt if PostHog ever loses events or is replaced.
- #8 and #39 extend the sampler and the workspace tag instead of adding their own plumbing.

**Negative / tradeoffs**:
- Free plan quotas: 0.2 trace sampling hides rare slow requests; errors beyond the monthly quota are dropped until the month turns.
- The free plan likely allows one uptime monitor and one cron monitor, so previews get neither.
- Server side events only: no funnels of what people click, and no session replay.
- Without browser tracing, the time a request spends between the browser and the API (Vercel, the network) isn't charted.
- `relay.lag` starts at the transaction's start, not its commit, so a long write reads as lag.
- A third definer function widens row level security's deliberate gaps by two numbers.
- One more insert per created record (a conflict on a primary key after the first).
- Two vendors, two dashboards, two sets of settings for the owner to keep.

**Neutral**:
- One migration, one definer function, four new pinned dependencies.
- The api and worker start with `--import`.
- Spec 0001's `SENTRY_RELEASE` goes; `SENTRY_DSN_WEB` gains the `VITE_` prefix.

## Follow-up

- [ ] **Owner**: create the Sentry (EU) and PostHog (EU) accounts on your own email, never the work org; accept both data processing terms.
- [ ] **#36 (audit log and privacy tools)**: the privacy page names Sentry and PostHog as processors, the EU region, and what is sent; erasing a person also deletes their PostHog events by distinct id (the user id), and Sentry's retention is stated, since its events can't be deleted per user.
- [ ] **#8**: add the `jobs` probe (queued jobs and oldest age) to the sampler; outbox pruning keeps `crm_outbox_backlog()` fast.
- [ ] **#7**: check Neon's monthly compute hours with the relay's 1 second poll; a poll that never stops keeps the free compute awake all month.
- [ ] **#12**: the load harness reads `relay.lag` and the request spans; the budget's thresholds may replace this spec's 30 second lag alert.
- [ ] **#39**: recent errors per workspace through the `workspace_id` tag.
- [ ] **Later**: browser tracing with Web Vitals once the first load has room; a short error reference (the request id) in the error toast so a user can quote it.
- [ ] `sentry-node-sdk` and `sentry-react-sdk` conventions are not yet captured: they belong in `apps/api/AGENTS.md` and `apps/web/AGENTS.md` (area scoped, not root).
- [ ] Consider installing a PostHog community skill for `posthog-node` conventions; none is installed.
