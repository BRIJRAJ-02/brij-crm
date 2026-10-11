# Verify: Monitoring and product analytics · spec 0010 · updated 2026-10-12
_Steps derived from spec 0010's acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

## Milestone 2: request time, charted, and the app watched

Sentry has no DSN yet, so everything below that happens in Sentry waits for the owner's setup (the steps at the end). What code can prove is proven locally with a fake transport.

### Proven locally

- [x] Every `/api/rpc` request is a trace named `rpc <procedure>`, and every sign in route `auth <route>` (only routes on the allow list, so a name never comes from a path a caller made up). Hono's own integration is left out: it renamed each trace after its route pattern (`POST /api/rpc/*`) and sent the errors `app.ts` answers a second time (`tracing.test.ts`, "a traced request, in this process" and "a traced api process") → AC-170
- [x] Database queries are child spans of the request that made them, in a real Node process started the way `instrument.ts` starts production (Sentry before `pg` loads), on the test Postgres: sending a code, signing in and `me.get` each carry their queries (`tracing.test.ts`, "a traced api process, on a real Postgres") → AC-170
- [x] Sampling: production 0.2, preview 1.0, local 0; health checks, other paths and work outside a request 0; an incoming trace's decision is never followed, so a caller can't raise the rate (`tracing.test.ts`, "the sampler") → AC-170
- [x] The worker traces nothing: a sample rate of 0, errors only (`tracing.test.ts`, "the options") → AC-170
- [x] No span carries anything personal: no user agent, client address, header beyond `content-type` and `x-request-id`, query, bound parameter, connection string or database login; every text scrubbed; SQL sent as its shape, every literal a `?` (`tracing.test.ts`, "keepSpan" and the real process's envelopes) → AC-165
- [x] Trace headers go to no outgoing call (Resend, Google, Centrifugo, the worker's poke), and only our own organization's traces are continued (`tracing.test.ts`, "the options" and "no header leaves for another host") → AC-170
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
