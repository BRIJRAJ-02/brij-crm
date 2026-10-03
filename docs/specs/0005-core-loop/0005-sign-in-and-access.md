# 0005. Sign in and access for the core loop

## Summary

People sign in with a 6 digit code sent to their email, or with Google, through Better Auth (a sign in library the API hosts itself). Better Auth keeps its tables in their own `auth` schema, beside a small directory that says which workspaces each user is in. Every workspace request then passes one access door that checks the person is an active member and hands the engine its scope. A shared secret from Vercel's middleware proves a request came through the web app, so rate limits can trust the client IP.

## Decisions

- **Sign in methods**: email one time code (Better Auth `emailOTP({ otpLength: 6, expiresIn: 600, allowedAttempts: 5, storeOTP: 'hashed' })`, sign up by code allowed, routes under the default `basePath` `/api/auth`) plus Google (`socialProviders.google`). No passwords, so no reset flow and no unverified accounts. Runner up: email and password with a verification link (two more screens and the pre registration hijack risk).
- **Account linking**: `accountLinking.enabled: true` with no `trustedProviders` and `updateUserInfoOnLink` off. Better Auth's default then links Google to an existing account only when Google reports the email verified; email codes prove ownership of the address, so both paths reach the same user. (Listing Google in `trustedProviders` would link even an unverified Google email, so it stays out.)
- **Allowlist**: a `databaseHooks.user.create.before` hook and the OTP send path both refuse an email not in `SIGNUP_ALLOWLIST` with `SIGNUP_CLOSED` ("Sign up isn't open yet"). The send path checks before any email goes out; an existing user is never blocked. Unset locally means open. This tells an unlisted new email that it isn't listed; for any other email the answer is the same whether or not an account exists.
- **Sessions**: `session.expiresIn` 30 days, `updateAge` 1 day, no cookie cache (revocation stays immediate). Cookies host only, `HttpOnly`, `Secure` outside local, `SameSite=Lax`. `trustedOrigins` = `APP_URL` plus local origins. `baseURL` = `BETTER_AUTH_URL` (the public origin).
- **Ids**: `advanced.database.generateId: 'uuid'` so `auth.user.id` fits `members.user_id`.
- **Names**: email code sign ups start with an empty `auth.user.name`. `/welcome` asks "Your name"; `workspaces.create` saves it as the member's name and fills `auth.user.name` when empty.
- **Where it lives**: schema `auth`, written as a Drizzle `pgSchema('auth')` in `packages/db/src/schema/auth.ts` with a hand written migration; Better Auth's Drizzle adapter is built inside `packages/db` (an identity store export), so no pool exists outside `packages/db`. The organization plugin stays off until #23.
- **Directory**: `auth.workspace_directory` (workspace id, slug unique, name) and `auth.workspace_membership` (user, workspace, member). Read for slug lookup and "my workspaces" only. The access door never reads it for permission.
- **Rate limits**: Better Auth's limiter with `storage: 'database'` (its `auth.rate_limit` table, safe across instances) and `enabled: true` set explicitly (it is otherwise on only when `NODE_ENV` is `production`, and the local tests need it): code sends 5 per 10 minutes per email (a mistyped email plus the 60 second resend wait can't lock someone out for long) and 10 per 10 minutes per IP; code checks 5 tries per code, and 15 per hour and 40 per day per email whatever the code or IP, where a try counts against an email only while it has a live (unexpired) code or an account, so junk tries at an address with neither can't lock it out (an email reaching its cap is logged by its domain only); sign in endpoints 5 per minute per IP; every other auth route 600 per 10 minutes per IP (that window is also how long Better Auth keeps its rows). The IP comes from `x-forwarded-for` (`advanced.ipAddress.ipAddressHeaders: ['x-forwarded-for']`) only after the edge check. A request with no trusted IP (locally, where Vite's proxy sets no forwarded header, or a forwarded value that isn't an IP, which never reaches Better Auth) gets no per IP limit at all, never one shared bucket for every caller; the per email limits still hold.
- **Emails checked first**: both code routes check the email against the shared `EmailValue` schema in `@crm/contracts` (trimmed, lowercased, at most 254 characters) before Better Auth or its limiter sees the request, answering 400 `INPUT_INVALID` otherwise, and pass it on normalized, so the limits, the code and the account use one spelling and a malformed email writes nothing.
- **Mail**: a `Mailer` interface (`send({ to, subject, html, text })`) passed in. `apps/api/src/mail/resend.ts` is the only `resend` importer; `apps/api/src/mail/mailpit.ts` posts to Mailpit's `POST /api/v1/send` locally. `MAIL_FROM` is `onboarding@resend.dev` in production until a domain is verified. One React Email template ("Your sign in code"). Sent inside the request for now; a send failure answers the same as success to the caller and is logged without the address or code.

