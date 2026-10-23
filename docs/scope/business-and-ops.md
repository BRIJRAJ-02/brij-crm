# Business and operations

Running the product as a SaaS business: monitoring, scale, plans and limits, the operator console, onboarding, and billing. See [index.md](index.md) for the house rules and the full order.

## Slice 1: Core loop (the walking skeleton)

### 11. Monitoring and product analytics · done
See errors, slow requests, realtime delay and key product events from the first slice on, so problems show up before users report them.
**Done when:** a production error is visible with its request within a minute; request time, realtime delay and job backlog are charted; signups, workspaces created and first records created are counted.
- [x] Design it (spec): `/architect monitoring and product analytics`
- [x] Build it: `/develop monitoring and product analytics`
   - [x] A production error, with its request, in under a minute
   - [x] Request time, charted, and the app watched
   - [x] Product counts
   - [x] Live delay, backlog and the heartbeat
- [x] Verify it: `/check verify monitoring and product analytics`
- [x] Test it: `/test monitoring and product analytics`
Spec [0010](../specs/0010-monitoring-analytics/index.md) · code in `apps/api/src/monitoring/` · still yours: create the Sentry and PostHog accounts and set their keys

### 12. Scale budget and load harness · done
Write down the targets (100 online, room for 1,000, a million records per workspace, response and delivery times) and build the tools that prove them, so every later slice is checked against them.
**Done when:** one command seeds a workspace with a million records across related objects; one command simulates 100 people browsing and editing at once and reports the p95 of reads, writes and live delivery against the targets.
- [x] Design it (spec): `/architect scale budget and load harness`
- [x] Build it: `/develop scale budget and load harness`
   - [x] The budget, the million record seed and minted sessions
   - [x] Reads and writes against the budget
   - [x] Live delivery
   - [x] 1,000 users, the hub, and the weekly smoke
- [x] Verify it: `/check verify scale budget and load harness`
Spec [0011](../specs/0011-scale-budget-load-harness/index.md) · code in `packages/load/`, `.github/workflows/load-smoke.yml`

## Slice 10: Trust and launch (the end of the first release)

### 38. Plans and limits · needs a decision · planned
Define the free and paid plans and enforce their limits in one place, ready for billing.
**Done when:** seats, custom objects, records, storage, API calls, enrichment and AI usage are limited per plan from one definition; going over a limit is refused with a clear message, never silently cut; owners see their usage.
- [ ] Design it (spec): `/architect plans and limits` (today the seat limit is a placeholder with no plan tables)

### 39. Operator console · in-progress · GA
Your own admin area for running the SaaS: every workspace, its plan, usage, errors and health.
**Done when:** an operator finds any workspace and sees its plan, usage and recent errors; support access to a workspace needs the owner's grant, is time limited, and is written to the audit log; operators can change a plan and suspend an abusive workspace.
- [x] Design it (spec): `/architect operator console` (slice 1)
- [ ] Build it: `/develop operator console`
   - [x] Slice 1: super admin analytics, every workspace and user, live in production
   - [ ] Support access with the owner's grant, plan changes and suspending a workspace (later slices, needs `/architect`)
- [x] Verify it: `/check verify operator console` (slice 1)
Spec [0047](../specs/0047-operator-console/index.md) · code in `apps/api/src/modules/operator/`, `apps/web/src/features/admin/`

### 40. Templates and onboarding · needs a decision · in-progress
Help a new workspace start fast: templates for common uses, sample data, and a short first run guide.
**Done when:** a new workspace picks a template (sales, recruiting, fundraising, or blank) that sets up objects, attributes and views; sample data can be added and removed in one step; a first run checklist leads to the first import, invite and saved view.
- [ ] Design it (spec): `/architect templates and onboarding`
The first run itself is built (#63) and Home opens with a setup checklist (#62); templates and sample data are not built.

### 41. Scale hardening · planned
Prove the whole first release against the scale budget before launch.
**Done when:** the load harness passes at 100 people online with a million records, and reaches 1,000 online without a redesign; every miss is fixed or recorded with a plan.
- [ ] Build it: `/develop scale hardening` (the last runs put the p95 5 to 12 times over budget)

## Slice 11: Billing

### 42. Billing · needs a decision · planned · GA
Let workspaces pay: checkout, upgrade, downgrade and invoices.
**Done when:** an owner upgrades and the new limits apply at once; a downgrade that would break a limit is explained first; failed payments are retried and the owner is told; invoices and tax are correct.
- [ ] Design it (spec): `/architect billing`
