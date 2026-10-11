# Verify: Monitoring and product analytics · spec 0010 · updated 2026-10-12
_Steps derived from spec 0010's acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Milestone 2: request time, charted, and the app watched

Sentry has no DSN yet, so everything below that happens in Sentry waits for the owner's setup (the steps at the end). What code can prove is proven locally with a fake transport.

### Proven locally

- [x] Every `/api/rpc` request is a trace named `rpc <procedure>`, and every sign in route `auth <route>` (only routes on the allow list, so a name never comes from a path a caller made up). Hono's own integration is left out: it renamed each trace after its route pattern (`POST /api/rpc/*`) and sent the errors `app.ts` answers a second time (`tracing.test.ts`, "a traced request, in this process" and "a traced api process") → AC-170
- [x] Database queries are child spans of the request that made them, in a real Node process started the way `instrument.ts` starts production (Sentry before `pg` loads), on the test Postgres: sending a code, signing in and `me.get` each carry their queries (`tracing.test.ts`, "a traced api process, on a real Postgres") → AC-170
- [x] Sampling: production 0.2, preview 1.0, local 0; health checks, other paths, paths over 128 characters, work outside a request, requests without the edge header (outside local) and requests carrying `sentry-trace`, `baggage` or `traceparent` 0, so a caller can't raise the rate or pick a trace id; the middleware drops those three headers too (`tracing.test.ts`, "the sampler"; `middleware.test.ts`) → AC-170
- [x] The worker traces nothing: tracing off (no rate set), errors only (`tracing.test.ts`, "the options") → AC-170
- [x] No span carries anything personal: no user agent, client or server address, full URL, header beyond `content-type` and `x-request-id`, query, bound parameter, status message (a failed query's Postgres message), database location or login, or link; every text cut to 1 KB (SQL 2 KB) and scrubbed; SQL sent as its shape, every literal a `?`; a span `keepSpan` can't read leaves blank (`tracing.test.ts`, "keepSpan", "the options" and the real process's envelopes, which include a failing query bound with a name) → AC-165
- [x] A span costs well under a millisecond to scrub, even with 9 KB in its path and headers; `scrub` finds emails from each `@` so no text makes it slow (`tracing.test.ts`, `scrub.test.ts`) → AC-166
- [x] Trace headers go to no outgoing call (Resend, Google, Centrifugo, the worker's poke), and a request bringing its own trace is never sampled (`tracing.test.ts`, "the options" and "no header leaves for another host") → AC-170
- [x] A fault outside any request (a pool error) keeps none of a traced request's trace, with tracing on (`sentry.test.ts`, "keeps a real HTTP request's data, breadcrumbs and trace out of a fault outside any request (preview)") → AC-162
- [x] The uptime target, `GET /api/health`, answers in production through the edge without touching the database, and is never traced (`uptime.test.ts`) → AC-171

### In Sentry and production (owner, once the DSN is set)

- [ ] The request time chart: p50 and p95 per procedure, a screenshot here → AC-170
- [ ] The uptime monitor on `https://brij-crm-phi.vercel.app/api/health`, every 5 minutes, two failures in a row email the owner; green, a screenshot here → AC-171
- [ ] Issue alerts in both projects (a new issue, and a regressed one, in production) email the owner; both projects auto resolve after 2 hours → AC-172

### Owner setup for this milestone

Nothing new to set on Railway, Vercel or GitHub: the `SENTRY_DSN_SERVER` milestone 1 asks for turns traces on too.

1. **Request time.** In `brij-crm-server`, open Explore, then Traces. Filter to `environment:production` and to spans that start a trace (`is_transaction:true`; only the api sends traces). Show `p50(span.duration)` and `p95(span.duration)`, grouped by `span.name` (`rpc records.query`, `auth /sign-in/email-otp`, …). Save it to a dashboard as "Request time", and put a screenshot here.
2. **Uptime.** Alerts, then Create Alert, then Uptime Monitor: URL `https://brij-crm-phi.vercel.app/api/health`, method GET, interval 5 minutes, environment `production`, project `brij-crm-server`. Set the failure tolerance to 2 checks in a row, and the owner's email as the action. If Vercel's firewall or bot protection is ever turned on, let Sentry's uptime checker through (user agent `SentryUptimeBot`). Never point it at `/api/health/ready`: that one queries Postgres, and a probe every 5 minutes would keep Neon awake.
3. **Issue alerts.** In each project (`brij-crm-server`, `brij-crm-web`): Alerts, then Create Alert, then Issues. When "a new issue is created" or "an issue changes state from resolved to unresolved", if the environment is `production`, email the owner.
4. **Auto resolve.** In each project's settings, General, set "Auto Resolve" to 2 hours, so a problem that returns later regresses and emails again.
5. **Quota.** The free plan's span quota is monthly. At 0.2 in production the CRM's traffic fits easily; if Usage Stats ever shows spans near the cap, lower `TRACE_RATES.production` in `apps/api/src/monitoring/tracing.ts`.

## Milestone 3: product counts

PostHog has no project or key yet, so production runs with `POSTHOG_KEY` unset and sends nothing. What code can prove is proven locally: the real `posthog-node` client sends to a fake capture endpoint on the test machine (`apps/api/test/posthog.ts`), and the app runs on the test Postgres.

### Proven locally

- [x] The catalog is closed: one strict schema per event, uuids and closed lists only; an event outside it, an extra property, an email as the distinct id, a name for a workspace id and a milestone without its fixed id are all refused (`packages/contracts/src/monitoring/events.test.ts`); the wrapper refuses them too, sends nothing, and logs the event's name only (`posthog.test.ts`) → AC-173
- [x] Every event carries `environment`, `$process_person_profile: false` and `$geoip_disable: true`, and goes to `/batch/` only (no flags or config calls) (`posthog.test.ts`) → AC-173, AC-178
- [x] `user_signed_up` (`email_code`) is sent once for a new account, after Better Auth wrote it, by user id; signing in again sends nothing; the method comes from the route (`events.test.ts`, "user_signed_up" and "signUpMethod") → AC-174
- [x] `workspace_created` is sent once after the workspace commits, by the creator's user id, with `milestoneEventId` as its uuid and the row's `reached_at` as its timestamp; a replayed create and a refused one (`SLUG_TAKEN`) send nothing (`events.test.ts`; `user-workspace.test.ts` and `account.test.ts` in core) → AC-175
- [x] `first_record_created` is sent once for the first record a member makes, with its object's kind (`people`, `companies`, `custom`); a refused create, later records, the system's records, a write that creates no record and a write a later step rolls back send nothing; three creates at once reach it once (`events.test.ts`; `packages/core/src/milestones/milestones.test.ts`) → AC-176
- [x] `workspace_milestones`: forced row level security with the standard policy, the app may only read and insert (no update, delete or truncate; no other role holds anything), an insert returns its row the first time only, no read or write across workspaces, gone with its workspace (`guards.test.ts`, "workspace milestones"); a milestone's event id is the same every time (`events.test.ts` in contracts) → AC-177
- [x] Nothing personal leaves: the wire carries no email, name, workspace name or address, and no value; `before_send` drops anything outside the catalog and scrubs the rest (`posthog.test.ts`, `events.test.ts`) → AC-165
- [x] Without a key nothing is sent and nothing changes (milestone rows are still stored); a PostHog that hangs or fails never slows or fails the caller, and shutdown gives up within its timeout (`posthog.test.ts`, `events.test.ts`, "without a key") → AC-166, AC-178
- [x] `posthog-node` is imported only in `apps/api/src/monitoring/posthog.ts`, which imports no other vendor (`vendors.test.ts`) → AC-184

### In PostHog and production (owner, once the key is set)

- [ ] The three events from a local run with a key set (`environment = local`), a screenshot of PostHog's activity view here → AC-178
- [ ] The Activation dashboard with daily counts of the three events, filtered to `environment = production`, after a real production sign up, workspace and first record; a screenshot here → AC-178, AC-183

### Owner setup for this milestone

1. **Project.** On your own PostHog account (never the work org), create a PostHog Cloud project in the **EU** region named `brij-crm`, and accept PostHog's data processing terms. In its settings: turn on "Discard client IP data"; leave autocapture and session replay off (only the api sends, and only the three events). Copy the project API key (it starts `phc_`).
2. **Production key.** In Railway, production environment, the `api` service: set `POSTHOG_KEY` to that key. Leave `POSTHOG_HOST` unset (the code defaults to `https://eu.i.posthog.com`). Don't set either on `preview-base` or the worker. Redeploy; the api logs `Product analytics on`.
3. **Prove it locally (optional, before production).** Put the key in your root `.env` as `POSTHOG_KEY`, run `pnpm dev`, sign up with a new email, create a workspace and add one record. In PostHog's Activity, three events arrive within about 10 seconds, each with `environment = local` and only ids. Take a screenshot for the first box above, then remove the key from `.env`.
4. **Activation dashboard.** New dashboard "Activation". Add one Trends insight with three series, `user_signed_up`, `workspace_created` and `first_record_created`, each "Total count", interval "Day", with the filter `environment = production` on the whole insight. Save it to the dashboard, and put a screenshot here after the first real production sign up.
5. **Person profiles.** The api asks for none (`$process_person_profile: false`). If the Persons tab ever shows profiles from these events, tell the build: something else is sending.
