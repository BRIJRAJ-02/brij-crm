# 0005. Sign in and access for the core loop

## Summary

People sign in with a 6 digit code sent to their email, or with Google, through Better Auth (a sign in library the API hosts itself). Better Auth keeps its tables in their own `auth` schema, beside a small directory that says which workspaces each user is in. Every workspace request then passes one access door that checks the person is an active member and hands the engine its scope. A shared secret from Vercel's middleware proves a request came through the web app, so rate limits can trust the client IP.

## Decisions

- **Sign in methods**: email one time code (Better Auth `emailOTP` plugin, 6 digits, 10 minutes, `sendVerificationOnSignUp`, sign up by code allowed) plus Google (`socialProviders.google`). No passwords, so no reset flow and no unverified accounts. Runner up: email and password with a verification link (two more screens and the pre registration hijack risk).
- **Account linking**: `accountLinking.enabled` with `trustedProviders: ['google']`: Google attaches to an existing account only when Google says the email is verified, and email codes prove ownership of the address, so both paths reach the same user.
- **Allowlist**: a `databaseHooks.user.create.before` hook and the OTP send path both refuse an email not in `SIGNUP_ALLOWLIST` with `SIGNUP_CLOSED` ("Sign up isn't open yet"). The send path checks before any email goes out; an existing user is never blocked. Unset locally means open.
- **Sessions**: `session.expiresIn` 30 days, `updateAge` 1 day, no cookie cache (revocation stays immediate). Cookies host only, `HttpOnly`, `Secure` outside local, `SameSite=Lax`. `trustedOrigins` = `APP_URL` plus local origins. `baseURL` = `BETTER_AUTH_URL` (the public origin).
- **Ids**: `advanced.database.generateId: 'uuid'` so `auth.user.id` fits `members.user_id`.
- **Where it lives**: schema `auth`, written as a Drizzle `pgSchema('auth')` in `packages/db/src/schema/auth.ts` with a hand written migration; Better Auth's Drizzle adapter is built inside `packages/db` (an identity store export), so no pool exists outside `packages/db`. The organization plugin stays off until #23.
- **Directory**: `auth.workspace_directory` (workspace id, slug unique, name) and `auth.workspace_membership` (user, workspace, member). Read for slug lookup and "my workspaces" only. The access door never reads it for permission.
- **Rate limits**: Better Auth's limiter with database storage (safe across instances): code sends 3 per 10 minutes per email and 10 per 10 minutes per IP; code checks 5 tries per code; sign in endpoints 20 per minute per IP. The IP comes from `x-forwarded-for` only after the edge check.
- **Mail**: a `Mailer` interface (`send({ to, subject, html, text })`) passed in. `apps/api/src/mail/resend.ts` is the only `resend` importer; `apps/api/src/mail/mailpit.ts` posts to Mailpit locally. One React Email template ("Your sign in code"). Sent inside the request for now; a send failure answers the same as success to the caller and is logged without the address or code.

## The access door

`packages/core/src/access/door.ts`:

```ts
/** Turns a signed in user and a workspace slug into the engine's scope, or refuses with NOT_FOUND. */
export async function enterWorkspace(deps: { db: Database; identity: IdentityStore }, input: { userId: string; slug: string }): Promise<EngineScope>
```

1. `identity.findWorkspace(slug)` → workspace id, or `NOT_FOUND`.
2. Inside `withWorkspace(id)`: the active `members` row with `user_id = userId` → member id, or `NOT_FOUND` (same message; existence never leaks).
3. Returns `{ db, workspaceId, actor: { type: 'member', id: memberId } }`.

oRPC middlewares in `apps/api`: `authed` (a session, else 401 `UNAUTHENTICATED`) and `member` (`authed` plus the door; puts `context.scope` in place). Procedures are built from `pub`, `authed` or `member` bases; a test lists every contract procedure and fails if one outside the bootstrap list (`system.*`, `me.get`, `workspaces.create`, `realtime.connectionToken`) isn't built on `member`.

## Getting a workspace

`workspaces.create({ id, name, slug })` (session, verified email):
1. One transaction through a new engine entry that accepts the workspace id and `firstMember.userId`: the workspace, its counters, the standard template, the member row, and an `AfterWrite` that inserts the directory and membership rows.
2. A repeat with the same id and the same user returns the existing workspace (idempotent); a different user with that id gets `ID_TAKEN`.
3. A taken slug → 409 `SLUG_TAKEN` on the `slug` field.

## The edge guard (thin #57)

- `apps/web` middleware sets `x-crm-edge: <EDGE_SECRET>` on every proxied `/api/*` request, replacing any copy the client sent.
- `apps/api` refuses `/api/*` except `/api/health*` without a matching header (constant time compare) with 403 `EDGE_REQUIRED` when `APP_ENV` is `preview` or `production`. `ApiEnv` requires `EDGE_SECRET` outside `local`.
- The client IP is read from `x-forwarded-for` only after the check; Better Auth's `advanced.ipAddress.ipAddressHeaders` is set accordingly.

## Tests

- Code sign in end to end against Mailpit; wrong, expired and reused codes; the 60 second resend wait; rate limit 429.
- Allowlist: no code and no user for an unlisted email; an existing user still signs in.
- The door: workspace B's member on workspace A, a removed member, an unknown slug, no session, all refused the same way; the contract walking test.
- `workspaces.create`: one transaction (a forced failure leaves no workspace and no directory rows), idempotent repeat, `SLUG_TAKEN`.
- The edge guard: 403 without the header in preview mode, health checks open, local open.
- Guard tests: schema `auth` holds no table with `workspace_id` leading a tenant shape; the app role still reads no `public` tenant row outside `withWorkspace`.

## Rationale (short)

A passwordless code keeps the account model simple and verified by design, and matches how Attio signs people in. Better Auth is the library spec 0001 chose; its own schema keeps global identity apart from tenant data without a second security definer function. One door now, with only "active member may do everything", is the seam #9 adds roles and rules to.
