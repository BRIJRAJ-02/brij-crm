# Business and operations

Running the product as a SaaS business: monitoring, scale, plans and limits, the operator console, onboarding, and billing. See [index.md](index.md) for the house rules and the full order.

## Slice 1: Core loop (the walking skeleton)

### 11. Monitoring and product analytics · needs a decision
See errors, slow requests, realtime delay and key product events from the first slice on, so problems show up before users report them.
**Done when:** a production error is visible with its request within a minute; request time, realtime delay and job backlog are charted; signups, workspaces created and first records created are counted.
- [ ] Design it (spec): `/architect monitoring and product analytics`

### 12. Scale budget and load harness · needs a decision
Write down the targets (100 online, room for 1,000, a million records per workspace, response and delivery times) and build the tools that prove them, so every later slice is checked against them.
**Done when:** one command seeds a workspace with a million records across related objects; one command simulates 100 people browsing and editing at once and reports the p95 of reads, writes and live delivery against the targets.
- [ ] Design it (spec): `/architect scale budget and load harness`

## Slice 10: Trust and launch (the end of the first release)

### 38. Plans and limits · needs a decision
Define the free and paid plans and enforce their limits in one place, ready for billing.
**Done when:** seats, custom objects, records, storage, API calls, enrichment and AI usage are limited per plan from one definition; going over a limit is refused with a clear message, never silently cut; owners see their usage.
- [ ] Design it (spec): `/architect plans and limits`

### 39. Operator console · needs a decision · GA
Your own admin area for running the SaaS: every workspace, its plan, usage, errors and health.
**Done when:** an operator finds any workspace and sees its plan, usage and recent errors; support access to a workspace needs the owner's grant, is time limited, and is written to the audit log; operators can change a plan and suspend an abusive workspace.
- [ ] Design it (spec): `/architect operator console`

### 40. Templates and onboarding · needs a decision
Help a new workspace start fast: templates for common uses, sample data, and a short first run guide.
**Done when:** a new workspace picks a template (sales, recruiting, fundraising, or blank) that sets up objects, attributes and views; sample data can be added and removed in one step; a first run checklist leads to the first import, invite and saved view.
- [ ] Design it (spec): `/architect templates and onboarding`

### 41. Scale hardening
Prove the whole first release against the scale budget before launch.
**Done when:** the load harness passes at 100 people online with a million records, and reaches 1,000 online without a redesign; every miss is fixed or recorded with a plan.
- [ ] Build it: `/develop scale hardening`

## Slice 11: Billing

### 42. Billing · needs a decision · GA
Let workspaces pay: checkout, upgrade, downgrade and invoices.
**Done when:** an owner upgrades and the new limits apply at once; a downgrade that would break a limit is explained first; failed payments are retried and the owner is told; invoices and tax are correct.
- [ ] Design it (spec): `/architect billing`
