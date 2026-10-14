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
- [x] `posthog-node` is imported only in `apps/api/src/monitoring/posthog.ts`, which imports no other vendor; the api's five wrapper exceptions are exact allow lists, so sign in can't import mail or Better Auth's browser client, and the mail modules can't import each other's vendor or Better Auth (`vendors.test.ts`) → AC-184

### In PostHog and production (owner, once the key is set)

- [ ] The three events from a local run with a key set (`environment = local`), a screenshot of PostHog's activity view here → AC-178
- [ ] The Activation dashboard with daily counts of the three events, filtered to `environment = production`, after a real production sign up, workspace and first record; a screenshot here → AC-178, AC-183

### Owner setup for this milestone

1. **Project.** On your own PostHog account (never the work org), create a PostHog Cloud project in the **EU** region named `brij-crm`, and accept PostHog's data processing terms. In its settings: turn on "Discard client IP data"; leave autocapture and session replay off (only the api sends, and only the three events). Copy the project API key (it starts `phc_`).
2. **Production key.** In Railway, production environment, the `api` service: set `POSTHOG_KEY` to that key. Leave `POSTHOG_HOST` unset (the code defaults to `https://eu.i.posthog.com`). Don't set either on `preview-base` or the worker. Redeploy; the api logs `Product analytics on`.
3. **Prove it locally (optional, before production).** Put the key in your root `.env` as `POSTHOG_KEY`, run `pnpm dev`, sign up with a new email, create a workspace and add one record. In PostHog's Activity, three events arrive within about 10 seconds, each with `environment = local` and only ids. Take a screenshot for the first box above, then remove the key from `.env`.
4. **Activation dashboard.** New dashboard "Activation". Add one Trends insight with three series, `user_signed_up`, `workspace_created` and `first_record_created`, each "Total count", interval "Day", with the filter `environment = production` on the whole insight. Save it to the dashboard, and put a screenshot here after the first real production sign up.
5. **Person profiles.** The api asks for none (`$process_person_profile: false`). If the Persons tab ever shows profiles from these events, tell the build: something else is sending.

## Milestone 4: live delay, backlog and the heartbeat

Sentry has no DSN yet, so production sends nothing and every monitoring call is a quiet no op. What code can prove is proven locally: the real `@sentry/node` wrapper sends to a fake transport (`apps/api/test/sentry.ts`), and the relay runs on the test Postgres. Production's worker still runs on the app login with `JOBS_RUNNER` off; the stats tick needs neither, since it reads memory only.

### Proven locally

