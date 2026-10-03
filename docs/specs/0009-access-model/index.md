# 0009. Access model: roles, permissions and one door

**Date**: 2026-10-03
**Status**: Proposed

## Summary

Every member now has a role (owner, admin or member), and each role is a flat list of named permissions; changing objects and attributes needs `schema.manage`, which owners and admins have. The access door that spec 0005 built now hands the engine a sealed scope that carries the member's permissions and a data policy (which objects, fields and records they may see), and the engine applies that policy at its few choke points, so whatever is hidden is simply absent from tables, records, history, counts, search, live events and exports. Rules per object, field and record are designed and enforced here but stay empty until #24 stores them and gives admins screens for them. It is built in three visible steps.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As the person who created a workspace, I want to be its owner, so nobody can take it away from me or lock me out.
- As an owner or admin, I want only owners and admins to change objects, attributes and options, so members can't reshape the data model by accident.
- As a member, I want to see what my role lets me do and not be offered actions I can't take, so the app never fails in my face.
- As an admin (from #24), I want a field or record I hide from a role to be gone everywhere that role looks: tables, record pages, search, counts, live updates, exports and the API.
- As the builder of every later feature, I want one set of access calls to use, so no feature invents its own check or forgets one.
- As the owner of this product, I want scopes nobody can forge and system power kept to the worker, so a bug in one handler can't read another workspace or act as the system.

**Acceptance criteria** (this spec owns the range AC-132 to AC-161, so every ID in the plan stays unique):
- **AC-132**: Every member has a role: `owner`, `admin` or `member`. Creating a workspace makes its creator the owner. The migration makes the earliest active member of each existing workspace (by `created_at`, then id) its owner and every other member a `member`.
- **AC-133**: Permissions are a fixed catalog of names in `packages/contracts`, and each role is a flat list of them, exactly as the permission table below says. A role never inherits from another. A test pins the table, so a change to it is a reviewed change.
- **AC-134**: Fail closed. A member whose role the code doesn't know is refused by the door with the same `NOT_FOUND` as a non member (and a warning is logged with the member id only). A permission or rule name the code doesn't know grants nothing. A principal with no data policy entry for an object gets `none` on it.
- **AC-135**: Every schema write needs `schema.manage`: `attributes.create` today, and every definition write #13 to #18 and #56 add (objects, attributes, options, relationships, groups, layouts, validation rules, computed attributes). A member calling one gets 403 `FORBIDDEN` with "Only workspace owners and admins can change objects and attributes." and nothing is written; an owner or admin succeeds.
- **AC-136**: `access.mine` returns the caller's role, its label and their permissions. The sidebar's workspace menu shows the role ("Owner", "Admin" or "Member"). A member sees no "Add attribute" on the People table, and a select cell offers no "Create option". The client uses this only to hide controls; the server checks every call on its own.
- **AC-137**: The last owner stays. Demoting or removing the only active owner of a live workspace is refused with 409 `LAST_OWNER`. A deferred database constraint also refuses any transaction that leaves a live workspace with no active owner, even one that skips the service. Only an owner may grant or take away the owner role; an admin may change members and admins between `member` and `admin` and remove them, never an owner; a member may change no roles.
- **AC-138**: Scopes can't be forged. Only the door's minting functions make an `EngineScope`; an object literal, a spread copy or an object built on a real scope's prototype is refused by every engine service at run time, and an object literal doesn't type check. `SYSTEM_ACTOR` and `systemScope` come only from `@crm/core/system`, which lint allows only in the worker entry, `apps/api/src/jobs/**`, `apps/api/src/realtime/**` and `packages/core/scripts/**`; `testScope` comes only from `@crm/core/testing`, allowed only in tests and scripts. A source scan finds no `scope.db` in `packages/core` outside the one runner.
- **AC-139**: Every service `@crm/core` exports that takes a scope has an entry in the access table (its permission, or the data check it makes). A table driven test calls each with a principal that lacks the access and gets the refusal; the test fails when an exported service has no entry.
- **AC-140**: A hidden object (data level `none`) is left out of `objects.list`, and every read or write naming it, its attributes or its records answers `NOT_FOUND` with the same message as an unknown id.
- **AC-141**: A hidden field is left out of `attributes.list`, `RecordView.values`, value history, values as of a date, time in stage, and the event's attribute ids. A filter or sort naming it, directly or through a relationship, is refused `FILTER_INVALID` exactly as an unknown attribute is, and a contains on it never reaches `crm_search_text`. A write naming it is refused `NOT_FOUND` as an unknown attribute.
- **AC-142**: A read only field comes in `attributes.list` with `readOnly: { reason }`, and a write to it is refused `ATTRIBUTE_READ_ONLY` with that reason. On an object the principal may only read, every attribute carries the object's reason, and a create, edit, delete or restore is refused 403 `FORBIDDEN`. The grid shows the reason on the cell (the library's read only state).
- **AC-143**: Records outside a principal's record rule are absent: left out of `records.query` pages, `records.get`, `records.count` (which counts only what may be seen), search results, reference values (the far id and its display), and history. A write or a link naming one answers `NOT_FOUND`. A write that replaces a multi reference value keeps the links to far records the writer can't see.
- **AC-144**: No refusal message names a value or a record the actor can't read. `UNIQUE_CONFLICT` never names the other record; `UNIQUE_HAS_DUPLICATES` lists values only when the actor sees every record and the field on that object, and gives a count otherwise; a restore conflict names only attributes the actor can see.
- **AC-145**: Live events go to audiences. The relay publishes each outbox event to every audience channel of the workspace (`workspace:<id>.<policyKey>`), filtered for that audience: events about an object at `none` are dropped, hidden attribute ids are removed, record ids of an object under a record rule are removed and the event is marked `coarse`, and `mutationId` is left out when anything was removed. `realtime.subscriptionToken` signs only the caller's own audience channel. Today every member shares the audience `open`, and AC-38's one second p95 still holds.
- **AC-146**: Access changes reach open screens. A role change or a removal (and, from #24, a rule change) stores an outbox row of kind `access`; the relay disconnects the affected users from Centrifugo within one second; their app reloads `access.mine`, the definitions and the records it holds through the door, and subscribes to its new channel. A removed member's next request gets `NOT_FOUND`.
- **AC-147**: Work a member starts runs as that member. The worker gets a scope for it only through `enterAsActor`, which reads the member's current role and rules at run time; a member removed between the start and the run is refused `NOT_FOUND`, and one demoted runs with the new role. The system scope is used only for system work (purge, recompute, the relay).
- **AC-148**: An API key is a principal with its own scopes. `keyAccess(scopes)` builds its access from the key scope catalog: chosen permissions, capped so a key can never hold `members.manage`, `access.manage`, `billing.manage`, `workspace.delete` or `support.grant`, and a data level of `read` or `write` on every object. An unknown scope grants nothing. #34 stores keys and calls `enterWithKey`.
- **AC-149**: The door stays one database round trip (the member row, now with its role; #24 adds one rule read and measures it), and adds at most 5 ms p95 per request locally. With the `open` policy, the compiled SQL of every page, count and search is the same as before this spec (a test compares the text), so the million record benchmark is unchanged.
- **AC-150**: The pure policy functions (`can`, `objectLevel`, `fieldLevel`, `recordRule`, `filterRecordView`, `filterEvent`, `keyAccess`) are unit tested over the whole grid of role, object level, field level and record rule, including every fail closed default.

## Decision

**Chosen option**: Option 1: a sealed scope that carries a pure policy, checked by the engine at its choke points.

The door turns a principal (member, API key, the system) into a sealed `EngineScope` holding an `Access` value (permissions plus a data policy); pure functions in `packages/core/src/access/` answer every question about it, and the engine's few choke points (the runner, the record reader, the query compiler, the write parser, the definition writes, the relay's event filter) call them, so no handler checks anything by hand.

Decisions taken from the brief and the owner decisions, recorded here so they can be confirmed:
- **Thin roles now** (owner decision): `owner`, `admin`, `member`; `schema.manage` for owner and admin. The fourth role #23 names is left to #23 (recommended: `guest`, read only on the objects shared with it).
- **Options are schema** (owner decision: "objects, attributes, options, layouts: admins only"): creating an option from a cell needs `schema.manage`. This overrides #13's brief, which allowed it for everyone.
- **Admins get everything but five owner only permissions** (recommendation): `workspace.delete`, `workspace.export`, `billing.manage`, `support.grant`, and the owner role itself.
- **Members may export what they can see** (recommendation, Attio's default): `records.export` for every role.
- **Delete forever and empty trash** need `records.purge`, owners and admins (#22's brief).
- **Hidden in a filter means unknown**: a filter on a hidden field is refused as if the field didn't exist, never silently dropped (a silently dropped filter would show more rows than asked for).
- **Rollups count every record** (#16's brief): a rollup's count may include records a viewer can't open. Its value is hidden when any of its inputs is hidden (strictest of inputs).
- **A task is visible** when it has no linked records, or the viewer is its assignee or creator, or at least one linked record is visible; links to hidden records are left out (#19's "access follows the record").
- **Proof before #24**: rules are enforced here but no rule table exists until #24, so tests inject rules through the door's `rules` dependency. Nothing in production can inject them.

**Implementation skills**: `crm-data-model-access` (house, `.claude/skills/crm-data-model-access/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `security-best-practices` (`openai/skills`, `.claude/skills/security-best-practices/`) · `api-and-interface-design` (`addyosmani/agent-skills`, `.claude/skills/api-and-interface-design/`) · `domain-modeling` (`mattpocock/skills`, `.claude/skills/domain-modeling/`) · `system-design` (`anthropics/knowledge-work-plugins`, `.claude/skills/system-design/`) · `zod` (`pproenca/dot-skills`, `.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

- **#10 core loop** (in progress): milestone 1 needs only its door and `member` base (built). Milestone 2 changes the record procedures #10's milestone 2 adds; if they aren't merged yet, it changes the engine services they call and they inherit the checks. Milestone 3 needs #10's outbox, relay and Centrifugo namespace (its milestone 3).
- **#6 client data**: the data layer reloads access, definitions and held records when it reconnects after a disconnect, and turns `readOnly` into the cell's reason (through `toFieldAttribute`). It never decides access.
- **#7 realtime** (thin slice built here): audience channels, the event filter in the relay, the `access` outbox kind and the disconnect on an access change. #7 keeps them and adds history and recovery per audience.
- **#8 background jobs** (thin slice built here): `enterAsActor`, the one way a job gets a scope for the member who started it. #8 stores the actor on each job row and calls it; no job runner is built here.
- **#23 members and teams** (thin slice built here): `setMemberRole` and `removeMember` in `packages/core` with the owner rules and the last owner guard. #23 adds the procedures, the screens, invites and teams (the policy already carries `teamIds`, empty until then).
- **#24 access rules**: adds the rule tables sketched below, the `RuleSource` that reads them, and the screens. Nothing in this spec's enforcement changes.
- **#34 public API**: adds the `api_keys` table and `enterWithKey`; the key's access comes from `keyAccess` built here.

### The model

**Principal**: who is acting. `{ kind: 'member', memberId, userId, role, teamIds }`, `{ kind: 'api_key', keyId, scopes }`, or `{ kind: 'system' }`. The actor stored on rows (`created_by`, `set_by`) is derived from it as today.

**Permissions** are workspace level actions, flat per role. **Data levels** say what a principal may do with data: per object `none`, `read` or `write`; per field `hidden`, `read` or `write`; per object an optional record rule (`own` or `team`, through a member attribute) that narrows which records are visible. Writing data needs `write` on the object and on the field; changing the object's definition needs `schema.manage`.

**Permission catalog** (`packages/contracts/src/access.ts`, `PERMISSIONS` and `ROLE_PERMISSIONS`; each entry also carries its refusal message):

| Permission | What it allows | Owner | Admin | Member | First used by |
|---|---|---|---|---|---|
| `workspace.manage` | rename the workspace, change its settings | yes | yes | | #23 |
| `workspace.delete` | delete the workspace | yes | | | #23 |
| `members.invite` | invite people | yes | yes | | #23 |
| `members.manage` | change roles (owner rules apply), remove members | yes | yes | | #23 (services built here) |
| `teams.manage` | create teams and change who is in them | yes | yes | | #23 |
| `access.manage` | object, field and record rules | yes | yes | | #24 |
| `schema.manage` | objects, attributes, options, relationships, groups and layouts, validation rules, computed attributes, drawing on the schema map | yes | yes | | #10 (`attributes.create`), #13 to #18, #56 |
| `views.manage` | lock and unlock shared views, change a locked one | yes | yes | | #20 |
| `records.purge` | delete forever, empty the trash | yes | yes | | #22 |
| `records.export` | export the records and fields you can see | yes | yes | yes | #30 |
| `api_keys.manage` | create and revoke API keys | yes | yes | | #34 |
| `webhooks.manage` | subscribe and manage webhooks | yes | yes | | #35 |
| `automations.manage` | build and run automations | yes | yes | | #53 |
| `audit.read` | read the audit log | yes | yes | | #36 |
| `workspace.export` | download the full workspace export | yes | | | #37 |
| `billing.manage` | plans and payment | yes | | | #38, #42 |
| `support.grant` | grant support access to the workspace | yes | | | #39 |

Every role's data level is `write` on every object and field, with no record rule, until #24 adds rules. Owner role changes follow the owner rules in AC-137, not a permission.

**Key scope catalog** (for #34): any permission above except `members.manage`, `members.invite`, `access.manage`, `teams.manage`, `billing.manage`, `workspace.delete`, `support.grant`; plus a data level, `read` or `write`, applied to every object.

### Code shape

`packages/core/src/access/`:

```ts
/** What a principal may do: its permissions and its data policy. Built only here. */
export interface Access {
  readonly principal: Principal;
  readonly permissions: ReadonlySet<Permission>;
  readonly data: DataPolicy;
}

/** What a principal may see and change. A missing object entry means `defaultObject`; unknown means `none`. */
export interface DataPolicy {
  readonly defaultObject: ObjectLevel;                       // 'write' for the three roles until #24
  readonly objects: ReadonlyMap<string, ObjectLevel>;        // object id → none | read | write
  readonly fields: ReadonlyMap<string, FieldLevel>;          // attribute id → hidden | read | write (never above its object)
  readonly records: ReadonlyMap<string, RecordRule>;         // object id → { kind: 'own' | 'team', attributeId }
  readonly key: string;                                      // 'open' when nothing is restricted, else a hash
}
```

- `policy.ts` (pure): `roleAccess(role, rules)`, `keyAccess(scopes)`, `can(access, permission)`, `objectLevel`, `fieldLevel` (the stricter of the field and its object), `recordRule`, `visibleAttributes(access, attributes)`, `filterRecordView(access, view)`, `filterEvent(access, event)`, `policyKey(data)`, `readOnlyReason(access, attribute, object)`.
- `mint.ts`: the seal. A scope is a frozen object with an own, non enumerable property under a module private `Symbol`, whose value is a frozen seal holding the same `workspaceId` and actor id. `checkScope(scope)` refuses (an unexpected error, so a 500 `INTERNAL`) a scope without that own property, a seal that doesn't match, or a scope that isn't frozen. A spread copy loses the property, and an object built on a scope's prototype has it only through the prototype, so both fail. The `EngineScope` type carries `readonly [SEALED]: Seal` with the symbol's `unique symbol` type, so an object literal doesn't type check outside this module.
- `run.ts`: `inWorkspace(scope, work)` and the existing `runWrite` are the only places that read `scope.db`; both call `checkScope` first. The 13 direct `scope.db.withWorkspace` calls in `packages/core` move to `inWorkspace`.
- `door.ts`: the minting functions (below).
- `table.ts`: the access table, one entry per exported service: `{ permission }`, `{ data: 'read' | 'write' }` or `{ owner rules }`.

**`EngineScope`** becomes `{ db, workspaceId, actor, access, limits?, [SEALED] }`.

**The minting functions** (the only ways to get a scope):

| Function | Where it may be called | What it does |
|---|---|---|
| `enterWorkspace(deps, { userId, slug })` | `apps/api` `member` middleware | As today, plus the member's `role`; an unknown role refuses `NOT_FOUND` (AC-134); loads rules through `deps.rules` (`NO_RULES` until #24) |
| `enterAsActor(deps, { workspaceId, actor })` | `@crm/core/system`: the worker's jobs | For a job a member started: the active member's current role and rules, else `NOT_FOUND` |
| `enterWithKey(deps, { workspaceId, keyId })` | `apps/api` (from #34) | Signature only here; #34 reads the key and calls `keyAccess` |
| `systemScope(db, workspaceId)` | `@crm/core/system`: the worker, the relay, core scripts | The system actor with every permission and the open policy |
| `testScope({ db, workspaceId, actor, role?, rules?, limits? })` | `@crm/core/testing`: tests and scripts | The same seal, for tests |

`createUserWorkspace` keeps making its bootstrap system scope inside `packages/core` through `mint.ts`. `SYSTEM_ACTOR` leaves the main `@crm/core` export.

### Choke points (where the engine applies the policy)

| Choke point | What it does with `scope.access` |
|---|---|
| `inWorkspace`, `runWrite` | `checkScope`; nothing reaches the database without a sealed scope |
| definition writes (`defineObject`, `defineAttribute`, `updateAttribute`, archive and restore, `defineOption`, `updateOption`, `defineRelationship`, `defineList`, `updateObject`, `setObjectArchived`) | `can(access, 'schema.manage')`, else `FORBIDDEN` |
| `listObjects`, `listAttributes`, `loadAttributes` for a principal | leave out `none` objects and `hidden` fields; add `access` per object and `readOnly` per attribute |
| `parseAll` (every record and entry write) | object level `write` (else `FORBIDDEN`), field level `write` (else `ATTRIBUTE_READ_ONLY` with the reason; `hidden` answers `NOT_FOUND` as an unknown attribute), beside today's `checkWriter` |
| record locking in writes, deletes, restores and links | the record rule as an extra condition on the locking select; a record outside it is `NOT_FOUND`; far records in a link write must be visible, and the far record's `updated_at` and `updated_by` move as part of the link without a check of their own; replacing a multi reference keeps hidden far links |
| `readRecords` | `filterRecordView`: hidden values left out; reference values lose far records the principal can't see (their object at `none`, or outside its record rule) |
| query compiler (`CompileContext.access`) | every attribute in a filter or sort, at every hop, must be visible (else `FILTER_INVALID`, "That attribute is not on this object."); each `Level` adds the record rule predicate of its object, at the base and inside every relationship hop; a contains is checked before `crm_search_text` is called |
| `countMatches` | the same compiled predicate, so counts count only visible records |
| history (`getHistory`, `getValuesAsOf`, `getTimeInStages`) | hidden attributes left out; a record outside the rule is `NOT_FOUND` |
| refusal builders (`unique.ts`, `values.ts`) | messages built from what the principal can see (AC-144) |
| the relay (`filterEvent` per audience) | see Live events |

The record rule predicate (for #24, compiled once per `Level`): `exists (select 1 from values v where v.owner_id = <level>.id and v.attribute_id = $rule_attribute and v.active_until is null and v.actor_member_id = any($members))`, where `$members` is the member themself (`own`) or every member of their teams (`team`). With no rule nothing is added, so the open policy's SQL is unchanged (AC-149). #24 adds the index it needs and measures it on the million record seed.

### Live events

- Audience: the data policy's `key` (`policyKey`): `open` when nothing is restricted, else the first 16 hex characters of the SHA-256 of the policy's canonical JSON. Members with equal data policies share one audience, whatever their role.
- Channel: `workspace:<workspaceId>.<key>` in the existing `workspace` namespace. `realtime.subscriptionToken` returns the member's own channel (the client already takes the channel from that answer).
- The relay asks `audiences(workspaceId)` (the distinct data policies of active members, read inside `withWorkspace`; just `open` until #24) and, per pending event, publishes `filterEvent(policy, event)` to each audience whose filtered event is not empty, with idempotency key `<workspace>:<seq>:<key>`.
- `filterEvent`: drops an event whose object is `none`; removes hidden attribute ids; for an object under a record rule, removes its record ids and sets `coarse: true` (the client refetches the records it holds through the door); leaves out `mutationId` when it removed anything; a `definitions` event passes when its object is visible, with hidden attribute ids removed.
- Access changes: `setMemberRole`, `removeMember` (and #24's rule writes) store an outbox row `kind: 'access'` with `member_ids`. The relay reads those members' `user_id` inside `withWorkspace` and calls Centrifugo's server `disconnect` for each user. The client reconnects, reloads `access.mine`, the definitions and its held records, and gets its new channel.
- Rollout: for one release the relay also publishes the `open` audience's events to the old `workspace:<id>` channel, so browsers open across the deploy keep updating until they reconnect.

### Call sites every later feature uses

| Feature | Call it uses | Rule |
|---|---|---|
| any new service | `inWorkspace` or `runWrite` with the scope it was given, plus an access table entry | AC-138, AC-139 |
| #13, #14, #15, #16, #18, #56 schema writes | the definition writes, which check `schema.manage` | AC-135 |
| #13 "Create option" from a cell | `defineOption`; the cell shows it only when `access.mine` lists `schema.manage` | owner decision |
| #15 links | `links.add` and `links.remove` through the record write path: near field `write`, far records visible | AC-143 |
| #16 computed attributes | `fieldLevel` treats a computed attribute as `hidden` when any input is hidden; always read only; written by `systemScope` | brief |
| #17 record page and activity | `getRecords`, history reads; activity is built from them, so hidden fields never appear | AC-141 |
| #19 notes and tasks | a note follows its record (`recordVisible`); a task follows the rule in the Decision | Decision |
| #20 saved views | a view whose filter or sort names a hidden field is left out for that member (`visibleAttributes`); `views.manage` for locks | brief |
| #21 board | `readOnly` reasons on cards and columns; drag needs field `write` | brief |
| #22 bulk actions and trash | the job runs under `enterAsActor`; "all matching" snapshots ids through the compiled predicate; trash lists only visible records; `records.purge` | AC-147 |
| #28 notifications | a recipient is notified only if `recordVisible(recipientAccess, ref)` and the field is visible; items render through the door when read | AC-143 |
| #30 export | a job under `enterAsActor`; columns from `visibleAttributes`, rows from the compiled predicate; `records.export` | AC-147 |
| #33 global search | the query compiler per object, so hidden fields are never searched and hidden records never match | AC-141, AC-143 |
| #34 API | `enterWithKey`, `keyAccess` | AC-148 |
| #35 webhooks | each delivery filtered by `filterEvent` with the subscribing key's access, then read through the door | AC-145 |
| #36 audit log | `audit.read`; entries about hidden records stay visible to holders of `audit.read` only | catalog |
| #53 automations, #54 AI assistant | run under `enterAsActor` as the member who built or asked; paused when that member is removed | AC-147 |

### Data model sketch

Built here (one migration, milestone 1, plus one in milestone 3):

| Table | Change | Rules |
|---|---|---|
| `members` | `role` `member_role` enum (`owner`, `admin`, `member`) not null default `member` | Backfill in the migration: per workspace, the earliest active member by `created_at`, then id, becomes `owner`. `createUserWorkspace` inserts the first member as `owner`. |
| `members` | constraint trigger `members_keep_an_owner`, `deferrable initially deferred`, after update of `role`, `status` or delete, for each row | When the old row was an active owner and its live workspace has no active owner left at commit, raise `LAST_OWNER` (SQLSTATE `P0001`, mapped to the refusal). Runs as the caller, under row level security, so it sees only its own workspace. |
| `outbox` (milestone 3) | `kind` gains `access`; new `member_ids` uuid[] not null default `{}` | Ids only, like every event. |

Designed here, built by #24 (so the policy shape fits): `access_rules` (`workspace_id`, `id`, `subject_type` role or team, `subject`, `target_type` object or attribute, `target_id`, `level`, audit columns; forced row level security) and `record_rules` (`workspace_id`, `id`, `subject_type`, `subject`, `object_id`, `kind` own or team, `attribute_id` (a member attribute)). A rule row the code can't parse denies the whole object for its subject (fail closed). Teams (`teams`, `team_members`) come with #23.

### API surface

| Procedure or service | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `access.mine` (new) | `workspace` | `{ role, roleLabel, permissions: Permission[] }` | member | 404 |
| `objects.list` (changed) | `workspace` | objects at `read` or `write` only, each with `access: 'read' \| 'write'` | member | 404 |
| `attributes.list` (changed, from #10) | `workspace`, `objectId` | visible attributes only, each with `readOnly?: { reason }` | member | 404 |
| `attributes.create` (changed, from #10) | as #10 | as #10 | member with `schema.manage` | 403 `FORBIDDEN` |
| `records.query`, `records.count`, `records.get` (changed, from #10) | as #10 | only visible records and values | member, data `read` | 404, 422 `FILTER_INVALID` |
| `records.create`, `records.setValues` (changed, from #10) | as #10 | as #10 | member, data `write` | 403 `FORBIDDEN`, 404, 422 `ATTRIBUTE_READ_ONLY` |
| `realtime.subscriptionToken` (changed, from #10) | `workspace` | `{ channel: 'workspace:<id>.<key>', token }` | member | 404 |
| `setMemberRole(scope, { memberId, role })` (core service; procedure in #23) | member id, role | the member | `members.manage` plus owner rules | 403 `FORBIDDEN`, 404, 409 `LAST_OWNER` |
| `removeMember(scope, { memberId })` (core service; procedure in #23) | member id | none | `members.manage` plus owner rules | 403 `FORBIDDEN`, 404, 409 `LAST_OWNER` |

**Status codes**: new 403 `FORBIDDEN` (a workspace permission missing, or a write on an object the principal may only read: the thing is visible, the action isn't allowed) and 409 `LAST_OWNER`. Anything hidden answers 404 `NOT_FOUND` or 422 `FILTER_INVALID` exactly as if it didn't exist. A read only field keeps 422 `ATTRIBUTE_READ_ONLY`. A forged scope is a programming error: 500 `INTERNAL`, logged.

### Value sourcing

| Action | Value produced or displayed | Source |
|---|---|---|
| door | the member's role | `members.role`, read in the door's one query |
| door | permissions | `ROLE_PERMISSIONS[role]` in `packages/contracts/src/access.ts`; an unknown role refuses |
| door | data policy | `defaultObject: 'write'` for every role, plus the rules from `deps.rules` (`NO_RULES` until #24's tables) |
| door | team ids | empty until #23's `team_members` |
| workspace create | the first member's role | `owner`, set by `createUserWorkspace` |
| migration | who becomes owner | the earliest active member per workspace by `created_at`, then id |
| `access.mine` | `roleLabel` | `ROLE_LABELS` in contracts: "Owner", "Admin", "Member" |
| any `FORBIDDEN` | its message | the permission's catalog entry (for `schema.manage`: "Only workspace owners and admins can change objects and attributes."); for a read only object: "You can view <plural name> but not change them." |
| `LAST_OWNER` | its message | fixed in contracts: "A workspace needs an owner. Make someone else an owner first." |
| `attributes.list` | `readOnly.reason` | `readOnlyReason()`: the object's reason, else the field rule's ("Your role can't change <title>."), else today's system and archived reasons |
| `objects.list` | `access` per object | `objectLevel(access, objectId)` |
| records reads | which values appear | `filterRecordView`: `fieldLevel` per attribute, record visibility per far reference |
| page and count | which records match | the compiled record rule predicate per `Level` (none until #24) |
| events | the audience key | `policyKey(data)`: `open`, or 16 hex characters of SHA-256 over the canonical JSON |
| events | the channel | `workspace:<workspaceId>.<key>` |
| events | which audiences exist | `audiences(workspaceId)`: distinct data policies of active members |
| access change | the users to disconnect | the `access` outbox row's `member_ids`, mapped to `members.user_id` by the relay |
| job | who it acts as | the actor stored on the job row (#8), entered again by `enterAsActor` at run time |
| API key | its permissions and data level | the key's stored scopes (#34) through `keyAccess` |
| `UNIQUE_HAS_DUPLICATES` | values or a count | values when the policy has no record rule and the field is visible on that object, else "N values are used by more than one record" |

### Key invariants

- Only the minting functions make a scope; every engine path to the database checks the seal first.
- A principal's access is computed once per request (or per job run) by the door, never cached across requests, so a role change applies on the next request.
- Hidden is absent: a hidden object, field or record answers exactly as one that doesn't exist, in every read, filter, count, search, event, refusal message and export.
- Permissions never inherit; a role is the list in the table.
- Fail closed: an unknown role, permission, scope or rule grants nothing.
- A field is never more open than its object.
- A live workspace always has at least one active owner, enforced by the database at commit.
- A write never removes data the writer can't see (hidden far links stay).
- The client's copy of access only hides controls; every check is on the server.
- Work started by a member runs as that member; the system scope is for system work only.

### Security model

- Tenancy stays with forced row level security and `withWorkspace`; this spec adds the fine grained layer above it in `packages/core`, so the API and the worker share it.
- Role and rule data live in tenant tables under row level security; the door reads them inside `withWorkspace`.
- The scope's seal stops a handler or a job from building a scope for another workspace or the system; lint keeps `@crm/core/system` to the worker, jobs and the relay, and `@crm/core/testing` to tests.
- Owner rules: only an owner touches the owner role; the database keeps one owner per live workspace.
- Events carry ids only and are filtered per audience; a subscription token is signed only for the caller's own audience; an access change disconnects the affected users.
- Refusals never quote what the actor can't read.
- An API key can never manage members, rules, billing or support access, or delete the workspace.
- `security-access-reviewer` reviews every milestone before it lands; `state-performance-reviewer` reviews milestones 2 and 3 (the compiled predicate and the relay fan out).

### Configuration required

No new environment variables. The relay already holds `CENTRIFUGO_API_URL` and `CENTRIFUGO_API_KEY`, which the disconnect call uses.

### Critical test scenarios

- Roles: a new workspace's creator is owner; the migration on a copy of production data makes one owner per workspace, verifies **AC-132**.
- Catalog: the pinned role table; an unknown role in the database refused at the door; an unknown scope granting nothing, verifies **AC-133**, **AC-134**, **AC-148**, **AC-150**.
- Schema writes: a member's `attributes.create` gets 403 and writes no attribute and no outbox row; an admin's succeeds; the People table shows no "Add attribute" to a member (Playwright, locally, with a seeded member), verifies **AC-135**, **AC-136**.
- Last owner: demote the only owner, remove the only owner, and a raw `update members set role = 'member'` as the app role: all refused; two owners, one demoted: allowed; an admin trying to make an owner: refused, verifies **AC-137**.
- Forgery: an object literal, a spread copy with another `workspaceId`, an `Object.create(scope)` override, and an unfrozen copy all refused by `listAttributes` and `runWrite`; the lint rule and the source scan catch an import of `@crm/core/system` in a handler, verifies **AC-138**.
- The access table walk: every exported service denied for a principal without access, and the walk fails on a new unlisted export, verifies **AC-139**.
- Hidden is absent (rules injected through `deps.rules`): a hidden object, a hidden field, a read only field, a read only object and an `own` record rule, each checked in `objects.list`, `attributes.list`, `records.query`, `records.count`, `records.get`, a filter through a relationship, a contains, history, a reference value, a multi reference replace that keeps hidden links, and the unique refusal messages, verifies **AC-140** to **AC-144**.
- Events: with two audiences injected, one event published filtered to each; a hidden attribute id never reaches the restricted channel; a subscription token for another audience's channel is never signed; two browsers on the `open` audience still within one second, verifies **AC-145**.
- Access change: changing a seeded member's role (local script) disconnects their browser, which drops "Add attribute" without a reload, verifies **AC-146**.
- Jobs: `enterAsActor` for a removed member refused, for a demoted one carrying the new role, verifies **AC-147**.
- Cost: the door's added time measured; the compiled SQL text under the open policy equal to the pre change text for the benchmark grid's queries, verifies **AC-149**.

## Build plan

Tracer Bullet: each milestone ends with something you can see, in production where it applies.

**Milestone 1: roles, the sealed scope and schema permission, in production**
1. Contracts: `PERMISSIONS`, `ROLE_PERMISSIONS`, `ROLE_LABELS`, the key scope catalog, `FORBIDDEN` (403) and `LAST_OWNER` (409) in the error map, the `access.mine` contract, satisfies **AC-133**, **AC-135**, **AC-137**
2. Migration: `member_role`, `members.role` with the owner backfill, the `members_keep_an_owner` constraint trigger and its refusal mapping; `createUserWorkspace` makes the creator owner; guard tests updated, satisfies **AC-132**, **AC-137**
3. `packages/core/src/access/`: `policy.ts` (pure, with the full grid of unit tests), `mint.ts` (the seal), `run.ts` (`inWorkspace`), the door's minting functions, `@crm/core/system` and `@crm/core/testing` subpaths; move the 13 `scope.db` sites and every test and script to the new functions; lint rules and the source scan, satisfies **AC-134**, **AC-138**, **AC-148**, **AC-150**
4. The access table and its walking test; `schema.manage` on every definition write; `setMemberRole` and `removeMember` with the owner rules, satisfies **AC-135**, **AC-137**, **AC-139**
5. API and web: `access.mine`; the role in the workspace menu; "Add attribute" and "Create option" shown only with `schema.manage`; a local only script that adds a member with a chosen role to a workspace, for the member's view, satisfies **AC-135**, **AC-136**
6. Measure the door's added time; deploy; check the owner backfill in production (one owner per workspace); `security-access-reviewer` before it lands, satisfies **AC-132**, **AC-149**

**Milestone 2: hidden means absent, in every read and write**
7. `RuleSource` in the door's deps (`NO_RULES` in production); `listObjects` and `listAttributes` filtered with `access` and `readOnly`, satisfies **AC-140**, **AC-141**, **AC-142**
8. Writes: object and field levels in `parseAll`; the record rule on every locking select; far record visibility in link writes; hidden far links kept on replace, satisfies **AC-142**, **AC-143**
9. Reads: `filterRecordView` in `readRecords`; history reads; the query compiler's attribute checks at every hop, the record predicate per `Level`, the contains check before `crm_search_text`; counts; the open policy SQL text test, satisfies **AC-141**, **AC-143**, **AC-149**
10. Refusal messages: unique conflicts, duplicates and restore conflicts built from what the actor sees, satisfies **AC-144**
11. The grid's read only reasons wired through `toFieldAttribute`; a local Playwright run with rules injected into a test server (`apps/api/test/`) showing a hidden column and hidden rows absent from the People table; `security-access-reviewer` and `state-performance-reviewer` before it lands, satisfies **AC-140** to **AC-143**

**Milestone 3: live events, access changes and jobs**
12. Migration: `outbox.kind` `access` and `member_ids`; `policyKey`, `audiences`, `filterEvent`; the relay publishes per audience (and to the old channel for one release); `realtime.subscriptionToken` signs the member's audience channel, satisfies **AC-145**
13. `setMemberRole` and `removeMember` store the `access` row; the relay disconnects the affected users; the client reloads access, definitions and held records on reconnect, satisfies **AC-146**
14. `enterAsActor` in `@crm/core/system` with its tests, ready for #8, satisfies **AC-147**
15. Two browsers locally: a role changed by the local script drops "Add attribute" in the other browser without a reload; the production two browser timing (AC-38) run again on the new channel; results in `verify.md`; `security-access-reviewer` and `state-performance-reviewer` before it lands; remove the old channel publish in the next release, satisfies **AC-145**, **AC-146**, **AC-149**

## Migration plan

**Strategy**: expand, then switch, in three deploys (one per milestone).
**Phases**:
1. The `members.role` column arrives with a default and the backfill in one migration; code that ignores it keeps working. The trigger only enforces what the backfill makes true.
2. The sealed scope ships with the door that reads `role`. It changes code only, inside one image.
3. The relay publishes both to the old `workspace:<id>` channel and to the audience channel for one release, so browsers open across the deploy keep updating; the next release stops the old publish.

**Rollback**: revert the code; the `role` column, its default and the trigger stay and stay true. The `access` outbox rows are ignored by the old relay (it publishes `records` and `definitions` only).
**Risks**: a workspace whose earliest member was removed gets no owner from the backfill (the backfill takes the earliest active member, and a workspace with none is logged and left for #23); a test that builds scopes by hand fails to compile until moved to `testScope` (expected, mechanical).

## Consequences

**Positive**:
- One place answers every access question, and the engine applies it, so the API, the worker, exports, search and events can't drift apart.
- Scopes can't be forged, and system power stays in the worker.
- #24 only adds rule storage and screens; the enforcement and its tests already exist.
- The owner can never be locked out of their workspace.

**Negative / tradeoffs**:
- Every engine service and every test that builds a scope changes (mechanical, one milestone).
- Field and record rules are proven only with injected rules until #24 ships; nothing in production exercises them.
- The record rule predicate adds a correlated `exists` per row and per hop; its cost at a million records is unmeasured until #24 and #12.
- An audience under a record rule gets coarse events and refetches what it holds, more requests than a precise event.
- Each extra audience multiplies the relay's publishes per event.
- A rollup may count records a viewer can't open (accepted from #16's brief).
- Members can export what they see; an admin who wants to stop that waits for #24's rule screens.
- The access check runs in the app, not in Postgres; a service that skips the choke points would leak within its workspace, which is why the table walk and the source scan exist.

**Neutral**:
- Two migrations (roles and the owner guard; the `access` outbox kind).
- New package subpaths `@crm/core/system` and `@crm/core/testing`, and two lint rules.
- No new dependencies.

## Follow-up

- [ ] **#23**: the fourth role (recommended `guest`, read only on shared objects); `members.setRole` and `members.remove` procedures and screens on the services built here; teams feed `teamIds`; owner transfer.
- [ ] **#24**: `access_rules` and `record_rules` tables and their `RuleSource`; the index the record predicate needs, measured on the million record seed; whether a record rule may also allow read but not write per record.
- [ ] **#34**: the `api_keys` table and `enterWithKey` on `keyAccess`.
- [ ] **#8**: store the actor on each job row and run member work through `enterAsActor`.
- [ ] **#7**: history and recovery per audience channel; drop the old channel publish after one release.
- [ ] **#12**: measure the relay's fan out with several audiences, and the door's cost at 100 online.
- [ ] **#13**: the cell's "Create option" is admins only (owner decision overrides #13's brief).
- [ ] `/sync`: `packages/core/AGENTS.md` should name `access/` as the door and the rule that services reach the database only through `inWorkspace` or `runWrite`; `apps/api/AGENTS.md` should name the `@crm/core/system` import rule.
