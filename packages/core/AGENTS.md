# packages/core

## Overview

The domain services the api and the worker share, and (from Access model, #9) the one access door every read and write passes. No HTTP lives here. Tagged `server`.

## Key files

| File | Owns |
|---|---|
| `src/index.ts` | The package's public services |
| `src/system/status.ts` | The pattern to copy: a deps interface plus one service function |
| `src/milestones/milestones.ts` | The milestones a workspace reaches once (spec 0010, AC-177): `reachMilestone` stores one in the write's transaction, `milestoneHook` reaches `first_record_created` for a member's first record. Core only returns what a write reached; the api sends the events |
| `src/validation/` | Validation rules (spec 0013): `rules.ts` writes an attribute's rules (replace semantics, `rule_count` and `rules_version` kept exact, the 20 rule limit) and checks the rules a record write touches under its lock (`checkRecordRules`); `pattern.ts` is the only server file that imports `re2js`; `bypass.test.ts` places every engine export and fails when a new write skips the rules |
| `src/views/` | Saved views (spec 0020): `seed.ts` (each object's default view, written by `insertObject`), `views.ts` (`listViews` in switcher order, `getView` with hidden columns cut, `saveViewQuery` under the view's row lock with its `VIEW_CHANGED` version check, the lock rule and `checkViewQuery`; every refusal for a view the caller can't see is one `NOT_FOUND`), `facts.ts` (`viewFacts`, the relay's read for spec 0009's `views` rule, system only, in `@crm/core/system`). A save records `Change.views`, so `outboxHook` stores one `views` row per object. `manage.ts` (milestone 2): `createView` (replay by id, limits, `NAME_TAKEN` on `name`), `updateView`, `setViewLayout` (`mergeLayout` keeps what the writer can't see), `moveView`, `setViewLocked`, `setDefaultView`, `deleteView`, `markViewOpened` (`member_view_state`, no outbox row) and `deleteMemberViews` (called by `removeMember`); who may do what is `viewRule` from `@crm/contracts/views`; object then view, both locked `for no key update` |

## Conventions

- A service is a function that takes its dependencies (`{ db, environment }`) and its input, and returns a type from `packages/contracts`.
- One folder per feature (`src/<feature>/`), exported through `src/index.ts`.
- Never import Hono, `@orpc/server` or `process.env`. The api and the worker pass in everything a service needs.
- Tenant data is read and written only through `db.withWorkspace()`, and (from #9) only with a scope the access door produced. See `crm-data-model-access`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
