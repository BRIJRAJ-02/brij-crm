# 0033. Account security

**Date**: 2026-10-20
**Status**: Proposed
**Scope**: #25, Slice 6 ([Team and security](../../scope/team-and-security.md))
**Numbering**: handed out by the coordinator (0031 to 0033 for Slice 6); this spec owns AC-881 to AC-920.

## Owner decisions needed

The owner accepted every recommendation below on 20 October 2026; each is now a decision.

1. **Second factor methods.** Recommended: an authenticator app (TOTP) with 10 backup codes, and passkeys, both through Better Auth (its `twoFactor` plugin, already installed, and `@better-auth/passkey`, a new pinned dependency). Runner up: TOTP and backup codes only, passkeys later.
2. **Does two factor apply after Google sign in?** Recommended: yes, after every first step (email code or Google), so the setting means the same thing however you sign in. Runner up: trust Google's own two step check and skip ours after Google.
3. **Can a passkey sign you in on its own?** Recommended: yes; a passkey is something you have plus your fingerprint or device PIN, so it counts as two factor by itself, and it is also offered as the second step. Runner up: passkeys only as the second step.
4. **"Remember this device".** Recommended: offered at the second step, 30 days, per browser; cleared when you turn two factor off or sign out everywhere. Runner up: never remember; every sign in asks.
5. **Sessions list and sign out.** Recommended: our own procedures over the identity store, answering session ids only, and Better Auth's session routes stay shut (its list route sends session tokens to the browser). Runner up: open Better Auth's `list-sessions` and `revoke-session` routes.
6. **Sign in alerts.** Recommended: email when a sign in comes from a browser, system and country not seen for this account in 90 days; the email links to Account › Security, never a one click "sign out" link. Runner up: email on every sign in, or a one click revoke link in the email.
7. **Requiring two factor for a workspace.** Recommended: owners only (a new owner only permission, `security.manage`), only once the owner has two factor on; it applies at once, and anyone without it is taken to setup when they open that workspace (no grace period). Runner up: a 7 day grace period, and admins may turn it on too.
8. **Lost device and lost backup codes.** Recommended: no self service reset; an email code alone never turns two factor off (email is already the first step). Recovery goes through support (#39) with an identity check, or, in a workspace, nothing changes for the account but an owner can see who has it on. Runner up: email recovery after a 72 hour wait with alerts.
9. **Where location comes from.** Recommended: country and city from the edge's geo headers at sign in, stored on the session; no IP lookup service. Runner up: show the IP address only.
10. **SSO.** Recommended: not now; the workspace security row leaves room for "allowed sign in methods" and SAML or OIDC (Better Auth's SSO plugin) as a later, paid plan feature. Runner up: build OIDC SSO in this slice.

## Summary

Each person can protect their account with a second step at sign in (an authenticator app, a passkey, or a backup code), see every device signed in to their account and sign any or all of them out, and gets an email when a new device signs in. An owner can require two factor for everyone in their workspace. Sign in stays password less: an email code or Google, then the second step when it is on; a passkey alone can also sign you in. Screens live in Settings › Account › Security and Settings › Workspace › Security.

Reasoning and options: see [rationale.md](rationale.md).

## Requirements

**User stories**:
- As a member, I want a second step at sign in, so someone with access to my email can't get in.
- As a member, I want to see where I'm signed in and sign out a lost laptop.
- As a member, I want an email when a device I don't use signs in.
- As an owner, I want everyone in my workspace to use two factor.
- As a member who prefers it, I want to sign in with a passkey in one step.

**Acceptance criteria** (this spec owns AC-881 to AC-920):

*Two factor*
- **AC-881**: Account › Security › Two factor sign in shows Off or On with the methods set up. Turning on the authenticator app needs a fresh verification (AC-896), shows a QR code and the secret as text, and is confirmed only by a correct 6 digit code; it then shows 10 single use backup codes once, with Copy and Download, and the person must tick "I've saved these" before Done.
- **AC-882**: With two factor on, every sign in by email code or Google stops before a session exists and asks for a code from the app, a passkey, or a backup code (owner decision 2). A wrong code says "That code didn't work. Try the newest code in your app." Five wrong tries in 5 minutes per pending sign in, or 15 an hour per account, lock the second step for 15 minutes with that message.
- **AC-883**: A backup code works once; using one shows how many are left and offers "Make new codes". Making new codes needs a fresh verification and replaces all old ones.
- **AC-884**: "Remember this device for 30 days" at the second step skips it on this browser for 30 days (owner decision 4). Turning two factor off or signing out everywhere forgets every remembered device.
- **AC-885**: Turning two factor off needs a fresh verification with the second factor itself (an app code, passkey or backup code), not an email code (owner decision 8), and is refused while any workspace the person is in requires it: "Acme requires two factor sign in."
- **AC-886**: The TOTP secret and backup codes are stored encrypted by Better Auth with `BETTER_AUTH_SECRET`, never logged, never sent after setup, never in an audit or security event.

*Passkeys*
- **AC-887**: Account › Security › Passkeys lists passkeys (name, created, last used) with Add passkey (needs fresh verification), Rename and Remove (needs fresh verification). Removing the last second factor while a workspace requires two factor is refused as in AC-885.
- **AC-888**: The sign in page offers "Sign in with a passkey" (and the browser's autofill for passkeys); a passkey sign in creates a session directly and counts as two factor (owner decision 3). A passkey for an account with no other second factor still turns "two factor" on for AC-893.
- **AC-889**: Passkeys use the web origin from `APP_URL` as the relying party id; previews use their own origin, so a preview passkey never works in production.

*Sessions*
- **AC-890**: Account › Security › Devices lists the person's live sessions, newest activity first: device ("Chrome on macOS"), approximate place ("Berlin, Germany"), last active (a day's precision, from the session's update), and "This device" on the current one. Each other row has Sign out; above the list, "Sign out of all other devices".
- **AC-891**: `account.sessions.list` answers session ids, never tokens. `account.sessions.revoke(id)` deletes only a session of the caller; another user's id answers `NOT_FOUND`. Revoking takes effect on that device's next request (the cookie cache is off), and its live connection is cut with code 4501 ("signed out"); its tabs show the sign in page.
- **AC-892**: "Sign out of all other devices" needs a fresh verification, deletes every other session of the person, forgets remembered devices, and cuts their live connections; the current session stays.

*Workspace requirement*
- **AC-893**: Settings › Workspace › Security (visible with `security.manage`, owners only) has "Require two factor sign in". Turning it on is refused unless the owner has two factor on, and shows how many members don't yet: "4 people will be asked to set it up next time they open Acme."
- **AC-894**: In a workspace that requires it, the door refuses a person without two factor with 403 `TWO_FACTOR_REQUIRED` on every workspace procedure; the app shows a full page "Acme requires two factor sign in" with Set up now, which runs AC-881 or AC-887 and then continues. Their other workspaces are unaffected. API keys (#34) are unaffected.
- **AC-895**: Workspace › Members shows a "Two factor" column (On or Off) to owners and admins, so they can follow up.

*Fresh verification (step up)*
- **AC-896**: Sensitive account actions (turn two factor on or off, new backup codes, add or remove a passkey, sign out of all other devices) need a verification within the last 10 minutes on this session: the second factor when it is on, else an email code to the account's address. The action's dialog asks for it inline and then continues.

*Sign in alerts*
- **AC-897**: A sign in whose device key (browser family, system, country) has not been seen for this account in 90 days emails the account: when, device, approximate place, and "If this wasn't you, go to Account › Security to sign that device out and turn on two factor." with a link to that page. No alert on the very first sign in (sign up). The email is sent by a job (spec 0008) after the session exists, with an idempotency key of the session id.

*Security activity and audit*
- **AC-898**: Account › Security › Recent activity lists the person's last 90 days of security events: sign in (method, device, place), sign out, session revoked, two factor on or off, backup codes made or used, passkey added or removed, alert sent. Kept 1 year in `auth.security_event`, then deleted by the daily cleanup.
- **AC-899**: Turning the workspace requirement on or off writes an `audit_events` row (spec 0031).
- **AC-900**: The Better Auth routes the API serves grow only by the reviewed list in Feature design (`AUTH_ROUTES`); every other plugin route stays 404, and a test pins the set.
- **AC-901**: Every screen here is keyboard usable, labelled, meets WCAG AA, and the 6 digit input accepts paste and one time code autofill (`autocomplete="one-time-code"`).

## Decision

**Chosen option**: Option 1: extend the existing Better Auth wrapper with its `twoFactor` plugin (password less mode) and the passkey plugin, keep sessions in the `auth` schema and expose them through our own procedures, and enforce the workspace requirement in the access door.

**Implementation skills**: `better-auth-best-practices` (`.claude/skills/better-auth-best-practices/`) · `security-and-hardening` (`addyosmani/agent-skills`, `.claude/skills/security-and-hardening/`) · `security-best-practices` (`openai/skills`, `.claude/skills/security-best-practices/`) · `crm-api-backend` (house, `.claude/skills/crm-api-backend/`) · `crm-design-system` (house, `.claude/skills/crm-design-system/`) · `crm-frontend-state` (house, `.claude/skills/crm-frontend-state/`) · `resend` (`.claude/skills/resend/`) · `react-email` (`.claude/skills/react-email/`) · `drizzle` (`.claude/skills/drizzle/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-cli` (`microsoft/playwright-cli`, `.claude/skills/playwright-cli/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Dependencies

- **Spec 0005** (sign in): the Better Auth wrapper in `apps/api/src/auth/`, its route allowlist, rate limits and identity store.
- **Spec 0031**: `audit_events`; the Members page for AC-895.
- **Spec 0009**: the door, which gains the requirement check, and the permission catalog, which gains `security.manage`.
- **Spec 0007**: the Centrifugo disconnect, now also with code 4501.
- **Spec 0008**: jobs for alerts and the cleanup.

### Sign in flow

```
email code or Google ── user has 2FA? ── no ──> session
                              │ yes
                              ├─ remembered device (valid trust cookie) ──> session
                              └─ second step page: app code | passkey | backup code ──> session
passkey ──────────────────────────────────────────────────────────────────> session
```

Better Auth's `twoFactor` plugin sets a short lived pending cookie instead of a session when the user has two factor on; the plugin's hook covers its own credential sign in, so the wrapper adds an after hook on the email code and Google callback routes that does the same (verified in milestone 1's first task; if the plugin already covers them, the hook is not added).

### Data model sketch

`auth` schema (global, no row level security, written only through the identity store):

| Table | Change or columns | Rules |
|---|---|---|
| `auth.user` | add `two_factor_enabled` bool default false (Better Auth's `twoFactorEnabled`) | |
| `auth.two_factor` | `id`, `user_id`, `secret` (encrypted), `backup_codes` (encrypted) | one per user; cascade on user delete |
| `auth.passkey` | `id`, `user_id`, `name`, `credential_id`, `public_key`, `counter`, `device_type`, `backed_up`, `transports`, `aaguid`, `created_at`, `last_used_at` | unique `credential_id`; cascade |
| `auth.session` | add `country`, `city`, `device_label`, `verified_at` | `verified_at` set at sign in and on step up |
| `auth.trusted_device` | Better Auth's trust cookie store, or its own table per its schema | cleared per AC-884 |
| `auth.known_device` | `user_id`, `device_key` (SHA-256 of browser family, system, country), `first_seen`, `last_seen` | pk (`user_id`, `device_key`) |
| `auth.security_event` | `id`, `user_id`, `at`, `kind`, `session_id` null, `ip` inet null, `country`, `device_label`, `detail` jsonb | index (`user_id`, `at` desc); deleted after 1 year |

Tenant (forced row level security): `workspace_security` (`workspace_id` pk, `require_two_factor` bool default false, audit columns), with room for `allowed_methods` when SSO comes.

### API surface

Better Auth routes added to `AUTH_ROUTES` (all others stay 404): `/two-factor/enable`, `/two-factor/disable`, `/two-factor/get-totp-uri`, `/two-factor/verify-totp`, `/two-factor/verify-backup-code`, `/two-factor/generate-backup-codes`, and the passkey plugin's register options, register verify, authenticate options and authenticate verify routes. `/two-factor/send-otp` and `/two-factor/verify-otp` (email second factor) stay shut, since email is already the first step. The step up check runs in a before hook on the enable, disable, generate and passkey register routes.

oRPC procedures (behind a session, no workspace unless stated):

| Procedure | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|
| `account.security.get` | none | `{ twoFactor: { on, methods }, backupCodesLeft, passkeys[], requiredBy: workspaceName[] }` | session | 401 |
| `account.sessions.list` | cursor | `[{ id, deviceLabel, country, city, lastActiveAt, current }]` | session | 401 |
| `account.sessions.revoke` | `sessionId` | none | session, own session only | 404 |
| `account.sessions.revokeOthers` | none | `{ count }` | session, fresh | 403 `STEP_UP_REQUIRED` |
| `account.stepUp.start` | `method` (`email`, `totp`, `passkey`, `backup`) | for email: code sent | session | 429 |
| `account.stepUp.verify` | `method`, `code` or passkey response | `{ verifiedUntil }` | session | 422 `CODE_INVALID`, 429 |
| `account.passkeys.rename`, `.remove` | `id`, `name?` | none | session, fresh for remove | 403, 404 |
| `account.activity.list` | cursor | security events, newest first | session | 401 |
| `workspace.security.get`, `.set` | `workspace`, `requireTwoFactor` | the row, `membersWithout` | `security.manage` | 403, 409 `OWNER_NEEDS_TWO_FACTOR` |

Door change: `enterWorkspace` reads `workspace_security.require_two_factor` in its one query and compares it with the session user's `twoFactorEnabled` (passed in from the session); refuses 403 `TWO_FACTOR_REQUIRED`. `access.mine` is the one procedure that still answers (with `twoFactorRequired: true`) so the app can show the setup page.

### Value sourcing

| Action | Value | Source |
|---|---|---|
| TOTP | issuer | the product name constant, `PRODUCT_NAME` in contracts |
| TOTP | secret, QR | Better Auth's `get-totp-uri` |
| backup codes | count, format | Better Auth's `backupCodeOptions` (10 codes) |
| passkey | relying party id, origin | the host and origin of `APP_URL` |
| sessions | device label | the session's `user_agent` parsed once at sign in into `device_label` |
| sessions | place | `x-vercel-ip-country` and `x-vercel-ip-city` from the edge, forwarded as trusted headers only from the edge guard, stored at sign in |
| sessions | last active | `auth.session.updated_at` (Better Auth refreshes it daily, `updateAge`) |
| alerts | new device | `device_key` absent from `auth.known_device`, or `last_seen` older than 90 days |
| step up | fresh | `auth.session.verified_at` within 10 minutes (`STEP_UP_MINUTES`) |
| workspace requirement | members without | active members whose user has `two_factor_enabled` false, read by the identity store for the member user ids |
| door | the user's two factor state | the session read (`AuthSession.user.twoFactorEnabled`) |

### Key invariants

- No session exists for a two factor account until the second step passes (or a valid remembered device, or a passkey).
- An email code never removes or bypasses the second factor.
- A session id, never a token, leaves the server; a person can revoke only their own sessions.
- A workspace that requires two factor never answers a workspace procedure to someone without it (except `access.mine`'s flag).
- Secrets and codes never reach logs, audit rows or security events.
- The served Better Auth routes are exactly the pinned list.

### Security model

- STRIDE: spoofing (second factor, passkeys bound to origin), tampering (encrypted secrets, signed cookies), repudiation (security events per user, audit row per workspace setting), disclosure (no tokens on the wire, no codes in logs), denial of service (attempt limits per pending sign in and per account, not per IP alone), elevation (step up for every change to the factors themselves).
- Geo headers are trusted only when the edge guard set them, the same rule as the client IP today.
- Sign in alert emails carry no action link that changes anything.
- `security-access-reviewer` on every milestone; an OWASP ASVS level 2 checklist for authentication (V2) and session management (V3) is filled in `verify.md`.

### Configuration required

No new secrets: `BETTER_AUTH_SECRET` encrypts TOTP secrets; `APP_URL` gives the passkey relying party. New dependency: `@better-auth/passkey`, pinned exactly in the catalog at the version matching `better-auth` 1.7.7. The edge Worker forwards `x-vercel-ip-country` and `x-vercel-ip-city` to the API beside the client IP.

### Screens

- **Account › Security** (spec 0026's Account group, after Profile): sections Two factor sign in (status row, Set up or Turn off; the authenticator dialog with QR, code and backup codes), Passkeys (list, Add passkey), Devices (as Notion lays it out: "Sign out of all other devices", then the device rows), Recent activity.
- **Workspace › Security** (owners only): Require two factor sign in (a switch row with the members count), later sign in methods and SSO.
- **Sign in**: "Sign in with a passkey" under the email field; the second step page (6 digit input, "Use a passkey", "Use a backup code", "Remember this device for 30 days").
- **Required page**: inside the workspace frame's empty layout, "Acme requires two factor sign in", Set up now, Switch workspace.

### Critical test scenarios

- Happy path: turn on the app, sign out, sign in by email code, enter the TOTP, land in the app; sign in again with "remember" and skip the step, verifies **AC-881**, **AC-882**, **AC-884**.
- Google: the same account signing in with Google is stopped at the second step, verifies **AC-882**.
- Brute force: 5 wrong codes lock the step for 15 minutes; a new email code doesn't reset the per account count, verifies **AC-882**.
- Recovery: a backup code signs in once and not twice; an email code can't turn two factor off, verifies **AC-883**, **AC-885**.
- Passkey: register (virtual authenticator in Playwright), sign out, sign in with the passkey alone, verifies **AC-887**, **AC-888**.
- Sessions: two browsers; revoke one from the other, its next request is signed out and its live connection closes with 4501; another user's session id answers `NOT_FOUND`; the list carries no token, verifies **AC-890**, **AC-891**, **AC-892**.
- Requirement: an owner without two factor can't turn it on; with it on, a member without two factor gets `TWO_FACTOR_REQUIRED` and the setup page, sets it up and continues; their other workspace was never affected, verifies **AC-893**, **AC-894**.
- Alerts: a new browser signs in and one email goes out; the same browser again sends none, verifies **AC-897**.
- Routes: the served Better Auth route set equals the pinned list, verifies **AC-900**.

## Account deletion (added 21 October 2026, the owner)

A person can delete their own account from Account › Security. Lean on purpose: it reuses the step up and the members lane's removal.

**Acceptance criteria**:
- **AC-902**: A danger zone at the foot of Account › Security has "Delete account". It opens a danger Modal that first lists every workspace where the person is the last active owner, each linked to its Members settings to hand ownership on (or delete the workspace); while any is listed, nothing can be deleted (409 `LAST_OWNER`).
- **AC-903**: Confirming needs a fresh step up (AC-896; with two factor on, the second factor itself) and the account's email typed in full. The dialog reminds the person to export what they need from each workspace first.
- **AC-904**: Deleting, per workspace in that workspace's own transaction: the member is removed through `removeMember` (their private views and calendar connections go with them), their member row keeps its id but its name becomes "Deleted user" and its email a placeholder that names no one, and one `account.deleted` audit row is written. Records, notes and tasks they made stay, credited to "Deleted user".
- **AC-905**: Then, outside any workspace: calendar grants are revoked with the provider (best effort), and the `auth.user` row is deleted, which takes their sessions, Google link, two factor, passkeys, preferences, directory rows and security history with it; remembered devices, step up codes, sign in codes and the per email rate limit rows go too. Their live connections are cut (4501).
- **AC-906**: A final email goes to the old address, saying the account was deleted and when. It holds no link that changes anything.
- **AC-907**: Every step can run again: a failure part way leaves the person signed in, and confirming again finishes what is left (a workspace already left is skipped). Tests show a stale session refused, the last owner refusal, and that no personal data of theirs remains in `auth` or in a member row.

**Decision for the owner**: no grace window. Deletion is immediate once confirmed, because the step up and the typed email already make it deliberate, and a pending state would keep personal data and a half signed in account around. If the owner prefers a 7 day window (sign in again to cancel), it is a later change: a `deletion_requested_at` on the user and the daily cleanup finishing it.

**API**: `account.deletion.check` answers the blocking workspaces (`{ blockers: [{ slug, name }] }`); `account.deletion.confirm({ email })` deletes (403 `STEP_UP_REQUIRED` or `SECOND_FACTOR_REQUIRED`, 409 `LAST_OWNER`, 400 when the email doesn't match). Both need a session and no workspace.

## Build plan

Tracer Bullet: each milestone ends with something you can use in production.

**Milestone 1: sessions you can see and end** (no new dependency)
1. Migration: session `country`, `city`, `device_label`, `verified_at`; `auth.security_event`; the edge forwards geo headers; sign in fills them, satisfies **AC-890**, **AC-898**
2. `account.sessions.list`, `.revoke`, `.revokeOthers` (step up stubbed to "signed in within 10 minutes" until milestone 2's step up), the 4501 disconnect; Account › Security with Devices, satisfies **AC-890** to **AC-892**
3. Deploy; sign out a second real browser from the first in production; `security-access-reviewer`

**Milestone 2: authenticator app and backup codes**
4. Spike: does the `twoFactor` plugin in password less mode hold back the session on the email code and Google routes? Add the after hook if not; record the answer in `verify.md`, satisfies **AC-882**
5. Migration: `two_factor_enabled`, `auth.two_factor`, trusted devices; plugin config; `AUTH_ROUTES` extended and pinned; attempt limits, satisfies **AC-881** to **AC-886**, **AC-900**
6. Step up (`account.stepUp.*`, the before hook), satisfies **AC-896**
7. Screens: the Two factor section and dialog, the second step page, satisfies **AC-881**, **AC-882**, **AC-901**

**Milestone 3: passkeys**
8. Add `@better-auth/passkey` to the catalog; migration `auth.passkey`; routes; Passkeys section; "Sign in with a passkey", satisfies **AC-887** to **AC-889**

**Milestone 4: workspace requirement and alerts**
9. `security.manage` in the catalog (owner only, pinned table updated); migration `workspace_security`; the door check and `access.mine` flag; Workspace › Security; the required page; the Members column, satisfies **AC-893** to **AC-895**, **AC-899**
10. `auth.known_device`, the alert job and email, satisfies **AC-897**
11. Recent activity list; the daily cleanup deletes year old events; ASVS checklist in `verify.md`; `/check verify`, satisfies **AC-898**, all

**Account deletion** (after milestone 2, it needs the step up)
12. `account.deletion.check` and `.confirm`, the `account.deleted` audit action, the farewell email, the danger zone and its Modal, satisfies **AC-902** to **AC-907**

## Consequences

**Positive**:
- Email access alone no longer opens an account with two factor on, which matters because email is the first step.
- People can find and end a stolen session themselves.
- Owners can raise the floor for the whole workspace.

**Negative / tradeoffs**:
- A person who loses their device and their backup codes needs support; there is no self service reset by design.
- One new dependency (`@better-auth/passkey`) and four more auth routes to review on every Better Auth upgrade.
- The door's query reads one more row; measured against spec 0009's 5 ms budget.
- "Last active" is only accurate to a day, from Better Auth's session refresh.
- Previews and production have separate passkeys.

**Neutral**:
- Four migrations in the `auth` schema and one tenant table.
- Sign in alerts add one email per new device.

## Follow-up

- [ ] SSO (SAML or OIDC through Better Auth's SSO plugin) and "allowed sign in methods" on `workspace_security`, for a later plan.
- [ ] Support assisted recovery flow with #39.
- [ ] Owner view of who has two factor in the audit log screens (#36).
- [ ] `/sync`: `apps/api/AGENTS.md` lists the pinned auth routes and the 4501 code.
- [ ] Account deletion: member rows in workspaces the person left before deleting keep their name and address (the directory no longer leads there); scrubbing them needs a narrow privileged path across workspaces. Accepted invitations and queued emails keep the address too.