## The access door

`packages/core/src/access/door.ts`:

```ts
/** Turns a signed in user and a workspace slug into the engine's scope, or refuses with NOT_FOUND. */
export async function enterWorkspace(deps: { db: Database; identity: IdentityStore }, input: { userId: string; slug: string }): Promise<EngineScope>
```

1. `identity.findWorkspace(slug)` → workspace id, or `NOT_FOUND`.
2. Inside `withWorkspace(id)`: the active `members` row with `user_id = userId` → member id, or `NOT_FOUND` (same message; existence never leaks).
3. Returns `{ db, workspaceId, actor: { type: 'member', id: memberId } }`.

oRPC middlewares in `apps/api`: `authed` (a session, else 401 `UNAUTHENTICATED`) and `member` (`authed` plus the door; puts `context.scope` in place). Procedures are built from `pub`, `authed` or `member` bases; a test lists every contract procedure and fails if one outside the bootstrap list (`system.status`, `me.get`, `workspaces.create`, by name) isn't built on `member`. A `member` handler sees `context.scope` and no `context.db`, and a source scan refuses `context.db` or `withWorkspace` in `src/modules` outside the bootstrap handlers' files. Better Auth answers only the routes sign in uses (send a code, sign in by code, Google and its callback, sign out, the session read); every other `/api/auth` path is 404, and its bodies stop at 64 KB.

## Getting a workspace

`workspaces.create({ id, name, slug })` (session, verified email):
1. One transaction through a new engine entry that accepts the workspace id and `firstMember.userId`: the workspace, its counters, the standard template, the member row, and an `AfterWrite` that inserts the directory and membership rows.
2. Replay: on a unique violation of `workspaces_pkey`, read the workspace and the active member with `user_id` = this user inside `withWorkspace(id)`. Found → return the workspace (200). Not found → 409 `ID_TAKEN`.
3. A taken slug → 409 `SLUG_TAKEN` on the `slug` field, from either `workspaces_slug` (partial, live workspaces) or `auth.workspace_directory`'s unconditional slug index, so a slug once used is never reused.
4. `workspaces.create` builds no scope in `apps/api`; the engine's bootstrap builds its system scope inside `packages/core`. It stores no outbox row (nobody can be subscribed yet).

## The edge guard (thin #57)

- `apps/web` middleware sets `x-crm-edge: <EDGE_SECRET>` on every proxied `/api/*` request, replacing any copy the client sent.
- `apps/api` refuses `/api/*` except `/api/health*` without a matching header (constant time compare) with 403 `EDGE_REQUIRED` whenever `APP_ENV` isn't `local`. `EDGE_SECRET` is required in `ApiEnv` outside local (#57): the API refuses to boot without one, and a guard built without one admits nothing but the health checks. Rollout: the secrets are set on Vercel (Production and Preview) and on Railway (production and `preview-base`) before the branch merges; the brief 403 window between the API deploy and the web deploy is accepted. A startup log line says whether the guard is on.
- The client IP is read from `x-forwarded-for` only after the check, and reaches Better Auth only when it is an IP (`net.isIP`); Better Auth's `advanced.ipAddress.ipAddressHeaders` is set accordingly.

## Tests

- Code sign in end to end against Mailpit; wrong, expired and reused codes; the 60 second resend wait; rate limit 429.
- Production can't be tested by reading codes (Resend has no inbox API, and only the owner's mailbox receives mail). AC-27 is proven locally; production tests start from signed in browser states saved after one manual sign in, and `verify.md` says so.
- Allowlist: no code and no user for an unlisted email; an existing user still signs in.
- The door: workspace B's member on workspace A, a removed member, an unknown slug, no session, all refused the same way; the contract walking test.
- `workspaces.create`: one transaction (a forced failure leaves no workspace and no directory rows), idempotent repeat, `SLUG_TAKEN`.
- The edge guard: 403 without the header in preview mode, health checks open, local open; `ApiEnv` refuses preview and production without `EDGE_SECRET`.
- Guard tests: no table in schema `auth` has a `workspace_id` column except `workspace_directory` and `workspace_membership`; only the identity store module imports the `auth` tables (lint); the app role still reads no `public` tenant row outside `withWorkspace`.

## Rationale (short)

A passwordless code keeps the account model simple and verified by design, and matches how Attio signs people in. Better Auth is the library spec 0001 chose; its own schema keeps global identity apart from tenant data without a second security definer function. One door now, with only "active member may do everything", is the seam #9 adds roles and rules to.
