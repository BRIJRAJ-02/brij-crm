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
| `src/availability/` | Availability schedules (spec 0035): `resolve.ts` (`defaultSchedule`, `scheduleFor`, `resolveMany`: a named schedule of the member's, else their stored default, else the virtual default in the caller's zone; `loadPage` and the page views resolve through it in one query, a page carrying its schedule's name) and `schedules.ts` (`listScheduleMembers`, whose schedules the reader may view: the Viewing Select's one service; list, get (an owner or admin sees every page using it; a colleague reading through a page they book on sees only those), create (a member's first schedule stores their virtual default beside it, so they keep one default), update with the `STALE` check, set default, duplicate, delete repointing pages to the default, `checkPageSchedule` for `SCHEDULE_NOT_ALLOWED`, and the default's hours behind `bookings.hours` and `setHours`); every write goes through `writeSchedules`, takes the member's schedules lock and records `Change.schedules`, one `schedules` outbox row, then hands what it changed to `afterScheduleChange` (empty: spec 0037's audit row and member notice attach there, AC-1444); `mayChange` and `targetMember` hold the one colleague check (`booking.admin`), and `mayEditOwnHours` the own one, so spec 0037 swaps each in one place |

## Conventions

- A service is a function that takes its dependencies (`{ db, environment }`) and its input, and returns a type from `packages/contracts`.
- One folder per feature (`src/<feature>/`), exported through `src/index.ts`.
- Never import Hono, `@orpc/server` or `process.env`. The api and the worker pass in everything a service needs.
- Tenant data is read and written only through `db.withWorkspace()`, and (from #9) only with a scope the access door produced. See `crm-data-model-access`.

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