- [x] `relay.lag`: the relay hands over one lag per row it marks, the same number the row holds (`published_at - created_at`, both from the database clock, in the mark statement itself), into a bounded sample; the stats tick records what it gathered as the distribution `relay.lag` in milliseconds, awake or asleep: every row up to 500 a minute, a uniform sample of 500 past that (its median lands in the middle of 100,000 values; 200,000 rows cost it well under 200 ms); a shutdown records what came since the last tick before the flush; a lag hook that throws never fails a turn and warns once a minute (`relay.test.ts`, "the relay lag metric"; `stats.test.ts`, "the lag sample"; `sentry.test.ts`, "metrics") → AC-179
- [x] Metrics are a closed list (`relay.lag`, `worker.awake`, `outbox.pending`, `outbox.oldest_age_s`), and each leaves with exactly `service` and the SDK's environment, release, SDK name and sequence: no user id even inside a request with a user, no host (`server.address`, and `includeServerName` is off, so no event names the host either), no workspace, nothing a caller added; a name outside the list is dropped (`sentry.test.ts`, "metrics") → AC-180, AC-182
- [x] The stats tick runs at start and then once a minute: `worker.awake` 1 and both outbox gauges while awake, from the relay's memory; a stuck relay's oldest age keeps growing from its commit time; with nothing waiting both gauges are 0 (`stats.test.ts`, "the stats reporter") → AC-180
- [x] The backlog age has no blind spot for a stuck relay: rows a turn read count as waiting until they are published, even when the turn then throws (audiences that fail to load); a workspace failing before it reads ages from its first failure; and a relay that can't reach Postgres while pokes keep coming ages from boot or the first unserved poke until a poll answers, then counts afresh (`relay.test.ts`, "the relay lag metric") → AC-180, AC-182
- [x] Asleep, the tick records `worker.awake` 0, checks in, reads no source and sends no outbox gauge (`stats.test.ts`) → AC-180, AC-181
- [x] `RELAY_LAGGING` is raised at the second awake tick in a row with the oldest row over 30 seconds, with the pending count and the age, and again every hour the episode lasts (so the 2 hour auto resolve can't close it meanwhile); exactly 30 is not over; a fine tick or an asleep tick ends the episode, and a later one raises again; it goes as a warning with the one fingerprint `RELAY_LAGGING`, its two numbers, the `service` tag and nothing of a request or host, and a second raise isn't dropped as a duplicate (the SDK's Dedupe lets raised issues through and still drops a repeated fault) (`stats.test.ts`) → AC-182
- [x] A source, gauge, issue or heartbeat that throws never stops the tick, and the heartbeat still runs (`stats.test.ts`) → AC-166, AC-181
- [x] The heartbeat checks in to `worker-heartbeat` (interval 1 minute, margin 2 minutes) in production only; preview and local send none (`stats.test.ts`, "the heartbeat and RELAY_LAGGING through the wrapper") → AC-181
- [x] The sleep test: a real relay on the test Postgres goes dormant, then ten ticks on a fake clock send ten check ins, ten `worker.awake` 0, no outbox gauge and no issue; the relay never connects again and `pg_stat_activity` shows no connection from it (`stats.test.ts`, "a sleeping worker") → AC-180, AC-181
- [x] The full api suite passes after the review fixes (46 files, 499 tests, 14 October), with Sentry unset, as production runs today. Two timing tests in `relay.test.ts` ("backs a failing workspace off" and "starts a round on a busy pass") can fail when the machine is heavily loaded; the second fails the same way on the base commit, so neither is this milestone's → AC-166
- [x] `@sentry/node` is still imported only in `apps/api/src/monitoring/sentry.ts`; `stats.ts` takes the wrapper's functions as arguments (`vendors.test.ts`, lint) → AC-184

### In Sentry and production (owner, once the DSN is set)

- [ ] The live delay chart: `relay.lag` p50 and p95 per minute, a screenshot here → AC-179, AC-183
- [ ] The backlog charts: `outbox.pending` and `outbox.oldest_age_s`, and `worker.awake`, a screenshot here → AC-180, AC-183
- [ ] `worker-heartbeat` green across a stretch when the production worker slept (`worker.awake` 0 for that stretch), a screenshot of the monitor here → AC-181, AC-183
- [ ] `RELAY_LAGGING` reaches the owner by email through the issue alert (optional drill, step 5 below) → AC-182

### Owner setup for this milestone

Nothing new to set on Railway, Vercel or GitHub: the worker already reads the api's `SENTRY_DSN_SERVER`, and that one value turns the metrics, the heartbeat and `RELAY_LAGGING` on. Once it is set, deploy and check the worker logs `Monitoring on` with `service: worker`.

1. **Live delay.** In `brij-crm-server`, open Explore, then Metrics. Pick `relay.lag` (a distribution, in milliseconds). Show `p50` and `p95`, interval 1 minute, filtered to `environment:production`. Keep the interval at 1 minute: above 500 rows a minute the worker sends a sample of 500, so a wider interval (Sentry widens it on long time ranges) under weights a burst minute. Save it to a dashboard as "Live delay", and put a screenshot here.
2. **Backlog.** On the same dashboard, add three more charts from Explore, then Metrics, each filtered to `environment:production`, interval 1 minute: `outbox.pending` (max), `outbox.oldest_age_s` (max) and `worker.awake` (min, so a minute with any sleep shows 0). Gaps in the two outbox charts are normal: they are sent only while the worker is awake. Put a screenshot here.
3. **Heartbeat alert.** The worker creates the cron monitor `worker-heartbeat` itself with its first check in (interval 1 minute, check in margin 2 minutes, one miss opens an issue, one check in closes it). Open Crons (Insights, then Crons), select `worker-heartbeat`, check it is in the `production` environment, and edit its alerting so a missed check in emails the owner. Leave the schedule as the worker set it: the next check in would set it back anyway. The free plan includes one cron monitor, which is this one; previews send none.
4. **Watch it sleep.** Leave production idle for at least 10 minutes (the relay goes dormant after 3 quiet minutes). `worker.awake` drops to 0 and the outbox charts stop, while `worker-heartbeat` stays green. Put a screenshot of the monitor's timeline and the `worker.awake` chart here.
5. **`RELAY_LAGGING`** (optional drill). It is an ordinary warning issue in `brij-crm-server`, so milestone 2's issue alert (a new issue, or one that regressed, in production) already emails it, and auto resolve after 2 hours lets a later episode email again. To see one, stop the Centrifugo service on Railway for 3 minutes while making a few edits in the app, then start it again: the worker raises one `RELAY_LAGGING` with the pending count and the age, and publishes the backlog once Centrifugo is back.
6. **Quota.** The worker sends at most about 505 metric values a minute while awake (up to 500 `relay.lag`, three gauges), and one while asleep, plus one check in a minute. If Usage Stats ever shows metrics near the free plan's cap, lower `LAG_SAMPLE_SIZE` in `apps/api/src/monitoring/stats.ts`.
