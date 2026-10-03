# 0009. Access model: decision record

## Context

Spec 0005 built the access door as a thin start: a signed in user plus a workspace address becomes the engine's scope when an active member row exists, and that member may then do everything. The scope is a plain object (`{ db, workspaceId, actor }`), so any code holding a database can build one for any workspace, and `SYSTEM_ACTOR`, which skips the engine's writer checks, is exported from the package's main entry. Tests in `apps/api` keep handlers from building scopes, but nothing stops a job, a script or a future module in `packages/core` from doing so.

The product now needs roles. The owner decided that schema changes (objects, attributes, options, layouts) are for admins only from now, and that a thin role (owner, admin, member) exists before the full roles and rules of #24. Features #13 to #22 are being designed in parallel, and each needs to know how to ask "may this person do this?" and "what may this person see?". Without one answer, each would check in its own way and some would forget.

The scope's promise for #9 and #24 is strict: an unknown role or missing rule means no access, a hidden field or record is simply absent (never shown as locked) in screens, live events, search, notifications, exports and the API, an API key is an actor with its own permissions, and the last owner can never be removed. Today several paths would break that promise once rules exist: live events on one shared channel name attribute ids and pair record ids by `mutationId`; `crm_search_text` is a security definer function that sees every value of an attribute; unique refusals quote other records' values; a link write moves the far record's `updated_at`; reference values show far records by name.

Forces: the engine is the one path for every object (spec 0004), and the API and the worker both call it; the scale budget is a million records per workspace with filters and sorts inside 300 ms p95; the team is one builder with AI help, so the model must be simple to reason about and hard to bypass by accident; Postgres row level security already holds tenancy and must keep doing so.

## Options considered

### Option 1: a sealed scope that carries a pure policy, checked by the engine at its choke points (chosen)

The door computes an `Access` value (permissions plus a data policy) and seals it into the scope. Pure functions answer every access question; the engine's few choke points (runner, write parser, record reader, query compiler, definition writes, relay filter) call them.

**Pros**: one place for the rules, used by the API and the worker alike; hidden data is cut where it's read, so every surface built on the engine inherits it; pure functions test cheaply over the whole grid; the open policy adds no SQL.
**Cons**: every engine service and test changes once; the checks live in the app, so a new path around the choke points would leak within a workspace (mitigated by the seal, the source scan and the table walk).

### Option 2: checks in the API, per procedure

Each oRPC procedure declares its permission in contract metadata, and middleware checks it before the handler runs; handlers filter results.

**Pros**: easy to see per procedure; no engine changes.
**Cons**: the worker, exports, notifications and the relay don't go through procedures, so they would need a second copy of the rules; field and record filtering in handlers repeats in every one and is easy to forget; it can't reach inside the query compiler, so a filter on a hidden field or a relationship hop through hidden records would still leak.

### Option 3: field and record rules in Postgres row level security

Roles and rules become session settings, and policies on `records` and `values` filter rows per principal.

**Pros**: the database enforces it even for a careless query.
**Cons**: policies per role and rule on the hottest tables cost on every row of every query at a million records; field hiding on the `values` table would make the query compiler's plans unpredictable; definer functions (`crm_search_text`, the relay's) bypass them anyway; rule changes would mean policy changes or complex session state; harder to test and to explain.

### Option 4: an external authorization engine (a relationship based service, or a policy language library)

Store relationships and policies in a dedicated engine and ask it per check.

**Pros**: proven models for complex sharing; audit tooling.
**Cons**: a new service to run, or a new language to learn, for a model that is flat roles plus three kinds of rule; per record checks at a million records need list filtering, which these engines answer poorly without a sync of every record; another moving part on the free Neon and Railway plans.

## Rationale

Option 1 is the only one that reaches every surface the scope names. Events, exports, notifications and jobs run in the worker, not through procedures, which rules out option 2; filters, counts and relationship hops are compiled SQL, which only a check inside the compiler can cover. Option 3 would put the rule cost on every row at the million record budget, and the two definer functions sidestep it. Option 4 adds operations for a model that is small. Row level security keeps doing what it is good at (tenancy), and the app does the fine grained part, as spec 0001 already said.

Per decision:
- **Flat permission names per role, in contracts**: the house rule (roles are flat lists, never a hierarchy), and the browser can hide controls from the same list.
- **Data levels apart from permissions**: what you may see changes per object, field and record; what you may manage is per workspace. Mixing them would make the table huge and the audience key unstable.
- **The seal (own, non enumerable symbol, frozen, matching seal)**: a type brand alone is erased at run time; the seal makes spread copies and prototype tricks fail too. Module level mutable registries (a WeakSet) would break the house rule against mutable module state.
- **One runner reads `scope.db`**: only 13 sites today, and one check point is easy to scan for.
- **`@crm/core/system` and `@crm/core/testing` subpaths**: lint can then forbid an import by path, which is simpler and stricter than forbidding a name.
- **`FORBIDDEN` only for visible things**: a missing permission on something you can see deserves a clear message; anything hidden answers as if absent.
- **Hidden filter means unknown attribute**: dropping it silently would show more rows than the person asked for.
- **Audience channels keyed by data policy**: members with the same view of the data share one channel, so with no rules it stays one channel per workspace; record rules get coarse events because per member record checks in the relay would cost a query per member per event.
- **Disconnect on an access change**: subscription tokens last 10 minutes; a disconnect makes a role change felt in about a second without shortening tokens for everyone.
- **`enterAsActor` for jobs**: a job that runs as the system would export or notify past the member's rules; entering again at run time also applies a removal made after the job started.
- **The last owner in the database too**: #23's screens and any future path (support tools, scripts) can't leave a workspace ownerless.
- **Rules injected only through the door's deps until #24**: proves the enforcement now without a production backdoor (no environment switch).
- **Options as schema** follows the owner's decision over #13's brief.

## Evidence

Read on 3 October 2026 from `feat/core-loop` at `977b5bc`:
- `packages/core/src/access/door.ts`: one query for the active member, no role; returns a plain object.
- `packages/core/src/engine/scope.ts`: `EngineScope` is a plain interface; `SYSTEM_ACTOR` is exported, and exported again from `packages/core/src/index.ts`.
- 13 direct `scope.db` uses in `packages/core/src` (definitions, query page, objects, history, records, write, lists, options).
- `apps/api/src/door.test.ts`: the contract walk, the `TAKEN_AWAY` context, and the scan that finds no `EngineScope`, `SYSTEM_ACTOR` or actor literal in `apps/api`.
- `packages/core/src/engine/values.ts` `checkWriter`: only system only types are refused for non system actors.
- `packages/core/src/engine/unique.ts`: `UNIQUE_HAS_DUPLICATES` lists up to 10 values with counts; the restore conflict names attribute titles and keys.
- `packages/core/src/engine/records.ts` `readRecords`: returns every attribute's value and every far reference.
- `packages/core/src/engine/query/compile.ts`: `CompileContext` and `Level` per hop, the natural place for a predicate per object.
- `packages/db/src/schema/workspaces.ts`: `members` has `status` but no role; `values.actor_member_id` exists for member attributes.
- Spec 0005's list of follow ups for #9 named the shared channel leak, the search function, the refusal messages, the far `updated_at` move, and the plain scope with an exported system actor; each is answered above.
