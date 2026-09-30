---
name: crm-api-backend
description: House rules for all server side code in this CRM. Use it whenever you write or review endpoints, server actions, services, the public API, background jobs, change events, realtime delivery, webhooks, validation, error handling, pagination, rate limits, integrations or anything else that runs on the server, even a small handler.
---

# CRM API and backend rules

The screens, the public API, background jobs and automations all change the same data. If each one has its own logic, they drift apart and one of them skips a check. So there is one service layer, and every write follows the same path. The concrete stack (framework, database, job runner, realtime transport) is decided in the specs under `docs/specs/`. These rules hold whatever is chosen.

## Every write follows the same path

1. **Validate at the boundary** with a shared schema. The same schema is used by the screen and the API, so one shape has one definition.
2. **Authorise** through the access door (see `crm-data-model-access`). No write skips it, including jobs, imports and integrations.
3. **Write in one transaction:** the change itself, the value history, the audit entry, and one change event in an outbox table. If any part fails, none of it happened.
4. **Change events name what changed** (workspace, object, record ids, and the kind of change) and carry no field values. Viewers load the data through the access door, so an event can never leak a value someone may not see. Realtime, search indexing, notifications, webhooks, automations and sync all read from this one event stream.
5. **Return the new id and version.** Undo, chained steps and the AI assistant all need them.

## API conventions

- **Generic over objects:** the same endpoints serve every object, for example `/objects/{object}/records`. A custom object gets the full API automatically.
- **Resource names are plural and stable.** Every breaking change gets a new version, and an existing version never changes shape.
- **Cursor pagination** with a stable sort, because offsets break at a million rows.
- **Filters use the same structure saved views use,** so a view and an API call can't disagree.
- **One error shape everywhere:** a stable machine code, a human message, and details per field. Refusals say why without revealing whether a hidden record exists.
- **Idempotency keys on every create,** so a retried request doesn't make two records.
- **Formats:** timestamps in ISO 8601 UTC, dates as `YYYY-MM-DD`, money as integer minor units with the currency code on each value.
- **Rate limits per workspace and per key,** by plan, through the central limits module.

## Jobs, events and integrations

- **Anything slow runs as a background job,** never in the request: imports, exports, bulk edits, recomputing, type changes, enrichment, sync and webhooks. Jobs are idempotent, retry with backoff, report progress, can be cancelled, and are fair between workspaces.
- **Webhooks are delivered from the event stream,** signed, retried and logged. An endpoint that keeps failing is paused.
- **Every outside service sits behind a small interface in one place.** Feature code never imports a vendor SDK directly. OAuth tokens and secrets are encrypted at rest and never logged.

## Scale

- **The targets:** 100 people online, room for 1,000, and a million records per workspace.
- **Before calling a backend change done,** run it against the load harness seed.
- **Queries are paged and indexed, with no N+1.** Counts and rollups over big sets run as jobs or incremental updates, never as full scans per request.

## Before you finish any backend change

- [ ] Input is validated with the shared schema.
- [ ] The action is authorised through the access door, with a test for the denied case.
- [ ] The change, value history, audit entry and change event are written in one transaction.
- [ ] The new id and version are returned.
- [ ] Errors use the standard shape.
- [ ] Slow work runs in a job.
- [ ] The change was checked against the scale budget.

For a second opinion, ask the `security-access-reviewer` agent, and `state-performance-reviewer` for anything touching realtime or load. The installed `api-and-interface-design`, `security-and-hardening` and `security-best-practices` skills go deeper.
