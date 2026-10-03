# 0005. The core loop: sign in, a workspace, People, live

**Date**: 2026-10-03
**Status**: Proposed

## Summary

This is the first time the CRM becomes something you can use. A person signs in with a code sent by email (or with Google), names a workspace, lands on the People table, adds a column, creates and edits people, and a second browser sees every change within a second. To get there it builds only the thin parts of the client data layer (#6), live updates (#7), sign in and access (#9) and edge only API access (#57) that this one path needs; the rest of those features comes later. It is built in four visible steps, each running in production.

## Structure

- [0005-sign-in-and-access.md](0005-sign-in-and-access.md): sign in by email code and Google, the sign up allowlist, sessions, the workspace directory, the one access door, and the edge guard (thin #9, #57, part of #23).
- [0005-data-layer.md](0005-data-layer.md): the client data layer for this path: the record store behind a prototype gate, row windows, optimistic writes and live patches (thin #6).
- [0005-change-events.md](0005-change-events.md): the outbox, the relay, Centrifugo channels and tokens, and how a change reaches another browser (thin #7).
- [0005-screens.md](0005-screens.md): the routes and screens, which library components each uses, and the auth modules pulled forward from spec 0003's deferred milestone 4.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a new user, I want to sign in with a code from my email or with Google, so I never manage a password.
- As a new user, I want to name my workspace once and land on People, so I can start right away.
- As a member, I want to add a column, create people and edit cells in a fast table, so the CRM fits my data.
- As a member, I want my teammate's changes to appear on my screen within a second, so we never work on stale data.
- As the owner of this product, I want sign up limited to emails I list until plans exist, so strangers can't create workspaces on an early build.

**Acceptance criteria** (numbered after spec 0004's, so every ID in the plan stays unique):
- **AC-27**: Entering an allowed email on `/sign-in` sends a 6 digit code (Mailpit locally, Resend in production) and moves to `/verify`. Typing the right code signs in. A wrong or expired code shows a message on the code field and signs nothing in. "Send a new code" waits 60 seconds between sends. Code sends are rate limited per email and per client IP (3 per 10 minutes per email), and the answer never reveals whether an account exists.
- **AC-28**: "Continue with Google" signs in where Google is configured (local and production) and is hidden where it isn't (previews). Google sign in with an email that already has an account lands in that same account; a Google account never attaches to someone else's.
- **AC-29**: In production and previews, an email not on `SIGNUP_ALLOWLIST` gets "Sign up isn't open yet" on `/sign-in`; no code is sent and no user is created. An existing user whose email is later removed from the list can still sign in. Locally there is no list.
- **AC-30**: A signed in user with no workspace lands on `/welcome`: a name prefilled from their name, the web address (slug) derived from it and editable, and "Create workspace". Creating it writes the workspace, its standard objects, the user's member row and the directory rows in one transaction, then lands on the People table. A taken slug shows on the address field. Repeating the request after a dropped response creates nothing twice.
- **AC-31**: A session lasts 30 days and is extended while used. Sign out (in the sidebar's workspace menu) ends it on that device. A request with an expired session gets `UNAUTHENTICATED`; the app goes to `/sign-in?redirect=<the page>` and a pending edit is rolled back with a message.
- **AC-32**: Every workspace procedure needs a session and an active member row in that workspace. A non member and an unknown workspace get the same `NOT_FOUND`. A test walks the contract and fails if any procedure outside the bootstrap list skips the access door.
- **AC-33**: In preview and production, a request to `/api/*` (health checks aside) without the edge secret header gets 403 `EDGE_REQUIRED`. The client IP (for rate limits and sessions) is read from the forwarded header only after that check passes.
- **AC-34**: The People table at `/w/$slug/objects/people` shows every People attribute in template order plus any added ones, with the total count. Rows load in windows as you scroll (thousands of rows stay smooth), and the table has loading, error with Retry, and empty with "New person" states.
- **AC-35**: "New person" opens a dialog with the Name and Email editors. Create adds the row at once and focuses it. A refusal removes the row and shows the message on that field. Retrying a create whose response was lost returns the record already made, not an error.
- **AC-36**: Editing a cell shows the new value at once. A refusal rolls it back, marks the cell with the message, and raises a toast with Retry. Two quick edits to one cell never flicker the older value back. Reference and member cells are read only in this loop.
- **AC-37**: "Add attribute" in the view bar opens a dialog with a name and a type (text, long text, number, date, checkbox, email, URL, rating). It waits for the server; a refusal (name taken, a limit) shows inline in the dialog; on success the column appears.
- **AC-38**: A second browser on the same workspace (another session of the same user, or another member) sees a created person, an edited value and an added column within 1 second at p95, measured in production. The writer's own changes are not fetched back. While the live connection is down the table says live updates are paused; when it returns without recovering the missed changes, the open table refetches.
- **AC-39**: Every write that changes something stores who and when (the engine already does) and one outbox row in the same transaction, with a per workspace number that has no gaps and follows commit order. A refused write stores no outbox row.
- **AC-40**: The client record store passes its prototype gate before the table is built on it: 100,000 records in windows, live patches and edits, measured (memory, scroll, patch time). If TanStack DB misses, the same interface runs on a plain store and the result is recorded in `verify.md`.
- **AC-41**: The whole loop runs in production on brij-crm-phi.vercel.app. Every screen is built from tokens and library components only, works by keyboard with a visible focus ring, meets contrast in light and dark, and the first load stays under the 250 kB budget with the grid loaded lazily.

## Decision

**Chosen option**: Option 1: one thin thread through every layer, with the auth, data layer and live update pieces each designed as the start of their full feature.

Better Auth signs people in by emailed code and Google into its own `auth` schema; one access door turns a session and a workspace into the engine's scope; the data layer keeps one copy per record and patches it from outbox events relayed through Centrifugo.

**Implementation skills**: `better-auth-best-practices` (`.claude/skills/better-auth-best-practices/`) · `resend` (`.claude/skills/resend/`) · `react-email` (`.claude/skills/react-email/`) · `db-core` (`tanstack/db`, `.claude/skills/db-core/`) · `react-db` (`tanstack/db`, `.claude/skills/react-db/`) · `centrifugo` (`pedronauck/skills`, community, `.claude/skills/centrifugo/`) · `tanstack-query` (`.claude/skills/tanstack-query/`) · `tanstack-router-best-practices` (`.claude/skills/tanstack-router-best-practices/`) · `tanstack-virtual` (`.claude/skills/tanstack-virtual/`) · `react-aria` (`.claude/skills/react-aria/`) · `zod` (`.claude/skills/zod/`) · `drizzle` (`.claude/skills/drizzle/`) · `use-railway` (`.claude/skills/use-railway/`) · `playwright-cli` (`.claude/skills/playwright-cli/`) · house skills `crm-api-backend`, `crm-data-model-access`, `crm-frontend-state`, `crm-design-system`

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

**Data model sketch** (the target; one migration per milestone that needs it):

| Table | Schema | Key | Columns and rules |
|---|---|---|---|
| `user` | `auth` | `id` uuid | Better Auth's columns (`name`, `email` unique, `email_verified`, `image`, times). Ids generated as uuid from the first migration. |
| `session` | `auth` | `id` uuid | `user_id` → user, `token` unique, `expires_at`, `ip_address`, `user_agent`. 30 days, extended on use. |
| `account` | `auth` | `id` uuid | `user_id` → user, `provider_id` (`google`), `account_id`; unique (`provider_id`, `account_id`). |
| `verification` | `auth` | `id` uuid | `identifier`, `value` (the hashed code), `expires_at` (10 minutes). |
| `workspace_directory` | `auth` | `workspace_id` uuid (= `workspaces.id`) | `slug` unique, `name`. Lets the API find a workspace from its address before any workspace is set. |
| `workspace_membership` | `auth` | (`user_id`, `workspace_id`) | `member_id` uuid (= `members.id`). "Which workspaces am I in". Written only with the workspace, never read for access. |
| `outbox` | `public` | (`workspace_id`, `seq`) | `kind` (`records`, `definitions`), `object_id`, `record_ids` uuid[], `attribute_ids` uuid[], `mutation_id` uuid null, `actor_type`, `actor_id`, `created_at`, `published_at` null. Forced row level security, the standard policy. |
| `workspace_counters` | `public` | existing | new `outbox_seq` bigint not null default 0. |
| `members` | `public` | existing | `user_id` (exists) now always set for a member who signs in; partial unique (`workspace_id`, `user_id`) where active. |

**API surface** (oRPC procedures on `/api/rpc`, plus Better Auth's own routes on `/api/auth/*`; every procedure answers refusals as `{ code, message, data?: { refusals } }`):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| Better Auth `/api/auth/email-otp/send-verification-otp`, `/sign-in/email-otp`, `/sign-in/social`, `/sign-out`, `/get-session` | email, code, provider | session cookie | public, rate limited | `SIGNUP_CLOSED`, invalid code, 429 |
| `me.get` | none | user (id, name, email), workspaces [{ id, slug, name }] | session | 401 |
| `workspaces.create` | `id` uuid v7 (client chosen), `name`, `slug` | { workspace: { id, slug, name } } | session, verified email | 409 `SLUG_TAKEN`, 422 `CONFIG_INVALID` |
| `objects.list` | `workspace` (slug) | ObjectSummary[] (id, apiSlug, names, icon, hue, standardKey, primaryAttributeId) | member | 404 |
| `attributes.list` | `workspace`, `objectId` | AttributeDefinition[] (id, apiSlug, title, type, isMulti, isRequired, isUnique, isSystem, config, position) | member | 404 |
| `attributes.create` | `workspace`, `objectId`, `title`, `apiSlug`, `type` (the eight), `mutationId` | AttributeDefinition | member | 409 `SLUG_TAKEN`, `LIMIT_REACHED`; 422 `CONFIG_INVALID` |
| `records.query` | `workspace`, `objectId`, `position` or `cursor`, `limit` ≤ 200 (sorts and filter accepted, unused by the loop) | { records: RecordView[], nextCursor? } | member | 422 `FILTER_INVALID`, 503 `QUERY_CANCELLED` |
| `records.count` | `workspace`, `objectId` | { count, atLeast } | member | 503 `QUERY_CANCELLED` (cancelled with the request) |
| `records.get` | `workspace`, `ids` ≤ 500 | RecordView[] | member | 404 |
| `records.create` | `workspace`, `objectId`, `id` uuid v7, `values`, `mutationId` | RecordView | member | 409 `UNIQUE_CONFLICT`, `LIMIT_REACHED`; 422 `VALUE_REQUIRED`, `ATTRIBUTE_VALUE_INVALID` |
| `records.setValues` | `workspace`, `recordId`, `values` { attributeId: { value } }, `mutationId` | RecordView | member | 409 `UNIQUE_CONFLICT`, `RECORD_DELETED`; 422 per value |
| `realtime.connectionToken` | none | { token } (HS256, `sub` = user id, 10 minutes) | session | 401 |
| `realtime.subscriptionToken` | `workspace` | { channel, token } (HS256, channel `workspace:<id>`, 10 minutes) | member | 404 |

**Status codes**: 400 `INPUT_INVALID`, 401 `UNAUTHENTICATED`, 403 `EDGE_REQUIRED` and `FORBIDDEN_ORIGIN`, 404 `NOT_FOUND` (also non member), 409 for conflicts (`SLUG_TAKEN`, `UNIQUE_CONFLICT`, `ID_TAKEN`, `RECORD_DELETED`, `LIMIT_REACHED`), 422 for invalid values and config, 429 `RATE_LIMITED` with `Retry-After`, 503 `QUERY_CANCELLED` with `Retry-After`, 500 `INTERNAL` (logged, never detailed).

**The change event** (one per outbox row, on channel `workspace:<id>`):

```json
{ "seq": 41, "kind": "records", "objectId": "…", "recordIds": ["…"], "attributeIds": ["…"], "mutationId": "…" }
```

Ids only, never values: a browser refetches the records through `records.get`, so the access door decides what it sees. `kind: "definitions"` means "refetch this object's attributes".

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| send code | whether the email may sign up | `SIGNUP_ALLOWLIST` (api env, comma separated, lowercased); unset locally means open |
| send code | the code and its expiry | Better Auth email OTP plugin, 6 digits, 10 minutes |
| send code | the sender address | `MAIL_FROM`; Mailpit locally, Resend in production and previews |
| any rate limit | the client IP | the forwarded header, trusted only after the edge check (AC-33) |
| sign in | session length | 30 days, `updateAge` 1 day (Better Auth `session` config) |
| `/welcome` | the prefilled name | `"<user's first name>'s workspace"` from `auth.user.name`, else the email's local part |
| `/welcome` | the slug | derived from the name (lowercase, letters and digits joined by single dashes, 3 to 40 characters); editable |
| `workspaces.create` | workspace id | the client's uuid v7 (idempotent retry key) |
| `workspaces.create` | the member's name and email | `auth.user.name` and `auth.user.email` |
| every member procedure | the workspace id | `auth.workspace_directory` by slug |
| every member procedure | the actor | the active `members` row for (workspace, `user_id`), read inside `withWorkspace` |
| People table | the object | `objects.list`, the one with `standardKey = 'people'` |
| People table | columns and their order | `attributes.list`, non system attributes by `position`, then created at |
| People table | total rows | `records.count` (exact for an unfiltered object) |
| People table | a window of rows | `records.query` with `position` = block × 100, `limit` 100, id order (creation order) |
| a cell | its display and editor | the field set's registry for the attribute type (spec 0003) |
| create | the record id | uuid v7 minted in the browser |
| create, edit, add attribute | `mutationId` | uuid minted in the browser per write; echoed in the event |
| live update | the event | the outbox row, relayed to `workspace:<id>` |
| live update | the changed values | `records.get` by the event's ids |
| live update | the new column | `attributes.list` after a `definitions` event |
| outbox | `seq` | `workspace_counters.outbox_seq + 1` under that row's lock, in the write transaction |
| tokens | the signing secret | `CENTRIFUGO_TOKEN_SECRET` = the Centrifugo service's `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY` |

**Key invariants**:
- No procedure builds an `EngineScope` except the access door; a contract walking test enforces it.
- The directory never grants access: the door reads only the tenant `members` row.
- Workspace, member and directory rows are written in one transaction, or none are.
- Every write procedure passes the outbox hook through one composer; a test asserts each write procedure stores an outbox row and a refused one stores none.
- Outbox `seq` per workspace has no gaps and follows commit order.
- An event carries ids only.
- The browser holds one copy per record; screens never fetch.

**Security model**:
- Better Auth's tables and the directory live in schema `auth`, outside row level security, reachable only through `packages/db`'s identity store (lint keeps the pool there). `crm_app` gets select, insert, update and delete on schema `auth`; no tenant table lives there (a guard test checks).
- Workspace data stays behind forced row level security and the door. Non member and unknown workspace answer the same `NOT_FOUND`.
- The relay reads outbox rows across workspaces only through two security definer functions owned by a narrow role (see [0005-change-events.md](0005-change-events.md)); the guard tests list them by name beside `crm_search_text`.
- The edge secret makes the forwarded IP trustworthy; without it, rate limits would be bypassable by calling Railway directly.
- Cookies are host only, `HttpOnly`, `Secure`, `SameSite=Lax`. The API trusts only `APP_URL` (and local origins) as origins.
- No secret is logged; code emails log only success or failure, never the address or the code.
- `security-access-reviewer` reviews milestones 1 and 3 before they land.

**Configuration required**:
- `BETTER_AUTH_SECRET` (api): signs sessions; generated per environment.
- `BETTER_AUTH_URL` (api): the public origin (`APP_URL`), never the Railway host.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (api, optional): Google sign in; the button hides without them. The OAuth client is the owner's to create.
- `RESEND_API_KEY`, `MAIL_FROM` (api, production and previews): code emails. Until a domain is verified, Resend only delivers to the account owner's address.
- `MAILPIT_URL` (api, local): the local mail catcher (added to `docker-compose.yml`).
- `SIGNUP_ALLOWLIST` (api, production and previews): emails allowed to sign up.
- `EDGE_SECRET` (api and the Vercel project): the edge guard; required outside local.
- `CENTRIFUGO_TOKEN_SECRET` (api): a Railway reference to the Centrifugo service's HMAC secret.
- `CENTRIFUGO_API_URL`, `CENTRIFUGO_API_KEY` (worker): publishing over Railway's private network; references to the Centrifugo service.
- `VITE_REALTIME_URL` (web): the Centrifugo WebSocket address; added to the CSP `connect-src`.

**Critical test scenarios**:
- Happy path: sign in by code (read from Mailpit), name the workspace, land on People, add a column, create a person, edit a cell; a second browser sees all three within a second (Playwright, locally and against production), verifies **AC-27**, **AC-30**, **AC-34** to **AC-38**, **AC-41**.
- Failure: a refused edit rolls back with a cell message and a toast; an expired session redirects with the edit rolled back; a dropped live connection shows the paused notice and refetches on return, verifies **AC-31**, **AC-36**, **AC-38**.
- Auth: a member of workspace B asking for workspace A, a removed member, and no session all get nothing; a request without the edge secret gets 403; an email off the allowlist gets no code, verifies **AC-29**, **AC-32**, **AC-33**.
- Events: a write stores one outbox row with the next `seq`; a refused write stores none; the relay publishes in order and marks rows; a gap makes the client refetch, verifies **AC-38**, **AC-39**.
- Store: the prototype gate's measurements, verifies **AC-40**.

## Build plan

Tracer Bullet: each milestone ends with something you can click in production.

**Milestone 1: signed in, in production, on an empty People page**
1. Error plumbing: the shared error map in `packages/contracts`, the RPC interceptor in `apps/api` (refusal to status, input errors to `INPUT_INVALID`, unknowns logged as `INTERNAL`), body limits, satisfies **AC-32**
2. The edge guard in the Vercel middleware and the API, with `EDGE_SECRET` set on Vercel and Railway, satisfies **AC-33**
3. Migration: schema `auth` (Better Auth's four tables, the directory), `members_user` unique index; guard tests extended, satisfies **AC-30**, **AC-32**
4. Better Auth in its one wrapper: email OTP, the allowlist hook, rate limits, sessions, Mailpit locally and Resend in production behind a mailer interface, satisfies **AC-27**, **AC-29**, **AC-31**
5. The access door and the `authed` and `member` middlewares; `me.get`; `workspaces.create` (one transaction, idempotent); the contract walking test, satisfies **AC-30**, **AC-32**
6. Library: the Form molecule, AuthLayout, SignInForm and VerifyEmail (thin, presentational, stories, README, guardian review, artifact publish), satisfies **AC-41**
7. Routes: `/sign-in`, `/verify`, `/welcome`, the `/w/$slug` frame (AppShell, Sidebar with sign out), and an empty People page; the status screen moves to `/status`, satisfies **AC-27**, **AC-30**, **AC-31**, **AC-41**
8. Deploy and smoke test in production with your email; `security-access-reviewer` before it lands, satisfies **AC-27**, **AC-33**, **AC-41**

**Milestone 2: the People table**
9. The store prototype gate (TanStack DB record collection plus our own windows, 100,000 records) and its decision recorded, satisfies **AC-40**
10. Core services and procedures: `objects.list` (new `listObjects`), `attributes.list` and `attributes.create`, `records.query`, `records.count`, `records.get`, `records.create` (idempotent replay) and `records.setValues` returning the fresh RecordView, satisfies **AC-34**, **AC-35**, **AC-36**, **AC-37**
11. The data layer: `data.records.view` (windows, count, status, retry), optimistic create and edit with rollback, cell errors and toasts, server confirmed attribute create, the React binding, all loaded lazily, satisfies **AC-34** to **AC-37**, **AC-41**
12. The People screen: TopBar, ViewBar with "Add attribute", the lazy DataGrid fed by the view, the create dialog, read only reference and member cells, satisfies **AC-34** to **AC-37**, **AC-41**
13. Deploy; `state-performance-reviewer` and `ux-interaction-reviewer` before it lands, satisfies **AC-41**

**Milestone 3: live**
14. Migration: `outbox`, `workspace_counters.outbox_seq`, the relay role and its two functions; guard tests updated, satisfies **AC-39**
15. The outbox hook and the one write composer (records and definitions changes, `mutationId`), satisfies **AC-39**
16. The relay in the worker (LISTEN plus a 1 second poll, one relay by advisory lock, ordered publish, idempotency keys) and the Centrifugo `workspace` namespace with history and recovery, satisfies **AC-38**, **AC-39**
17. Token procedures and the browser subscription (own echoes skipped, gap and recovery refetch, the paused notice), satisfies **AC-38**
18. Railway and Vercel variables and the CSP; deploy; the two browser Playwright test locally and against production; `security-access-reviewer` before it lands, satisfies **AC-38**, **AC-41**

**Milestone 4: finish and harden**
19. Google sign in (local and production, once you create the OAuth client) and account linking only on a verified email, satisfies **AC-28**
20. Session expiry and edit rollback, focus moves on route change, keyboard and contrast passes in both themes, `dxe quick` and `ux-interaction-reviewer` on every screen, satisfies **AC-31**, **AC-41**
21. The full Playwright flow in CI and against production; `verify.md` with results, satisfies **AC-27** to **AC-41**

## Consequences

**Positive**:
- A product you can click, in production, after milestone 1, growing each milestone.
- Sign in, the access door, the data layer and live updates each start in their final shape, so #6, #7, #9 and #23 extend them instead of replacing them.
- Passwordless sign in removes password storage, resets and the pre registration hijack path.

**Negative / tradeoffs**:
- Without a domain, production codes reach only the Resend account owner, and Google works only for listed test users, so AC-28 and AC-38's "another member" are proven with your own accounts until a domain exists.
- A second deliberate gap in row level security (the relay functions), on top of `crm_search_text`.
- Every request adds a session read and a door transaction before the engine's own.
- Code emails are sent inside the request until background jobs (#8) exist.
- On Neon's free plan the compute sleeps; the relay's LISTEN reconnects on wake, and the 1 second poll covers the gap, so the first event after an idle spell can be late.
- The outbox grows until #8 adds pruning.
- Pulling SignInForm, VerifyEmail, AuthLayout and the Form molecule forward amends spec 0003's milestone 4 deferral.
- Last save wins without a notice until #6 adds version ids to reads.

**Neutral**:
- Three migrations (auth, outbox and relay, plus the `members_user` index).
- New pinned dependencies: `better-auth`, `@tanstack/db`, `@tanstack/react-db`, `centrifuge`, `resend`.
- Mailpit joins the local Docker services.

## Follow-up

- [ ] **A domain** (yours to buy or name): verify it in Resend, point it at Vercel, publish the Google consent screen. No code change needed.
- [ ] **Google OAuth client** (yours to create): a Web client with redirect URIs for local and the production domain.
- [ ] **Spec 0003 and the scope**: record that SignInForm, VerifyEmail, AuthLayout and the Form molecule moved forward from milestone 4 (`/sync`).
- [ ] **#6**: version ids in reads and the "your value was replaced" notice; filtered and sorted windows (cursor paging); reading only visible attributes.
- [ ] **#7**: channel split per object if the load harness (#12) shows fan out cost; Centrifugo history beyond memory.
- [ ] **#8**: code emails and outbox pruning as jobs.
- [ ] **#9**: roles, field and record rules in the door; check field access before a contains reaches `crm_search_text`.
- [ ] **#13**: select, status, currency and relation attributes in "Add attribute"; the grid's "+" column header.
- [ ] **#23**: rename a workspace, invite members, the workspace picker.
- [ ] **#57**: replace the shared secret with Vercel's signed OIDC token behind the same check.
- [ ] **Spec 0004 review findings** (the fresh review of #5): fix the six medium findings before milestone 3, since the outbox hook builds on the `Change` payload one of them names.
- [ ] `db-core`, `react-db` and `centrifugo` skills were installed for this spec; `/sync` should list them in `packages/data/AGENTS.md` and `apps/api/AGENTS.md` (area scoped, not root). `centrifugo` is a community skill, reviewed: documentation only.
